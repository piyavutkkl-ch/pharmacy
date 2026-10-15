-- =====================================================================
--  ขั้นที่ 63: AI แปลภาษาไทยอัตโนมัติ (ฉลาก openFDA + คู่ drug interaction) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ai_th_auto(): GitHub Actions ai-news เรียกทุกชั่วโมงด้วย secret key (tools/ai_news/run.mjs --check)
--     ① ตรวจคำตอบ AI ของรายการที่ส่งไปแล้ว (รวมที่ผู้ดูแลกดแล้วปิดหน้าไปก่อนเสร็จ)
--     ② ส่งรายการที่ยังไม่มีภาษาไทยต่อ ≤ วันละ ai_th_daily (site_texts · ค่าเริ่ม 5) ต่อชนิด · รอบละ ≤ 2 (ไม่ชนโควตาต่อนาทีของ Gemini ฟรี)
--        ลำดับ: ฉลากที่ผูกกับยา รพ.สต. ก่อน · คู่ยารุนแรงก่อน (Major → Moderate → Minor) · ที่เคยผิดพลาดไว้ท้าย
--     ไม่ทับข้อความไทยที่มีอยู่ (เลือกเฉพาะที่ยังว่าง) · ส่งเฉพาะข้อความสาธารณะ (ฉลากยาสหรัฐฯ/DDInter) ไม่มีข้อมูลผู้ป่วย
--   ปุ่มของผู้ดูแล (ai_fda_th_start/poll, ai_ddi_th_start/poll) ทำงานเหมือนเดิม: ตรวจสิทธิ์แล้วเรียกตัวทำงานภายในชุดเดียวกัน
-- =====================================================================

alter table public.drug_fda_labels add column if not exists th_auto_at timestamptz;
alter table public.ddi_pairs add column if not exists th_auto_at timestamptz;

/* ---------- ตัวทำงานภายใน (ไม่ตรวจสิทธิ์ · หน้าเว็บเรียกตรงไม่ได้) ---------- */
create or replace function public.ai_fda_th_send(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.drug_fda_labels; k text; model text; prompt text; req bigint;
begin
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

create or replace function public.ai_fda_th_check(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.drug_fda_labels; res record; txt text; j jsonb; out jsonb; nreq bigint;
begin
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

create or replace function public.ai_ddi_th_send(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.ddi_pairs; na text; nb text; k text; model text; prompt text; req bigint;
begin
  select * into r from public.ddi_pairs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคู่ยานี้'; end if;
  if r.th_status = 'pending' and r.th_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังแปลอยู่ กรุณารอสักครู่'; end if;
  if (select count(*) from public.ddi_pairs where th_sent_at > now() - interval '1 day') >= 300 then
    raise exception 'ใช้ AI แปล drug interaction ครบ 300 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  select name into na from public.ddi_drugs where id = r.a;
  select name into nb from public.ddi_drugs where id = r.b;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกร แปลและเรียบเรียงข้อมูล drug interaction ด้านล่างเป็นภาษาไทยที่อ่านง่าย กระชับ สำหรับเภสัชกรและเจ้าหน้าที่ รพ.สต. นำไปใช้ได้จริง' || E'
'
    || '- คงชื่อยา ชื่อเอนไซม์ (เช่น CYP3A4) ตัวเลข และหน่วยให้ตรงต้นฉบับ · ห้ามเพิ่มข้อมูลที่ไม่มีในต้นฉบับ' || E'
'
    || '- description = กลไกและผลที่เกิด 2–4 ประโยค · management = สิ่งที่ควรทำ เขียนเป็นข้อ ๆ ขึ้นบรรทัดใหม่ด้วย "• "' || E'
'
    || 'ตอบเป็น JSON เท่านั้น: {"description": "...", "management": "..."}' || E'

'
    || 'คู่ยา: ' || na || ' + ' || nb || E'
Interaction: ' || r.description || E'
Management: ' || r.management;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0.2)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  update public.ddi_pairs set th_status = 'pending', th_note = null, th_request_id = req, th_job = public.ai_job_of(req), th_sent_at = now() where id = r.id;
end $$;

create or replace function public.ai_ddi_th_check(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ddi_pairs; res record; txt text; j jsonb; nreq bigint;
begin
  select * into r from public.ddi_pairs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคู่ยานี้'; end if;
  if r.th_status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.th_request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          if coalesce(btrim(j->>'description'), '') = '' then raise exception 'empty'; end if;
          update public.ddi_pairs set th_status = 'done', th_reviewed = false, th_note = null,
                 description_th = left(btrim(j->>'description'), 6000), management_th = nullif(left(btrim(coalesce(j->>'management', '')), 6000), '')
           where id = r.id returning * into r;
        exception when others then
          update public.ddi_pairs set th_status = 'error', th_note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่' where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.th_job, res.status_code) end;
        if nreq is not null then
          update public.ddi_pairs set th_request_id = nreq, th_sent_at = now() where id = r.id returning * into r;
        else
          update public.ddi_pairs set th_status = 'error', th_note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id returning * into r;
        end if;
      end if;
    elsif r.th_sent_at < now() - interval '3 minutes' then
      update public.ddi_pairs set th_status = 'error', th_note = 'หมดเวลารอ AI กรุณาลองใหม่' where id = r.id returning * into r;
    end if;
    if r.th_status <> 'pending' and r.th_job is not null then update public.ai_jobs set body = null where id = r.th_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'th_status', r.th_status, 'th_note', r.th_note, 'description_th', r.description_th, 'management_th', r.management_th);
end $$;

revoke execute on function public.ai_fda_th_send(int), public.ai_fda_th_check(int), public.ai_ddi_th_send(int), public.ai_ddi_th_check(int) from public, anon, authenticated;

/* ---------- ปุ่มของผู้ดูแล: ตรวจสิทธิ์ → ตัวทำงานภายใน ---------- */
create or replace function public.ai_fda_th_start(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform public.ai_fda_th_send(p_id);
end $$;

create or replace function public.ai_fda_th_poll(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  return public.ai_fda_th_check(p_id);
end $$;

create or replace function public.ai_ddi_th_start(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform public.ai_ddi_th_send(p_id);
end $$;

create or replace function public.ai_ddi_th_poll(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  return public.ai_ddi_th_check(p_id);
end $$;

revoke execute on function public.ai_fda_th_start(int), public.ai_fda_th_poll(int), public.ai_ddi_th_start(int), public.ai_ddi_th_poll(int) from public, anon;
grant execute on function public.ai_fda_th_start(int), public.ai_fda_th_poll(int), public.ai_ddi_th_start(int), public.ai_ddi_th_poll(int) to authenticated;

/* ---------- แปลอัตโนมัติ (เรียกทุกชั่วโมง · secret key เท่านั้น) ---------- */
create or replace function public.ai_th_auto()
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  daily int := 5;
  day0 timestamptz := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  i int; n int; note text; fp int := 0; fs int := 0; dp int := 0; ds int := 0;
begin
  begin daily := least(greatest(coalesce(nullif(btrim((select t.body from public.site_texts t where t.key = 'ai_th_daily')), '')::int, 5), 0), 50);
  exception when others then daily := 5; end;

  -- ① ตรวจคำตอบที่ค้างอยู่
  for i in select id from public.drug_fda_labels where th_status = 'pending' order by id loop
    perform public.ai_fda_th_check(i); fp := fp + 1;
  end loop;
  for i in select id from public.ddi_pairs where th_status = 'pending' order by id loop
    perform public.ai_ddi_th_check(i); dp := dp + 1;
  end loop;

  -- ② ส่งรายการใหม่ (ฉลาก)
  n := least(2, daily - (select count(*) from public.drug_fda_labels where th_auto_at >= day0)::int);
  for i in select f.id from public.drug_fda_labels f
            where f.sections_th is null and f.th_status <> 'pending' and jsonb_array_length(f.sections) > 0
              and (f.th_auto_at is null or f.th_auto_at < now() - interval '20 hours')
            order by (f.th_status = 'error'),
                     not exists (select 1 from public.local_drugs l where l.fda_key = f.key and l.active), f.id
            limit greatest(n, 0) loop
    begin
      perform public.ai_fda_th_send(i);
      update public.drug_fda_labels set th_auto_at = now() where id = i;
      fs := fs + 1;
    exception when others then note := sqlerrm; exit;
    end;
  end loop;

  -- ② ส่งรายการใหม่ (คู่ยา)
  if note is null then
    n := least(2, daily - (select count(*) from public.ddi_pairs where th_auto_at >= day0)::int);
    for i in select p.id from public.ddi_pairs p
              where p.description_th is null and p.th_status <> 'pending' and p.description <> ''
                and (p.th_auto_at is null or p.th_auto_at < now() - interval '20 hours')
              order by (p.th_status = 'error'), array_position(array['Major', 'Moderate', 'Minor', 'Unknown'], p.level), p.id
              limit greatest(n, 0) loop
      begin
        perform public.ai_ddi_th_send(i);
        update public.ddi_pairs set th_auto_at = now() where id = i;
        ds := ds + 1;
      exception when others then note := sqlerrm; exit;
      end;
    end loop;
  end if;

  return jsonb_build_object('daily', daily, 'note', note,
    'fda', jsonb_build_object('checked', fp, 'sent', fs, 'today', (select count(*) from public.drug_fda_labels where th_auto_at >= day0),
                              'left', (select count(*) from public.drug_fda_labels where sections_th is null and jsonb_array_length(sections) > 0)),
    'ddi', jsonb_build_object('checked', dp, 'sent', ds, 'today', (select count(*) from public.ddi_pairs where th_auto_at >= day0),
                              'left', (select count(*) from public.ddi_pairs where description_th is null and description <> '')));
end $$;
revoke execute on function public.ai_th_auto() from public, anon, authenticated;
grant execute on function public.ai_th_auto() to service_role;

select 'ok' as step_63_ai_th_auto;
