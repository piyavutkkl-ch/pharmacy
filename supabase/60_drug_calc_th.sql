-- =====================================================================
--  ขั้นที่ 60: เครื่องคำนวณใช้รายการยา รพ.สต. + ฉลาก openFDA ภาษาไทย (AI แปล) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   local_drugs.strength = ความแรงของยา รพ.สต. รายการนั้น {mg, per: 'tab'|'5ml'|'ml'} (ว่าง = อ่านจากชื่อยา เช่น "500 MG")
--   local_drugs.dose_id  = ผูกกับข้อมูลคำนวณขนาดยา (dose_drugs) เอง (ว่าง = จับคู่ชื่อยาอัตโนมัติ)
--   drug_fda_labels.sections_th = ข้อมูลฉลากที่ AI (Gemini ฟรี) แปล/เรียบเรียงเป็นภาษาไทย [{title, body:[ข้อ]}] · ผู้ดูแลแก้ได้ (th_reviewed = ตรวจแล้ว)
--   ai_fda_th_start/poll: ส่งเฉพาะข้อความฉลากยาสาธารณะของสหรัฐฯ (ไม่มีข้อมูลผู้ป่วย) · AI ไม่ว่าง = ลองรุ่นสำรอง (49_ai_retry.sql)
-- =====================================================================

alter table public.local_drugs add column if not exists strength jsonb check (strength is null or (jsonb_typeof(strength) = 'object' and octet_length(strength::text) <= 300));
alter table public.local_drugs add column if not exists dose_id bigint references public.dose_drugs(id) on delete set null;

alter table public.drug_fda_labels add column if not exists sections_th jsonb check (sections_th is null or (jsonb_typeof(sections_th) = 'array' and octet_length(sections_th::text) <= 60000));
alter table public.drug_fda_labels add column if not exists th_reviewed boolean not null default false;
alter table public.drug_fda_labels add column if not exists th_status text not null default 'none';
alter table public.drug_fda_labels drop constraint if exists drug_fda_labels_th_status_check;
alter table public.drug_fda_labels add constraint drug_fda_labels_th_status_check check (th_status in ('none', 'pending', 'done', 'error'));
alter table public.drug_fda_labels add column if not exists th_note text;
alter table public.drug_fda_labels add column if not exists th_request_id bigint;
alter table public.drug_fda_labels add column if not exists th_job bigint;
alter table public.drug_fda_labels add column if not exists th_sent_at timestamptz;

/** ให้ AI แปล/เรียบเรียงฉลากเป็นภาษาไทย (ส่งเฉพาะข้อความฉลาก) */
create or replace function public.ai_fda_th_start(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.drug_fda_labels; k text; model text; prompt text; req bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.drug_fda_labels where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบฉลากนี้'; end if;
  if r.th_status = 'pending' and r.th_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังแปลอยู่ กรุณารอสักครู่'; end if;
  if (select count(*) from public.drug_fda_labels where th_sent_at > now() - interval '1 day') >= 150 then
    raise exception 'ใช้ AI แปลฉลากครบ 150 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกร แปลและเรียบเรียงข้อมูลจากฉลากยาสหรัฐอเมริกา (ภาษาอังกฤษ) ด้านล่าง เป็นภาษาไทยที่อ่านง่าย สำหรับเภสัชกรและเจ้าหน้าที่ รพ.สต. นำไปใช้ได้จริง' || E'\n'
    || '- แต่ละหัวข้อสรุปเป็นข้อ ๆ สั้น กระชับ ไม่เกิน 8 ข้อ เรียงเรื่องสำคัญก่อน' || E'\n'
    || '- ตัวเลข หน่วย ขนาดยา ความถี่ ช่วงอายุ และน้ำหนัก ต้องตรงกับต้นฉบับทุกตัว (ใช้ มก. มล. กก.)' || E'\n'
    || '- ชื่อยา ชื่อโรค หรือศัพท์เฉพาะ ใส่ภาษาอังกฤษในวงเล็บได้ · ห้ามเพิ่มข้อมูลที่ไม่มีในต้นฉบับ · ส่วนที่ต้นฉบับถูกตัด (…) ไม่ต้องเดา' || E'\n'
    || '- ใช้ชื่อหัวข้อ (title) เดิมตามที่ให้ ห้ามเปลี่ยน' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"sections": [{"title": "<title เดิม>", "points": ["ข้อความภาษาไทย", ...]}]}' || E'\n\n'
    || 'ยา: ' || coalesce(nullif(r.title, ''), r.generic) || ' (' || r.generic || ')' || E'\n' || r.sections::text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0.2)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000);
  update public.drug_fda_labels set th_status = 'pending', th_note = null, th_request_id = req, th_job = public.ai_job_of(req), th_sent_at = now() where id = r.id;
end $$;

create or replace function public.ai_fda_th_poll(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.drug_fda_labels; res record; txt text; j jsonb; out jsonb; nreq bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.drug_fda_labels where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบฉลากนี้'; end if;
  if r.th_status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.th_request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          -- เก็บเฉพาะหัวข้อที่มีในฉลาก (เรียงตามฉลาก) · ข้อละ ≤ 600 ตัวอักษร · ≤ 12 ข้อ/หัวข้อ
          select jsonb_agg(jsonb_build_object('title', s.title, 'body', s.pts) order by s.ord) into out
            from (select o.ord, o.e->>'title' as title,
                         (select jsonb_agg(left(btrim(pt), 600)) from (select pt from jsonb_array_elements_text(a.e->'points') with ordinality q(pt, n)
                            where btrim(pt) <> '' order by n limit 12) z) as pts
                    from jsonb_array_elements(r.sections) with ordinality o(e, ord)
                    join lateral (select x as e from jsonb_array_elements(coalesce(j->'sections', '[]')) x
                                   where x->>'title' = o.e->>'title' and jsonb_typeof(x->'points') = 'array' limit 1) a on true) s
           where s.pts is not null;
          if out is null then raise exception 'empty'; end if;
          update public.drug_fda_labels set th_status = 'done', sections_th = out, th_reviewed = false, th_note = null where id = r.id returning * into r;
        exception when others then
          update public.drug_fda_labels set th_status = 'error', th_note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่' where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.th_job, res.status_code) end;
        if nreq is not null then
          update public.drug_fda_labels set th_request_id = nreq, th_sent_at = now() where id = r.id returning * into r;
        else
          update public.drug_fda_labels set th_status = 'error', th_note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id returning * into r;
        end if;
      end if;
    elsif r.th_sent_at < now() - interval '3 minutes' then
      update public.drug_fda_labels set th_status = 'error', th_note = 'หมดเวลารอ AI กรุณาลองใหม่' where id = r.id returning * into r;
    end if;
    if r.th_status <> 'pending' and r.th_job is not null then update public.ai_jobs set body = null where id = r.th_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'th_status', r.th_status, 'th_note', r.th_note, 'sections_th', r.sections_th);
end $$;

revoke execute on function public.ai_fda_th_start(int), public.ai_fda_th_poll(int) from public, anon;
grant execute on function public.ai_fda_th_start(int), public.ai_fda_th_poll(int) to authenticated;

select 'ok' as step_60_drug_calc_th;
