-- =====================================================================
--  ขั้นที่ 94: ตรวจความปลอดภัย 25 ต.ค. 2569 — จำกัดการใช้งานเกินควร + ซ่อนช่องภายในจากผู้ไม่ได้ล็อกอิน
--   เพิ่ม/ปรับสิทธิ์อย่างเดียว ไม่ลบข้อมูล · รันซ้ำได้
--   ① ไฟล์ที่ผู้ใช้อัปโหลดเอง (พื้นที่ฟรีรวม 1 GB): รูปประจำตัว ≤ 10 ไฟล์/วัน/คน · รูปในแชทของประชาชน ≤ 30 ไฟล์/วัน/คน
--      (เดิมไม่จำกัด: แชทส่งได้ 10 ครั้ง/นาที → บัญชีเดียวอัปโหลดรูปจนพื้นที่เต็มได้ในไม่กี่ชั่วโมง) · เจ้าหน้าที่/ผู้ดูแลไม่จำกัด
--   ② ส่งถี่เกินไป (ผู้ใช้ทั่วไปที่ล็อกอินด้วย Google): ความคิดเห็นข่าว ≤ 10 ครั้ง/10 นาที · ข้อเสนอแนะ ≤ 10 ครั้ง/ชั่วโมง · ห้องแชทใหม่ ≤ 5 ห้อง/วัน
--   ③ ผู้ไม่ได้ล็อกอิน (anon) อ่านได้เฉพาะช่องที่หน้าเว็บสาธารณะใช้: ข่าว (ไม่รวมความเห็นผู้ตรวจ/ผู้เขียน/สถานะเดิม)
--      · ความคิดเห็น (ไม่รวมรหัสผู้เขียน) · รายการถูกใจรายคนไม่ต้องอ่าน (นับผ่าน news_like_state)
-- =====================================================================

-- ① โควตาอัปโหลดไฟล์ต่อวัน (นับจาก storage.objects ของผู้อัปโหลด)
create or replace function public.upload_quota_ok(p_bucket text, p_folder text, p_max int)
returns boolean language sql stable security definer set search_path = public, storage as $$
  select public.is_staff_or_admin()
      or (select count(*) from storage.objects o
           where o.bucket_id = p_bucket
             and o.owner_id = auth.uid()::text
             and (p_folder is null or (storage.foldername(o.name))[1] = p_folder)
             and o.created_at > now() - interval '1 day') < p_max
$$;
revoke all on function public.upload_quota_ok(text, text, int) from public, anon;
grant execute on function public.upload_quota_ok(text, text, int) to authenticated;

drop policy if exists img_insert_avatar on storage.objects;
create policy img_insert_avatar on storage.objects for insert to authenticated
  with check (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'avatars'
              and (storage.foldername(name))[2] = auth.uid()::text
              and public.upload_quota_ok('public-images', 'avatars', 10));

drop policy if exists chatimg_insert on storage.objects;
create policy chatimg_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and public.can_access_chat_file(name)
              and public.upload_quota_ok('chat-images', null, 30));

-- ② กันส่งถี่เกินไป (ผู้ดูแลไม่จำกัด)
create or replace function public.rate_limit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_table_name = 'news_comments' then
    select count(*) into n from public.news_comments c where c.author_id = auth.uid() and c.created_at > now() - interval '10 minutes';
    if n >= 10 then raise exception 'แสดงความคิดเห็นถี่เกินไป กรุณารอสักครู่' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'feedback' then
    select count(*) into n from public.feedback f where f.author_id = auth.uid() and f.created_at > now() - interval '1 hour';
    if n >= 10 then raise exception 'ส่งข้อเสนอแนะถี่เกินไป กรุณาลองใหม่ภายหลัง' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'conversations' then
    select count(*) into n from public.conversations c where c.citizen_id = auth.uid() and c.created_at > now() - interval '1 day';
    if n >= 5 then raise exception 'เปิดห้องสนทนาใหม่ได้ไม่เกิน 5 ห้องต่อวัน' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
revoke all on function public.rate_limit_guard() from public, anon, authenticated;

drop trigger if exists news_comments_rate on public.news_comments;
create trigger news_comments_rate before insert on public.news_comments for each row execute function public.rate_limit_guard();
drop trigger if exists feedback_rate on public.feedback;
create trigger feedback_rate before insert on public.feedback for each row execute function public.rate_limit_guard();
drop trigger if exists conversations_rate on public.conversations;
create trigger conversations_rate before insert on public.conversations for each row execute function public.rate_limit_guard();

-- ③ ผู้ไม่ได้ล็อกอินอ่านเฉพาะช่องที่หน้าสาธารณะใช้ (ผู้ที่ล็อกอินแล้วยังเป็นตามเดิม · แถวที่อ่านได้ยังคุมด้วย RLS)
revoke select on public.news from anon;
grant select (id, title, tag, body, image_path, status, unit_id, comments_closed, view_count, created_at, updated_at, published_at,
              file_path, file_name, ai_generated, source_url, source_title, gallery, source_file_url, topic_ids) on public.news to anon;
revoke select on public.news_comments from anon;
grant select (id, news_id, author_name, body, created_at) on public.news_comments to anon;
revoke select on public.news_likes from anon;

select 'ok' as step_94_abuse_limits;
