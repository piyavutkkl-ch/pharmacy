-- =====================================================================
--  ขั้นที่ 96: แก้ไข ai_news_image_start ให้ใช้ public.ai_key() ตามมาตรฐานขั้นที่ 48
--   (ถอดการตรวจ has_table_privilege ค้างเดิมออก เพื่อให้เรียกได้บน Supabase)
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

revoke execute on function public.ai_news_image_start(text, text) from public, anon, authenticated;
grant execute on function public.ai_news_image_start(text, text) to authenticated;

select 'ok' as step_96_ai_news_image_fix;
