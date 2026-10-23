-- =====================================================================
--  ขั้นที่ 92: ธง AI ตรวจย้อนหลัง 4 ประเภท + เภสัชกรตัดสิน (ผลตรวจระบบ 23 ต.ค. 2569 · F-01 / P0-1) · รันซ้ำได้ · ไม่เพิ่มตาราง/คอลัมน์ (แก้ฟังก์ชันเท่านั้น)
--   AI แยกระดับ: wrong = ฉลากมีข้อบ่งใช้/กลุ่มอายุนี้แต่ตัวเลขขัด (หยุดแสดงเองตามเดิม · แบบ ข) · offlabel = ฉลากไม่มีข้อบ่งใช้นี้ (ไม่ซ่อน) · doubt = สงสัย (ไม่ซ่อน)
--   เภสัชกรตัดสินแต่ละธง (dose_audit_decide): conflict = ขัดจริง (ซ่อนจนแก้) · offlabel_ok = นอกฉลาก–มีแนวทางรองรับ · local = แนวปฏิบัติท้องถิ่น · no_conflict = ไม่ขัด
--     การตัดสินเก็บในธงเดิม (decision · decided_at · sig = ลายนิ้วมือของข้อบ่งใช้ตอนตัดสิน) · ใคร/เมื่อไร = ประวัติแก้ไข drug_data_history (79 · ผู้ดูแลอ่านเท่านั้น)
--     ไม่เก็บชื่อ/เหตุผลพิมพ์เองในธง เพราะ audit_flags ประชาชนอ่านได้ (หน้าคำนวณใช้ตัดสินการแสดง)
--   ตรวจซ้ำทุก 30 วัน: ข้อที่ตัดสินแล้วและตัวเลขไม่เปลี่ยน = คงการตัดสินเดิม (ไม่ถูกธง/ซ่อนซ้ำ) · แก้ตัวเลขแล้ว = ตรวจใหม่
--   dose_audit_resolve (91) ยังใช้ได้ (หน้าเว็บรุ่นเก่าระหว่าง deploy)
-- =====================================================================

/** ลายนิ้วมือของข้อบ่งใช้ชื่อนี้ (ตัวเลข/ช่วงอายุ/วิธีคิด · ไม่รวมที่มา) — ตัดสินแล้วตัวเลขเปลี่ยน = ไม่ใช้การตัดสินเดิม */
create or replace function public.dose_ind_sig(p_inds jsonb, p_name text)
returns text language sql immutable
set search_path = ''
as $$
  select md5((e - 'ref' - 'checked' - 'quote' - 'note')::text) from jsonb_array_elements(case when jsonb_typeof(p_inds) = 'array' then p_inds else '[]' end) e
   where btrim(e->>'name') = btrim(p_name) limit 1
$$;
revoke execute on function public.dose_ind_sig(jsonb, text) from public, anon, authenticated;

/** ส่งยา 1 ตัวให้ AI ตรวจย้อนหลัง → id ของรายการตรวจ (ไม่มีฉลาก = null) */
create or replace function public.dose_audit_send(p_dose bigint, p_user uuid default null)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare d record; lid int; src text; k text; model text; prompt text; nreq bigint; new_id bigint;
begin
  select x.id, x.name, x.indications into d from public.dose_drugs x where x.id = p_dose;
  if d.id is null then return null; end if;
  lid := public.dose_audit_local(p_dose);
  src := case when lid is not null then public.ai_dose_fix_src(lid) end;
  if btrim(coalesce(src, '')) = '' then return null; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรตรวจทานข้อมูลเครื่องคำนวณขนาดยาที่อนุมัติใช้งานแล้ว ของ รพ.สต. ในประเทศไทย' || E'\n'
    || 'เทียบข้อบ่งใช้แต่ละข้อ (JSON) กับ "ฉลากยา" ด้านล่างเท่านั้น แล้วตัดสินแต่ละข้อ:' || E'\n'
    || '- "wrong" = ฉลากระบุข้อบ่งใช้และกลุ่มอายุเดียวกันนี้ แต่ตัวเลขขัดกันชัดเจน (เช่น ขนาดต่อวันบันทึกเป็นต่อครั้ง ตัวเลขต่างจากฉลาก เพดานผิดช่อง จำนวนครั้งต่อวันผิด ขนาดเด็กเกินผู้ใหญ่) ต้องใส่ quote = ข้อความในฉลากตรงตัว (ภาษาอังกฤษ ≤ 300 ตัวอักษร) ที่แสดงว่าผิด' || E'\n'
    || '- "offlabel" = ฉลากนี้ไม่ได้ระบุข้อบ่งใช้หรือกลุ่มอายุนี้เลย (ใช้นอกฉลากสหรัฐฯ อาจมีแนวทางอื่นรองรับ) · ห้ามใช้ "wrong" กับกรณีนี้' || E'\n'
    || '- "doubt" = สงสัย/ฉลากไม่ได้ระบุชัด/ต้องให้เภสัชกรดู · "ok" = ตรงกับฉลาก' || E'\n'
    || public.ai_dose_rules_text() || E'\n'
    || 'ห้ามเดา ห้ามใช้ความรู้นอกฉลาก · why = เหตุผลภาษาไทยสั้น ๆ บอกค่าที่ควรเป็นตามฉลาก' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"items": [{"name": "ชื่อข้อบ่งใช้ตรงตามที่ให้", "level": "wrong|offlabel|doubt|ok", "why": "...", "quote": "..."}]}' || E'\n\n'
    || 'ยา: ' || d.name || E'\n'
    || 'ข้อบ่งใช้: ' || (select coalesce(jsonb_agg(e - 'ref' - 'checked'), '[]') from jsonb_array_elements(coalesce(d.indications, '[]')) e)::text || E'\n\n'
    || 'ฉลากยา (OpenFDA+DailyMed):' || E'\n' || src;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  nreq := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000);
  insert into public.dose_audits (dose_id, local_id, inds, src, request_id, ai_job, sent_at, by_user)
  values (p_dose, lid, coalesce(d.indications, '[]'), src, nreq, public.ai_job_of(nreq), now(), p_user)
  returning id into new_id;
  return new_id;
end $$;

/** อ่านคำตอบของรายการตรวจ → ติดธงในข้อมูลคำนวณ · คืน 'pending' | 'done' | 'hit' (AI ไม่ว่าง/ติดโควตา) | 'error' */
create or replace function public.dose_audit_process(p_id bigint)
returns text language plpgsql security definer
set search_path = ''
as $$
declare r public.dose_audits; res record; txt text; j jsonb; it jsonb; flags jsonb := '[]'; lvl text; q text; nm text; nreq bigint; out text := 'pending'; sg text; old jsonb;
begin
  select * into r from public.dose_audits where id = p_id for update;
  if r.id is null or r.status <> 'pending' then return coalesce(r.status, 'error'); end if;
  select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.request_id;
  if found then
    if res.status_code = 200 then
      begin
        select string_agg(p->>'text', '') into txt
          from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
        txt := btrim(coalesce(txt, ''));
        j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
        for it in select x from jsonb_array_elements(case when jsonb_typeof(j->'items') = 'array' then j->'items' else '[]' end) x limit 40 loop
          nm := btrim(coalesce(it->>'name', ''));
          lvl := it->>'level';
          if lvl not in ('wrong', 'offlabel', 'doubt') then continue; end if;
          -- ต้องเป็นชื่อข้อบ่งใช้ที่มีจริง (ณ ตอนส่งตรวจ)
          if not exists (select 1 from jsonb_array_elements(r.inds) e where btrim(e->>'name') = nm) then continue; end if;
          q := left(nullif(btrim(it->>'quote'), ''), 300);
          -- "ผิดชัดเจน" ต้องอ้างข้อความที่มีในฉลากจริง ไม่งั้นลดเป็น "สงสัย" (กัน AI กล่าวหาเกินจริง)
          if lvl = 'wrong' and (q is null or position(public.dose_norm(q) in public.dose_norm(r.src)) = 0) then lvl := 'doubt'; end if;
          -- เภสัชกรตัดสินข้อนี้ไว้แล้ว และตัวเลขยังเหมือนตอนตัดสิน = ใช้การตัดสินเดิม (ไม่ธงซ้ำ · ไม่ซ่อนซ้ำ)
          sg := public.dose_ind_sig(r.inds, nm);
          select x into old from public.dose_drugs d, jsonb_array_elements(d.audit_flags) x
           where d.id = r.dose_id and x->>'name' = nm and x ? 'decision' and x->>'sig' = sg limit 1;
          if old is not null then
            if not exists (select 1 from jsonb_array_elements(flags) y where y->>'name' = nm) then flags := flags || jsonb_build_array(old); end if;
            continue;
          end if;
          flags := flags || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', left(nm, 200), 'level', lvl,
                     'why', left(coalesce(nullif(btrim(it->>'why'), ''), 'AI ตรวจย้อนหลังพบข้อสงสัย'), 300), 'quote', q, 'at', now(), 'sig', sg)));
        end loop;
        update public.dose_audits set status = 'done', done_at = now(), result = jsonb_build_object('flags', flags) where id = r.id;
        -- ติดธงเฉพาะเมื่อข้อมูลยังเหมือนตอนส่งตรวจ (ผู้ดูแลแก้/อนุมัติใหม่ระหว่างนั้น = ผลเก่า ไม่ใช้)
        perform set_config('pcps.audit', '1', true);
        update public.dose_drugs set audit_flags = flags where id = r.dose_id and indications = r.inds and active;
        perform set_config('pcps.audit', '', true);
        out := 'done';
      exception when others then
        update public.dose_audits set status = 'error', done_at = now(), note = 'อ่านคำตอบของ AI ไม่ได้' where id = r.id;
        out := 'error';
      end;
    else
      nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
      if nreq is not null then update public.dose_audits set request_id = nreq, sent_at = now() where id = r.id;
      else
        update public.dose_audits set status = 'error', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id;
        out := case when res.status_code in (429, 500, 503) then 'hit' else 'error' end;
      end if;
    end if;
  elsif coalesce(r.sent_at, r.created_at) < now() - interval '5 minutes' then
    update public.dose_audits set status = 'error', done_at = now(), note = 'หมดเวลารอ AI' where id = r.id;
    out := 'error';
  end if;
  if out <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  return out;
end $$;

/** ผู้ดูแล: ตัดสินธง AI ตรวจย้อนหลังของข้อบ่งใช้นี้ · p_decision = conflict | offlabel_ok | local | no_conflict · ว่าง = ยกเลิกการตัดสิน (กลับเป็นรอตัดสิน) */
create or replace function public.dose_audit_decide(p_dose bigint, p_name text, p_decision text)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare f jsonb; d record; dec text := nullif(btrim(coalesce(p_decision, '')), '');
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if dec is not null and dec not in ('conflict', 'offlabel_ok', 'local', 'no_conflict') then raise exception 'การตัดสินไม่ถูกต้อง'; end if;
  select x.id, x.indications, x.audit_flags into d from public.dose_drugs x where x.id = p_dose;
  if d.id is null then raise exception 'ไม่พบข้อมูลขนาดยานี้'; end if;
  if not exists (select 1 from jsonb_array_elements(d.audit_flags) x where x->>'name' = p_name) then raise exception 'ไม่พบธงของข้อบ่งใช้นี้'; end if;
  perform set_config('pcps.audit', '1', true);
  update public.dose_drugs set audit_flags = (
    select coalesce(jsonb_agg(case when x->>'name' = p_name
             then case when dec is null then x - 'decision' - 'decided_at'
                       else x || jsonb_build_object('decision', dec, 'decided_at', now(), 'sig', public.dose_ind_sig(d.indications, p_name)) end
             else x end), '[]')
      from jsonb_array_elements(audit_flags) x)
   where id = p_dose returning audit_flags into f;
  perform set_config('pcps.audit', '', true);
  return f;
end $$;
revoke execute on function public.dose_audit_decide(bigint, text, text) from public, anon;
grant execute on function public.dose_audit_decide(bigint, text, text) to authenticated;
