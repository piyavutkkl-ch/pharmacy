-- =====================================================================
--  ขั้นที่ 53: สรุปจากไฟล์ "ประวัติรายการจัดส่งยา" (Excel) → หน้าบริการจัดส่งยาถึงบ้าน · รันซ้ำได้ · เพิ่มอย่างเดียว
--   หน้าเว็บของผู้ดูแลอ่านไฟล์ในเครื่อง (ไม่อัปโหลดไฟล์) แล้วเก็บเฉพาะตัวเลขสรุป (summary jsonb) — ไม่มีชื่อ/เลขบัตร/HN/เบอร์/ที่อยู่ (PDPA)
--   กันพลาด: summary ที่มีตัวเลขติดกันตั้งแต่ 9 หลัก (เลขบัตร/HN/เบอร์โทร) ถูกปฏิเสธ
--   ปุ่ม AI (ไม่บังคับ): ai_delivery_start/poll ส่งเฉพาะตัวเลขสรุปให้ Gemini เรียบเรียงเป็นข้อความ → ai_text
-- =====================================================================

create table if not exists public.delivery_reports (
  id            bigint generated always as identity primary key,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  period_from   date,
  period_to     date,
  summary       jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 20000),
  ai_text       text check (ai_text is null or char_length(ai_text) <= 4000),
  ai_status     text not null default 'none' check (ai_status in ('none', 'pending', 'done', 'error')),
  ai_note       text,
  ai_request_id bigint,
  ai_job        bigint,
  ai_sent_at    timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists delivery_reports_created_idx on public.delivery_reports (created_at desc);

create or replace function public.guard_delivery_report()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if new.summary::text ~ '[0-9]{9,}' then
    raise exception 'สรุปมีตัวเลขยาวคล้ายเลขบัตร/HN/เบอร์โทร — เก็บได้เฉพาะตัวเลขสรุป';
  end if;
  if current_user in ('anon', 'authenticated') then   -- ช่อง AI เขียนได้เฉพาะฟังก์ชันของระบบ
    if tg_op = 'INSERT' then
      new.ai_text := null; new.ai_status := 'none'; new.ai_note := null; new.ai_request_id := null; new.ai_job := null; new.ai_sent_at := null;
    else
      new.ai_text := old.ai_text; new.ai_status := old.ai_status; new.ai_note := old.ai_note;
      new.ai_request_id := old.ai_request_id; new.ai_job := old.ai_job; new.ai_sent_at := old.ai_sent_at;
    end if;
    new.created_by := coalesce(old.created_by, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists delivery_reports_guard on public.delivery_reports;
create trigger delivery_reports_guard before insert or update on public.delivery_reports
  for each row execute function public.guard_delivery_report();

alter table public.delivery_reports enable row level security;
drop policy if exists drep_read on public.delivery_reports;
drop policy if exists drep_admin on public.delivery_reports;
create policy drep_read on public.delivery_reports for select using (true);   -- ตัวเลขสรุปเท่านั้น
create policy drep_admin on public.delivery_reports for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.delivery_reports from anon, authenticated;
grant select on public.delivery_reports to anon, authenticated;
grant insert, update, delete on public.delivery_reports to authenticated;
grant all on public.delivery_reports to service_role;

/** ให้ AI เรียบเรียงตัวเลขสรุปเป็นข้อความ (ส่งเฉพาะ summary · ไม่มีข้อมูลรายบุคคล) */
create or replace function public.ai_delivery_start(p_id bigint)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.delivery_reports; k text; model text; prompt text; req bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.delivery_reports where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายงานนี้'; end if;
  if r.ai_status = 'pending' and r.ai_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังสรุปอยู่ กรุณารอสักครู่'; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรโรงพยาบาลชุมชน สรุป "ผลการให้บริการจัดส่งยาถึงบ้าน" จากตัวเลขสรุป (JSON) ด้านล่าง เป็นภาษาไทยสำหรับประชาชนและผู้บริหาร' || E'\n'
    || 'เขียน 4–6 ข้อ ขึ้นต้นแต่ละข้อด้วย "• " บรรทัดละข้อ: ภาพรวม (จำนวนครั้งที่ส่งสำเร็จ/ยกเลิก จำนวนผู้ป่วย ช่วงเวลา) · ช่องทางที่ใช้มาก · เดือน/พื้นที่ที่ใช้บริการมาก · กลุ่มสิทธิ · ค่าจัดส่ง/ส่งฟรี · ระยะเวลาส่ง · ข้อสังเกตหรือข้อเสนอแนะสั้น ๆ 1 ข้อ' || E'\n'
    || 'ใช้เฉพาะตัวเลขที่ให้มา ห้ามเดาหรือแต่งตัวเลขเพิ่ม · ไม่ต้องมีหัวข้อหรือคำเกริ่น · ตอบเป็นข้อความธรรมดา' || E'\n\n'
    || 'หัวข้อ: ' || r.title || E'\n' || r.summary::text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('temperature', 0.3)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  update public.delivery_reports set ai_status = 'pending', ai_note = null, ai_request_id = req, ai_job = public.ai_job_of(req), ai_sent_at = now() where id = r.id;
end $$;

create or replace function public.ai_delivery_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.delivery_reports; res record; txt text; nreq bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.delivery_reports where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายงานนี้'; end if;
  if r.ai_status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.ai_request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := left(btrim(regexp_replace(coalesce(txt, ''), '[0-9]{9,}', '', 'g')), 4000);
          if txt = '' then raise exception 'empty'; end if;
          update public.delivery_reports set ai_status = 'done', ai_text = txt, ai_note = null where id = r.id returning * into r;
        exception when others then
          update public.delivery_reports set ai_status = 'error', ai_note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่' where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.delivery_reports set ai_request_id = nreq, ai_sent_at = now() where id = r.id returning * into r;
        else
          update public.delivery_reports set ai_status = 'error', ai_note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id returning * into r;
        end if;
      end if;
    elsif r.ai_sent_at < now() - interval '3 minutes' then
      update public.delivery_reports set ai_status = 'error', ai_note = 'หมดเวลารอ AI กรุณาลองใหม่' where id = r.id returning * into r;
    end if;
    if r.ai_status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'ai_status', r.ai_status, 'ai_text', r.ai_text, 'ai_note', r.ai_note);
end $$;

revoke execute on function public.ai_delivery_start(bigint), public.ai_delivery_poll(bigint) from public, anon;
grant execute on function public.ai_delivery_start(bigint), public.ai_delivery_poll(bigint) to authenticated;

select 'ok' as step_53_delivery_reports;
