-- =====================================================================
--  ขั้นที่ 48: แก้ "ระบบ AI ยังไม่พร้อมใช้งาน" (AI แนะนำข้อมาตรฐาน + แบบทดสอบท้ายข่าว) — รันต่อจาก 47 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   เดิม: ถ้าบทบาทของหน้าเว็บ (anon/authenticated) "มีสิทธิ์" อ่านคิวคำขอของ pg_net (ที่มี header คีย์) ระบบจะไม่ยอมเรียก AI เลย
--         แต่บน Supabase สิทธิ์นี้มักติดมากับ pg_net และหน้าเว็บเข้าถึงไม่ได้จริง (schema net ไม่ได้เปิดผ่าน API) → AI ใช้ไม่ได้ทั้งที่ปลอดภัย
--   ใหม่: ① พยายามเปิด pg_net + ถอนสิทธิ์อ่านคิว/ผลตอบกลับจาก anon/authenticated (ทำไม่ได้ก็ไม่เป็นไร)
--         ② ai_key(): ไม่ยอมเรียก AI เฉพาะเมื่อ "เข้าถึงได้จริง" (schema net เปิดผ่าน API) · บอกสาเหตุชัด ๆ (ไม่มี pg_net / ยังไม่ได้ตั้งคีย์)
--         ③ ai_match_start / ai_news_quiz_start ใช้ ai_key() แทนการตรวจแบบเดิม (เนื้อหาอื่นเหมือนเดิมทุกอย่าง)
-- =====================================================================

do $$ begin
  if to_regclass('net.http_request_queue') is null then
    begin create extension if not exists pg_net with schema extensions;
    exception when others then
      begin create extension if not exists pg_net; exception when others then raise notice 'pg_net: %', sqlerrm; end;
    end;
  end if;
  if to_regclass('net.http_request_queue') is not null then
    begin revoke all on table net.http_request_queue from anon, authenticated; exception when others then raise notice 'revoke queue: %', sqlerrm; end;
    begin revoke all on table net._http_response from anon, authenticated; exception when others then raise notice 'revoke response: %', sqlerrm; end;
  end if;
end $$;

/** คีย์ Gemini สำหรับฟังก์ชันของระบบ (ห้ามเรียกจากหน้าเว็บโดยตรง) · ไม่พร้อม = แจ้งสาเหตุ */
create or replace function public.ai_key()
returns text language plpgsql security definer
set search_path = ''
as $$
declare k text;
begin
  if to_regclass('net.http_request_queue') is null then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน: ฐานข้อมูลยังไม่ได้เปิดส่วนเรียก AI (pg_net)';
  end if;
  -- คีย์อยู่ใน header ของคิวคำขอ: ห้ามเรียกถ้าหน้าเว็บอ่านคิวได้จริง (schema net เปิดผ่าน API + มีสิทธิ์อ่าน)
  if (has_table_privilege('authenticated', 'net.http_request_queue', 'select') or has_table_privilege('anon', 'net.http_request_queue', 'select'))
     and exists (select 1 from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
                  where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%' and c ~ '(=|,)\s*net\s*(,|$)') then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน: schema net เปิดผ่าน API อยู่ (ไม่ปลอดภัยต่อคีย์)';
  end if;
  select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
  if coalesce(k, '') = '' then raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งคีย์)'; end if;
  return k;
end $$;
revoke execute on function public.ai_key() from public, anon, authenticated;

create or replace function public.ai_match_start(p_text text, p_achievement uuid default null)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  fy int := public.fiscal_year_of(current_date);
  u smallint; k text; model text; items text; prompt text; req bigint; new_id bigint;
begin
  if coalesce(public.my_role(), '') not in ('staff', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  p_text := btrim(coalesce(p_text, ''));
  if char_length(p_text) < 10 then raise exception 'กรุณาพิมพ์รายละเอียดผลงานก่อน (อย่างน้อย 10 ตัวอักษร)'; end if;
  if char_length(p_text) > 4000 then raise exception 'รายละเอียดยาวเกิน 4,000 ตัวอักษร'; end if;
  if p_achievement is not null then
    select a.unit_id into u from public.achievements a where a.id = p_achievement;
    if u is null or not (public.is_admin() or public.is_staff_of(u)) then raise exception 'ไม่มีสิทธิ์'; end if;
  else
    u := public.my_unit();
  end if;
  if (select count(*) from public.ai_matches m where m.user_id = auth.uid() and m.created_at > now() - interval '1 day') >= 30 then
    raise exception 'ใช้ AI ครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  if (select count(*) from public.ai_matches m where m.created_at > now() - interval '1 day') >= 300 then
    raise exception 'ระบบ AI ใช้ครบโควตาของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  k := public.ai_key();   -- ตรวจความพร้อม (pg_net · คีย์) + บอกสาเหตุชัด ๆ (48_ai_ready.sql)

  select string_agg(format('ข้อ %s [%s%s] %s%s', c.item_no, c.topic_title, coalesce(' › ' || c.sub_label, ''), c.body,
                           coalesce(' (หลักฐาน: ' || c.evidence || ')', '')), E'\n' order by c.sort)
    into items from public.criteria_items c where c.fiscal_year = fy;
  if items is null then raise exception 'ยังไม่มีเกณฑ์มาตรฐานของปีงบ %', fy; end if;
  prompt := 'คุณเป็นเภสัชกรผู้ตรวจประเมินมาตรฐานงานเภสัชกรรมปฐมภูมิของ รพ.สต.' || E'\n'
    || 'อ่าน "ผลงาน" แล้วเลือกข้อมาตรฐานที่ผลงานนี้ใช้เป็นหลักฐานได้จริง (เลือกเฉพาะข้อที่เนื้อหาผลงานสอดคล้องชัดเจน ไม่เดา ไม่เกิน 5 ข้อ เรียงจากตรงที่สุด · ไม่มีข้อที่ตรง = matches ว่าง)' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"matches": [{"item_no": "เลขข้อตามรายการ", "reason": "เหตุผลสั้น ๆ ภาษาไทย ไม่เกิน 100 ตัวอักษร"}]}' || E'\n\n'
    || 'ข้อมาตรฐานปีงบ ' || fy || E':\n' || left(items, 40000) || E'\n\nผลงาน:\n' || p_text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  insert into public.ai_matches (user_id, unit_id, achievement_id, fiscal_year, input, request_id)
  values (auth.uid(), u, p_achievement, fy, p_text, req) returning id into new_id;
  return new_id;
end $$;


create or replace function public.ai_news_quiz_start(p_news uuid, p_items jsonb)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare n public.news; k text; model text; prompt text; req bigint; new_id bigint; qs text; cnt int; ev record;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into n from public.news where id = p_news;
  if n.id is null then raise exception 'ไม่พบข่าวนี้'; end if;
  if coalesce(n.source_file_url, '') !~ '^https://' then raise exception 'ข่าวนี้ไม่มีไฟล์ PDF ต้นฉบับให้ตรวจเทียบ'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'รูปแบบคำถามไม่ถูกต้อง'; end if;
  select count(*), string_agg(format('%s. คำถาม: %s%sคำตอบของผู้ตั้งคำถาม: %s%s', i, left(btrim(e->>'q'), 300), E'\n   ', left(btrim(e->>'a'), 200),
           coalesce(E'\n   ตัวเลือกที่ผิดที่ผู้ตั้งคำถามร่างไว้: ' || (select string_agg(left(btrim(w), 200), ' | ') from jsonb_array_elements_text(case when jsonb_typeof(e->'w') = 'array' then e->'w' else '[]' end) w where btrim(w) <> ''), '')),
         E'\n' order by i)
    into cnt, qs
    from jsonb_array_elements(p_items) with ordinality t(e, i)
   where btrim(coalesce(e->>'q', '')) <> '' and btrim(coalesce(e->>'a', '')) <> '';
  if cnt = 0 then raise exception 'กรุณาพิมพ์คำถามและคำตอบที่ถูกอย่างน้อย 1 ข้อ'; end if;
  if cnt <> jsonb_array_length(p_items) then raise exception 'ทุกข้อต้องมีทั้งคำถามและคำตอบที่ถูก'; end if;
  if cnt > 10 then raise exception 'ตั้งคำถามได้ไม่เกิน 10 ข้อ'; end if;
  if (select count(*) from public.ai_news_checks c where c.user_id = auth.uid() and c.created_at > now() - interval '1 day') >= 30 then
    raise exception 'ใช้ AI ตรวจข่าวครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  k := public.ai_key();   -- ตรวจความพร้อม (pg_net · คีย์) + บอกสาเหตุชัด ๆ (48_ai_ready.sql)

  select * into ev from public.ai_news_evidence(n.id, n.source_file_url);
  prompt := 'คุณเป็นเภสัชกรผู้ช่วยทำแบบทดสอบความรู้สำหรับผู้อ่านข่าว (ประชาชนและเจ้าหน้าที่ รพ.สต.) ' || ev.intro
    || 'ผู้ดูแลตั้งคำถามพร้อมคำตอบที่ถูกไว้ด้านล่าง ทำทีละข้อ:' || E'\n'
    || '1) ai_answer = ลองตอบคำถามเองจากบทความเท่านั้น (สั้น ๆ) ก่อนดูคำตอบของผู้ตั้ง' || E'\n'
    || '2) match = "yes" ถ้าคำตอบของผู้ตั้งถูกต้องตามบทความ · "no" ถ้าบทความเขียนต่างออกไป · "not_found" ถ้าบทความไม่มีข้อมูลนี้ · page = เลขหน้าที่ใช้ตอบ' || E'\n'
    || '3) explain = คำอธิบายสั้นสำหรับผู้อ่าน ภาษาเข้าใจง่าย อ้างจากบทความ (ไม่เกิน 2 ประโยค)' || E'\n'
    || '4) answer_rewrite = คำตอบของผู้ตั้งคำถามที่เรียบเรียงให้อ่านง่ายขึ้น (ความหมายเดิม ห้ามเปลี่ยนสาระ) · ถ้า match ไม่ใช่ "yes" ให้ explain บอกเหตุผลว่าทำไมคิดว่าเฉลยผิด (บทความเขียนว่าอะไร หน้าไหน)' || E'\n'
    || '5) distractors = ตัวเลือกที่ผิด 3 ข้อ: ถ้าผู้ตั้งคำถามร่างไว้แล้ว ให้ใช้ของเขาเป็นหลัก (เรียงตามเดิม เรียบเรียงให้อ่านง่ายขึ้นได้ ความหมายเดิม) แล้วค่อยแต่งเพิ่มให้ครบ 3 ข้อ · ถ้าตัวเลือกที่เขาร่างไว้ข้อไหนจริง ๆ แล้วถูกตามบทความ ให้บอกใน explain'
    || ' · ตัวเลือกที่ผิดต้องความยาว/รูปแบบใกล้เคียงคำตอบที่ถูก ฟังดูเป็นไปได้ แต่ผิดชัดเจนตามบทความ (ห้ามกำกวม ห้ามถูกบางส่วน ห้ามซ้ำกัน)' || E'\n'
    || 'ถ้าเปิดอ่าน PDF ไม่ได้ ให้ pdf_read=false และ items ว่าง' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"pdf_read": true, "items": [{"n": <เลขข้อ>, "ai_answer": "...", "match": "yes|no|not_found", "page": <เลขหน้าหรือ null>, "explain": "...", "answer_rewrite": "...", "distractors": ["...", "...", "..."]}]}' || E'\n\n'
    || 'หัวข้อข่าว: ' || n.title || E'\n' || qs;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('temperature', 0.3))
            || case when ev.tools is null then '{}'::jsonb else jsonb_build_object('tools', ev.tools) end,   -- มีข้อความ PDF ในระบบ = ไม่ต้องให้ AI เปิดลิงก์
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 180000);
  insert into public.ai_news_checks (user_id, news_id, kind, points, request_id) values (auth.uid(), n.id, 'quiz', cnt, req) returning id into new_id;
  return new_id;
end $$;


revoke execute on function public.ai_match_start(text, uuid), public.ai_news_quiz_start(uuid, jsonb) from public, anon;
grant execute on function public.ai_match_start(text, uuid), public.ai_news_quiz_start(uuid, jsonb) to authenticated;

select 'ok' as step_48_ai_ready;
