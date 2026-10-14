-- =====================================================================
--  ขั้นที่ 50: ผู้ดูแล › ตั้งค่า › รายการยา — ปุ่ม "ช่วยกรอกจากฐานข้อมูล" · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ① ฐานข้อมูลดึง (pg_net · ฟรี ไม่ใช้คีย์) RxNorm (NLM) = ชื่อยา + ความแรง · openFDA = ฉลากยา (ขนาดยา/ข้อบ่งใช้ ภาษาอังกฤษ)
--   ② ส่งข้อความฉลาก (ข้อมูลสาธารณะ ไม่มีข้อมูลผู้ป่วย) ให้ Gemini ร่างขนาดยา มก./กก. พร้อมข้อความอ้างอิงจากฉลาก
--   ③ หน้าเว็บแสดงให้ผู้ดูแลเลือกใส่ลงฟอร์ม → ตรวจ/แก้เองก่อนกดบันทึก (ระบบไม่บันทึกรายการยาเอง)
--   AI ไม่ว่าง → ลองรุ่นสำรองเหมือน 49_ai_retry.sql · AI ไม่สำเร็จ = ยังได้ความแรงจาก RxNorm + ข้อความฉลาก
-- =====================================================================

create table if not exists public.ai_dose_drafts (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  query       text not null check (char_length(query) between 2 and 80),
  stage       text not null default 'fetch' check (stage in ('fetch', 'fetch2', 'ai')),
  rx_req      bigint,
  fda_req     bigint,
  request_id  bigint,
  ai_job      bigint,
  sent_at     timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result      jsonb,
  note        text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
alter table public.ai_dose_drafts enable row level security;
drop policy if exists add_read on public.ai_dose_drafts;
create policy add_read on public.ai_dose_drafts for select to authenticated using (public.is_admin());
revoke all on public.ai_dose_drafts from anon, authenticated;
grant select on public.ai_dose_drafts to authenticated;
grant all on public.ai_dose_drafts to service_role;

/** จำคำขอ Gemini ที่เพิ่งเข้าคิวไว้ ให้ ai_resend ส่งใหม่ด้วยรุ่นสำรองได้ (เหมือน trigger ai_job_capture) */
create or replace function public.ai_job_of(p_req bigint)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare q record; jid bigint;
begin
  execute 'select url, body, timeout_milliseconds from net.http_request_queue where id = $1' into q using p_req;
  if q.url is null then return null; end if;
  insert into public.ai_jobs (body, models, timeout_ms)
  values (q.body, public.ai_models(substring(q.url from '/models/([^/:]+):')), coalesce(q.timeout_milliseconds, 90000))
  returning id into jid;
  return jid;
end $$;
revoke execute on function public.ai_job_of(bigint) from public, anon, authenticated;

/** ค้นฉลากยา openFDA: ครั้งแรกชื่อสามัญตรงตัว (ไม่เอายาสูตรผสม) · ไม่พบ → ค้นแบบคำใกล้เคียง */
create or replace function public.ai_dose_fda(p_q text, p_exact boolean)
returns bigint language sql security definer
set search_path = ''
as $$
  select net.http_get('https://api.fda.gov/drug/label.json',
    params := jsonb_build_object('search', case when p_exact then 'openfda.generic_name.exact:"' || upper(p_q) || '"' else 'openfda.generic_name:"' || p_q || '"' end, 'limit', '1'),
    timeout_milliseconds := 20000)
$$;
revoke execute on function public.ai_dose_fda(text, boolean) from public, anon, authenticated;

create or replace function public.ai_dose_start(p_name text)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare q text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')); new_id bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if q !~ '^[a-z][a-z0-9 .,()/+-]{1,79}$' then
    raise exception 'กรุณาพิมพ์ชื่อสามัญภาษาอังกฤษในชื่อยา เช่น พาราเซตามอล (Paracetamol)';
  end if;
  if (select count(*) from public.ai_dose_drafts d where d.user_id = auth.uid() and d.created_at > now() - interval '1 day') >= 30 then
    raise exception 'ใช้ช่วยกรอกครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  perform public.ai_key();   -- ตรวจความพร้อม (pg_net · คีย์ Gemini) ก่อนเริ่ม
  insert into public.ai_dose_drafts (user_id, query, rx_req, fda_req)
  values (auth.uid(), q,
          net.http_get('https://rxnav.nlm.nih.gov/REST/drugs.json', params := jsonb_build_object('name', q), timeout_milliseconds := 20000),
          public.ai_dose_fda(q, true))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.ai_dose_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_dose_drafts; rx record; fda record; res record; lab jsonb; rxl jsonb; txt text; j jsonb; inds jsonb;
        k text; model text; prompt text; nreq bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
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
          prompt := 'คุณเป็นเภสัชกรผู้ช่วยตั้งค่าเครื่องคำนวณขนาดยาตามน้ำหนักตัว (มก./กก.) สำหรับ รพ.สต. ในประเทศไทย' || E'\n'
            || 'อ่าน "ฉลากยา" (US FDA ภาษาอังกฤษ) ด้านล่าง แล้วสกัดขนาดยาที่ฉลากระบุเป็น มก./กก. เท่านั้น (ส่วนใหญ่เป็นขนาดยาเด็ก) แยกตามข้อบ่งใช้' || E'\n'
            || 'กฎ: ห้ามเดา ห้ามใช้ความรู้นอกฉลาก · ถ้าฉลากไม่มีขนาดยาแบบ มก./กก. ให้ indications ว่าง · ทุกข้อต้องมี quote = ข้อความจากฉลากตรงตัว (ภาษาอังกฤษ ไม่เกิน 300 ตัวอักษร) ที่ใช้เป็นที่มาของตัวเลข' || E'\n'
            || '· per = "day" ถ้าฉลากให้เป็นต่อวัน (แล้ว times = จำนวนครั้งที่แบ่งให้ต่อวัน) หรือ "dose" ถ้าเป็นต่อครั้ง · min/max = มก./กก. (ถ้าฉลากให้ค่าเดียว min = max)' || E'\n'
            || '· cap = ขนาดสูงสุดต่อครั้ง (มก.) ถ้าฉลากระบุ · name = ข้อบ่งใช้ภาษาไทยสั้น ๆ · freq = ความถี่/ระยะเวลาเป็นภาษาไทยสั้น ๆ · renal = การปรับขนาดในโรคไตเป็นภาษาไทยสั้น ๆ ถ้าฉลากระบุ' || E'\n'
            || 'ตอบเป็น JSON เท่านั้น: {"indications": [{"name": "...", "per": "dose|day", "min": 0, "max": 0, "times": null, "cap": null, "freq": "...", "renal": null, "quote": "..."}]} (ไม่เกิน 6 ข้อ)' || E'\n\n'
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
                 note = case when jsonb_array_length(inds) = 0 then 'ฉลากยาไม่มีขนาดยาแบบ มก./กก. ที่ AI ยืนยันได้ · ดูข้อความฉลากด้านล่างแล้วกรอกเอง' end
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

revoke execute on function public.ai_dose_start(text), public.ai_dose_poll(bigint) from public, anon;
grant execute on function public.ai_dose_start(text), public.ai_dose_poll(bigint) to authenticated;

select 'ok' as step_50_ai_dose;
