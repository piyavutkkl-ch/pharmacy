-- =====================================================================
--  ขั้นที่ 1.3: เปิดสิทธิ์ให้หน้าเว็บเรียกตารางได้ (Data API grants)
--  Supabase โปรเจกต์ใหม่ไม่เปิดสิทธิ์ตารางให้อัตโนมัติแล้ว จึงต้องรันไฟล์นี้
--  ความปลอดภัยรายแถวยังคุมด้วย RLS เหมือนเดิม — รันซ้ำได้ ไม่เสียหาย
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

-- ระบบหลังบ้าน (Edge Functions / สำรองข้อมูล) ใช้ได้ทุกตาราง
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ผู้ที่ login แล้ว: อ่าน/เขียนได้ แต่ถูกกรองด้วย RLS ทุกแถว
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ข้อจำกัดเพิ่มเติม (ชั้นป้องกันนอกจาก RLS)
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, address, home_unit_id) on public.profiles to authenticated;
revoke update on public.conversations from authenticated;
revoke update on public.messages, public.feedback from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.site_stats from authenticated;

-- ผู้ที่ยังไม่ login: อ่านได้เฉพาะข้อมูลสาธารณะ
grant select on public.units, public.news, public.news_comments, public.news_likes, public.site_stats,
               public.achievements, public.criteria_years, public.criteria_items, public.dose_drugs
  to anon;

-- ฟังก์ชันตรวจสิทธิ์ที่กฎ RLS เรียกใช้
grant execute on function public.fiscal_year_of(date), public.my_role(), public.my_unit(), public.is_admin(),
                          public.is_staff_of(smallint), public.is_staff_or_admin(),
                          public.can_access_conversation(uuid)
  to anon, authenticated;

-- ฟังก์ชันที่หน้าเว็บเรียก
grant execute on function public.bump_home_views(), public.bump_news_view(uuid),
                          public.public_unit_scores(int), public.public_tracking_stats(int, smallint)
  to anon, authenticated;
grant execute on function public.start_fiscal_year(int), public.mark_conversation_read(uuid) to authenticated;

-- ตรวจผล: ควรเห็น authenticated มีสิทธิ์ SELECT บน profiles = true
select has_table_privilege('authenticated', 'public.profiles', 'SELECT') as authenticated_can_read_profiles,
       has_table_privilege('anon', 'public.patients', 'SELECT')          as anon_can_read_patients_should_be_false;
