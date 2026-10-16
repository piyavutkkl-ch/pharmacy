-- =====================================================================
--  ขั้นที่ 66: ยาสูตรผสม (สารสำคัญมากกว่า 1 ตัว เช่น co-trimoxazole) · รันซ้ำได้ · ไม่ลบข้อมูล
--   local_drugs.ingredients = [{name, mg, per: 'tab'|'5ml'|'ml'}] ปริมาณสารสำคัญแต่ละตัวต่อหน่วย (ผู้ดูแลแก้ได้)
--   dose_drugs.indications[].basis = ชื่อสารสำคัญที่ใช้คิดขนาดยา (เช่น Trimethoprim) → เครื่องคำนวณใช้ปริมาณของสารนั้นคิดจำนวนเม็ด/มล.
--   ① ใส่สารสำคัญของ co-trimoxazole (เม็ด 400/80 มก. · ยาน้ำ 200/40 มก./5 มล.) ถ้ายังไม่มี
--   ② AI ร่างขนาดยา: บอก basis ของยาสูตรผสม · ③ ตรวจข้อมูลเดิม: อ่าน basis จากข้อความฉลาก (quote) เช่น "8 mg/kg trimethoprim"
-- =====================================================================

alter table public.local_drugs add column if not exists ingredients jsonb
  check (ingredients is null or (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) <= 10 and octet_length(ingredients::text) <= 2000));

-- ① co-trimoxazole (ขนาดมาตรฐานในประเทศไทย)
update public.local_drugs set ingredients = '[{"name":"Sulfamethoxazole","mg":400,"per":"tab"},{"name":"Trimethoprim","mg":80,"per":"tab"}]'
 where ingredients is null and name ~* 'co-?trimoxazole' and (unit ~* 'tab' or name ~* 'tab');
update public.local_drugs set ingredients = '[{"name":"Sulfamethoxazole","mg":200,"per":"5ml"},{"name":"Trimethoprim","mg":40,"per":"5ml"}]'
 where ingredients is null and name ~* 'co-?trimoxazole' and name ~* 'susp|syr';

create or replace function public.ai_dose_step(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_dose_drafts; rx record; fda record; res record; lab jsonb; rxl jsonb; txt text; j jsonb; inds jsonb;
        k text; model text; prompt text; nreq bigint;
begin
  select * into r from public.ai_dose_drafts where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายการนี้'; end if;

  if r.status = 'pending' and r.stage in ('fetch', 'fetch2') then
    select h.status_code, h.content into rx from net._http_response h where h.id = r.rx_req;
    select h.status_code, h.content into fda from net._http_response h where h.id = r.fda_req;
    if (rx.status_code is null or fda.status_code is null) and r.created_at > now() - interval '1 minute' then
      null;   -- ยังรอ
    elsif r.stage = 'fetch' and fda.status_code = 404 then   -- ไม่พบชื่อตรงตัว → ค้นแบบคำใกล้เคียง
      update public.ai_dose_drafts set stage = 'fetch2', fda_req = public.ai_dose_fda(r.query, false) where id = r.id returning * into r;
    else
      -- RxNorm: ยาชื่อสามัญ (SCD) เช่น "amoxicillin 250 MG/5ML Oral Suspension" · ไม่มี = ยาชื่อการค้า (SBD)
      begin
        with c as (
          select g->>'tty' tty, p->>'name' nm
            from jsonb_array_elements(case when rx.status_code = 200 then coalesce(rx.content::jsonb #> '{drugGroup,conceptGroup}', '[]') else '[]' end) g,
                 jsonb_array_elements(coalesce(g->'conceptProperties', '[]')) p
           where g->>'tty' in ('SCD', 'SBD'))
        select coalesce(jsonb_agg(nm order by nm), '[]') into rxl
          from (select distinct left(nm, 200) nm from c
                 where tty = case when exists (select 1 from c where tty = 'SCD') then 'SCD' else 'SBD' end
                 limit 40) x;
      exception when others then rxl := '[]';
      end;
      begin
        select case when fda.status_code = 200 then jsonb_strip_nulls(jsonb_build_object(
                 'brand', left(x->'openfda'->'brand_name'->>0, 120), 'generic', left(x->'openfda'->'generic_name'->>0, 200),
                 'effective', left(x->>'effective_time', 8), 'set_id', left(x->>'set_id', 60),
                 'dosage', left(nullif(btrim(x->'dosage_and_administration'->>0), ''), 12000),
                 'indications', left(nullif(btrim(x->'indications_and_usage'->>0), ''), 2500),
                 'pediatric', left(nullif(btrim(x->'pediatric_use'->>0), ''), 2500))) end
          into lab from (select fda.content::jsonb #> '{results,0}' x) t where x is not null;
      exception when others then lab := null;
      end;
      if lab ? 'dosage' then
        begin
          k := public.ai_key();
          prompt := 'คุณเป็นเภสัชกรผู้ช่วยตั้งค่าเครื่องคำนวณขนาดยาตามน้ำหนักตัว (มก./กก. หรือ ไมโครกรัม/กก.) สำหรับ รพ.สต. ในประเทศไทย' || E'\n'
            || 'อ่าน "ฉลากยา" (US FDA ภาษาอังกฤษ) ด้านล่าง แล้วสกัดขนาดยาที่ฉลากระบุเป็นต่อน้ำหนักตัว (mg/kg หรือ mcg/kg) เท่านั้น (ส่วนใหญ่เป็นขนาดยาเด็ก) แยกตามข้อบ่งใช้' || E'\n'
            || 'กฎ: ห้ามเดา ห้ามใช้ความรู้นอกฉลาก · ถ้าฉลากไม่มีขนาดยาต่อน้ำหนักตัว ให้ indications ว่าง · ทุกข้อต้องมี quote = ข้อความจากฉลากตรงตัว (ภาษาอังกฤษ ไม่เกิน 300 ตัวอักษร) ที่ใช้เป็นที่มาของตัวเลข' || E'\n'
            || '· per = "day" ถ้าฉลากให้เป็นต่อวัน (แล้ว times = จำนวนครั้งที่แบ่งให้ต่อวัน) หรือ "dose" ถ้าเป็นต่อครั้ง · unit = "mcg" ถ้าฉลากใช้ mcg/kg (microgram เช่น levothyroxine) หรือ "mg" ถ้าใช้ mg/kg ห้ามแปลงหน่วยเอง · min/max = ตัวเลขต่อ กก. ในหน่วย unit (ถ้าฉลากให้ค่าเดียว min = max)' || E'\n'
            || '· ยาสูตรผสม (สารสำคัญมากกว่า 1 ตัว เช่น sulfamethoxazole + trimethoprim): basis = ชื่อสารสำคัญที่ฉลากใช้คิดขนาดยา (ภาษาอังกฤษตามฉลาก) · ถ้าฉลากให้ขนาดของหลายสาร ให้แยกเป็นคนละข้อ · ยาเดี่ยว basis = null' || E'\n'
            || '· cap = ขนาดสูงสุดต่อครั้ง (หน่วยเดียวกับ unit) ถ้าฉลากระบุ · name = ข้อบ่งใช้ภาษาไทยสั้น ๆ · freq = ความถี่/ระยะเวลาเป็นภาษาไทยสั้น ๆ · renal = การปรับขนาดในโรคไตเป็นภาษาไทยสั้น ๆ ถ้าฉลากระบุ' || E'\n'
            || 'ตอบเป็น JSON เท่านั้น: {"indications": [{"name": "...", "basis": null, "unit": "mg|mcg", "per": "dose|day", "min": 0, "max": 0, "times": null, "cap": null, "freq": "...", "renal": null, "quote": "..."}]} (ไม่เกิน 6 ข้อ)' || E'\n\n'
            || 'ชื่อยา: ' || coalesce(lab->>'generic', r.query) || E'\n'
            || 'DOSAGE AND ADMINISTRATION:' || E'\n' || (lab->>'dosage') || E'\n\n'
            || coalesce('PEDIATRIC USE:' || E'\n' || (lab->>'pediatric') || E'\n\n', '')
            || coalesce('INDICATIONS AND USAGE:' || E'\n' || (lab->>'indications'), '');
          model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
          nreq := net.http_post(
            url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
            body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                                       'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
            timeout_milliseconds := 90000);
          update public.ai_dose_drafts set stage = 'ai', request_id = nreq, ai_job = public.ai_job_of(nreq), sent_at = now(),
                 result = jsonb_build_object('rx', rxl, 'label', lab)
           where id = r.id returning * into r;
        exception when others then
          update public.ai_dose_drafts set status = 'done', done_at = now(), result = jsonb_build_object('rx', rxl, 'label', lab),
                 note = 'AI ยังไม่พร้อมใช้งาน จึงยังไม่ได้ร่างขนาดยา · ดูข้อความฉลากด้านล่างแล้วกรอกเอง'
           where id = r.id returning * into r;
        end;
      elsif jsonb_array_length(rxl) = 0 and rx.status_code is distinct from 200 and fda.status_code is distinct from 200 and fda.status_code is distinct from 404 then
        update public.ai_dose_drafts set status = 'error', done_at = now(), note = 'เชื่อมต่อฐานข้อมูลยา (RxNorm/openFDA) ไม่ได้ กรุณาลองใหม่ภายหลัง'
         where id = r.id returning * into r;
      else
        update public.ai_dose_drafts set status = 'done', done_at = now(), result = jsonb_build_object('rx', rxl, 'label', lab),
               note = case when jsonb_array_length(rxl) = 0 and lab is null then 'ไม่พบยานี้ในฐานข้อมูล กรุณาตรวจตัวสะกดชื่อสามัญภาษาอังกฤษ'
                           else 'ไม่พบข้อความขนาดยาในฉลากยา openFDA · ใส่ได้เฉพาะความแรงจาก RxNorm' end
         where id = r.id returning * into r;
      end if;
    end if;

  elsif r.status = 'pending' and r.stage = 'ai' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'name', left(btrim(e->>'name'), 200),
                   'basis', left(nullif(btrim(e->>'basis'), ''), 60),
                   'unit', case when e->>'unit' = 'mcg' or (e->>'unit' is null and e->>'quote' ~* '(mcg|microgram|µg)\s*/\s*kg') then 'mcg' end,
                   'per', case when e->>'per' = 'day' then 'day' else 'dose' end,
                   'min', (e->>'min')::numeric, 'max', (e->>'max')::numeric,
                   'times', case when e->>'per' = 'day' and e->>'times' ~ '^\d{1,2}$' and (e->>'times')::int between 1 and 12 then (e->>'times')::int end,
                   'cap', case when e->>'cap' ~ '^\d+(\.\d+)?$' then (e->>'cap')::numeric end,
                   'freq', left(nullif(btrim(e->>'freq'), ''), 120),
                   'renal', left(nullif(btrim(e->>'renal'), ''), 1000),
                   'quote', left(nullif(btrim(e->>'quote'), ''), 400))) order by n), '[]')
            into inds
            from jsonb_array_elements(case when jsonb_typeof(j->'indications') = 'array' then j->'indications' else '[]' end) with ordinality t(e, n)
           where n <= 6 and btrim(coalesce(e->>'name', '')) <> ''
             and e->>'min' ~ '^\d+(\.\d+)?$' and e->>'max' ~ '^\d+(\.\d+)?$' and (e->>'max')::numeric >= (e->>'min')::numeric;
          update public.ai_dose_drafts set status = 'done', done_at = now(), result = r.result || jsonb_build_object('ai', inds),
                 note = case when jsonb_array_length(inds) = 0 then 'ฉลากยาไม่มีขนาดยาต่อน้ำหนักตัว (มก./กก. หรือ mcg/กก.) ที่ AI ยืนยันได้ · ดูข้อความฉลากด้านล่างแล้วกรอกเอง' end
           where id = r.id returning * into r;
        exception when others then
          update public.ai_dose_drafts set status = 'done', done_at = now(), note = 'อ่านคำตอบของ AI ไม่ได้ · ดูข้อความฉลากด้านล่างแล้วกรอกเอง หรือกดลองใหม่'
           where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_dose_drafts set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_dose_drafts set status = 'done', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false))
           where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '3 minutes' then
      update public.ai_dose_drafts set status = 'done', done_at = now(), note = 'หมดเวลารอ AI · ดูข้อความฉลากด้านล่างแล้วกรอกเอง หรือกดลองใหม่' where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result, 'note', r.note, 'query', r.query);
end $$;

create or replace function public.ai_dose_convert(p_id bigint)
returns text language plpgsql security definer
set search_path = ''
as $$
declare fac numeric; d public.ai_dose_drafts; res jsonb; inds jsonb; concs jsonb; f jsonb; lab jsonb; new_id bigint; outcome text;
begin
  select * into d from public.ai_dose_drafts where id = p_id for update;
  if d.id is null or d.converted or d.status = 'pending' then return null; end if;
  res := coalesce(d.result, '{}');
  if d.status = 'error' then outcome := 'error';
  elsif public.dose_has(d.auto_name) then outcome := 'done';
  elsif res ? 'ai' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', e->'name', 'basis', e->'basis', 'unit', e->'unit', 'per', e->'per', 'min', e->'min', 'max', e->'max',
             'times', case when e->>'per' = 'day' then e->'times' end, 'cap', e->'cap', 'freq', e->'freq', 'renal', e->'renal', 'quote', e->'quote')) order by n)
      into inds
      from jsonb_array_elements(res->'ai') with ordinality t(e, n)
     where n <= 20 and coalesce(e->>'name', '') <> '' and jsonb_typeof(e->'min') = 'number' and jsonb_typeof(e->'max') = 'number'
       and (e->>'max')::numeric >= (e->>'min')::numeric;
    outcome := case when inds is null then 'none' else 'draft' end;
  elsif res->'label' ? 'dosage' then outcome := 'ai_error';   -- มีฉลาก แต่ AI ไม่ตอบ (ไม่ว่าง/โควตา/หมดเวลา)
  else outcome := 'none';
  end if;

  if outcome = 'draft' then
    select coalesce(jsonb_agg(c order by k), '[]') into concs
      from (select distinct on (c->>'label') c, k from jsonb_array_elements_text(coalesce(res->'rx', '[]')) with ordinality r(nm, k)
              cross join lateral (select public.rx_conc(r.nm) as c) z where c is not null order by c->>'label', k) u;
    f := inds->0; lab := coalesce(res->'label', '{}'); fac := case when f->>'unit' = 'mcg' then 0.001 else 1 end;   -- ช่องเดิม (mg_per_kg_*) เก็บเป็น มก.
    insert into public.dose_drugs (name, form, indications, indication, per, mg_per_kg_min, mg_per_kg_max, dose_freq_per_day, max_mg_per_dose, freq, renal_note,
                                   concs, sort, active, ai_draft, ai_source)
    values (left(d.auto_name, 120),
            case when jsonb_array_length(concs) = 0 then 'อื่น ๆ'
                 when not exists (select 1 from jsonb_array_elements(concs) c where not c ? 'mgPerTab') then 'ยาเม็ด'
                 when not exists (select 1 from jsonb_array_elements(concs) c where c ? 'mgPerTab') then 'ยาน้ำ' else 'อื่น ๆ' end,
            inds, f->>'name', f->>'per', (f->>'min')::numeric * fac, (f->>'max')::numeric * fac, (f->>'times')::smallint, (f->>'cap')::numeric * fac, f->>'freq', f->>'renal',
            concs, coalesce((select max(sort) + 1 from public.dose_drugs), 0), false, true,
            left('AI ร่างจากฉลากยา openFDA' || coalesce(' ' || (lab->>'brand'), '') || coalesce(' ฉบับ ' || (lab->>'effective'), '') || ' + ความแรงจาก RxNorm · ยังไม่ผ่านการตรวจ', 500))
    returning id into new_id;
    update public.local_drugs set dose_id = new_id, dose_ai_status = 'done', dose_ai_note = null, dose_ai_at = now() where id in (select public.dose_group(d.auto_name));
  elsif outcome = 'done' then
    update public.local_drugs set dose_ai_status = 'done', dose_ai_note = null, dose_ai_at = now() where id in (select public.dose_group(d.auto_name));
  else
    update public.local_drugs set dose_ai_status = case when outcome = 'none' then 'none' else 'error' end, dose_ai_at = now(),
           dose_ai_note = left(coalesce(d.note, case when outcome = 'none' then 'ฉลากยาไม่มีขนาดยาแบบ มก./กก.' else 'AI ไม่ว่าง · ระบบจะลองใหม่' end), 300)
     where id in (select public.dose_group(d.auto_name));
  end if;
  update public.ai_dose_drafts set converted = true where id = d.id;
  return outcome;
end $$;

revoke execute on function public.ai_dose_step(bigint), public.ai_dose_convert(bigint) from public, anon, authenticated;

-- ③ ข้อมูลขนาดยาเดิมที่ยังไม่มี basis: ตัวเลขในข้อความฉลากตามด้วยชื่อสารสำคัญ เช่น "8 mg/kg trimethoprim" / "40 mg/kg of sulfamethoxazole"
update public.dose_drugs d
   set indications = x.inds
  from (select id, jsonb_agg(case
                 when not (e ? 'basis') and e ? 'quote' and e ? 'min'
                      and substring(lower(e->>'quote') from '(?:^|[^0-9.])' || replace(e->>'min', '.', '\.') || '\s*(?:mg|mcg)\s*/\s*kg(?:/day|/dose| per day)?\s*(?:of\s+|as\s+)?(sulfamethoxazole|trimethoprim|amoxicillin|clavulanate|clavulanic acid)') is not null
                 then e || jsonb_build_object('basis', initcap(substring(lower(e->>'quote') from '(?:^|[^0-9.])' || replace(e->>'min', '.', '\.') || '\s*(?:mg|mcg)\s*/\s*kg(?:/day|/dose| per day)?\s*(?:of\s+|as\s+)?(sulfamethoxazole|trimethoprim|amoxicillin|clavulanate|clavulanic acid)')))
                 else e end order by n) as inds
          from public.dose_drugs, jsonb_array_elements(indications) with ordinality t(e, n)
         group by id) x
 where d.id = x.id and d.indications is distinct from x.inds;

select 'ok' as step_66_combo, (select count(*) from public.local_drugs where ingredients is not null) as combo_drugs;
