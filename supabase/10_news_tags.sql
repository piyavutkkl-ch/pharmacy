-- =====================================================================
--  ขั้นที่ 9: ประเภทข่าวใหม่ ข่าว / ประชาสัมพันธ์ / ความรู้ — รันต่อจาก 09 · รันซ้ำได้
--   ประเภทเดิม (ประกาศ / อบรม / รายงาน) ยังใช้ได้ เพื่อให้ข่าวเก่าไม่ต้องแก้ · หน้าเว็บให้เลือกเฉพาะประเภทใหม่
-- =====================================================================

alter table public.news drop constraint if exists news_tag_check;
alter table public.news add constraint news_tag_check
  check (tag in ('ข่าว', 'ประชาสัมพันธ์', 'ความรู้', 'ประกาศ', 'อบรม', 'รายงาน'));
alter table public.news alter column tag set default 'ข่าว';

select 'ok' as step_9_news_tags;
