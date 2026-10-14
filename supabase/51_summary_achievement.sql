-- =====================================================================
--  ขั้นที่ 51: สรุปผลงานเยี่ยมบ้าน (one page summary) → บันทึกเป็นผลงานตามข้อมาตรฐานด้วย · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ติ๊กข้อมาตรฐาน (เช่น 4.5.1) ในฟอร์มสรุป → หน้าเว็บสร้าง/แก้แถวใน achievements (unit_id = รพ.สต. ของสรุป · item_ids = ข้อที่เลือก)
--   visit_summaries.achievement_id จำผลงานที่สร้างจากสรุปนี้ (แก้สรุปแล้วแก้ผลงานเดิม ไม่สร้างซ้ำ) · ลบผลงาน = ช่องนี้เป็น null
--   สิทธิ์ใช้ policy เดิมของ achievements (ผู้ดูแล / เจ้าหน้าที่ของหน่วยนั้น)
-- =====================================================================

alter table public.visit_summaries add column if not exists achievement_id uuid references public.achievements(id) on delete set null;

select 'ok' as step_51_summary_achievement;
