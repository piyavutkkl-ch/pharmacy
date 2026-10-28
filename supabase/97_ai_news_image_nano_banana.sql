-- =====================================================================
--  ขั้นที่ 97: ปรับปรุงการสร้างภาพข่าวด้วย AI ให้ใช้โมเดลตระกูล Nano Banana (gemini-2.5-flash-image)
--   - เปลี่ยนปลายทางเป็น :generateContent ตามมาตรฐาน Gemini API
--   - กำหนด responseModalities เป็น ["IMAGE"] และ aspectRatio เป็น 3:4
--   - ปรับ ai_news_image_poll ให้ดึงข้อมูล inlineData จากชิ้นส่วนผลลัพธ์ได้อย่างแม่นยำ
--   - แสดงรายละเอียดข้อความผิดพลาดจริงจาก AI หากเรียกไม่สำเร็จ
-- =====================================================================

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
  k := public.ai_key();

  p_title := btrim(coalesce(p_title, ''));
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_title) < 3 then raise exception 'กรุณากรอกหัวข้อข่าวก่อน'; end if;

  if (select count(*) from public.ai_image_jobs j where j.user_id = auth.uid() and j.created_at > now() - interval '1 day') >= 30 then
    raise exception 'คุณสร้างภาพครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;

  palette := public.ai_random_vibrant_palette();
  full_prompt := 'Create ONLY ONE single tall portrait poster divided into 3 clearly separated sections stacked from top to bottom, with thin subtle divider lines. Flat modern vector graphic design, highly aesthetic and professional medical illustration. Tone: Random bright vibrant colors featuring ' || palette || '.' || E'\n\n'
    || 'TOPIC: ' || p_title || E'\n'
    || 'CONTENT SUMMARY: ' || left(p_body, 3500) || E'\n\n'
    || 'SECTION 1 (top - Executive Summary for patients & clinic front): An informative medical infographic poster. Clean minimalist layout, clear visual hierarchy, modern healthcare vector icons, core mechanism, and key tips.' || E'\n'
    || 'SECTION 2 (middle - Humorous 3-panel comic): A funny 3-panel comic strip in 2D hand-drawn editorial cartoon style with speech bubbles. Panel 1: Cute organ or pill character dealing with health stress. Panel 2: Discovering new medication/lifestyle solution with energetic spark. Panel 3: Happy healthy outcome with smiling patient. Humorous and lighthearted.' || E'\n'
    || 'SECTION 3 (bottom - Clinical Guideline & Matrix for healthcare staff): A professional clinical flowchart and structured decision matrix. Step-by-step decision tree, dosage/management comparison tables, color-coded sections, crisp and readable typography.' || E'\n\n'
    || 'Important: Use short, correctly spelled English keywords and labels only. Highly organized, vibrant, zero visual clutter.';

  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_image_model'), 'gemini-2.5-flash-image');

  if model like 'imagen-%' then
    req := net.http_post(
      url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':predict',
      body := jsonb_build_object(
        'instances', jsonb_build_array(jsonb_build_object('prompt', full_prompt)),
        'parameters', jsonb_build_object('sampleCount', 1, 'aspectRatio', '3:4', 'outputMimeType', 'image/jpeg')
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
      timeout_milliseconds := 120000
    );
  else
    req := net.http_post(
      url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
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

  insert into public.ai_image_jobs (user_id, title, prompt, request_id)
  values (auth.uid(), p_title, full_prompt, req)
  returning id into new_id;

  return new_id;
end $$;

revoke execute on function public.ai_news_image_start(text, text) from public, anon, authenticated;
grant execute on function public.ai_news_image_start(text, text) to authenticated;

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
          -- 1) ค้นหาจาก candidates[0].content.parts ที่มี inlineData (สำหรับ gemini-2.5-flash-image / Nano Banana)
          select p->'inlineData'->>'data',
                 coalesce(p->'inlineData'->>'mimeType', 'image/jpeg')
            into b64, mime
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') as p
           where p->'inlineData'->>'data' is not null
           limit 1;
        exception when others then
          b64 := null;
        end;

        -- 2) รูปแบบ predictions[0].bytesBase64Encoded (กรณีใช้โมเดลตระกูล Imagen)
        if b64 is null or b64 = '' then
          b64 := trim(both '"' from coalesce((res.content::jsonb #> '{predictions,0,bytesBase64Encoded}')::text, ''));
          mime := trim(both '"' from coalesce((res.content::jsonb #> '{predictions,0,mimeType}')::text, 'image/jpeg'));
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
      else
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
      end if;
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

select 'ok' as step_97_ai_news_image_nano_banana;
