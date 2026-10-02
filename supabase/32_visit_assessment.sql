-- =====================================================================
--  ขั้นที่ 31: บันทึกเยี่ยมบ้านช่อง A (Assessment) — รันต่อจาก 31 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   SOAP ครบ: S (subjective) · O (objective) · A (assessment) · P (plan) · DRPs ยังแยกเป็นรายการติ๊กเหมือนเดิม
--   รายการยาที่เหลือ (med_list jsonb) เพิ่มคีย์ "how" = วิธีใช้ — ไม่ต้องแก้โครงสร้าง (เก็บใน jsonb เดิม)
-- =====================================================================

alter table public.visits add column if not exists assessment text;
alter table public.visits drop constraint if exists visits_assessment_check;
alter table public.visits add constraint visits_assessment_check check (assessment is null or char_length(assessment) <= 4000);

select 'ok' as step_31_visit_assessment;
