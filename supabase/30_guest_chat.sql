-- =====================================================================
--  ขั้นที่ 29: แชทแบบไม่ต้องล็อกอิน (ประชาชนทั่วไป) — รันต่อจาก 29 · รันซ้ำได้
--   ผู้ไม่ได้ล็อกอินคุยกับ รพ.สต./ห้องยา รพ. ได้ผ่านฟังก์ชันเท่านั้น (guest_chat_send / guest_chat_fetch / guest_chat_list)
--   · ต้องใส่ชื่อเล่น · ข้อความละไม่เกิน 15 ตัวอักษร · วันละไม่เกิน 20 ข้อความต่อเครื่อง (60 ต่อ IP) · ส่งรูปไม่ได้ (ทั้งสองฝั่ง)
--   · ห้องจำไว้ในเครื่องด้วยรหัสเครื่อง (localStorage 'pcps_device') — ฐานข้อมูลเก็บแค่ md5 ของรหัส (เจ้าหน้าที่เห็นก็สวมรอยไม่ได้)
--   · เก็บชั่วคราว: ห้องที่ไม่มีข้อความใหม่ 7 วัน ลบทิ้งอัตโนมัติ (purge_guest_chats)
--   เจ้าหน้าที่/ผู้ดูแลตอบในกล่อง "ข้อความ" เดิม (RLS เดิม: เจ้าหน้าที่เห็นห้องของหน่วยตัวเอง · ผู้ดูแลเห็นทั้งหมด)
-- confirmed-destructive: เจ้าของเว็บยืนยันใน comment หน้าตัวอย่าง (2 ต.ค. 2569) ให้ลบแชทของผู้ไม่ได้ล็อกอินอัตโนมัติเมื่อครบ 7 วัน
-- =====================================================================

alter table public.conversations alter column citizen_id drop not null;
alter table public.conversations add column if not exists guest_key  text;   -- md5('guest:' || รหัสเครื่อง)
alter table public.conversations add column if not exists guest_name text;   -- ชื่อเล่นที่ผู้ถามใส่
alter table public.conversations add column if not exists guest_ip   text;   -- md5(IP) กันสแปมเปลี่ยนรหัสเครื่อง
alter table public.conversations drop constraint if exists conversations_owner_check;
alter table public.conversations add constraint conversations_owner_check
  check (num_nonnulls(citizen_id, guest_key) = 1
         and (guest_key is null or char_length(btrim(coalesce(guest_name, ''))) between 1 and 30));
create unique index if not exists conversations_guest_one_per_target
  on public.conversations (guest_key, coalesce(target_unit, -1)) where guest_key is not null;
create index if not exists conversations_guest_ip on public.conversations (guest_ip) where guest_ip is not null;

-- ข้อความ: ผู้ไม่ได้ล็อกอินส่งได้ผ่าน guest_chat_send เท่านั้น · ห้องของผู้ไม่ได้ล็อกอินส่งรูปไม่ได้ (ไฟล์จะค้างหลังลบห้อง)
create or replace function public.before_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
  recent int;
begin
  select * into c from public.conversations where id = new.conversation_id;
  if c.guest_key is not null and new.image_path is not null then
    raise exception 'ห้องของผู้ไม่ได้ล็อกอิน ส่งรูปไม่ได้';
  end if;
  if auth.uid() is null then
    if c.guest_key is null or coalesce(current_setting('pcps.guest_send', true), '') <> 'on' then
      raise exception 'ไม่มีสิทธิ์';
    end if;
    new.sender_id := null; new.sender_role := 'citizen'; new.sender_name := c.guest_name; new.created_at := now();
    return new;
  end if;
  new.sender_id := auth.uid();
  new.sender_role := case when c.citizen_id = auth.uid() then 'citizen' else 'staff' end;
  select coalesce(p.full_name, 'ผู้ใช้') into new.sender_name from public.profiles p where p.id = auth.uid();
  new.created_at := now();
  -- กันส่งถี่เกินไป: ไม่เกิน 10 ข้อความต่อนาทีต่อคน
  select count(*) into recent from public.messages m
   where m.sender_id = auth.uid() and m.created_at > now() - interval '1 minute';
  if recent >= 10 then
    raise exception 'ส่งข้อความถี่เกินไป กรุณารอสักครู่';
  end if;
  return new;
end $$;
revoke execute on function public.before_message() from public, anon, authenticated;

-- ลบแชทของผู้ไม่ได้ล็อกอินที่ไม่มีข้อความใหม่ 7 วัน (ข้อความลบตามอัตโนมัติ) · เรียกจากฟังก์ชันแชท + กล่องข้อความเจ้าหน้าที่ + keepalive
create or replace function public.purge_guest_chats()
returns int language plpgsql security definer
set search_path = ''
as $$
declare n int;
begin
  delete from public.conversations c
   where c.guest_key is not null and coalesce(c.last_message_at, c.created_at) < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.guest_key_of(p_token uuid)
returns text language sql immutable
set search_path = ''
as $$ select md5('guest:' || p_token::text) $$;

create or replace function public.guest_message_json(m public.messages)
returns jsonb language sql stable
set search_path = ''
as $$ select jsonb_build_object('id', m.id, 'sender_role', m.sender_role, 'sender_name', m.sender_name, 'body', m.body, 'created_at', m.created_at) $$;

/** ส่งข้อความ (ผู้ไม่ได้ล็อกอิน) → ข้อความที่บันทึก (jsonb) */
create or replace function public.guest_chat_send(p_token uuid, p_target smallint, p_name text, p_body text)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  k   text;
  ip  text;
  nm  text := btrim(coalesce(p_name, ''));
  b   text := btrim(coalesce(p_body, ''));
  cid uuid;
  n   int;
  m   public.messages;
begin
  if auth.uid() is not null then raise exception 'เข้าสู่ระบบแล้ว กรุณาใช้แชทในหน้า "ของฉัน"'; end if;
  if p_token is null then raise exception 'ไม่พบรหัสเครื่อง กรุณารีเฟรชหน้า'; end if;
  if char_length(nm) not between 1 and 30 then raise exception 'กรุณาใส่ชื่อเล่น (ไม่เกิน 30 ตัวอักษร)'; end if;
  if char_length(b) = 0 then raise exception 'กรุณาพิมพ์ข้อความ'; end if;
  if char_length(b) > 15 then raise exception 'กรุณาเข้าสู่ระบบเพื่อแชทต่อ (ยังไม่ได้ล็อกอิน พิมพ์ได้ข้อความละไม่เกิน 15 ตัวอักษร)'; end if;
  if p_target is not null and not exists (select 1 from public.units u where u.id = p_target) then raise exception 'ไม่พบหน่วยบริการ'; end if;
  perform public.purge_guest_chats();
  k := public.guest_key_of(p_token);
  begin
    ip := nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '');
  exception when others then ip := null;
  end;
  ip := case when ip is null then null else md5(ip) end;
  select count(*) into n from public.messages x join public.conversations c on c.id = x.conversation_id
   where c.guest_key = k and x.sender_role = 'citizen' and x.created_at > now() - interval '1 day';
  if n >= 20 then raise exception 'กรุณาเข้าสู่ระบบเพื่อแชทต่อ (ยังไม่ได้ล็อกอิน ส่งได้วันละ 20 ข้อความ)'; end if;
  if ip is not null then
    select count(*) into n from public.messages x join public.conversations c on c.id = x.conversation_id
     where c.guest_ip = ip and x.sender_role = 'citizen' and x.created_at > now() - interval '1 day';
    if n >= 60 then raise exception 'กรุณาเข้าสู่ระบบเพื่อแชทต่อ (มีการส่งข้อความจากเครือข่ายนี้มากเกินไป)'; end if;
  end if;
  select c.id into cid from public.conversations c where c.guest_key = k and c.target_unit is not distinct from p_target;
  if cid is null then
    insert into public.conversations (citizen_id, target_unit, guest_key, guest_name, guest_ip)
    values (null, p_target, k, nm, ip) returning id into cid;
  else
    update public.conversations set guest_name = nm, guest_ip = coalesce(ip, guest_ip) where id = cid;
  end if;
  perform set_config('pcps.guest_send', 'on', true);
  insert into public.messages (conversation_id, body) values (cid, b) returning * into m;
  perform set_config('pcps.guest_send', '', true);
  return public.guest_message_json(m);
end $$;

/** อ่านห้องของเครื่องนี้ (ล้างตัวเลขยังไม่อ่านฝั่งผู้ถาม) → [ข้อความ เก่า → ใหม่] */
create or replace function public.guest_chat_fetch(p_token uuid, p_target smallint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare cid uuid;
begin
  if p_token is null then return '[]'::jsonb; end if;
  perform public.purge_guest_chats();
  select c.id into cid from public.conversations c
   where c.guest_key = public.guest_key_of(p_token) and c.target_unit is not distinct from p_target;
  if cid is null then return '[]'::jsonb; end if;
  update public.conversations set unread_citizen = 0 where id = cid and unread_citizen > 0;
  return coalesce((select jsonb_agg(public.guest_message_json(m) order by m.created_at, m.id)
                     from (select * from public.messages x where x.conversation_id = cid order by x.created_at desc, x.id desc limit 300) m), '[]'::jsonb);
end $$;

/** ห้องทั้งหมดของเครื่องนี้ + ตัวเลขข้อความใหม่ → [{target_unit, unread}] */
create or replace function public.guest_chat_list(p_token uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('target_unit', c.target_unit, 'unread', c.unread_citizen, 'last_message_at', c.last_message_at)), '[]'::jsonb)
    from public.conversations c
   where p_token is not null and c.guest_key = public.guest_key_of(p_token)
     and coalesce(c.last_message_at, c.created_at) >= now() - interval '7 days'
$$;

revoke execute on function public.purge_guest_chats(), public.guest_key_of(uuid), public.guest_message_json(public.messages),
  public.guest_chat_send(uuid, smallint, text, text), public.guest_chat_fetch(uuid, smallint), public.guest_chat_list(uuid) from public;
grant execute on function public.purge_guest_chats(), public.guest_chat_send(uuid, smallint, text, text),
  public.guest_chat_fetch(uuid, smallint), public.guest_chat_list(uuid) to anon, authenticated;

select 'ok' as step_29_guest_chat;
