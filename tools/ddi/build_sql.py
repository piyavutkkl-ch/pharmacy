#!/usr/bin/env python3
"""tools/ddi/ddi.json (fetch.py) → supabase/61_ddi.sql · รันซ้ำได้ ไม่ทับที่ผู้ดูแลแก้"""
import json, pathlib, re

root = pathlib.Path(__file__).resolve().parents[2]
d = json.loads((root / 'tools/ddi/ddi.json').read_text(encoding='utf-8'))
drugs = [{'id': x['id'], 'name': x['name'], 'cyp': x['cyp'] or {}} for x in d['drugs']]
pairs = [{'a': p['a'], 'b': p['b'], 'level': p['level'], 'mech': p['mech'], 'description': p.get('desc', ''), 'management': p.get('mgmt', ''), 'iid': p['iid']}
         for p in d['pairs']]
codes = [{'code': c, 'ids': sorted(set(v))} for c, v in sorted(d['codes'].items())]
J = lambda x: '[\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in x) + '\n]'
for blob in (J(drugs), J(pairs), J(codes)):
    assert '$ddi$' not in blob and not re.search(r'drop\s+(table|schema|database|column)|truncate\s|delete\s+from', blob, re.I)

sql = f"""-- =====================================================================
--  ขั้นที่ 61: Drug interaction ของยา รพ.สต. (DDInter) + AI แปลไทย · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ที่มา: DDInter https://ddinter.scbdd.com (ข้อมูล CC BY-NC-SA 4.0 · ใช้แบบไม่แสวงหากำไร · แสดงที่มาทุกครั้ง)
--   ddi_drugs = ยาใน DDInter ที่ตรงกับยา รพ.สต. (ใช้ทั้งระบบ) + ค่าทำนาย CYP (ADMETlab 2.0 ตามที่ DDInter แสดง · ≥ 0.7 = น่าจะใช่)
--   ddi_pairs = คู่ interaction ระหว่างยา รพ.สต. เท่านั้น: ระดับ · กลไก · คำอธิบาย · การจัดการ (+ ภาษาไทยจาก AI · ผู้ดูแลแก้ได้)
--   local_drugs.ddi_ids = ยา รพ.สต. รายการนั้นตรงกับยาใดใน DDInter (ยาผสมมีหลายตัว)
--   ไฟล์นี้สร้างด้วย tools/ddi/build_sql.py (อย่าแก้มือ) · ใส่ข้อมูลแบบ on conflict do nothing
-- =====================================================================

create table if not exists public.ddi_drugs (
  id          text primary key check (id ~ '^DDInter[0-9]+$'),
  name        text not null check (char_length(name) between 1 and 200),
  cyp         jsonb not null default '{{}}' check (jsonb_typeof(cyp) = 'object'),
  updated_at  timestamptz not null default now()
);
create table if not exists public.ddi_pairs (
  id              int generated always as identity primary key,
  a               text not null references public.ddi_drugs(id) on delete cascade,
  b               text not null references public.ddi_drugs(id) on delete cascade,
  level           text not null default 'Unknown' check (level in ('Major', 'Moderate', 'Minor', 'Unknown')),
  mech            text[] not null default '{{}}',
  description     text not null default '' check (char_length(description) <= 6000),
  management      text not null default '' check (char_length(management) <= 6000),
  description_th  text check (description_th is null or char_length(description_th) <= 6000),
  management_th   text check (management_th is null or char_length(management_th) <= 6000),
  th_reviewed     boolean not null default false,
  th_status       text not null default 'none' check (th_status in ('none', 'pending', 'done', 'error')),
  th_note         text,
  th_request_id   bigint,
  th_job          bigint,
  th_sent_at      timestamptz,
  iid             int,                 -- รหัสคู่ใน DDInter (ลิงก์ไปหน้าต้นฉบับ)
  updated_at      timestamptz not null default now(),
  check (a < b),
  unique (a, b)
);
alter table public.local_drugs add column if not exists ddi_ids text[] not null default '{{}}';

alter table public.ddi_drugs enable row level security;
alter table public.ddi_pairs enable row level security;
drop policy if exists ddid_read on public.ddi_drugs;
drop policy if exists ddid_admin on public.ddi_drugs;
drop policy if exists ddip_read on public.ddi_pairs;
drop policy if exists ddip_admin on public.ddi_pairs;
create policy ddid_read on public.ddi_drugs for select using (true);
create policy ddid_admin on public.ddi_drugs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ddip_read on public.ddi_pairs for select using (true);
create policy ddip_admin on public.ddi_pairs for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.ddi_drugs, public.ddi_pairs from anon, authenticated;
grant select on public.ddi_drugs, public.ddi_pairs to anon, authenticated;
grant insert, update, delete on public.ddi_drugs, public.ddi_pairs to authenticated;
grant all on public.ddi_drugs, public.ddi_pairs to service_role;

insert into public.ddi_drugs (id, name, cyp)
select x.id, x.name, x.cyp from jsonb_to_recordset($ddi${J(drugs)}$ddi$::jsonb) as x(id text, name text, cyp jsonb)
on conflict (id) do nothing;

insert into public.ddi_pairs (a, b, level, mech, description, management, iid)
select x.a, x.b, x.level, x.mech, x.description, x.management, x.iid
  from jsonb_to_recordset($ddi${J(pairs)}$ddi$::jsonb) as x(a text, b text, level text, mech text[], description text, management text, iid int)
on conflict (a, b) do nothing;

update public.local_drugs l set ddi_ids = x.ids
  from jsonb_to_recordset($ddi${J(codes)}$ddi$::jsonb) as x(code text, ids text[])
 where l.code = x.code and cardinality(l.ddi_ids) = 0;

/** ให้ AI แปล/เรียบเรียงคำอธิบาย + การจัดการ ของคู่ interaction เป็นภาษาไทย (ส่งเฉพาะข้อความสาธารณะจาก DDInter) */
create or replace function public.ai_ddi_th_start(p_id int)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.ddi_pairs; na text; nb text; k text; model text; prompt text; req bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ddi_pairs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคู่ยานี้'; end if;
  if r.th_status = 'pending' and r.th_sent_at > now() - interval '3 minutes' then raise exception 'AI กำลังแปลอยู่ กรุณารอสักครู่'; end if;
  if (select count(*) from public.ddi_pairs where th_sent_at > now() - interval '1 day') >= 300 then
    raise exception 'ใช้ AI แปล drug interaction ครบ 300 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  select name into na from public.ddi_drugs where id = r.a;
  select name into nb from public.ddi_drugs where id = r.b;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกร แปลและเรียบเรียงข้อมูล drug interaction ด้านล่างเป็นภาษาไทยที่อ่านง่าย กระชับ สำหรับเภสัชกรและเจ้าหน้าที่ รพ.สต. นำไปใช้ได้จริง' || E'\n'
    || '- คงชื่อยา ชื่อเอนไซม์ (เช่น CYP3A4) ตัวเลข และหน่วยให้ตรงต้นฉบับ · ห้ามเพิ่มข้อมูลที่ไม่มีในต้นฉบับ' || E'\n'
    || '- description = กลไกและผลที่เกิด 2–4 ประโยค · management = สิ่งที่ควรทำ เขียนเป็นข้อ ๆ ขึ้นบรรทัดใหม่ด้วย "• "' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {{"description": "...", "management": "..."}}' || E'\n\n'
    || 'คู่ยา: ' || na || ' + ' || nb || E'\nInteraction: ' || r.description || E'\nManagement: ' || r.management;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0.2)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  update public.ddi_pairs set th_status = 'pending', th_note = null, th_request_id = req, th_job = public.ai_job_of(req), th_sent_at = now() where id = r.id;
end $$;

create or replace function public.ai_ddi_th_poll(p_id int)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ddi_pairs; res record; txt text; j jsonb; nreq bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ddi_pairs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคู่ยานี้'; end if;
  if r.th_status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.th_request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{{candidates,0,content,parts}}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{{' in txt) for length(txt) - position('{{' in txt) - position('}}' in reverse(txt)) + 2)::jsonb;
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

revoke execute on function public.ai_ddi_th_start(int), public.ai_ddi_th_poll(int) from public, anon;
grant execute on function public.ai_ddi_th_start(int), public.ai_ddi_th_poll(int) to authenticated;

select 'ok' as step_61_ddi, (select count(*) from public.ddi_drugs) as drugs, (select count(*) from public.ddi_pairs) as pairs;
"""
(root / 'supabase/61_ddi.sql').write_text(sql, encoding='utf-8')
print('drugs', len(drugs), 'pairs', len(pairs), 'codes', len(codes))
