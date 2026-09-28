-- =====================================================================
--  ขั้นที่ 8: แนบรูปในแชท (ประชาชน ⇄ เจ้าหน้าที่ รพ.สต. / ห้องยา รพ.) — รันต่อจาก 08 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   รูปเก็บใน bucket ส่วนตัว chat-images path = <conversation id>/<ไฟล์>.webp (หน้าเว็บย่อรูปก่อนส่ง ≤ 1 MB)
--   เห็นรูปได้เฉพาะคนที่เข้าห้องแชทนั้นได้ (can_access_conversation: เจ้าของห้อง, เจ้าหน้าที่หน่วยนั้น, ผู้ดูแล)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ชื่อไฟล์ขึ้นต้นด้วย id ห้องแชท → ตรวจสิทธิ์ตามห้อง (ชื่อผิดรูปแบบ = ไม่มีสิทธิ์)
create or replace function public.can_access_chat_file(p_name text)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
begin
  return public.can_access_conversation(split_part(p_name, '/', 1)::uuid);
exception when others then
  return false;
end $$;
revoke execute on function public.can_access_chat_file(text) from public;
grant execute on function public.can_access_chat_file(text) to anon, authenticated;

drop policy if exists chatimg_read on storage.objects;
drop policy if exists chatimg_insert on storage.objects;
drop policy if exists chatimg_delete on storage.objects;
create policy chatimg_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and public.can_access_chat_file(name));
create policy chatimg_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and public.can_access_chat_file(name));
create policy chatimg_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and public.is_admin());

-- ข้อความ: แนบรูปได้ 1 รูป · ส่งรูปอย่างเดียว (ไม่มีข้อความ) ได้ · รูปต้องอยู่ในโฟลเดอร์ของห้องนี้เท่านั้น
alter table public.messages add column if not exists image_path text;
alter table public.messages alter column body set default '';
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (char_length(btrim(body)) <= 1000 and (char_length(btrim(body)) >= 1 or image_path is not null));
alter table public.messages drop constraint if exists messages_image_path_check;
alter table public.messages add constraint messages_image_path_check
  check (image_path is null or (split_part(image_path, '/', 1) = conversation_id::text
                                and image_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'));
grant insert (conversation_id, body, image_path) on public.messages to authenticated;

-- ตัวอย่างข้อความล่าสุดในรายการห้อง: ส่งรูปอย่างเดียว → "ส่งรูปภาพ"
create or replace function public.after_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = case when btrim(new.body) = '' then 'ส่งรูปภาพ' else left(new.body, 120) end,
         unread_staff   = unread_staff   + case when new.sender_role = 'citizen' then 1 else 0 end,
         unread_citizen = unread_citizen + case when new.sender_role = 'staff'   then 1 else 0 end
   where id = new.conversation_id;
  return null;
end $$;
revoke execute on function public.after_message() from public, anon, authenticated;

select 'ok' as step_8_chat_images,
       (select count(*) from storage.buckets where id = 'chat-images') as bucket_should_be_1;
