-- =====================================================================
--  ขั้นที่ 4.4: ข้อมูลส่วนตัวประชาชน + แชท real-time (รันต่อจาก 06 · รันซ้ำได้)
--   1) หน้าเว็บเพิ่มห้องแชท/ข้อความได้เฉพาะช่องที่จำเป็น
--      (กันการปลอมตัวเลข "ยังไม่อ่าน", ชื่อผู้ส่ง, เวลา — ระบบเติมให้เอง)
--   2) ตรวจว่าเปิด Realtime ให้ตาราง messages / conversations แล้ว
-- =====================================================================

revoke insert on public.conversations from authenticated;
grant insert (target_unit) on public.conversations to authenticated;

revoke insert on public.messages from authenticated;
grant insert (conversation_id, body) on public.messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

select 'ok' as step_4_4,
       (select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
         and tablename in ('messages', 'conversations')) as realtime_tables_should_be_2;
