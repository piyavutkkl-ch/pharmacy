-- =====================================================================
--  ขั้นที่ 101: อัปเดต AI สรุปประวัติการจัดส่งยาให้สรุปแยกตามเดือนและภาพรวม
--   (1. ภาพรวมความสำเร็จ · 2. ช่องทางการจัดส่ง · 3. กลุ่มผู้รับบริการและสิทธิการรักษา หลัก/ย่อย)
--   ส่งเฉพาะตัวเลขสรุป (summary jsonb) ไม่มีข้อมูลส่วนบุคคล (PDPA) · รันซ้ำได้
-- =====================================================================

create or replace function public.ai_delivery_start(p_id bigint)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.delivery_reports; k text; model text; prompt text; req bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.delivery_reports where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายงานนี้'; end if;
  if r.ai_status = 'pending' and r.ai_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังสรุปอยู่ กรุณารอสักครู่'; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรโรงพยาบาลชุมชน สรุป "ผลการให้บริการจัดส่งยาถึงบ้าน" จากตัวเลขสรุป (JSON) ด้านล่าง เป็นภาษาไทยสำหรับประชาชนและผู้บริหาร' || E'\n'
    || 'ให้สรุปทั้งภาพรวมและแนวโน้มรายเดือน 4–6 ข้อ ขึ้นต้นแต่ละข้อด้วย "• " บรรทัดละข้อ:' || E'\n'
    || '• ภาพรวมความสำเร็จ (ยอดการจัดส่งยาทั้งสิ้น จำนวนผู้รับบริการทั้งหมด อัตราการจัดส่งสำเร็จ)' || E'\n'
    || '• ช่องทางการจัดส่ง (สัดส่วนผ่าน Health Rider และผ่านพัสดุ Flash Express พร้อมร้อยละ)' || E'\n'
    || '• กลุ่มผู้รับบริการและสิทธิการรักษา (สิทธิหลัก UC/Non-UC และกลุ่มเป้าหมายหลัก เช่น ผู้สูงอายุ ผู้พิการ สิทธิ UC ทั่วไปในเขต)' || E'\n'
    || '• แนวโน้มรายเดือน พื้นที่/ตำบลที่ใช้บริการมาก และข้อสังเกตหรือข้อเสนอแนะสั้น ๆ 1 ข้อ' || E'\n'
    || 'ใช้เฉพาะตัวเลขที่ให้มา ห้ามเดาหรือแต่งตัวเลขเพิ่ม · ไม่ต้องมีหัวข้อหรือคำเกริ่น · ตอบเป็นข้อความธรรมดา' || E'\n\n'
    || 'หัวข้อ: ' || r.title || E'\n' || r.summary::text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('temperature', 0.25)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  update public.delivery_reports set ai_status = 'pending', ai_note = null, ai_request_id = req, ai_job = public.ai_job_of(req), ai_sent_at = now() where id = r.id;
end $$;

revoke execute on function public.ai_delivery_start(bigint) from public, anon;
grant execute on function public.ai_delivery_start(bigint) to authenticated;

select 'ok' as step_101_ai_delivery_monthly;
