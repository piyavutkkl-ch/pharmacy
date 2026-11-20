-- =====================================================================
--  ขั้นที่ 102: ตั้งค่า API Key (Google AI Studio) · โมเดล · Prompt สร้างภาพข่าว AI พร้อมระบบล็อกค่าค้างไว้
--   - เก็บ API Key สำหรับสร้างภาพแยกใน Supabase Vault ('ai_image_api_key') ไม่เก็บใน site_texts (กันหลุดสู่สาธารณะ)
--   - หากไม่ได้กรอกคีย์แยก จะสลับไปใช้คีย์หลัก ('gemini_api_key') ของระบบอัตโนมัติ
--   - เก็บโมเดล ('ai_image_model'), Prompt สร้างภาพ ('ai_image_prompt') และสถานะล็อก ('ai_image_locked') ใน site_texts
--   - ai_image_settings_get() / ai_image_settings_save() สำหรับผู้ดูแล (และ service_role ใน GitHub Actions)
--   - ai_news_image_start / ai_news_image_poll ใช้คีย์ โมเดล และ Prompt ที่ตั้งค้างไว้
-- =====================================================================

/** Prompt มาตรฐานสำหรับสร้างภาพข่าว 1 ภาพ */
create or replace function public.ai_default_image_prompt()
returns text language sql immutable
as $$
  select 'Create ONLY ONE single tall portrait poster divided into 3 clearly separated sections stacked from top to bottom, with thin subtle divider lines. Flat modern vector graphic design, highly aesthetic and professional medical illustration.' || E'\n'
    || 'SECTION 1 (top - Executive Summary for patients & clinic front): An informative medical infographic poster. Clean minimalist layout, clear visual hierarchy, modern healthcare vector icons, core mechanism, and key tips.' || E'\n'
    || 'SECTION 2 (middle - Humorous 3-panel comic): A funny 3-panel comic strip in 2D hand-drawn editorial cartoon style with speech bubbles. Panel 1: Cute organ or pill character dealing with health stress. Panel 2: Discovering new medication/lifestyle solution with energetic spark. Panel 3: Happy healthy outcome with smiling patient. Humorous and lighthearted.' || E'\n'
    || 'SECTION 3 (bottom - Clinical Guideline & Matrix for healthcare staff): A professional clinical flowchart and structured decision matrix. Step-by-step decision tree, dosage/management comparison tables, color-coded sections, crisp and readable typography.' || E'\n'
    || 'Important: Use short, correctly spelled keywords and labels only. Highly organized, vibrant, zero visual clutter.'
$$;

/** ดึง API Key สำหรับสร้างภาพ (ใช้ ai_image_api_key ที่ผู้ดูแลกรอกไว้ก่อน ถ้าไม่มีจึงใช้ gemini_api_key หลัก) */
create or replace function public.ai_image_key()
returns text language plpgsql security definer
set search_path = ''
as $$
declare k text;
begin
  if to_regclass('net.http_request_queue') is null then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน: ฐานข้อมูลยังไม่ได้เปิดส่วนเรียก AI (pg_net)';
  end if;
  if (has_table_privilege('authenticated', 'net.http_request_queue', 'select') or has_table_privilege('anon', 'net.http_request_queue', 'select'))
     and exists (select 1 from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
                  where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%' and c ~ '(=|,)\s*net\s*(,|$)') then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน: schema net เปิดผ่าน API อยู่ (ไม่ปลอดภัยต่อคีย์)';
  end if;
  select btrim(s.decrypted_secret) into k from vault.decrypted_secrets s where s.name = 'ai_image_api_key' limit 1;
  if coalesce(k, '') = '' then
    select btrim(s.decrypted_secret) into k from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
  end if;
  if coalesce(k, '') = '' then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน (กรุณากรอก Google AI Studio API Key ในช่องตั้งค่า)';
  end if;
  return k;
end $$;
revoke execute on function public.ai_image_key() from public, anon, authenticated;

/** อ่านค่าตั้ง AI สร้างภาพ (เฉพาะผู้ดูแล และ service_role สำหรับสร้างข่าวอัตโนมัติรายวัน) */
create or replace function public.ai_image_settings_get()
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  k text;
  has_def boolean;
  m text;
  p text;
  lck text;
begin
  if not (public.is_admin()
          or coalesce(current_setting('role', true), '') in ('service_role', 'postgres')
          or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role') then
    raise exception 'ไม่มีสิทธิ์ เฉพาะผู้ดูแลเท่านั้น';
  end if;

  select btrim(s.decrypted_secret) into k from vault.decrypted_secrets s where s.name = 'ai_image_api_key' limit 1;
  select exists(select 1 from vault.decrypted_secrets s where s.name = 'gemini_api_key' and coalesce(btrim(s.decrypted_secret), '') <> '') into has_def;
  select nullif(btrim(t.body), '') into m from public.site_texts t where t.key = 'ai_image_model';
  select nullif(btrim(t.body), '') into p from public.site_texts t where t.key = 'ai_image_prompt';
  select nullif(btrim(t.body), '') into lck from public.site_texts t where t.key = 'ai_image_locked';

  return jsonb_build_object(
    'api_key', coalesce(k, ''),
    'has_default_key', coalesce(has_def, false),
    'model', coalesce(m, 'gemini-2.5-flash-image'),
    'prompt', coalesce(p, public.ai_default_image_prompt()),
    'locked', coalesce(lck, 'on') <> 'off'
  );
end $$;
revoke execute on function public.ai_image_settings_get() from public, anon, authenticated;
grant execute on function public.ai_image_settings_get() to authenticated, service_role;

/** บันทึกและล็อกค่าตั้ง AI สร้างภาพ (เฉพาะผู้ดูแล) */
create or replace function public.ai_image_settings_save(
  p_api_key text,
  p_model text,
  p_prompt text,
  p_locked boolean default true
)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid;
  clean_key text := btrim(coalesce(p_api_key, ''));
  clean_model text := btrim(coalesce(p_model, ''));
  clean_prompt text := btrim(coalesce(p_prompt, ''));
begin
  if not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ เฉพาะผู้ดูแลเท่านั้น';
  end if;

  if clean_model = '' or clean_model !~ '^[a-z0-9][a-z0-9.\-]{1,60}$' then
    clean_model := 'gemini-2.5-flash-image';
  end if;
  if clean_prompt = '' then
    clean_prompt := public.ai_default_image_prompt();
  end if;

  select s.id into sid from vault.secrets s where s.name = 'ai_image_api_key' limit 1;
  if sid is null then
    if clean_key <> '' then
      perform vault.create_secret(clean_key, 'ai_image_api_key', 'Google AI Studio API Key สำหรับสร้างภาพข่าว');
    end if;
  else
    if (select d.decrypted_secret from vault.decrypted_secrets d where d.id = sid) is distinct from clean_key then
      perform vault.update_secret(sid, clean_key);
    end if;
  end if;

  insert into public.site_texts (key, body, updated_at)
  values
    ('ai_image_model', clean_model, now()),
    ('ai_image_prompt', left(clean_prompt, 4000), now()),
    ('ai_image_locked', case when coalesce(p_locked, true) then 'on' else 'off' end, now())
  on conflict (key) do update
    set body = excluded.body, updated_at = now();

  return public.ai_image_settings_get();
end $$;
revoke execute on function public.ai_image_settings_save(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.ai_image_settings_save(text, text, text, boolean) to authenticated;

/** เริ่มสร้างภาพด้วยคีย์ โมเดล และ Prompt ที่ตั้งค้างไว้ (เฉพาะผู้ดูแล) */
create or replace function public.ai_news_image_start(p_title text, p_body text)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  k text;
  palette text;
  custom_prompt text;
  full_prompt text;
  first_model text;
  model_list text[];
  req bigint;
  new_id bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์ เฉพาะผู้ดูแลเท่านั้น'; end if;
  k := public.ai_image_key();

  p_title := btrim(coalesce(p_title, ''));
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_title) < 3 then raise exception 'กรุณากรอกหัวข้อข่าวก่อน'; end if;

  if (select count(*) from public.ai_image_jobs j where j.user_id = auth.uid() and j.created_at > now() - interval '1 day') >= 30 then
    raise exception 'คุณสร้างภาพครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;

  palette := public.ai_random_vibrant_palette();
  custom_prompt := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_image_prompt'), public.ai_default_image_prompt());
  full_prompt := custom_prompt || E'\n\n'
    || 'Tone: Random bright vibrant colors featuring ' || palette || '.' || E'\n'
    || 'TOPIC: ' || p_title || E'\n'
    || 'CONTENT SUMMARY: ' || left(p_body, 3500);

  first_model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_image_model'), 'gemini-2.5-flash-image');
  model_list := public.ai_image_models(first_model);

  if model_list[1] like 'imagen-%' then
    req := net.http_post(
      url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model_list[1] || ':predict',
      body := jsonb_build_object(
        'instances', jsonb_build_array(jsonb_build_object('prompt', full_prompt)),
        'parameters', jsonb_build_object('sampleCount', 1, 'aspectRatio', '3:4', 'outputMimeType', 'image/jpeg')
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
      timeout_milliseconds := 120000
    );
  else
    req := net.http_post(
      url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model_list[1] || ':generateContent',
      body := jsonb_build_object(
        'contents', jsonb_build_array(
          jsonb_build_object(
            'parts', jsonb_build_array(
              jsonb_build_object('text', full_prompt)
            )
          )
        ),
        'generationConfig', jsonb_build_object(
          'responseModalities', jsonb_build_array('IMAGE'),
          'imageConfig', jsonb_build_object('aspectRatio', '3:4')
        )
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
      timeout_milliseconds := 120000
    );
  end if;

  insert into public.ai_image_jobs (user_id, title, prompt, request_id, models, try)
  values (auth.uid(), p_title, full_prompt, req, model_list, 1)
  returning id into new_id;

  return new_id;
end $$;

revoke execute on function public.ai_news_image_start(text, text) from public, anon, authenticated;
grant execute on function public.ai_news_image_start(text, text) to authenticated;

/** อ่านผลการสร้างภาพ พร้อมระบบลองโมเดลสำรองอัตโนมัติโดยใช้คีย์จาก ai_image_key() */
create or replace function public.ai_news_image_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  r public.ai_image_jobs;
  res record;
  b64 text;
  mime text;
  k text;
  next_model text;
  new_req bigint;
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
          select p->'inlineData'->>'data',
                 coalesce(p->'inlineData'->>'mimeType', 'image/jpeg')
            into b64, mime
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') as p
           where p->'inlineData'->>'data' is not null
           limit 1;
        exception when others then
          b64 := null;
        end;

        if b64 is null or b64 = '' then
          b64 := trim(both '"' from coalesce((res.content::jsonb #> '{predictions,0,bytesBase64Encoded}')::text, ''));
          mime := trim(both '"' from coalesce((res.content::jsonb #> '{predictions,0,mimeType}')::text, 'image/jpeg'));
        end if;

        if b64 is not null and b64 <> '' and b64 <> 'null' then
          update public.ai_image_jobs
             set status = 'done', image_base64 = b64, mime_type = mime, done_at = now()
           where id = r.id returning * into r;
          return jsonb_build_object(
            'id', r.id, 'status', r.status, 'note', r.note,
            'mime_type', r.mime_type, 'image_base64', r.image_base64,
            'created_at', r.created_at, 'done_at', r.done_at
          );
        end if;
      end if;

      if r.try < coalesce(array_length(r.models, 1), 0) and res.status_code not in (401, 403) then
        begin
          k := public.ai_image_key();
          next_model := r.models[r.try + 1];
          if next_model like 'imagen-%' then
            new_req := net.http_post(
              url := 'https://generativelanguage.googleapis.com/v1beta/models/' || next_model || ':predict',
              body := jsonb_build_object(
                'instances', jsonb_build_array(jsonb_build_object('prompt', r.prompt)),
                'parameters', jsonb_build_object('sampleCount', 1, 'aspectRatio', '3:4', 'outputMimeType', 'image/jpeg')
              ),
              headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
              timeout_milliseconds := 120000
            );
          else
            new_req := net.http_post(
              url := 'https://generativelanguage.googleapis.com/v1beta/models/' || next_model || ':generateContent',
              body := jsonb_build_object(
                'contents', jsonb_build_array(
                  jsonb_build_object(
                    'parts', jsonb_build_array(jsonb_build_object('text', r.prompt))
                  )
                ),
                'generationConfig', jsonb_build_object(
                  'responseModalities', jsonb_build_array('IMAGE'),
                  'imageConfig', jsonb_build_object('aspectRatio', '3:4')
                )
              ),
              headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
              timeout_milliseconds := 120000
            );
          end if;

          update public.ai_image_jobs
             set try = try + 1, request_id = new_req
           where id = r.id returning * into r;

          return jsonb_build_object(
            'id', r.id, 'status', 'pending', 'note', 'กำลังลองด้วยโมเดลสำรอง...',
            'mime_type', r.mime_type, 'image_base64', null,
            'created_at', r.created_at, 'done_at', null
          );
        exception when others then
          null;
        end;
      end if;

      update public.ai_image_jobs set status = 'error', done_at = now(),
             note = case
               when res.status_code = 429 then 'AI โควตาเต็มหรือมีผู้ใช้มาก กรุณาลองใหม่ภายหลัง'
               when res.timed_out then 'AI ตอบช้าเกินไป กรุณาลองใหม่'
               else coalesce(
                 nullif(trim(res.content::jsonb #>> '{error,message}'), ''),
                 'สร้างภาพไม่สำเร็จ (รหัส ' || coalesce(res.status_code::text, '-') || ') กรุณาลองใหม่'
               )
             end
       where id = r.id returning * into r;

    elsif r.created_at < now() - interval '3 minutes' then
      update public.ai_image_jobs set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
  end if;

  return jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'note', r.note,
    'mime_type', r.mime_type,
    'image_base64', r.image_base64,
    'created_at', r.created_at,
    'done_at', r.done_at
  );
end $$;

revoke execute on function public.ai_news_image_poll(bigint) from public, anon, authenticated;
grant execute on function public.ai_news_image_poll(bigint) to authenticated;

select 'ok' as step_102_ai_news_image_settings;
