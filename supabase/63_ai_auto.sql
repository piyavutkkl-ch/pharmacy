-- =====================================================================
--  ขั้นที่ 63: งาน AI ที่ระบบทำเอง (ไม่ต้องรอผู้ดูแลกด) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ai_auto_tick(): pg_cron เรียกทุกนาที (ถ้าเปิด pg_cron ได้) + GitHub Actions ai-news เรียกทุกชั่วโมงสำรอง (tools/ai_news/run.mjs --check · secret key)
--   ① แปลไทย: ฉลาก openFDA (ผูกกับยา รพ.สต. ก่อน) → คู่ drug interaction (รุนแรงก่อน) · ไม่จำกัดจำนวน (เจ้าของเว็บ)
--      ส่งทีละ 1 รายการ: รอคำตอบก่อนส่งรายการถัดไป · ไม่ทับข้อความไทยที่มีอยู่/ผู้ดูแลแก้แล้ว
--   ② ร่างขนาดยา: ยารับประทานของ รพ.สต. ที่ยังไม่มีข้อมูลคำนวณ (รวมตามชื่อยาในบัญชียาหลัก) ทีละ 1 ยา
--      RxNorm + ฉลาก openFDA → Gemini ร่าง มก./กก. (ขั้นตอนเดียวกับ 50_ai_dose.sql) → dose_drugs.ai_draft (ซ่อนจนผู้ดูแลกด "ตรวจแล้ว")
--      + ผูก local_drugs.dose_id · ฉลากไม่มีขนาดยาตามน้ำหนัก = dose_ai_status 'none' (ผู้ดูแลกรอกเอง)
--   AI ไม่ว่าง/ติดโควตา (ลองรุ่นสำรองแล้วยังไม่ได้ · 49_ai_retry.sql) → พักทุกงาน 30 นาที (site_texts ai_auto_pause) แล้วส่งรายการที่ยังไม่เสร็จใหม่
--   ส่งเฉพาะข้อมูลสาธารณะ (ฉลากยาสหรัฐฯ/DDInter/ชื่อยา) ไม่มีข้อมูลผู้ป่วย
-- =====================================================================

alter table public.drug_fda_labels add column if not exists th_auto_at timestamptz;
alter table public.ddi_pairs add column if not exists th_auto_at timestamptz;
alter table public.local_drugs add column if not exists dose_ai_status text;
alter table public.local_drugs drop constraint if exists local_drugs_dose_ai_status_check;
alter table public.local_drugs add constraint local_drugs_dose_ai_status_check check (dose_ai_status is null or dose_ai_status in ('pending', 'done', 'none', 'error'));
alter table public.local_drugs add column if not exists dose_ai_note text check (dose_ai_note is null or char_length(dose_ai_note) <= 300);
alter table public.local_drugs add column if not exists dose_ai_at timestamptz;
alter table public.ai_dose_drafts add column if not exists auto_name text;
alter table public.ai_dose_drafts add column if not exists converted boolean not null default false;

/* ---------- แปลไทย: ตัวทำงานภายใน (ไม่ตรวจสิทธิ์ · ไม่จำกัดจำนวนต่อวัน · หน้าเว็บเรียกตรงไม่ได้) ---------- */
create or replace function public.ai_fda_th_send(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.drug_fda_labels; k text; model text; prompt text; req bigint;
begin
  select * into r from public.drug_fda_labels where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบฉลากนี้'; end if;
  if r.th_status = 'pending' and r.th_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังแปลอยู่ กรุณารอสักครู่'; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกร แปลและเรียบเรียงข้อมูลจากฉลากยาสหรัฐอเมริกา (ภาษาอังกฤษ) ด้านล่าง เป็นภาษาไทยที่อ่านง่าย สำหรับเภสัชกรและเจ้าหน้าที่ รพ.สต. นำไปใช้ได้จริง' || E'\n'
    || '- แต่ละหัวข้อสรุปเป็นข้อ ๆ สั้น กระชับ ไม่เกิน 8 ข้อ เรียงเรื่องสำคัญก่อน' || E'\n'
    || '- ตัวเลข หน่วย ขนาดยา ความถี่ ช่วงอายุ และน้ำหนัก ต้องตรงกับต้นฉบับทุกตัว (ใช้ มก. มล. กก.)' || E'\n'
    || '- ชื่อยา ชื่อโรค หรือศัพท์เฉพาะ ใส่ภาษาอังกฤษในวงเล็บได้ · ห้ามเพิ่มข้อมูลที่ไม่มีในต้นฉบับ · ส่วนที่ต้นฉบับถูกตัด (…) ไม่ต้องเดา' || E'\n'
    || '- ใช้ชื่อหัวข้อ (title) เดิมตามที่ให้ ห้ามเปลี่ยน' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"sections": [{"title": "<title เดิม>", "points": ["ข้อความภาษาไทย", ...]}]}' || E'\n\n'
    || 'ยา: ' || coalesce(nullif(r.title, ''), r.generic) || ' (' || r.generic || ')' || E'\n' || r.sections::text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0.2)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000);
  update public.drug_fda_labels set th_status = 'pending', th_note = null, th_request_id = req, th_job = public.ai_job_of(req), th_sent_at = now() where id = r.id;
end $$;

create or replace function public.ai_fda_th_check(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.drug_fda_labels; res record; txt text; j jsonb; out jsonb; nreq bigint;
begin
  select * into r from public.drug_fda_labels where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบฉลากนี้'; end if;
  if r.th_status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.th_request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          -- เก็บเฉพาะหัวข้อที่มีในฉลาก (เรียงตามฉลาก) · ข้อละ ≤ 600 ตัวอักษร · ≤ 12 ข้อ/หัวข้อ
          select jsonb_agg(jsonb_build_object('title', s.title, 'body', s.pts) order by s.ord) into out
            from (select o.ord, o.e->>'title' as title,
                         (select jsonb_agg(left(btrim(pt), 600)) from (select pt from jsonb_array_elements_text(a.e->'points') with ordinality q(pt, n)
                            where btrim(pt) <> '' order by n limit 12) z) as pts
                    from jsonb_array_elements(r.sections) with ordinality o(e, ord)
                    join lateral (select x as e from jsonb_array_elements(coalesce(j->'sections', '[]')) x
                                   where x->>'title' = o.e->>'title' and jsonb_typeof(x->'points') = 'array' limit 1) a on true) s
           where s.pts is not null;
          if out is null then raise exception 'empty'; end if;
          update public.drug_fda_labels set th_status = 'done', sections_th = out, th_reviewed = false, th_note = null where id = r.id returning * into r;
        exception when others then
          update public.drug_fda_labels set th_status = 'error', th_note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่' where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.th_job, res.status_code) end;
        if nreq is not null then
          update public.drug_fda_labels set th_request_id = nreq, th_sent_at = now() where id = r.id returning * into r;
        else
          update public.drug_fda_labels set th_status = 'error', th_note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id returning * into r;
        end if;
      end if;
    elsif r.th_sent_at < now() - interval '3 minutes' then
      update public.drug_fda_labels set th_status = 'error', th_note = 'หมดเวลารอ AI กรุณาลองใหม่' where id = r.id returning * into r;
    end if;
    if r.th_status <> 'pending' and r.th_job is not null then update public.ai_jobs set body = null where id = r.th_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'th_status', r.th_status, 'th_note', r.th_note, 'sections_th', r.sections_th);
end $$;

create or replace function public.ai_ddi_th_send(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.ddi_pairs; na text; nb text; k text; model text; prompt text; req bigint;
begin
  select * into r from public.ddi_pairs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคู่ยานี้'; end if;
  if r.th_status = 'pending' and r.th_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังแปลอยู่ กรุณารอสักครู่'; end if;
  select name into na from public.ddi_drugs where id = r.a;
  select name into nb from public.ddi_drugs where id = r.b;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกร แปลและเรียบเรียงข้อมูล drug interaction ด้านล่างเป็นภาษาไทยที่อ่านง่าย กระชับ สำหรับเภสัชกรและเจ้าหน้าที่ รพ.สต. นำไปใช้ได้จริง' || E'
'
    || '- คงชื่อยา ชื่อเอนไซม์ (เช่น CYP3A4) ตัวเลข และหน่วยให้ตรงต้นฉบับ · ห้ามเพิ่มข้อมูลที่ไม่มีในต้นฉบับ' || E'
'
    || '- description = กลไกและผลที่เกิด 2–4 ประโยค · management = สิ่งที่ควรทำ เขียนเป็นข้อ ๆ ขึ้นบรรทัดใหม่ด้วย "• "' || E'
'
    || 'ตอบเป็น JSON เท่านั้น: {"description": "...", "management": "..."}' || E'

'
    || 'คู่ยา: ' || na || ' + ' || nb || E'
Interaction: ' || r.description || E'
Management: ' || r.management;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0.2)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  update public.ddi_pairs set th_status = 'pending', th_note = null, th_request_id = req, th_job = public.ai_job_of(req), th_sent_at = now() where id = r.id;
end $$;

create or replace function public.ai_ddi_th_check(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ddi_pairs; res record; txt text; j jsonb; nreq bigint;
begin
  select * into r from public.ddi_pairs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคู่ยานี้'; end if;
  if r.th_status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.th_request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          if coalesce(btrim(j->>'description'), '') = '' then raise exception 'empty'; end if;
          update public.ddi_pairs set th_status = 'done', th_reviewed = false, th_note = null,
                 description_th = left(btrim(j->>'description'), 6000), management_th = nullif(left(btrim(coalesce(j->>'management', '')), 6000), '')
           where id = r.id returning * into r;
        exception when others then
          update public.ddi_pairs set th_status = 'error', th_note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่' where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.th_job, res.status_code) end;
        if nreq is not null then
          update public.ddi_pairs set th_request_id = nreq, th_sent_at = now() where id = r.id returning * into r;
        else
          update public.ddi_pairs set th_status = 'error', th_note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id returning * into r;
        end if;
      end if;
    elsif r.th_sent_at < now() - interval '3 minutes' then
      update public.ddi_pairs set th_status = 'error', th_note = 'หมดเวลารอ AI กรุณาลองใหม่' where id = r.id returning * into r;
    end if;
    if r.th_status <> 'pending' and r.th_job is not null then update public.ai_jobs set body = null where id = r.th_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'th_status', r.th_status, 'th_note', r.th_note, 'description_th', r.description_th, 'management_th', r.management_th);
end $$;

revoke execute on function public.ai_fda_th_send(int), public.ai_fda_th_check(int), public.ai_ddi_th_send(int), public.ai_ddi_th_check(int) from public, anon, authenticated;

/* ---------- ปุ่มของผู้ดูแล: ตรวจสิทธิ์ → ตัวทำงานภายใน ---------- */
create or replace function public.ai_fda_th_start(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform public.ai_fda_th_send(p_id);
end $$;

create or replace function public.ai_fda_th_poll(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  return public.ai_fda_th_check(p_id);
end $$;

create or replace function public.ai_ddi_th_start(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform public.ai_ddi_th_send(p_id);
end $$;

create or replace function public.ai_ddi_th_poll(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  return public.ai_ddi_th_check(p_id);
end $$;

revoke execute on function public.ai_fda_th_start(int), public.ai_fda_th_poll(int), public.ai_ddi_th_start(int), public.ai_ddi_th_poll(int) from public, anon;
grant execute on function public.ai_fda_th_start(int), public.ai_fda_th_poll(int), public.ai_ddi_th_start(int), public.ai_ddi_th_poll(int) to authenticated;

/* ---------- ร่างขนาดยา: ขั้นตอนเดียวกับ ai_dose_poll (ไม่ตรวจสิทธิ์) ---------- */
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
revoke execute on function public.ai_dose_step(bigint) from public, anon, authenticated;

create or replace function public.ai_dose_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  return public.ai_dose_step(p_id);
end $$;
revoke execute on function public.ai_dose_poll(bigint) from public, anon;
grant execute on function public.ai_dose_poll(bigint) to authenticated;

/** ชื่ออังกฤษของยาในเครื่องคำนวณ (เหมือน latinOf ใน dose.js) เช่น "พาราเซตามอล (Paracetamol)" → "paracetamol" */
create or replace function public.dose_latin(p text)
returns text language sql immutable
set search_path = ''
as $$
  select lower(btrim(coalesce((regexp_match(coalesce(p, ''), '\(([^()]*[A-Za-z][^()]*)\)'))[1], case when p ~ '[A-Za-z]' then p else '' end)))
$$;

/** มีข้อมูลคำนวณของยาชื่อนี้แล้วหรือยัง (เหมือน keysOf + sameDrug ใน dose.js · รวมร่าง) */
create or replace function public.dose_has(p_name text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dose_drugs d
      cross join lateral (select public.dose_latin(d.name) as dk) x
      cross join lateral (select btrim(k) as k from regexp_split_to_table(lower(p_name), '[()]') k) y
     where x.dk <> '' and y.k <> '' and (y.k = x.dk or (left(y.k, length(x.dk) + 1) = x.dk || ' ' and position('+' in y.k) = 0)))
$$;

/** ชื่อสามัญภาษาอังกฤษสำหรับค้นฐานข้อมูลสหรัฐฯ (เหมือน doseQuery ใน admin-settings.js) */
create or replace function public.dose_query(p text)
returns text language sql immutable
set search_path = ''
as $$
  select case q when 'paracetamol' then 'acetaminophen' when 'salbutamol' then 'albuterol' when 'adrenaline' then 'epinephrine'
                when 'noradrenaline' then 'norepinephrine' when 'frusemide' then 'furosemide' when 'lignocaine' then 'lidocaine'
                when 'glibenclamide' then 'glyburide' when 'chlorpheniramine maleate' then 'chlorpheniramine' else q end
    from (select lower(btrim(regexp_replace(coalesce(string_agg(m[1], ' '), ''), '\s+', ' ', 'g'))) as q
            from regexp_matches(coalesce(p, ''), '([A-Za-z][A-Za-z0-9 .,+/-]*)', 'g') m) z
$$;

/** ชื่อยาจาก RxNorm → ความแรง (เหมือน rxConc ใน admin-settings.js) เช่น "amoxicillin 250 MG/5ML Oral Suspension" → {label:'ยาน้ำ 250 มก./5 มล.', mgPer5ml:250} */
create or replace function public.rx_conc(p text)
returns jsonb language plpgsql immutable
set search_path = ''
as $$
declare m text[]; mg numeric; ml numeric;
begin
  m := regexp_match(coalesce(p, ''), '((\d+(?:\.\d+)?)\s*MG(?:\s*/\s*(\d+(?:\.\d+)?)?\s*ML)?)', 'i');
  if m is null or (select count(*) from regexp_matches(p, '\d\s*MG', 'gi') x) > 1 then return null; end if;
  if p ~* '(topical|inject|ophthalmic|otic|nasal|rectal|vaginal|inhal|transdermal|cream|ointment|gel|paste|patch)' then return null; end if;
  mg := trim_scale(m[2]::numeric);
  ml := case when upper(m[1]) like '%ML%' then trim_scale(coalesce(m[3]::numeric, 1)) end;
  if ml is not null then
    if ml = 5 then return jsonb_build_object('label', 'ยาน้ำ ' || mg || ' มก./5 มล.', 'mgPer5ml', mg); end if;
    return jsonb_build_object('label', 'ยาน้ำ ' || mg || ' มก./' || case when ml = 1 then '' else ml || ' ' end || 'มล.', 'mgPerMl', trim_scale(round(mg / ml, 3)));
  end if;
  if p ~* '(tablet|capsule)' then
    return jsonb_build_object('label', case when p ~* 'capsule' then 'แคปซูล ' else 'เม็ด ' end || mg || ' มก.', 'mgPerTab', mg);
  end if;
  return null;
end $$;

/** ยา รพ.สต. ในกลุ่มชื่อยา (ชื่อยาในบัญชียาหลักของรายการแรก) */
create or replace function public.dose_group(p_name text)
returns setof int language sql stable security definer
set search_path = ''
as $$
  select l.id from public.local_drugs l join public.drug_monographs m on m.ref = l.mono_refs[1]
   where m.name = p_name and l.active and l.dose_id is null
$$;

/** ผลร่างขนาดยาที่เสร็จแล้ว → dose_drugs (ร่าง · ซ่อน) + ผูกยา รพ.สต. · คืน 'draft' | 'none' | 'error' | 'ai_error' (AI ไม่ว่าง → พัก) */
create or replace function public.ai_dose_convert(p_id bigint)
returns text language plpgsql security definer
set search_path = ''
as $$
declare d public.ai_dose_drafts; res jsonb; inds jsonb; concs jsonb; f jsonb; lab jsonb; new_id bigint; outcome text;
begin
  select * into d from public.ai_dose_drafts where id = p_id for update;
  if d.id is null or d.converted or d.status = 'pending' then return null; end if;
  res := coalesce(d.result, '{}');
  if d.status = 'error' then outcome := 'error';
  elsif public.dose_has(d.auto_name) then outcome := 'done';
  elsif res ? 'ai' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', e->'name', 'per', e->'per', 'min', e->'min', 'max', e->'max',
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
    f := inds->0; lab := coalesce(res->'label', '{}');
    insert into public.dose_drugs (name, form, indications, indication, per, mg_per_kg_min, mg_per_kg_max, dose_freq_per_day, max_mg_per_dose, freq, renal_note,
                                   concs, sort, active, ai_draft, ai_source)
    values (left(d.auto_name, 120),
            case when jsonb_array_length(concs) = 0 then 'อื่น ๆ'
                 when not exists (select 1 from jsonb_array_elements(concs) c where not c ? 'mgPerTab') then 'ยาเม็ด'
                 when not exists (select 1 from jsonb_array_elements(concs) c where c ? 'mgPerTab') then 'ยาน้ำ' else 'อื่น ๆ' end,
            inds, f->>'name', f->>'per', (f->>'min')::numeric, (f->>'max')::numeric, (f->>'times')::smallint, (f->>'cap')::numeric, f->>'freq', f->>'renal',
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

/* ---------- งานที่ระบบทำเอง: ทีละ 1 รายการต่อชนิดงาน ---------- */
create or replace function public.ai_th_tick(p_paused boolean)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare i int; x jsonb; busy boolean := false; hit boolean := false; sent text; note text;
begin
  -- ① ตรวจคำตอบที่รออยู่ (รวมที่ผู้ดูแลกดแล้วปิดหน้าไปก่อนเสร็จ)
  for i in select id from public.drug_fda_labels where th_status = 'pending' order by id loop
    x := public.ai_fda_th_check(i);
    if x->>'th_status' = 'pending' then busy := true;
    elsif x->>'th_status' = 'error' and coalesce(x->>'th_note', '') not like 'อ่านคำตอบ%' then hit := true; end if;
  end loop;
  for i in select id from public.ddi_pairs where th_status = 'pending' order by id loop
    x := public.ai_ddi_th_check(i);
    if x->>'th_status' = 'pending' then busy := true;
    elsif x->>'th_status' = 'error' and coalesce(x->>'th_note', '') not like 'อ่านคำตอบ%' then hit := true; end if;
  end loop;
  if busy or hit or p_paused then return jsonb_build_object('busy', busy, 'hit', hit); end if;

  -- ② ส่งรายการถัดไป 1 รายการ (ที่ AI ตอบมาอ่านไม่ได้ = เว้นไว้ 20 ชั่วโมง)
  begin
    select f.id into i from public.drug_fda_labels f
     where f.sections_th is null and f.th_status <> 'pending' and jsonb_array_length(f.sections) > 0
       and not (f.th_status = 'error' and coalesce(f.th_note, '') like 'อ่านคำตอบ%' and f.th_auto_at > now() - interval '20 hours')
     order by not exists (select 1 from public.local_drugs l where l.fda_key = f.key and l.active), f.id
     limit 1;
    if i is not null then
      perform public.ai_fda_th_send(i);
      update public.drug_fda_labels set th_auto_at = now() where id = i;
      sent := 'fda:' || i;
    else
      select p.id into i from public.ddi_pairs p
       where p.description_th is null and p.th_status <> 'pending' and p.description <> ''
         and not (p.th_status = 'error' and coalesce(p.th_note, '') like 'อ่านคำตอบ%' and p.th_auto_at > now() - interval '20 hours')
       order by array_position(array['Major', 'Moderate', 'Minor', 'Unknown'], p.level), p.id
       limit 1;
      if i is not null then
        perform public.ai_ddi_th_send(i);
        update public.ddi_pairs set th_auto_at = now() where id = i;
        sent := 'ddi:' || i;
      end if;
    end if;
  exception when others then note := sqlerrm;
  end;
  return jsonb_build_object('busy', false, 'hit', false, 'sent', sent, 'note', note);
end $$;

create or replace function public.ai_dose_tick(p_paused boolean)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare i bigint; r record; q text; busy boolean := false; hit boolean := false; sent text; note text; o text;
begin
  -- ① เดินขั้นตอนของร่างที่รออยู่ → เสร็จแล้วบันทึกเป็นร่างในรายการยา
  for i in select id from public.ai_dose_drafts where auto_name is not null and status = 'pending' order by id loop
    perform public.ai_dose_step(i);
  end loop;
  for i in select id from public.ai_dose_drafts where auto_name is not null and status <> 'pending' and not converted order by id loop
    o := public.ai_dose_convert(i);
    if o = 'ai_error' then hit := true; end if;
  end loop;
  busy := exists (select 1 from public.ai_dose_drafts where auto_name is not null and status = 'pending');
  if busy or hit or p_paused then return jsonb_build_object('busy', busy, 'hit', hit); end if;

  -- ② เริ่มยาถัดไป 1 ยา (ยารับประทานของ รพ.สต. ที่ยังไม่มีข้อมูลคำนวณ · ไม่สำเร็จ = ลองใหม่หลัง 1 ชั่วโมง)
  for r in select m.name as mono,
                  (array_agg(split_part(l.fda_key, '|', 1) order by l.sort, l.id) filter (where l.fda_key is not null))[1] as fq
             from public.local_drugs l join public.drug_monographs m on m.ref = l.mono_refs[1]
            where l.active and l.dose_id is null and l.category ~ '(เม็ด|แคปซูล|น้ำรับประทาน|ผง|NCD|เรื้อรัง)'
              and (l.dose_ai_status is null or (l.dose_ai_status in ('error', 'pending') and l.dose_ai_at < now() - interval '1 hour'))
            group by m.name
            order by min(l.sort), m.name
            limit 20 loop
    if public.dose_has(r.mono) then
      update public.local_drugs set dose_ai_status = 'done', dose_ai_at = now(), dose_ai_note = null where id in (select public.dose_group(r.mono));
      continue;
    end if;
    q := lower(regexp_replace(btrim(coalesce(r.fq, public.dose_query(r.mono))), '\s+', ' ', 'g'));
    if q !~ '^[a-z][a-z0-9 .,()/+-]{1,79}$' then
      update public.local_drugs set dose_ai_status = 'none', dose_ai_at = now(), dose_ai_note = 'ไม่มีชื่อสามัญภาษาอังกฤษ · กรอกเอง' where id in (select public.dose_group(r.mono));
      continue;
    end if;
    begin
      perform public.ai_key();   -- ตรวจความพร้อม (pg_net · คีย์ Gemini)
      insert into public.ai_dose_drafts (user_id, query, rx_req, fda_req, auto_name)
      values (null, q,
              net.http_get('https://rxnav.nlm.nih.gov/REST/drugs.json', params := jsonb_build_object('name', q), timeout_milliseconds := 20000),
              public.ai_dose_fda(q, true), r.mono);
      update public.local_drugs set dose_ai_status = 'pending', dose_ai_at = now(), dose_ai_note = null where id in (select public.dose_group(r.mono));
      sent := r.mono;
    exception when others then note := sqlerrm;
    end;
    exit;
  end loop;
  return jsonb_build_object('busy', false, 'hit', false, 'sent', sent, 'note', note);
end $$;

revoke execute on function public.dose_has(text), public.dose_group(text), public.ai_dose_convert(bigint), public.ai_th_tick(boolean), public.ai_dose_tick(boolean) from public, anon, authenticated;

/** เรียกทุกนาที (pg_cron) / ทุกชั่วโมง (GitHub Actions) · ทำครั้งละ 1 ตัว (กันเรียกซ้อน) · AI ไม่ว่าง = พัก 30 นาที */
create or replace function public.ai_auto_tick()
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare pause timestamptz; paused boolean; t jsonb; d jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('ai_auto_tick')) then return jsonb_build_object('skip', true); end if;
  begin pause := (select s.body from public.site_texts s where s.key = 'ai_auto_pause')::timestamptz; exception when others then pause := null; end;
  paused := coalesce(pause > now(), false);
  t := public.ai_th_tick(paused);
  d := public.ai_dose_tick(paused);
  if (t->>'hit')::boolean or (d->>'hit')::boolean then
    pause := now() + interval '30 minutes';
    insert into public.site_texts (key, body) values ('ai_auto_pause', pause::text)
      on conflict (key) do update set body = excluded.body, updated_at = now();
  end if;
  return jsonb_build_object('paused', case when pause > now() then pause end, 'th', t, 'dose', d,
    'left', jsonb_build_object(
      'fda', (select count(*) from public.drug_fda_labels where sections_th is null and jsonb_array_length(sections) > 0),
      'ddi', (select count(*) from public.ddi_pairs where description_th is null and description <> ''),
      'dose', (select count(*) from public.local_drugs where active and dose_id is null and category ~ '(เม็ด|แคปซูล|น้ำรับประทาน|ผง|NCD|เรื้อรัง)' and coalesce(dose_ai_status, '') not in ('none', 'done'))));
end $$;
revoke execute on function public.ai_auto_tick() from public, anon, authenticated;
grant execute on function public.ai_auto_tick() to service_role;

-- ทุกนาทีด้วย pg_cron (ฟรีใน Supabase) · เปิดไม่ได้ = ใช้รอบชั่วโมงของ GitHub Actions อย่างเดียว
do $$ begin
  if to_regnamespace('cron') is null then
    begin create extension if not exists pg_cron with schema pg_catalog; exception when others then raise notice 'pg_cron: %', sqlerrm; end;
  end if;
  if to_regnamespace('cron') is not null then
    begin perform cron.schedule('ai-auto-tick', '* * * * *', 'select public.ai_auto_tick()');
    exception when others then raise notice 'cron.schedule: %', sqlerrm; end;
  end if;
end $$;

select 'ok' as step_63_ai_auto, (select count(*) from pg_catalog.pg_namespace where nspname = 'cron') as has_cron;
