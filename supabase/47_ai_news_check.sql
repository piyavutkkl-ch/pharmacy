-- =====================================================================
--  ขั้นที่ 47: ผู้ดูแล "ตรวจข่าว AI กับความเข้าใจของฉัน" — รันต่อจาก 46 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ผู้ดูแลอ่านบทความ/ทำแบบทดสอบ CCPE ด้วยตัวเองก่อน แล้วพิมพ์ประเด็นที่เข้าใจ (บรรทัดละ 1 ประเด็น · คำของตัวเอง)
--   → ฐานข้อมูลเรียก Gemini (ฟรี · pg_net · คีย์ใน Vault เหมือน 37_ai_match.sql) ให้อ่าน PDF ต้นฉบับจากลิงก์ (url_context)
--     เทียบ ประเด็น ↔ ข่าว ↔ PDF ทีละข้อ (ถูก/ผิด/ไม่ได้พูดถึง + หน้า) และร่างข่าวฉบับแก้จาก PDF
--   ข้อความที่ผู้ดูแลพิมพ์ "ไม่ถูกเก็บ" ในตารางนี้ (เก็บแค่จำนวนประเด็น + ผลตรวจที่ตัดข้อความประเด็นออกแล้ว) · ไม่แสดงในข่าว
--   ai_news_checks อ่านได้เฉพาะผู้ดูแล · เขียนผ่านฟังก์ชันเท่านั้น · ผู้ดูแลคนละ 30 ครั้ง/วัน
--   + แบบทดสอบสำหรับผู้อ่าน (news_quiz · ไม่ใช่ข้อสอบของสภาเภสัชกรรม): ผู้ดูแลตั้งคำถาม + คำตอบที่ถูกเอง
--     → ai_news_quiz_start: AI อ่าน PDF แล้วลองตอบเอง · บอกว่าคำตอบของผู้ดูแลตรงกับ PDF ไหม (หน้า) · สร้างตัวเลือกหลอก 3 ข้อ
--     → ผู้ดูแลแก้/ยืนยัน → บันทึกลง news_quiz → แสดงท้ายข่าวที่เผยแพร่ (ผู้อ่านกดตอบ รู้ผล + คำอธิบาย)
--   + news_sources: ข้อความที่ถอดจาก PDF ต้นฉบับ (ช่อง AI ถอดเก็บไว้ตอนสร้างข่าว · tools/ai_news/run.mjs) — อ่านได้เฉพาะผู้ดูแล
--     มีข้อความแล้ว = ส่งข้อความให้ AI ตรวจเลย (เร็ว ไม่ต้องเปิด PDF ซ้ำ) · ยังไม่มี = ให้ AI เปิดอ่าน PDF จากลิงก์ (url_context)
-- =====================================================================

create table if not exists public.news_sources (
  news_id     uuid primary key references public.news(id) on delete cascade,
  body        text not null check (char_length(body) <= 300000),
  pages       smallint,
  method      text,   -- pdftotext | gemini
  created_at  timestamptz not null default now()
);
alter table public.news_sources enable row level security;
drop policy if exists nsrc_read on public.news_sources;
create policy nsrc_read on public.news_sources for select to authenticated using (public.is_admin());
revoke all on public.news_sources from anon, authenticated;
grant select on public.news_sources to authenticated;
grant all on public.news_sources to service_role;

/** หลักฐานที่ให้ AI ใช้: ข้อความ PDF ที่ถอดเก็บไว้ (ถ้ามี) หรือให้เปิดอ่านจากลิงก์ → (ข้อความนำใน prompt, tools) */
create or replace function public.ai_news_evidence(p_news uuid, p_url text, out intro text, out tools jsonb)
language plpgsql stable security definer
set search_path = ''
as $$
declare src text;
begin
  select s.body into src from public.news_sources s where s.news_id = p_news;
  if coalesce(btrim(src), '') <> '' then
    intro := 'หลักฐานเดียวที่ใช้ได้คือบทความต้นฉบับ (ถอดข้อความจาก PDF ไว้แล้ว แบ่งตาม [หน้า n]) ด้านล่างนี้:' || E'\n<<<บทความ\n' || left(src, 150000) || E'\nบทความ>>>\n';
    tools := null;
  else
    intro := 'หลักฐานเดียวที่ใช้ได้คือบทความต้นฉบับ PDF ที่ลิงก์นี้ (เปิดอ่านทุกหน้าด้วยเครื่องมืออ่าน URL): ' || p_url || E'\n';
    tools := jsonb_build_array(jsonb_build_object('url_context', '{}'::jsonb));
  end if;
end $$;
revoke execute on function public.ai_news_evidence(uuid, text) from public, anon, authenticated;

create table if not exists public.ai_news_checks (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references public.profiles(id) on delete set null,
  news_id     uuid not null references public.news(id) on delete cascade,
  kind        text not null default 'notes' check (kind in ('notes', 'quiz')),
  points      smallint not null,
  request_id  bigint,
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result      jsonb,   -- notes: {pdf_read, summary, body, items:[{n, verdict, page, explain, fix}]} (ไม่มีข้อความประเด็นของผู้ดูแล)
                       -- quiz:  {pdf_read, items:[{n, ai_answer, match, page, explain, distractors[]}]}
  note        text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists ai_news_checks_news_idx on public.ai_news_checks (news_id, created_at desc);

alter table public.ai_news_checks enable row level security;
drop policy if exists anc_read on public.ai_news_checks;
create policy anc_read on public.ai_news_checks for select to authenticated using (public.is_admin());
revoke all on public.ai_news_checks from anon, authenticated;
grant select on public.ai_news_checks to authenticated;
grant all on public.ai_news_checks to service_role;

/** เริ่มตรวจ (ผู้ดูแล) → id · p_body = เนื้อข่าวที่กำลังแก้ในกล่องตรวจ (ยังไม่บันทึกก็ได้) · p_notes = ประเด็นบรรทัดละข้อ (ไม่เก็บ) */
create or replace function public.ai_news_check_start(p_news uuid, p_notes text, p_body text default null)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare n public.news; k text; model text; prompt text; req bigint; new_id bigint; lines text[]; pts int; ev record;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into n from public.news where id = p_news;
  if n.id is null then raise exception 'ไม่พบข่าวนี้'; end if;
  if coalesce(n.source_file_url, '') !~ '^https://' then raise exception 'ข่าวนี้ไม่มีไฟล์ PDF ต้นฉบับให้ตรวจเทียบ'; end if;
  select array_agg(l) into lines from (select left(btrim(x), 300) l from regexp_split_to_table(coalesce(p_notes, ''), E'\n') x where btrim(x) <> '' limit 15) t;
  pts := coalesce(array_length(lines, 1), 0);
  if pts = 0 then raise exception 'กรุณาพิมพ์ประเด็นที่เข้าใจอย่างน้อย 1 บรรทัด'; end if;
  p_body := left(coalesce(nullif(btrim(p_body), ''), n.body), 20000);
  if (select count(*) from public.ai_news_checks c where c.user_id = auth.uid() and c.created_at > now() - interval '1 day') >= 30 then
    raise exception 'ใช้ AI ตรวจข่าวครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  if to_regclass('net.http_request_queue') is null or has_table_privilege('authenticated', 'net.http_request_queue', 'select')
     or has_table_privilege('anon', 'net.http_request_queue', 'select') then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน';
  end if;
  select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
  if coalesce(k, '') = '' then raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งคีย์)'; end if;

  select * into ev from public.ai_news_evidence(n.id, n.source_file_url);
  prompt := 'คุณเป็นเภสัชกรผู้ตรวจข่าวความรู้เรื่องยาก่อนเผยแพร่ ' || ev.intro
    || 'ด้านล่างมี "ประเด็นที่ผู้ตรวจเข้าใจ" (เภสัชกรอ่านบทความมาแล้ว · มีเลขข้อ) และ "ข่าว"' || E'\n'
    || 'ทำทีละประเด็น: (1) หาในบทความว่าประเด็นนี้ถูกต้องตามบทความไหม ระบุเลขหน้า (2) ดูว่าข่าวเขียนเรื่องนี้ถูก ผิด หรือไม่ได้พูดถึง' || E'\n'
    || 'verdict: "correct" = ข่าวเขียนถูกตามบทความ · "wrong" = ข่าวเขียนไม่ตรงบทความ · "missing" = ข่าวไม่ได้พูดถึง · "unsupported" = บทความไม่ได้เขียนแบบที่ผู้ตรวจเข้าใจ (บอกว่าบทความเขียนว่าอะไร)' || E'\n'
    || 'explain = เหตุผลสั้น ๆ ภาษาไทยอ้างจากบทความ · fix = ข้อความที่ควรใช้ในข่าว (เขียนจากบทความ ด้วยภาษาที่ประชาชนเข้าใจ) หรือ "" ถ้าไม่ต้องแก้' || E'\n'
    || 'แล้วร่าง body = ข่าวทั้งฉบับที่แก้แล้ว: คงโครงและบรรทัดเดิม แก้เฉพาะจุดที่ผิด · ประเด็นที่ขาดให้เพิ่มในหัวข้อ "ใจความสำคัญจากบทความ" (บรรทัดละข้อ ขึ้นต้น "• " ท้ายข้อใส่ (หน้า n)) วางก่อนบรรทัด "ข้อควรรู้" · คงบรรทัดหมายเหตุ AI ท้ายข่าว' || E'\n'
    || 'ห้ามคัดลอกถ้อยคำของผู้ตรวจลงข่าว ห้ามเขียนเป็นคำถาม-คำตอบ ทุกข้อความต้องมาจากบทความ ห้ามเดา · ถ้าเปิดอ่าน PDF ไม่ได้ ให้ pdf_read=false และ items ว่าง' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"pdf_read": true, "items": [{"n": <เลขข้อ>, "verdict": "correct|wrong|missing|unsupported", "page": <เลขหน้าหรือ null>, "explain": "...", "fix": "..."}], "summary": "สรุป 1-2 ประโยค", "body": "ข่าวฉบับแก้"}' || E'\n\n'
    || 'ประเด็นที่ผู้ตรวจเข้าใจ:' || E'\n' || (select string_agg(i || '. ' || lines[i], E'\n') from generate_subscripts(lines, 1) i) || E'\n\n'
    || 'ข่าว (หัวข้อ: ' || n.title || '):' || E'\n' || p_body;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('temperature', 0))
            || case when ev.tools is null then '{}'::jsonb else jsonb_build_object('tools', ev.tools) end,   -- มีข้อความ PDF ในระบบ = ไม่ต้องให้ AI เปิดลิงก์
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 180000);
  insert into public.ai_news_checks (user_id, news_id, points, request_id) values (auth.uid(), n.id, pts, req) returning id into new_id;
  return new_id;
end $$;

/** แบบทดสอบสำหรับผู้อ่าน: p_items = [{"q": คำถาม, "a": คำตอบที่ถูก}] (1–10 ข้อ) → AI ตรวจกับ PDF + ลองตอบ + สร้างตัวเลือกหลอก */
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
  if to_regclass('net.http_request_queue') is null or has_table_privilege('authenticated', 'net.http_request_queue', 'select')
     or has_table_privilege('anon', 'net.http_request_queue', 'select') then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน';
  end if;
  select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
  if coalesce(k, '') = '' then raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งคีย์)'; end if;

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

/** อ่านผล: ยังรอ → ตรวจคำตอบจาก pg_net · ได้แล้ว = เก็บผล (ตัดข้อความประเด็นของผู้ดูแลออก) */
create or replace function public.ai_news_check_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_news_checks; res record; txt text; j jsonb; items jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_news_checks where id = p_id;
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
          if not coalesce((j->>'pdf_read')::boolean, true) then
            update public.ai_news_checks set status = 'error', note = 'AI เปิดอ่านไฟล์ PDF ต้นฉบับไม่ได้ กรุณาลองใหม่ภายหลัง', done_at = now() where id = r.id returning * into r;
          elsif r.kind = 'quiz' then
            select coalesce(jsonb_agg(jsonb_build_object('n', (e->>'n')::int,
                     'ai_answer', left(coalesce(e->>'ai_answer', ''), 400),
                     'match', case when e->>'match' in ('yes', 'no', 'not_found') then e->>'match' else 'not_found' end,
                     'page', case when e->>'page' ~ '^\d{1,4}$' then (e->>'page')::int end,
                     'explain', left(coalesce(e->>'explain', ''), 600),
                     'answer_rewrite', left(coalesce(e->>'answer_rewrite', ''), 200),
                     'distractors', coalesce((select jsonb_agg(left(btrim(d), 200)) from jsonb_array_elements_text(case when jsonb_typeof(e->'distractors') = 'array' then e->'distractors' else '[]' end) d where btrim(d) <> ''), '[]'))
                     order by (e->>'n')::int), '[]')
              into items from jsonb_array_elements(coalesce(j->'items', '[]')) e where e->>'n' ~ '^\d{1,2}$' and (e->>'n')::int between 1 and r.points;
            update public.ai_news_checks set status = 'done', done_at = now(), result = jsonb_build_object('pdf_read', true, 'items', items)
             where id = r.id returning * into r;
          else
            select coalesce(jsonb_agg(jsonb_build_object('n', (e->>'n')::int,
                     'verdict', case when e->>'verdict' in ('correct', 'wrong', 'missing', 'unsupported') then e->>'verdict' else 'missing' end,
                     'page', case when e->>'page' ~ '^\d{1,4}$' then (e->>'page')::int end,
                     'explain', left(coalesce(e->>'explain', ''), 600), 'fix', left(coalesce(e->>'fix', ''), 800)) order by (e->>'n')::int), '[]')
              into items from jsonb_array_elements(coalesce(j->'items', '[]')) e where e->>'n' ~ '^\d{1,2}$' and (e->>'n')::int between 1 and r.points;
            update public.ai_news_checks set status = 'done', done_at = now(),
                   result = jsonb_build_object('pdf_read', true, 'items', items, 'summary', left(coalesce(j->>'summary', ''), 600), 'body', left(coalesce(j->>'body', ''), 20000))
             where id = r.id returning * into r;
          end if;
        exception when others then
          update public.ai_news_checks set status = 'error', note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
        end;
      else
        update public.ai_news_checks set status = 'error', done_at = now(),
               note = case when res.status_code = 429 then 'AI มีผู้ใช้มาก/โควตาเต็ม กรุณาลองใหม่ภายหลัง'
                           when res.timed_out then 'AI ตอบช้าเกินไป กรุณาลองใหม่'
                           else 'AI ไม่ว่าง (รหัส ' || coalesce(res.status_code::text, '-') || ') กรุณาลองใหม่' end
         where id = r.id returning * into r;
      end if;
    elsif r.created_at < now() - interval '4 minutes' then
      update public.ai_news_checks set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'result', r.result, 'note', r.note, 'points', r.points);
end $$;

/* แบบทดสอบท้ายข่าว (ผู้ดูแลตั้ง · ไม่ใช่ข้อสอบของสภาเภสัชกรรม) — ผู้อ่านเห็นเมื่อข่าวเผยแพร่แล้ว · เขียนได้เฉพาะผู้ดูแล */
create table if not exists public.news_quiz (
  id          bigint generated always as identity primary key,
  news_id     uuid not null references public.news(id) on delete cascade,
  sort        smallint not null default 0,
  question    text not null check (char_length(question) between 1 and 300),
  answer      text not null check (char_length(answer) between 1 and 200),
  choices     jsonb not null default '[]' check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 1 and 4),   -- ตัวเลือกที่ผิด
  explain     text check (explain is null or char_length(explain) <= 600),
  page        smallint,
  created_at  timestamptz not null default now()
);
create index if not exists news_quiz_news_idx on public.news_quiz (news_id, sort);
alter table public.news_quiz enable row level security;
drop policy if exists nq_read on public.news_quiz;
drop policy if exists nq_admin on public.news_quiz;
create policy nq_read on public.news_quiz for select
  using (public.is_admin() or exists (select 1 from public.news n where n.id = news_id and n.status = 'published'));
create policy nq_admin on public.news_quiz for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.news_quiz to anon, authenticated;
grant insert, update, delete on public.news_quiz to authenticated;

revoke execute on function public.ai_news_check_start(uuid, text, text), public.ai_news_quiz_start(uuid, jsonb), public.ai_news_check_poll(bigint) from public, anon;
grant execute on function public.ai_news_check_start(uuid, text, text), public.ai_news_quiz_start(uuid, jsonb), public.ai_news_check_poll(bigint) to authenticated;

select 'ok' as step_47_ai_news_check;
