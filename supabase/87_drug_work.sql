-- =====================================================================
--  ขั้นที่ 87: หน้าทำงานยา (ทีละยา · หน้าเดียวจบ) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   ① drug_mims.sections = หัวข้อจากข้อความหน้า MIMS ที่ผู้ดูแลวาง (หน้าเว็บแยกหัวข้อให้อัตโนมัติ) [{title, body}]
--      ตาราง drug_mims เดิม = ผู้ดูแลเท่านั้น (85) · ข้อมูล MIMS เป็นข้อมูลสมาชิก ไม่เก็บลงไฟล์ใน repo
--   ② AI ช่วยแก้ข้อบ่งใช้ที่ทดสอบสูตรไม่ผ่าน: ai_dose_fix_start(ยา, ข้อบ่งใช้, ปัญหา) → ai_dose_fix_poll(id)
--      ส่งให้ Gemini เฉพาะข้อความฉลาก OpenFDA+DailyMed (ข้อมูลสาธารณะ) ของยานั้น · ไม่ส่งข้อความ MIMS (ข้อมูลสมาชิก · กฎใน CLAUDE.md)
--      คำตอบต้องผ่าน dose_inds_problem + ข้อความอ้างอิง (quote) อยู่ในฉลากจริง + ตัวเลข min/max อยู่ใน quote · ไม่ผ่าน = rejected พร้อมเหตุผล
--      ระบบไม่บันทึกเอง: หน้าเว็บแสดงค่าที่ AI เสนอ → ผู้ดูแลกดใช้ → ตรวจ → อนุมัติ (ต้องผ่านทดสอบสูตรเหมือนเดิม)
-- =====================================================================

alter table public.drug_mims add column if not exists sections jsonb not null default '[]';
alter table public.drug_mims drop constraint if exists drug_mims_sections_check;
alter table public.drug_mims add constraint drug_mims_sections_check
  check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) <= 80 and octet_length(sections::text) <= 400000);

create table if not exists public.ai_dose_fixes (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  local_id    int references public.local_drugs(id) on delete cascade,
  ind         jsonb not null,
  issues      jsonb not null default '[]',
  src         text,
  request_id  bigint,
  ai_job      bigint,
  sent_at     timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result      jsonb,
  note        text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
alter table public.ai_dose_fixes enable row level security;
drop policy if exists adf_read on public.ai_dose_fixes;
create policy adf_read on public.ai_dose_fixes for select to authenticated using (public.is_admin());
revoke all on public.ai_dose_fixes from anon, authenticated;
grant select on public.ai_dose_fixes to authenticated;
grant all on public.ai_dose_fixes to service_role;

/** ข้อความฉลาก OpenFDA+DailyMed ของยานี้ (ขนาดยา · ข้อบ่งใช้ · ใช้ในเด็ก/ผู้สูงอายุ) · ไม่มีฉลาก = null */
create or replace function public.ai_dose_fix_src(p_local int)
returns text language sql stable security definer
set search_path = ''
as $$
  select left(string_agg(s->>'title' || E':\n' ||
           case jsonb_typeof(s->'body') when 'array' then (select string_agg(x, E'\n') from jsonb_array_elements_text(s->'body') x) else coalesce(s->>'body', '') end,
           E'\n\n' order by n), 12000)
    from public.local_drugs l
    join public.drug_fda_labels f on f.key = l.fda_key
    cross join lateral jsonb_array_elements(case when jsonb_typeof(f.sections) = 'array' then f.sections else '[]' end) with ordinality t(s, n)
   where l.id = p_local and s->>'title' in ('ขนาดยาและวิธีใช้', 'ข้อบ่งใช้', 'การใช้ในหญิงตั้งครรภ์/ให้นมบุตร เด็ก ผู้สูงอายุ')
$$;
revoke execute on function public.ai_dose_fix_src(int) from public, anon, authenticated;

create or replace function public.ai_dose_fix_start(p_local int, p_ind jsonb, p_issues jsonb)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare l record; src text; k text; model text; prompt text; nreq bigint; new_id bigint; iss jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_ind is null or jsonb_typeof(p_ind) <> 'object' or octet_length(p_ind::text) > 8000 then raise exception 'ข้อมูลข้อบ่งใช้ไม่ถูกต้อง'; end if;
  select coalesce(jsonb_agg(left(x, 300)), '[]') into iss
    from (select x from jsonb_array_elements_text(case when jsonb_typeof(p_issues) = 'array' then p_issues else '[]' end) x limit 12) t;
  if (select count(*) from public.ai_dose_fixes f where f.user_id = auth.uid() and f.created_at > now() - interval '1 day') >= 60 then
    raise exception 'ใช้ AI ช่วยแก้ครบ 60 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  select d.id, d.name, d.strength, d.ingredients into l from public.local_drugs d where d.id = p_local;
  if l.id is null then raise exception 'ไม่พบยานี้'; end if;
  src := public.ai_dose_fix_src(p_local);
  if btrim(coalesce(src, '')) = '' then
    raise exception 'ยาตัวนี้ยังไม่ได้ผูกฉลาก OpenFDA+DailyMed ที่มีข้อความขนาดยา · ผูกฉลากก่อน (AI ใช้เฉพาะข้อมูลสาธารณะ ไม่ส่งข้อความ MIMS)';
  end if;
  k := public.ai_key();   -- ตรวจความพร้อม (pg_net · คีย์ Gemini)
  prompt := 'คุณเป็นเภสัชกรผู้ช่วยตรวจข้อมูลเครื่องคำนวณขนาดยาของ รพ.สต. ในประเทศไทย' || E'\n'
    || 'ข้อบ่งใช้ด้านล่าง (JSON) ทดสอบสูตรไม่ผ่านด้วยปัญหาที่ระบุ ให้ตรวจกับ "ฉลากยา" ด้านล่างเท่านั้น แล้วแก้ให้ถูกต้องและครบ' || E'\n'
    || 'ความหมายของช่อง: name = ข้อบ่งใช้ภาษาไทยสั้น ๆ · per = "dose" (ขนาดต่อครั้ง) หรือ "day" (ขนาดต่อวัน ต้องมี times = จำนวนครั้งที่แบ่งให้ต่อวัน 1–12)'
    || ' · fixed = true เมื่อเป็นขนาดคงที่ไม่คิดตามน้ำหนัก (ไม่มี = ต่อ กก.) · unit = "mg" หรือ "mcg" · min/max = ขนาดต่ำสุด/สูงสุด'
    || ' · cap = ขนาดสูงสุดต่อครั้ง · cap_day = ขนาดสูงสุดต่อวัน (หน่วยเดียวกับ min/max) · age_min/age_max = ช่วงอายุ (ปี)'
    || ' · freq = ความถี่ภาษาไทยสั้น ๆ · renal = การปรับขนาดในโรคไต · note = หมายเหตุ · quote = ข้อความในฉลากตรงตัว (ภาษาอังกฤษ ไม่เกิน 300 ตัวอักษร) ที่เป็นที่มาของตัวเลข' || E'\n'
    || 'กฎ: ใช้เฉพาะตัวเลขที่อยู่ในฉลาก ห้ามเดา ห้ามใช้ความรู้นอกฉลาก · ใช้หน่วยตามฉลาก (ห้ามแปลงหน่วย) · ถ้าฉลากมีข้อมูลไม่พอ ให้ ind เป็น null และบอกเหตุผล' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"ind": {...} หรือ null, "why": "สรุปภาษาไทยสั้น ๆ ว่าแก้อะไร หรือทำไมแก้ไม่ได้"}' || E'\n\n'
    || 'ยา: ' || l.name || coalesce(' · ความแรง ' || l.strength::text, '') || E'\n'
    || 'ข้อบ่งใช้ปัจจุบัน: ' || (p_ind - 'ref')::text || E'\n'
    || 'ปัญหาจากการทดสอบสูตร: ' || iss::text || E'\n\n'
    || 'ฉลากยา (OpenFDA+DailyMed):' || E'\n' || src;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  nreq := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  insert into public.ai_dose_fixes (user_id, local_id, ind, issues, src, request_id, ai_job, sent_at)
  values (auth.uid(), p_local, p_ind, iss, src, nreq, public.ai_job_of(nreq), now())
  returning id into new_id;
  return new_id;
end $$;

/** ตัวเลขจากคำตอบ AI: ตัวเลขบวก หรือ null */
create or replace function public.ai_fix_num(v jsonb)
returns numeric language sql immutable
set search_path = ''
as $$
  select case when jsonb_typeof(v) = 'number' and v::text::numeric >= 0 then v::text::numeric
              when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^\d+(\.\d+)?$' then btrim(v #>> '{}')::numeric end
$$;

create or replace function public.ai_dose_fix_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_dose_fixes; res record; txt text; j jsonb; e jsonb; fx jsonb; q text; why text; nreq bigint; a numeric;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_dose_fixes where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายการนี้'; end if;
  if r.status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          e := j->'ind';
          if jsonb_typeof(e) is distinct from 'object' then
            update public.ai_dose_fixes set status = 'done', done_at = now(),
                   result = jsonb_build_object('none', true, 'why', left(coalesce(nullif(btrim(j->>'why'), ''), 'ฉลากยามีข้อมูลไม่พอให้แก้'), 500))
             where id = r.id returning * into r;
          else
            fx := jsonb_strip_nulls(jsonb_build_object(
              'name', left(coalesce(nullif(btrim(e->>'name'), ''), r.ind->>'name', 'ข้อบ่งใช้'), 200),
              'per', case when e->>'per' = 'day' then 'day' else 'dose' end,
              'fixed', case when e->>'fixed' = 'true' then true end,
              'unit', case when e->>'unit' = 'mcg' then 'mcg' end,
              'min', public.ai_fix_num(e->'min'), 'max', public.ai_fix_num(e->'max'),
              'times', case when e->>'per' = 'day' and public.ai_fix_num(e->'times') in (1,2,3,4,5,6,7,8,9,10,11,12) then public.ai_fix_num(e->'times')::int end,
              'times_alt', case when e->>'per' = 'day' and jsonb_typeof(e->'times_alt') = 'array' then
                 (select nullif(jsonb_agg(x::int), '[]'::jsonb) from (select public.ai_fix_num(y) x from jsonb_array_elements(e->'times_alt') y) t where x in (1,2,3,4,5,6,7,8,9,10,11,12)) end,
              'cap', nullif(public.ai_fix_num(e->'cap'), 0), 'cap_day', nullif(public.ai_fix_num(e->'cap_day'), 0),
              'age_min', case when public.ai_fix_num(e->'age_min') <= 120 then public.ai_fix_num(e->'age_min') end,
              'age_max', case when public.ai_fix_num(e->'age_max') <= 120 then public.ai_fix_num(e->'age_max') end,
              'basis', left(coalesce(nullif(btrim(e->>'basis'), ''), r.ind->>'basis'), 60),
              'freq', left(nullif(btrim(e->>'freq'), ''), 120),
              'renal', left(nullif(btrim(e->>'renal'), ''), 1000),
              'note', left(nullif(btrim(e->>'note'), ''), 500),
              'quote', left(nullif(btrim(e->>'quote'), ''), 400)));
            -- ตรวจคำตอบ: รูปแบบถูก → ข้อความอ้างอิงอยู่ในฉลากจริง → ตัวเลข min/max อยู่ในข้อความอ้างอิง
            why := public.dose_inds_problem(jsonb_build_array(fx));
            if why is null then
              q := public.dose_norm(fx->>'quote');
              if q = '' then why := 'AI ไม่ได้ระบุข้อความอ้างอิงจากฉลาก';
              elsif position(q in public.dose_norm(r.src)) = 0 then why := 'ข้อความที่ AI อ้างไม่พบในฉลากยา';
              else
                foreach a in array array[(fx->>'min')::numeric, (fx->>'max')::numeric] loop
                  if not (a = any(public.dose_nums(q))) then why := 'ตัวเลขขนาดยาไม่ตรงกับข้อความในฉลาก'; end if;
                end loop;
              end if;
            else
              why := regexp_replace(why, '^ข้อบ่งใช้ 1: ', '');
            end if;
            update public.ai_dose_fixes set status = 'done', done_at = now(),
                   result = case when why is null then jsonb_build_object('ind', fx, 'why', left(coalesce(j->>'why', ''), 500))
                                 else jsonb_build_object('rejected', fx, 'why', why, 'ai_why', left(coalesce(j->>'why', ''), 500)) end,
                   note = case when why is not null then 'ค่าที่ AI เสนอตรวจกับฉลากไม่ผ่าน จึงไม่ใช้' end
             where id = r.id returning * into r;
          end if;
        exception when others then
          update public.ai_dose_fixes set status = 'done', done_at = now(), note = 'อ่านคำตอบของ AI ไม่ได้ · กดลองใหม่ หรือแก้เองจากต้นฉบับ'
           where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_dose_fixes set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_dose_fixes set status = 'done', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false))
           where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '3 minutes' then
      update public.ai_dose_fixes set status = 'done', done_at = now(), note = 'หมดเวลารอ AI · กดลองใหม่ หรือแก้เองจากต้นฉบับ' where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result, 'note', r.note);
end $$;

revoke execute on function public.ai_dose_fix_start(int, jsonb, jsonb), public.ai_dose_fix_poll(bigint), public.ai_fix_num(jsonb) from public, anon;
grant execute on function public.ai_dose_fix_start(int, jsonb, jsonb), public.ai_dose_fix_poll(bigint) to authenticated;

select 'ok' as step_87_drug_work;
