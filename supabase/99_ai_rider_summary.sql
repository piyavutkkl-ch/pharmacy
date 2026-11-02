-- =====================================================================
--  ขั้นที่ 99: AI สรุปผลงาน Health Rider ขึ้นนำเสนอ (ai_rider_summary_start/poll)
--   ส่งเฉพาะตัวเลขสรุปรายตำบล (JSON) ให้ Gemini เรียบเรียงเป็นข้อความนำเสนอ
--   ไม่มีข้อมูลส่วนบุคคล (PDPA) · ผู้ดูแลเท่านั้น
-- =====================================================================

create or replace function public.ai_rider_summary_start(p_year int, p_stats jsonb)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  k text; model text; prompt text; req bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรโรงพยาบาลชุมชน สรุป "ผลการดำเนินงานบริการจัดส่งยาถึงบ้านโดย Health Rider" ประจำปีงบประมาณ ' || p_year || ' เพื่อนำเสนอต่อประชาชนและผู้บริหารบนหน้าเว็บ' || E'\n'
    || 'จากตัวเลขสรุปแยกรายตำบล (JSON) ต่อไปนี้:' || E'\n'
    || coalesce(p_stats::text, '[]') || E'\n\n'
    || 'เขียนเป็นข้อความสั้นกระชับ 4–5 ข้อ ขึ้นต้นแต่ละข้อด้วย "• " บรรทัดละข้อ:' || E'\n'
    || '• ภาพรวมจำนวนครั้งที่จัดส่งสำเร็จ และจำนวนผู้ป่วยที่ได้รับบริการ (คน ไม่นับซ้ำ)' || E'\n'
    || '• ตำบล/พื้นที่ที่มีการจัดส่งมากที่สุด' || E'\n'
    || '• สิทธิประโยชน์การจัดส่งยาฟรีให้ผู้ป่วย' || E'\n'
    || '• ประโยชน์ด้านความปลอดภัย การได้รับยาต่อเนื่อง และลดความแออัดที่โรงพยาบาล' || E'\n'
    || 'ใช้เฉพาะตัวเลขจริงจากข้อมูล ห้ามแต่งตัวเลขเพิ่ม · ไม่ต้องมีหัวข้อหรือคำเกริ่น · ตอบเป็นข้อความภาษาไทยธรรมดา';
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('temperature', 0.2)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  return req;
end $$;

create or replace function public.ai_rider_summary_poll(p_req bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  res record; txt text;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = p_req;
  if not found then
    return jsonb_build_object('status', 'pending');
  end if;
  if res.status_code = 200 then
    begin
      select string_agg(p->>'text', '') into txt
        from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p
       where not coalesce((p->>'thought')::boolean, false);
      txt := left(btrim(regexp_replace(coalesce(txt, ''), '[0-9]{9,}', '', 'g')), 4000);
      return jsonb_build_object('status', 'done', 'text', txt);
    exception when others then
      return jsonb_build_object('status', 'error', 'error', 'อ่านคำตอบของ AI ไม่ได้');
    end;
  else
    return jsonb_build_object('status', 'error', 'error', 'AI ไม่ว่าง กรุณาลองใหม่');
  end if;
end $$;

revoke execute on function public.ai_rider_summary_start(int, jsonb), public.ai_rider_summary_poll(bigint) from public, anon;
grant execute on function public.ai_rider_summary_start(int, jsonb), public.ai_rider_summary_poll(bigint) to authenticated;

select 'ok' as step_99_ai_rider_summary;
