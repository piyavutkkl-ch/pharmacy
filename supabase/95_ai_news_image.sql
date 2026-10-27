-- =====================================================================
--  ขั้นที่ 95: ฟังก์ชันสร้างภาพข่าว 1 ภาพ 3 ส่วน ด้วย AI (Nano Banana / Imagen) ผ่าน pg_net
--   ผู้ดูแลกด "✨ Gen ภาพด้วย AI" ในฟอร์มตรวจ/เขียนข่าว (#/admin/news)
--   ส่ง prompt ภาษาอังกฤษตามโครงสร้าง 3 ส่วน + สุ่มโทนสีสดใส
--   ai_news_image_start(p_title, p_body) → bigint id
--   ai_news_image_poll(p_id) → jsonb { status: pending|done|error, image_base64: '...', note: '...' }
--   จำกัด: ผู้ดูแลคนละไม่เกิน 30 ครั้ง/วัน
-- =====================================================================

create table if not exists public.ai_image_jobs (
  id              bigint generated always as identity primary key,
  user_id         uuid default auth.uid() references public.profiles(id) on delete set null,
  title           text not null,
  prompt          text not null,
  request_id      bigint,
  status          text not null default 'pending' check (status in ('pending', 'done', 'error')),
  image_base64    text,
  mime_type       text default 'image/jpeg',
  note            text,
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);

create index if not exists ai_image_jobs_user_idx on public.ai_image_jobs (user_id, created_at desc);

alter table public.ai_image_jobs enable row level security;
drop policy if exists aij_read on public.ai_image_jobs;
create policy aij_read on public.ai_image_jobs for select to authenticated
  using (public.is_admin() and user_id = auth.uid());
revoke all on public.ai_image_jobs from anon, authenticated;
grant select on public.ai_image_jobs to authenticated;
grant all on public.ai_image_jobs to service_role;

/** สุ่มโทนสีสดใส */
create or replace function public.ai_random_vibrant_palette()
returns text language sql immutable
as $$
  select case (floor(random() * 5)::int)
    when 0 then 'Vibrant coral orange, cyan teal, bright warm yellow, and clean white accents'
    when 1 then 'Bright cobalt blue, vivid lime green, energetic citrus yellow, and crisp white'
    when 2 then 'Electric violet, neon cyan, warm salmon pink, and modern minimal white'
    when 3 then 'Rich emerald teal, bold magenta pink, sunny yellow, and ultra-clean white'
    else 'Deep oceanic navy, bright turquoise, vibrant tangerine, and crisp white'
  end;
$$;

/** เริ่มสร้างภาพ (เฉพาะผู้ดูแล) */
create or replace function public.ai_news_image_start(p_title text, p_body text)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  k text;
  palette text;
  full_prompt text;
  model text;
  req bigint;
  new_id bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ เฉพาะผู้ดูแลเท่านั้น'; end if;
  perform public.ai_key();

  p_title := btrim(coalesce(p_title, ''));
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_title) < 3 then raise exception 'กรุณากรอกหัวข้อข่าวก่อน'; end if;

  if (select count(*) from public.ai_image_jobs j where j.user_id = auth.uid() and j.created_at > now() - interval '1 day') >= 30 then
    raise exception 'คุณสร้างภาพครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;

  if to_regclass('net.http_request_queue') is null or has_table_privilege('authenticated', 'net.http_request_queue', 'select')
     or has_table_privilege('anon', 'net.http_request_queue', 'select') then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน';
  end if;

  select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
  if coalesce(k, '') = '' then raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งคีย์)'; end if;

  palette := public.ai_random_vibrant_palette();
  full_prompt := 'Create ONLY ONE single tall portrait poster divided into 3 clearly separated sections stacked from top to bottom, with thin subtle divider lines. Flat modern vector graphic design, highly aesthetic and professional medical illustration. Tone: Random bright vibrant colors featuring ' || palette || '.' || E'\n\n'
    || 'TOPIC: ' || p_title || E'\n'
    || 'CONTENT SUMMARY: ' || left(p_body, 3500) || E'\n\n'
    || 'SECTION 1 (top - Executive Summary for patients & clinic front): An informative medical infographic poster. Clean minimalist layout, clear visual hierarchy, modern healthcare vector icons, core mechanism, and key tips.' || E'\n'
    || 'SECTION 2 (middle - Humorous 3-panel comic): A funny 3-panel comic strip in 2D hand-drawn editorial cartoon style with speech bubbles. Panel 1: Cute organ or pill character dealing with health stress. Panel 2: Discovering new medication/lifestyle solution with energetic spark. Panel 3: Happy healthy outcome with smiling patient. Humorous and lighthearted.' || E'\n'
    || 'SECTION 3 (bottom - Clinical Guideline & Matrix for healthcare staff): A professional clinical flowchart and structured decision matrix. Step-by-step decision tree, dosage/management comparison tables, color-coded sections, crisp and readable typography.' || E'\n\n'
    || 'Important: Use short, correctly spelled English keywords and labels only. Highly organized, vibrant, zero visual clutter.';

  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_image_model'), 'imagen-3.0-generate-002');

  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':predict',
    body := jsonb_build_object(
      'instances', jsonb_build_array(jsonb_build_object('prompt', full_prompt)),
      'parameters', jsonb_build_object('sampleCount', 1, 'aspectRatio', '3:4', 'outputMimeType', 'image/jpeg')
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000
  );

  insert into public.ai_image_jobs (user_id, title, prompt, request_id)
  values (auth.uid(), p_title, full_prompt, req)
  returning id into new_id;

  return new_id;
end $$;

/** อ่านผลการสร้างภาพ */
create or replace function public.ai_news_image_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  r public.ai_image_jobs;
  res record;
  b64 text;
  mime text;
begin
  select * into r from public.ai_image_jobs where id = p_id;
  if r.id is null or not (public.is_admin() and r.user_id = auth.uid()) then
    raise exception 'ไม่พบรายการนี้ หรือไม่มีสิทธิ์';
  end if;

  if r.status = 'pending' then
    select h.status_code, h.content, h.timed_out, h.error_msg into res from net._http_response h where h.id = r.request_id;
    if found then
      if res.status_code = 200 then
        begin
          -- รูปแบบคำตอบของ Imagen 3: predictions[0].bytesBase64Encoded
          b64 := (res.content::jsonb #> '{predictions,0,bytesBase64Encoded}')::text;
          b64 := trim(both '"' from coalesce(b64, ''));
          mime := trim(both '"' from coalesce((res.content::jsonb #> '{predictions,0,mimeType}')::text, 'image/jpeg'));

          -- รูปแบบสำรอง (ถ้าเป็น multimodal generateContent inlineData):
          if b64 = '' or b64 = 'null' then
            b64 := trim(both '"' from coalesce((res.content::jsonb #> '{candidates,0,content,parts,0,inlineData,data}')::text, ''));
            mime := trim(both '"' from coalesce((res.content::jsonb #> '{candidates,0,content,parts,0,inlineData,mimeType}')::text, 'image/png'));
          end if;

          if b64 is not null and b64 <> '' and b64 <> 'null' then
            update public.ai_image_jobs
               set status = 'done', image_base64 = b64, mime_type = mime, done_at = now()
             where id = r.id returning * into r;
          else
            update public.ai_image_jobs
               set status = 'error', note = 'AI ไม่ได้ส่งข้อมูลภาพกลับมา กรุณาลองใหม่', done_at = now()
             where id = r.id returning * into r;
          end if;
        exception when others then
          update public.ai_image_jobs set status = 'error', note = 'อ่านคำตอบของ AI ไม่ได้: ' || sqlerrm, done_at = now() where id = r.id returning * into r;
        end;
      else
        update public.ai_image_jobs set status = 'error', done_at = now(),
               note = case when res.status_code = 429 then 'AI โควตาเต็มหรือมีผู้ใช้มาก กรุณาลองใหม่ภายหลัง'
                           when res.timed_out then 'AI ตอบช้าเกินไป กรุณาลองใหม่'
                           else 'สร้างภาพไม่สำเร็จ (รหัส ' || coalesce(res.status_code::text, '-') || ') กรุณาลองใหม่' end
         where id = r.id returning * into r;
      end if;
    elsif r.created_at < now() - interval '3 minutes' then
      update public.ai_image_jobs set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
  end if;

  return jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'image_base64', r.image_base64,
    'mime_type', coalesce(r.mime_type, 'image/jpeg'),
    'note', r.note
  );
end $$;

revoke execute on function public.ai_news_image_start(text, text), public.ai_news_image_poll(bigint) from public, anon, authenticated;
grant execute on function public.ai_news_image_start(text, text), public.ai_news_image_poll(bigint) to authenticated;

/** ยา รพ.สต. ที่ผูกข้อมูลคำนวณนี้และมีข้อความฉลาก OpenFDA พร้อมตรวจ (ใช้ตรวจย้อนหลัง) */
create or replace function public.dose_audit_local(p_dose bigint)
returns int language sql stable security definer
set search_path = ''
as $$
  select l.id from public.local_drugs l
   where l.fda_key is not null and l.trashed_at is null
     and (l.dose_id = p_dose or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(l.ingredients) = 'array' then l.ingredients else '[]' end) g where (g->>'dose_id')::bigint = p_dose))
     and coalesce(btrim(public.ai_dose_fix_src(l.id)), '') <> ''
   order by l.active desc, l.id limit 1
$$;
revoke execute on function public.dose_audit_local(bigint) from public, anon, authenticated;

select 'ok' as step_95_ai_news_image;
