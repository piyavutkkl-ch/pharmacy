-- =====================================================================
--  ขั้นที่ 28: ข่าวจาก AI แนบลิงก์ดาวน์โหลดบทความต้นฉบับ (PDF บนเว็บ CCPE) อัตโนมัติ — รันต่อจาก 28 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   source_file_url = ลิงก์ปุ่ม "ดาวน์โหลดบทความ" ของ CCPE (showfile.php?file=<id>) — ลิงก์ไปไฟล์ต้นฉบับ ไม่เก็บสำเนาไว้ในระบบ
--   ข่าว AI ที่สร้างไปแล้วเติมลิงก์ให้จาก source_url (id บทความเดียวกัน)
-- =====================================================================

alter table public.news add column if not exists source_file_url text;
alter table public.news drop constraint if exists news_source_file_check;
alter table public.news add constraint news_source_file_check
  check (source_file_url is null or (source_file_url ~ '^https://' and char_length(source_file_url) <= 500));

update public.news
   set source_file_url = 'https://ccpe.pharmacycouncil.org/showfile.php?file=' || substring(source_url from '[?&]id=(\d+)')
 where ai_generated and source_file_url is null
   and source_url ~ '^https://ccpe\.pharmacycouncil\.org/.*[?&]id=\d+';

select 'ok' as step_28_ai_news_pdf;
