-- =====================================================================
--  ขั้นที่ 17: ถังข่าว — หยุดเผยแพร่ / ลบ (ย้ายลงถัง) / ไม่ผ่าน เรียกคืนได้ภายใน 30 วัน — รันต่อจาก 17 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   สถานะใหม่: unpublished (หยุดเผยแพร่), deleted (ลบแล้ว อยู่ในถัง) · trashed_at = เวลาที่ลงถัง, prev_status = สถานะก่อนหน้า
--   ข่าวในถังเกิน 30 วัน หน้าผู้ดูแลลบถาวรให้เอง (ผ่านสิทธิ์ลบข่าวของผู้ดูแลตามปกติ)
-- =====================================================================

alter table public.news add column if not exists trashed_at timestamptz;
alter table public.news add column if not exists prev_status text;
alter table public.news drop constraint if exists news_status_check;
alter table public.news add constraint news_status_check
  check (status in ('pending', 'fix', 'rejected', 'published', 'unpublished', 'deleted'));

create or replace function public.news_trash_stamp()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('unpublished', 'deleted', 'rejected') then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      new.trashed_at := now();
      new.prev_status := case when tg_op = 'UPDATE' then old.status end;
    end if;
  else
    new.trashed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists news_trash_stamp on public.news;
create trigger news_trash_stamp before insert or update on public.news
  for each row execute function public.news_trash_stamp();
revoke execute on function public.news_trash_stamp() from public, anon, authenticated;

-- เดิม: ข่าวที่ผ่านแล้วไม่ถูกลงถัง → ใช้เวลาแก้ไขล่าสุดเป็นจุดเริ่มนับ 30 วัน
update public.news set trashed_at = updated_at where status = 'rejected' and trashed_at is null;

select 'ok' as step_17_news_trash;
