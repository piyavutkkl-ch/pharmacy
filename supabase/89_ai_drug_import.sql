-- =====================================================================
--  ขั้นที่ 89: นำเข้าไฟล์ยาหลายรายการด้วย AI (หน้าตารางแก้ไขยา · เจ้าของเว็บ 21 ต.ค.) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   หน้าเว็บอ่านไฟล์ในเบราว์เซอร์ (Excel/CSV/PDF/ข้อความ) → ai_drug_import_start(ชื่อไฟล์, ข้อความ) → Gemini บอกว่าเป็นข้อมูลฐานไหน
--   (บัญชียา รพ.สต. · ยาในเว็บแอพ · บัญชียาหลักแห่งชาติ · อื่น ๆ) และจับข้อมูลลงช่อง → ai_drug_import_poll(id)
--   กันเดา: แถวที่ชื่อยา (และรหัส) ไม่อยู่ในข้อความไฟล์จริง = ตัดทิ้ง · ระบบไม่บันทึกเอง (หน้าเว็บแสดงให้ผู้ดูแลตรวจ → กดบันทึก)
--   ข้อมูล MIMS (ข้อมูลสมาชิก) ห้ามส่งให้ AI (เจ้าของเว็บ 21 ต.ค.) → ปฏิเสธข้อความที่เป็นหน้า MIMS · ใช้นำเข้า MIMS แบบไม่ใช้ AI แทน
--   ห้ามอัปโหลดไฟล์ที่มีข้อมูลผู้ป่วย (Gemini free tier) · ข้อความ ≤ 40,000 ตัวอักษร · 30 ครั้ง/วัน/ผู้ดูแล
-- =====================================================================

create table if not exists public.ai_drug_imports (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  file_name   text not null default '' check (char_length(file_name) <= 200),
  src         text not null check (char_length(src) <= 40000),
  request_id  bigint,
  ai_job      bigint,
  sent_at     timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result      jsonb,
  note        text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
alter table public.ai_drug_imports enable row level security;
drop policy if exists adi_read on public.ai_drug_imports;
create policy adi_read on public.ai_drug_imports for select to authenticated using (public.is_admin());
revoke all on public.ai_drug_imports from anon, authenticated;
grant select on public.ai_drug_imports to authenticated;
grant all on public.ai_drug_imports to service_role;

/** ข้อความเป็นหน้า MIMS หรือไม่ (ไม่ส่งให้ AI) */
create or replace function public.looks_mims(t text)
returns boolean language sql immutable
set search_path = ''
as $$ select coalesce(t, '') ~* '(mims\.com|MIMS Thailand|MIMS Class|What are the brands available for)' $$;

create or replace function public.ai_drug_import_start(p_name text, p_text text)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare k text; model text; prompt text; nreq bigint; new_id bigint; src text;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  src := btrim(coalesce(p_text, ''));
  if char_length(src) < 10 then raise exception 'ไฟล์ไม่มีข้อความให้อ่าน'; end if;
  if char_length(src) > 40000 then raise exception 'ไฟล์ยาวเกินไป (เกิน 40,000 ตัวอักษร) · แบ่งไฟล์เป็นส่วน ๆ'; end if;
  if public.looks_mims(src) then raise exception 'ไฟล์นี้เป็นข้อมูล MIMS · ไม่ส่งให้ AI (ข้อมูลสมาชิก) · ใช้ "นำเข้า MIMS" หรือวางข้อความหน้า MIMS ในหน้าทำงานทีละยาแทน'; end if;
  if (select count(*) from public.ai_drug_imports i where i.user_id = auth.uid() and i.created_at > now() - interval '1 day') >= 30 then
    raise exception 'ใช้ AI นำเข้าไฟล์ครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  k := public.ai_key();
  prompt := 'คุณช่วยเภสัชกรนำเข้าข้อมูลยาเข้าเว็บแอพของ รพ.สต. ในประเทศไทย ข้อความด้านล่างมาจากไฟล์ (ตาราง/เอกสาร) ที่ผู้ดูแลอัปโหลด' || E'\n'
    || 'ให้บอกว่าข้อมูลเป็นฐานไหน (target) แล้วดึงข้อมูลลงช่องของฐานนั้น:' || E'\n'
    || '- "rpst" = บัญชียา รพ.สต. (รายการยาของโรงพยาบาลพร้อมรหัสยา): code (รหัสยาโรงพยาบาล), name, category (หมวด/รูปแบบ), pack_size (ขนาดบรรจุ), unit (หน่วยนับ)' || E'\n'
    || '- "drugs" = รายการยาในเว็บแอพ (ไม่มีรหัสบัญชี หรือมีความแรงแยกช่อง): name, category, strength (ตัวเลข), strength_unit (เช่น มก./เม็ด · มก./5 มล. · มก./มล. · mcg/เม็ด · mcg/มล.), pack_size, unit, note, rpst_code' || E'\n'
    || '- "nlem" = บัญชียาหลักแห่งชาติ: name (ชื่อยา), group_name (กลุ่มยา), sub_name (กลุ่มย่อย), forms (รายการ {"form": รูปแบบยา, "acct": บัญชี ก/ข/ค/ง/จ})' || E'\n'
    || '- "other" = ไม่ใช่ข้อมูลยาที่นำเข้าได้' || E'\n'
    || 'กฎ: คัดลอกค่าจากไฟล์ตรงตัว ห้ามเดา ห้ามแต่ง ห้ามเติมข้อมูลที่ไม่มีในไฟล์ (ไม่มีค่า = ไม่ใส่ช่องนั้น) · ไม่เกิน 300 แถว' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"target": "rpst|drugs|nlem|other", "why": "เหตุผลภาษาไทยสั้น ๆ", "rows": [ {...} ], "unmapped": ["ชื่อคอลัมน์/ข้อมูลในไฟล์ที่ไม่มีช่องรองรับ"]}' || E'\n\n'
    || 'ชื่อไฟล์: ' || left(coalesce(p_name, ''), 200) || E'\n' || 'ข้อความในไฟล์:' || E'\n' || src;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  nreq := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000);
  insert into public.ai_drug_imports (user_id, file_name, src, request_id, ai_job, sent_at)
  values (auth.uid(), left(coalesce(p_name, ''), 200), src, nreq, public.ai_job_of(nreq), now())
  returning id into new_id;
  return new_id;
end $$;

/** ข้อความสำหรับเทียบว่า "อยู่ในไฟล์จริง" (ตัวเล็ก · ช่องว่างเดียว) */
create or replace function public.imp_norm(t text)
returns text language sql immutable
set search_path = ''
as $$ select lower(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')) $$;

create or replace function public.ai_drug_import_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_drug_imports; res record; txt text; j jsonb; tg text; keys text[]; rows jsonb := '[]'; row jsonb; o jsonb; kk text; v text; nsrc text; dropped int := 0; nreq bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_drug_imports where id = p_id for update;
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
          tg := case when j->>'target' in ('rpst', 'drugs', 'nlem') then j->>'target' else 'other' end;
          keys := case tg when 'rpst' then array['code', 'name', 'category', 'pack_size', 'unit']
                          when 'drugs' then array['name', 'category', 'strength', 'strength_unit', 'pack_size', 'unit', 'note', 'rpst_code']
                          when 'nlem' then array['name', 'group_name', 'sub_name'] else array[]::text[] end;
          nsrc := public.imp_norm(r.src);
          for row in select x from jsonb_array_elements(case when jsonb_typeof(j->'rows') = 'array' then j->'rows' else '[]' end) x limit 300 loop
            continue when jsonb_typeof(row) <> 'object';
            o := '{}';
            foreach kk in array keys loop
              v := left(btrim(coalesce(row->>kk, '')), case kk when 'note' then 500 when 'name' then 300 else 100 end);
              if v <> '' then o := o || jsonb_build_object(kk, v); end if;
            end loop;
            if tg = 'nlem' and jsonb_typeof(row->'forms') = 'array' then
              o := o || jsonb_build_object('forms', (select coalesce(jsonb_agg(jsonb_build_object('form', left(f->>'form', 200), 'acct', left(coalesce(f->>'acct', ''), 20))), '[]')
                                                    from jsonb_array_elements(row->'forms') f where jsonb_typeof(f) = 'object' and btrim(coalesce(f->>'form', '')) <> ''));
            end if;
            -- กันเดา: ชื่อยา (และรหัส) ต้องอยู่ในข้อความไฟล์จริง
            if coalesce(o->>'name', '') = '' or position(public.imp_norm(o->>'name') in nsrc) = 0
               or (o ? 'code' and position(public.imp_norm(o->>'code') in nsrc) = 0) then dropped := dropped + 1; continue; end if;
            rows := rows || jsonb_build_array(o);
          end loop;
          update public.ai_drug_imports set status = 'done', done_at = now(),
                 result = jsonb_build_object('target', tg, 'why', left(coalesce(j->>'why', ''), 500), 'rows', rows, 'dropped', dropped,
                                             'unmapped', (select coalesce(jsonb_agg(left(x, 100)), '[]') from (select x from jsonb_array_elements_text(case when jsonb_typeof(j->'unmapped') = 'array' then j->'unmapped' else '[]' end) x limit 30) t))
           where id = r.id returning * into r;
        exception when others then
          update public.ai_drug_imports set status = 'done', done_at = now(), note = 'อ่านคำตอบของ AI ไม่ได้ · กดลองใหม่' where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_drug_imports set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_drug_imports set status = 'done', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '4 minutes' then
      update public.ai_drug_imports set status = 'done', done_at = now(), note = 'หมดเวลารอ AI · กดลองใหม่' where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result, 'note', r.note);
end $$;

revoke execute on function public.ai_drug_import_start(text, text), public.ai_drug_import_poll(bigint), public.looks_mims(text), public.imp_norm(text) from public, anon;
grant execute on function public.ai_drug_import_start(text, text), public.ai_drug_import_poll(bigint) to authenticated;

select 'ok' as step_89_ai_drug_import;
