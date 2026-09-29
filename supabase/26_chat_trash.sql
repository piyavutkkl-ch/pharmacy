-- =====================================================================
--  ขั้นที่ 25: ลบห้องสนทนา (ประชาชน ⇄ รพ.สต./ห้องยา) ลงถัง · กู้คืนได้ภายใน 30 วัน — รันต่อจาก 25 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   เจ้าหน้าที่หน่วยนั้น/ผู้ดูแล ย้ายห้องลงถังหรือกู้คืนด้วย trash_conversation() (ประชาชนยังเห็นห้องของตัวเองตามเดิม)
--   ประชาชนส่งข้อความใหม่ → ห้องกลับขึ้นกล่องข้อความเอง (ไม่พลาดคำถามใหม่)
--   ห้องในถังเกิน 30 วัน หน้าผู้ดูแลลบถาวรให้เอง (ผ่านสิทธิ์ลบห้องของผู้ดูแลตามเดิม conv_delete)
-- =====================================================================

alter table public.conversations add column if not exists trashed_at timestamptz;

create or replace function public.trash_conversation(p_conv uuid, p_trash boolean)
returns timestamptz language plpgsql security definer
set search_path = ''
as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_conv;
  if not found or not public.can_access_conversation(p_conv) or c.citizen_id = auth.uid()
     or public.my_role() not in ('staff', 'admin') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  update public.conversations
     set trashed_at   = case when p_trash then now() end,
         unread_staff = case when p_trash then 0 else unread_staff end   -- ห้องในถังไม่นับเป็นข้อความค้าง
   where id = p_conv;
  return case when p_trash then now() end;
end $$;
revoke execute on function public.trash_conversation(uuid, boolean) from public, anon;
grant execute on function public.trash_conversation(uuid, boolean) to authenticated;

-- ข้อความใหม่จากประชาชน → ห้องออกจากถังอัตโนมัติ (ต่อยอดจาก 09_chat_images.sql)
create or replace function public.after_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = case when btrim(new.body) = '' then 'ส่งรูปภาพ' else left(new.body, 120) end,
         unread_staff   = unread_staff   + case when new.sender_role = 'citizen' then 1 else 0 end,
         unread_citizen = unread_citizen + case when new.sender_role = 'staff'   then 1 else 0 end,
         trashed_at     = case when new.sender_role = 'citizen' then null else trashed_at end
   where id = new.conversation_id;
  return null;
end $$;
revoke execute on function public.after_message() from public, anon, authenticated;

select 'ok' as step_25_chat_trash;
