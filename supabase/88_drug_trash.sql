-- 88: ถังยาที่ลบ (เจ้าของเว็บ 21 ต.ค.) — กดลบยา = ย้ายลงถัง (trashed_at) ยังไม่ลบจริง · เรียกคืนได้ภายใน 7 วัน · ครบ 7 วันหน้าผู้ดูแลลบถาวรให้เอง
-- ยาในถังไม่แสดงต่อประชาชน/เจ้าหน้าที่ (เหมือนยาที่ซ่อน) · ผู้ดูแลยังเห็นเพื่อเรียกคืน
alter table public.local_drugs add column if not exists trashed_at timestamptz;

drop policy if exists ldrug_read on public.local_drugs;
create policy ldrug_read on public.local_drugs for select using ((active and trashed_at is null) or public.is_admin());
