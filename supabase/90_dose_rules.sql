-- =====================================================================
--  ขั้นที่ 90: กฎความปลอดภัยข้อมูลขนาดยา (ผลตรวจ audit 22 ต.ค. 2569 · C1–C10) · รันซ้ำได้ · เพิ่ม/แทนที่ฟังก์ชันเท่านั้น (ไม่ลบข้อมูล)
--   ① dose_rules_problem(indications) = กฎโครงสร้างชุดเดียวกับ js/pages/dose-rules.js (ส่วนที่ไม่ต้องอ่านข้อความฉลาก):
--      ทุกข้อต้องมี age_min · คิดตามน้ำหนักต่อครั้งต้องมี cap · ต่อวันต้องมี cap_day · cap ≤ cap_day · ช่วงอายุห้ามขาดตอน ≤ 1 ปี
--   ② ยาจะแสดงในเครื่องคำนวณ (active) ต้องผ่าน dose_inds_problem + dose_rules_problem และระบบใส่ผู้อนุมัติให้ (approved_by/at)
--      ยาที่แสดงอยู่เดิมแต่ไม่มีผู้อนุมัติ (ก่อนมีขั้น 73) → ผู้ดูแลตรวจแล้วกดอนุมัติ (approve_dose) · ซ่อนยา = ล้างการอนุมัติ
--   ③ ประชาชน/เจ้าหน้าที่เห็นเฉพาะข้อมูลขนาดยาที่ "แสดง" และ "อนุมัติแล้ว" (ผู้ดูแลเห็นทั้งหมด)
--   ④ AI ช่วยแก้ (87): ส่งกฎให้ AI · ตรวจคำตอบกับกฎ · เพิ่มโหมด "ค้นจากเว็บพร้อมลิงก์อ้างอิง" (Gemini + Google Search ฟรี)
--      โหมดเว็บไม่มีข้อความต้นฉบับให้ตรวจเทียบ → แสดงลิงก์ที่ AI ใช้ให้ผู้ดูแลเปิดตรวจเองก่อนกดใช้ · ไม่ส่งข้อความ MIMS
-- =====================================================================

/** กฎโครงสร้างความปลอดภัย → null = ผ่าน · ข้อความ = เหตุผล (ตรงกับ indRules/drugRules ใน dose-rules.js ส่วนที่ไม่ต้องอ่านฉลาก) */
create or replace function public.dose_rules_problem(p jsonb)
returns text language plpgsql immutable
set search_path = ''
as $$
declare e jsonb; n int := 0; w text; wt boolean; b record; fin numeric; gap numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
  for e in select x from jsonb_array_elements(p) x loop
    n := n + 1; w := 'ข้อบ่งใช้ ' || n || ': ';
    if jsonb_typeof(e) <> 'object' then return w || 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
    if coalesce(jsonb_typeof(e->'age_min'), 'null') <> 'number' then
      return w || 'ยังไม่ระบุช่วงอายุ (อายุตั้งแต่ … ปี · ใช้ได้ทุกอายุ = 0)';
    end if;
    wt := coalesce(e->>'fixed', 'false') <> 'true';
    if wt and e->>'per' = 'dose' and not (coalesce(jsonb_typeof(e->'cap'), '') = 'number' and (e->>'cap')::numeric > 0) then
      return w || 'ขนาดตามน้ำหนักต่อครั้ง ต้องมีขนาดสูงสุดต่อครั้ง (ครั้งละไม่เกิน)';
    end if;
    if wt and e->>'per' = 'day' and not (coalesce(jsonb_typeof(e->'cap_day'), '') = 'number' and (e->>'cap_day')::numeric > 0) then
      return w || 'ขนาดตามน้ำหนักต่อวัน ต้องมีขนาดสูงสุดต่อวัน (วันละไม่เกิน)';
    end if;
    if jsonb_typeof(e->'cap') = 'number' and jsonb_typeof(e->'cap_day') = 'number' and (e->>'cap')::numeric > (e->>'cap_day')::numeric then
      return w || 'ครั้งละไม่เกิน มากกว่า วันละไม่เกิน';
    end if;
  end loop;
  -- ช่วงอายุ "ตั้งแต่ age_min ถึงก่อน age_max" เรียงตามอายุเริ่ม · ขาดตอนไม่เกิน 1 ปี = น่าจะกรอกช่วงแบบรวมปลาย (2–5 แล้ว 6–12)
  fin := null;
  for b in select (x->>'age_min')::numeric a, case when jsonb_typeof(x->'age_max') = 'number' then (x->>'age_max')::numeric end z, o
             from jsonb_array_elements(p) with ordinality t(x, o)
            where jsonb_typeof(x->'age_min') = 'number'
            order by 1, 2 nulls last loop
    if fin is not null and b.a > fin then
      gap := b.a - fin;
      if gap <= 1 then return 'ข้อบ่งใช้ ' || b.o || ': ช่วงอายุขาดตอน ' || fin::float8 || '–' || b.a::float8 || ' ปี (ใช้ช่วงแบบ ตั้งแต่…ถึงก่อน… เช่น 2–6 แล้ว 6–12)'; end if;
    end if;
    if b.z is null then exit; end if;   -- ไม่มีอายุสิ้นสุด = ครอบถึงอายุมาก
    fin := greatest(coalesce(fin, b.z), b.z);
  end loop;
  return null;
end $$;
grant execute on function public.dose_rules_problem(jsonb) to anon, authenticated;

/** ยาที่จะแสดงต้องผ่านกฎ + ระบบใส่ผู้อนุมัติ · ซ่อน = ล้างการอนุมัติ (แสดงใหม่ = ตรวจและอนุมัติใหม่) */
create or replace function public.before_dose_drugs_approve()
returns trigger language plpgsql
set search_path = ''
as $$
declare why text; approving boolean;
begin
  if tg_op = 'UPDATE' then new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  else new.approved_by := null; new.approved_at := null; end if;
  approving := tg_op = 'UPDATE' and coalesce(current_setting('pcps.approve_dose', true), '') = new.id::text;
  if new.active and (tg_op = 'INSERT' or not old.active or old.ai_draft or new.indications is distinct from old.indications or approving) then
    why := coalesce(public.dose_inds_problem(new.indications), public.dose_rules_problem(new.indications));
    if why is not null then
      raise exception 'ข้อมูลขนาดยายังไม่ครบหรือไม่ผ่านกฎความปลอดภัย จึงยังแสดงในเครื่องคำนวณไม่ได้ · %', why using errcode = '23514';
    end if;
    if not new.ai_draft then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  end if;
  if not new.active then new.approved_by := null; new.approved_at := null; end if;
  return new;
end $$;
drop trigger if exists dose_drugs_approve on public.dose_drugs;
create trigger dose_drugs_approve before insert or update on public.dose_drugs
  for each row execute function public.before_dose_drugs_approve();

/** ผู้ดูแลอนุมัติข้อมูลขนาดยาที่ตรวจแล้ว (ใช้กับยาที่แสดงอยู่เดิมแต่ยังไม่มีผู้อนุมัติ) → เวลาอนุมัติ */
create or replace function public.approve_dose(p_id bigint)
returns timestamptz language plpgsql
set search_path = ''
as $$
declare t timestamptz;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform set_config('pcps.approve_dose', p_id::text, true);
  update public.dose_drugs set active = true, ai_draft = false where id = p_id returning approved_at into t;
  perform set_config('pcps.approve_dose', '', true);
  if t is null then raise exception 'ไม่พบข้อมูลขนาดยานี้'; end if;
  return t;
end $$;
revoke execute on function public.approve_dose(bigint) from public, anon;
grant execute on function public.approve_dose(bigint) to authenticated;

-- ประชาชน/เจ้าหน้าที่เห็นเฉพาะที่แสดงและอนุมัติแล้ว
drop policy if exists dose_read on public.dose_drugs;
create policy dose_read on public.dose_drugs for select using ((active and approved_at is not null) or public.is_admin());

/* ---------- ④ AI ช่วยแก้ตามกฎ + ค้นจากเว็บพร้อมลิงก์ ---------- */
alter table public.ai_dose_fixes add column if not exists mode text not null default 'label';
alter table public.ai_dose_fixes drop constraint if exists ai_dose_fixes_mode_check;
alter table public.ai_dose_fixes add constraint ai_dose_fixes_mode_check check (mode in ('label', 'web'));

/** คำอธิบายช่อง + กฎ (ส่งให้ AI ทั้งสองโหมด · ตรงกับ RULES_TEXT ใน dose-rules.js) */
create or replace function public.ai_dose_rules_text()
returns text language sql immutable
set search_path = ''
as $$
  select 'ความหมายของช่อง: name = ข้อบ่งใช้ภาษาไทยสั้น ๆ · per = "dose" (ขนาดต่อครั้ง) หรือ "day" (ขนาดต่อวัน ต้องมี times = จำนวนครั้งที่แบ่งให้ต่อวัน 1–12)'
    || ' · fixed = true เมื่อเป็นขนาดคงที่ไม่คิดตามน้ำหนัก (ไม่มี = ต่อ กก.) · unit = "mg" หรือ "mcg" · min/max = ขนาดต่ำสุด/สูงสุด'
    || ' · cap = ขนาดสูงสุดต่อครั้ง · cap_day = ขนาดสูงสุดต่อวัน (หน่วยเดียวกับ min/max) · age_min/age_max = ช่วงอายุ (ปี · ทศนิยมได้ เช่น 3 เดือน = 0.25)'
    || ' · freq = ความถี่ภาษาไทยสั้น ๆ · renal = การปรับขนาดในโรคไต · note = หมายเหตุ · quote = ข้อความต้นฉบับตรงตัว (ภาษาอังกฤษ ไม่เกิน 300 ตัวอักษร) ที่เป็นที่มาของตัวเลข' || E'\n'
    || 'กฎความปลอดภัย (ต้องผ่านทุกข้อ): ทุกข้อต้องมี age_min (ทุกอายุ = 0 · ผู้ใหญ่ เช่น 12) และ age_max เมื่อมีอายุสิ้นสุด (ช่วงแบบ "ตั้งแต่ age_min ถึงก่อน age_max" เช่น 2–6 แล้ว 6–12 ห้ามเว้นช่วง)'
    || ' · คิดตามน้ำหนักแบบ per "dose" ต้องมี cap · แบบ per "day" ต้องมี cap_day และ times'
    || ' · ต้นฉบับเขียน mg/kg/day หรือ daily/divided = per "day" · every 6 hours = times 4, every 8 hours = 3, every 12 hours = 2'
    || ' · เพดานต่อวันที่ต้นฉบับเขียน (maximum … mg/day) ใส่ cap_day ห้ามใส่ cap · cap ต้องไม่มากกว่า cap_day · ขนาดเด็กต้องไม่เกินขนาดผู้ใหญ่'
    || ' · ข้อบ่งใช้เดียวมีหลายช่วงอายุที่ขนาดต่างกัน ให้เลือกช่วงที่ตรงกับชื่อข้อบ่งใช้/ปัญหาที่ระบุ แล้วบอกช่วงอื่นใน why'
$$;

create or replace function public.ai_dose_fix_start(p_local int, p_ind jsonb, p_issues jsonb)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare l record; src text; k text; model text; prompt text; nreq bigint; new_id bigint; iss jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_ind is null or jsonb_typeof(p_ind) <> 'object' or octet_length(p_ind::text) > 8000 then raise exception 'ข้อมูลข้อบ่งใช้ไม่ถูกต้อง'; end if;
  select coalesce(jsonb_agg(left(x, 300)), '[]') into iss
    from (select x from jsonb_array_elements_text(case when jsonb_typeof(p_issues) = 'array' then p_issues else '[]' end) x limit 12) t;
  if (select count(*) from public.ai_dose_fixes f where f.user_id = auth.uid() and f.created_at > now() - interval '1 day') >= 60 then
    raise exception 'ใช้ AI ช่วยแก้ครบ 60 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  select d.id, d.name, d.strength, d.ingredients into l from public.local_drugs d where d.id = p_local;
  if l.id is null then raise exception 'ไม่พบยานี้'; end if;
  src := public.ai_dose_fix_src(p_local);
  if btrim(coalesce(src, '')) = '' then
    raise exception 'ยาตัวนี้ยังไม่ได้ผูกฉลาก OpenFDA+DailyMed ที่มีข้อความขนาดยา · ผูกฉลากก่อน หรือกด "ให้ AI ค้นจากเว็บพร้อมลิงก์"';
  end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรผู้ช่วยตรวจข้อมูลเครื่องคำนวณขนาดยาของ รพ.สต. ในประเทศไทย' || E'\n'
    || 'ข้อบ่งใช้ด้านล่าง (JSON) ยังไม่ผ่านการตรวจด้วยปัญหาที่ระบุ ให้ตรวจกับ "ฉลากยา" ด้านล่างเท่านั้น แล้วแก้ให้ถูกต้องและครบตามกฎ' || E'\n'
    || public.ai_dose_rules_text() || E'\n'
    || 'ใช้เฉพาะตัวเลขที่อยู่ในฉลาก ห้ามเดา ห้ามใช้ความรู้นอกฉลาก · ใช้หน่วยตามฉลาก (ห้ามแปลงหน่วย) · ถ้าฉลากไม่มีข้อมูลบางช่อง (เช่น ช่วงอายุ เพดาน) ให้ใส่เท่าที่มีและบอกใน why ว่าขาดอะไร · ถ้าฉลากมีข้อมูลไม่พอเลย ให้ ind เป็น null' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"ind": {...} หรือ null, "why": "สรุปภาษาไทยสั้น ๆ ว่าแก้อะไร หรือขาดอะไร"}' || E'\n\n'
    || 'ยา: ' || l.name || coalesce(' · ความแรง ' || l.strength::text, '') || E'\n'
    || 'ข้อบ่งใช้ปัจจุบัน: ' || (p_ind - 'ref')::text || E'\n'
    || 'ปัญหาที่พบ: ' || iss::text || E'\n\n'
    || 'ฉลากยา (OpenFDA+DailyMed):' || E'\n' || src;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  nreq := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  insert into public.ai_dose_fixes (user_id, local_id, ind, issues, src, request_id, ai_job, sent_at, mode)
  values (auth.uid(), p_local, p_ind, iss, src, nreq, public.ai_job_of(nreq), now(), 'label')
  returning id into new_id;
  return new_id;
end $$;

/** AI ค้นจากเว็บ (Google Search ผ่าน Gemini) → ค่าที่เสนอ + ลิงก์ที่ใช้ค้น · ไม่ต้องผูกฉลาก · ไม่ส่งข้อความ MIMS/ข้อมูลผู้ป่วย */
create or replace function public.ai_dose_web_start(p_local int, p_ind jsonb, p_issues jsonb)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare l record; k text; model text; prompt text; nreq bigint; new_id bigint; iss jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_ind is null or jsonb_typeof(p_ind) <> 'object' or octet_length(p_ind::text) > 8000 then raise exception 'ข้อมูลข้อบ่งใช้ไม่ถูกต้อง'; end if;
  select coalesce(jsonb_agg(left(x, 300)), '[]') into iss
    from (select x from jsonb_array_elements_text(case when jsonb_typeof(p_issues) = 'array' then p_issues else '[]' end) x limit 12) t;
  if (select count(*) from public.ai_dose_fixes f where f.user_id = auth.uid() and f.created_at > now() - interval '1 day') >= 60 then
    raise exception 'ใช้ AI ช่วยแก้ครบ 60 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  select d.id, d.name, d.strength into l from public.local_drugs d where d.id = p_local;
  if l.id is null then raise exception 'ไม่พบยานี้'; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรผู้ช่วยตรวจข้อมูลเครื่องคำนวณขนาดยาของ รพ.สต. ในประเทศไทย' || E'\n'
    || 'ค้นข้อมูลขนาดยาจากแหล่งที่เชื่อถือได้บนเว็บ (ฉลากยา DailyMed/FDA, เอกสารกำกับยา อย. ไทย, BNF for Children, WHO Model Formulary, แนวทางเวชปฏิบัติของสมาคมวิชาชีพ) แล้วเสนอค่าที่ถูกต้องสำหรับข้อบ่งใช้ด้านล่างตามกฎ' || E'\n'
    || public.ai_dose_rules_text() || E'\n'
    || 'ใช้เฉพาะตัวเลขที่พบในแหล่งอ้างอิง ห้ามเดา · quote = ข้อความจากแหล่งอ้างอิงตรงตัว · ถ้าหาไม่พบหรือแหล่งขัดกัน ให้ ind เป็น null และบอกเหตุผล' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น (ไม่มีข้อความอื่น): {"ind": {...} หรือ null, "why": "สรุปภาษาไทยสั้น ๆ", "refs": [{"title": "ชื่อแหล่ง", "url": "https://..."}]}' || E'\n\n'
    || 'ยา: ' || l.name || coalesce(' · ความแรง ' || l.strength::text, '') || E'\n'
    || 'ข้อบ่งใช้ปัจจุบัน: ' || (p_ind - 'ref')::text || E'\n'
    || 'ปัญหาที่พบ: ' || iss::text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  nreq := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'tools', jsonb_build_array(jsonb_build_object('google_search', '{}'::jsonb)),
                               'generationConfig', jsonb_build_object('temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000);
  insert into public.ai_dose_fixes (user_id, local_id, ind, issues, src, request_id, ai_job, sent_at, mode)
  values (auth.uid(), p_local, p_ind, iss, null, nreq, public.ai_job_of(nreq), now(), 'web')
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.ai_dose_fix_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_dose_fixes; res record; txt text; j jsonb; e jsonb; fx jsonb; q text; why text; left_ text; nreq bigint; a numeric; srcs jsonb; refs jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_dose_fixes where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายการนี้'; end if;
  if r.status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          -- ลิงก์ที่ AI ค้นจริง (Google Search) + ลิงก์ที่ AI ระบุเฉพาะโดเมนที่ค้นเจอจริง
          select coalesce(jsonb_agg(x) filter (where x is not null), '[]') into srcs from (
            select distinct on (c->'web'->>'uri') jsonb_build_object('title', left(coalesce(c->'web'->>'title', 'แหล่งอ้างอิง'), 120), 'url', c->'web'->>'uri') x
              from jsonb_array_elements(coalesce(res.content::jsonb #> '{candidates,0,groundingMetadata,groundingChunks}', '[]')) c
             where c->'web'->>'uri' ~ '^https://' limit 8) t;
          select coalesce(jsonb_agg(jsonb_build_object('title', left(coalesce(x->>'title', 'แหล่งอ้างอิง'), 120), 'url', x->>'url')), '[]') into refs
            from jsonb_array_elements(case when jsonb_typeof(j->'refs') = 'array' then j->'refs' else '[]' end) x
           where x->>'url' ~ '^https://[^/\s"<>]+(/[^\s"<>]*)?$'
             and exists (select 1 from jsonb_array_elements(srcs) s
                          where lower(substring(x->>'url' from '^https://(?:www\.)?([^/:]+)')) like '%' || lower(regexp_replace(s->>'title', '^www\.', '')) || '%'
                             or lower(regexp_replace(s->>'title', '^www\.', '')) like '%' || lower(substring(x->>'url' from '^https://(?:www\.)?([^/:]+)')) || '%');
          e := j->'ind';
          if jsonb_typeof(e) is distinct from 'object' then
            update public.ai_dose_fixes set status = 'done', done_at = now(),
                   result = jsonb_build_object('none', true, 'why', left(coalesce(nullif(btrim(j->>'why'), ''), 'ไม่พบข้อมูลพอให้แก้'), 500), 'mode', r.mode, 'sources', srcs, 'refs', refs)
             where id = r.id returning * into r;
          else
            fx := jsonb_strip_nulls(jsonb_build_object(
              'name', left(coalesce(nullif(btrim(e->>'name'), ''), r.ind->>'name', 'ข้อบ่งใช้'), 200),
              'per', case when e->>'per' = 'day' then 'day' else 'dose' end,
              'fixed', case when e->>'fixed' = 'true' then true end,
              'unit', case when e->>'unit' = 'mcg' then 'mcg' end,
              'min', public.ai_fix_num(e->'min'), 'max', public.ai_fix_num(e->'max'),
              'times', case when e->>'per' = 'day' and public.ai_fix_num(e->'times') in (1,2,3,4,5,6,7,8,9,10,11,12) then public.ai_fix_num(e->'times')::int end,
              'times_alt', case when e->>'per' = 'day' and jsonb_typeof(e->'times_alt') = 'array' then
                 (select nullif(jsonb_agg(x::int), '[]'::jsonb) from (select public.ai_fix_num(y) x from jsonb_array_elements(e->'times_alt') y) t where x in (1,2,3,4,5,6,7,8,9,10,11,12)) end,
              'cap', nullif(public.ai_fix_num(e->'cap'), 0), 'cap_day', nullif(public.ai_fix_num(e->'cap_day'), 0),
              'age_min', case when public.ai_fix_num(e->'age_min') <= 120 then public.ai_fix_num(e->'age_min') end,
              'age_max', case when public.ai_fix_num(e->'age_max') <= 120 then public.ai_fix_num(e->'age_max') end,
              'basis', left(coalesce(nullif(btrim(e->>'basis'), ''), r.ind->>'basis'), 60),
              'freq', left(nullif(btrim(e->>'freq'), ''), 120),
              'renal', left(nullif(btrim(e->>'renal'), ''), 1000),
              'note', left(nullif(btrim(e->>'note'), ''), 500),
              'quote', left(nullif(btrim(e->>'quote'), ''), 400)));
            if r.mode = 'web' and jsonb_array_length(srcs) > 0 then   -- ที่มา = ลิงก์แรกที่ AI ค้นจริง (ผู้ดูแลเปิดตรวจ)
              fx := fx || jsonb_build_object('ref', jsonb_build_object('label', 'AI ค้นจากเว็บ: ' || left(coalesce(refs->0->>'title', srcs->0->>'title'), 80), 'url', coalesce(refs->0->>'url', srcs->0->>'url')));
            end if;
            -- ตรวจคำตอบ: รูปแบบถูก → (ฉลาก) ข้อความอ้างอิงอยู่ในฉลากจริง → ตัวเลข min/max อยู่ในข้อความอ้างอิง
            why := public.dose_inds_problem(jsonb_build_array(fx));
            if why is null then
              q := public.dose_norm(fx->>'quote');
              if q = '' then why := 'AI ไม่ได้ระบุข้อความอ้างอิงจากต้นฉบับ';
              elsif r.mode = 'label' and position(q in public.dose_norm(r.src)) = 0 then why := 'ข้อความที่ AI อ้างไม่พบในฉลากยา';
              elsif r.mode = 'web' and jsonb_array_length(srcs) = 0 then why := 'AI ไม่ได้ค้นจากเว็บจริง (ไม่มีลิงก์อ้างอิง) จึงไม่ใช้';
              else
                foreach a in array array[(fx->>'min')::numeric, (fx->>'max')::numeric] loop
                  if not (a = any(public.dose_nums(q))) then why := 'ตัวเลขขนาดยาไม่ตรงกับข้อความ' || case when r.mode = 'label' then 'ในฉลาก' else 'อ้างอิง' end; end if;
                end loop;
              end if;
            else
              why := regexp_replace(why, '^ข้อบ่งใช้ 1: ', '');
            end if;
            left_ := case when why is null then regexp_replace(public.dose_rules_problem(jsonb_build_array(fx)), '^ข้อบ่งใช้ 1: ', '') end;
            update public.ai_dose_fixes set status = 'done', done_at = now(),
                   result = case when why is null then jsonb_build_object('ind', fx, 'why', left(coalesce(j->>'why', ''), 500), 'left', left_, 'mode', r.mode, 'sources', srcs, 'refs', refs)
                                 else jsonb_build_object('rejected', fx, 'why', why, 'ai_why', left(coalesce(j->>'why', ''), 500), 'mode', r.mode, 'sources', srcs, 'refs', refs) end,
                   note = case when why is not null then 'ค่าที่ AI เสนอตรวจไม่ผ่าน จึงไม่ใช้' end
             where id = r.id returning * into r;
          end if;
        exception when others then
          update public.ai_dose_fixes set status = 'done', done_at = now(), note = 'อ่านคำตอบของ AI ไม่ได้ · กดลองใหม่ หรือแก้เองจากต้นฉบับ'
           where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_dose_fixes set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_dose_fixes set status = 'done', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false))
           where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '4 minutes' then
      update public.ai_dose_fixes set status = 'done', done_at = now(), note = 'หมดเวลารอ AI · กดลองใหม่ หรือแก้เองจากต้นฉบับ' where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result, 'note', r.note);
end $$;

revoke execute on function public.ai_dose_fix_start(int, jsonb, jsonb), public.ai_dose_web_start(int, jsonb, jsonb), public.ai_dose_fix_poll(bigint), public.ai_dose_rules_text() from public, anon;
grant execute on function public.ai_dose_fix_start(int, jsonb, jsonb), public.ai_dose_web_start(int, jsonb, jsonb), public.ai_dose_fix_poll(bigint) to authenticated;

select 'ok' as step_90_dose_rules,
       (select count(*) from public.dose_drugs where active and approved_at is null) as active_waiting_approval,
       (select count(*) from public.dose_drugs where active and public.dose_rules_problem(indications) is not null) as active_failing_rules;
