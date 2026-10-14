-- =====================================================================
--  ขั้นที่ 56: ใส่รายชื่อยา → AI ดึงข้อมูลขนาดยาเก็บเป็นฐานข้อมูล (ร่าง) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   dose_drugs.ai_draft = true → ร่างจาก AI (RxNorm + ฉลากยา openFDA + Gemini) ยังไม่ผ่านการตรวจ · ai_source = ที่มา
--   ร่างต้องซ่อนไว้เสมอ (active = false · ประชาชนไม่เห็น) จนผู้ดูแลตรวจแล้วกด "ตรวจแล้ว · แสดง" (ai_draft = false)
--   ai_dose_start: เพิ่มเป็นวันละ 100 ครั้ง (ทำทีละหลายยา) · ที่เหลือเหมือน 50_ai_dose.sql
-- =====================================================================

alter table public.dose_drugs add column if not exists ai_draft boolean not null default false;
alter table public.dose_drugs add column if not exists ai_source text;
alter table public.dose_drugs drop constraint if exists dose_drugs_ai_source_check;
alter table public.dose_drugs add constraint dose_drugs_ai_source_check check (ai_source is null or char_length(ai_source) <= 500);
alter table public.dose_drugs drop constraint if exists dose_drugs_ai_draft_hidden;
alter table public.dose_drugs add constraint dose_drugs_ai_draft_hidden check (not (ai_draft and active));   -- ร่างจาก AI แสดงในเครื่องคำนวณไม่ได้

create or replace function public.ai_dose_start(p_name text)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare q text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')); new_id bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if q !~ '^[a-z][a-z0-9 .,()/+-]{1,79}$' then
    raise exception 'กรุณาพิมพ์ชื่อสามัญภาษาอังกฤษในชื่อยา เช่น พาราเซตามอล (Paracetamol)';
  end if;
  if (select count(*) from public.ai_dose_drafts d where d.user_id = auth.uid() and d.created_at > now() - interval '1 day') >= 100 then
    raise exception 'ใช้ช่วยกรอกครบ 100 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  perform public.ai_key();   -- ตรวจความพร้อม (pg_net · คีย์ Gemini) ก่อนเริ่ม
  insert into public.ai_dose_drafts (user_id, query, rx_req, fda_req)
  values (auth.uid(), q,
          net.http_get('https://rxnav.nlm.nih.gov/REST/drugs.json', params := jsonb_build_object('name', q), timeout_milliseconds := 20000),
          public.ai_dose_fda(q, true))
  returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.ai_dose_start(text) from public, anon;
grant execute on function public.ai_dose_start(text) to authenticated;

select 'ok' as step_56_dose_ai_drafts;
