-- =====================================================================
--  ขั้นที่ 67: ขนาดยาที่ AI กรอกให้ มีที่มา = ข้อความจากฉลาก (quote) + อ้างอิงพร้อมลิงก์ (ref {label, url}) · รันซ้ำได้ · ไม่ลบข้อมูล
--   ref.url = ฉลากเต็มใน DailyMed (set_id) หรือหน้าค้น DailyMed · หน้าผู้ดูแลแสดงในกล่องข้อบ่งใช้ · หน้าคำนวณแสดง "ที่มา"
-- =====================================================================

/** อ้างอิงฉลากยา openFDA (ผลจาก ai_dose_step result->label) */
create or replace function public.dose_ref(lab jsonb)
returns jsonb language sql immutable
set search_path = ''
as $$
  select case when lab is null or jsonb_typeof(lab) <> 'object' then null else jsonb_build_object(
    'label', left(btrim('ฉลากยาสหรัฐฯ (US FDA) ' || coalesce(lab->>'brand', lab->>'generic', '')
             || coalesce(case when lab->>'effective' ~ '^\d{8}$' then ' ฉบับ ' || (substr(lab->>'effective', 7, 2))::int || '/' || (substr(lab->>'effective', 5, 2))::int || '/' || substr(lab->>'effective', 1, 4) end, '')), 200),
    'url', case when coalesce(lab->>'set_id', '') ~ '^[A-Za-z0-9-]+$' then 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=' || (lab->>'set_id')
                else 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=' || replace(regexp_replace(lower(coalesce(lab->>'generic', lab->>'brand', '')), '[^a-z0-9 ]', '', 'g'), ' ', '+') end) end
$$;

create or replace function public.ai_dose_convert(p_id bigint)
returns text language plpgsql security definer
set search_path = ''
as $$
declare fac numeric; d public.ai_dose_drafts; res jsonb; inds jsonb; concs jsonb; f jsonb; lab jsonb; new_id bigint; outcome text;
begin
  select * into d from public.ai_dose_drafts where id = p_id for update;
  if d.id is null or d.converted or d.status = 'pending' then return null; end if;
  res := coalesce(d.result, '{}');
  if d.status = 'error' then outcome := 'error';
  elsif public.dose_has(d.auto_name) then outcome := 'done';
  elsif res ? 'ai' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', e->'name', 'basis', e->'basis', 'unit', e->'unit', 'per', e->'per', 'min', e->'min', 'max', e->'max',
             'times', case when e->>'per' = 'day' then e->'times' end, 'cap', e->'cap', 'freq', e->'freq', 'renal', e->'renal', 'quote', e->'quote', 'ref', public.dose_ref(res->'label'))) order by n)
      into inds
      from jsonb_array_elements(res->'ai') with ordinality t(e, n)
     where n <= 20 and coalesce(e->>'name', '') <> '' and jsonb_typeof(e->'min') = 'number' and jsonb_typeof(e->'max') = 'number'
       and (e->>'max')::numeric >= (e->>'min')::numeric;
    outcome := case when inds is null then 'none' else 'draft' end;
  elsif res->'label' ? 'dosage' then outcome := 'ai_error';   -- มีฉลาก แต่ AI ไม่ตอบ (ไม่ว่าง/โควตา/หมดเวลา)
  else outcome := 'none';
  end if;

  if outcome = 'draft' then
    select coalesce(jsonb_agg(c order by k), '[]') into concs
      from (select distinct on (c->>'label') c, k from jsonb_array_elements_text(coalesce(res->'rx', '[]')) with ordinality r(nm, k)
              cross join lateral (select public.rx_conc(r.nm) as c) z where c is not null order by c->>'label', k) u;
    f := inds->0; lab := coalesce(res->'label', '{}'); fac := case when f->>'unit' = 'mcg' then 0.001 else 1 end;   -- ช่องเดิม (mg_per_kg_*) เก็บเป็น มก.
    insert into public.dose_drugs (name, form, indications, indication, per, mg_per_kg_min, mg_per_kg_max, dose_freq_per_day, max_mg_per_dose, freq, renal_note,
                                   concs, sort, active, ai_draft, ai_source)
    values (left(d.auto_name, 120),
            case when jsonb_array_length(concs) = 0 then 'อื่น ๆ'
                 when not exists (select 1 from jsonb_array_elements(concs) c where not c ? 'mgPerTab') then 'ยาเม็ด'
                 when not exists (select 1 from jsonb_array_elements(concs) c where c ? 'mgPerTab') then 'ยาน้ำ' else 'อื่น ๆ' end,
            inds, f->>'name', f->>'per', (f->>'min')::numeric * fac, (f->>'max')::numeric * fac, (f->>'times')::smallint, (f->>'cap')::numeric * fac, f->>'freq', f->>'renal',
            concs, coalesce((select max(sort) + 1 from public.dose_drugs), 0), false, true,
            left('AI ร่างจากฉลากยา openFDA' || coalesce(' ' || (lab->>'brand'), '') || coalesce(' ฉบับ ' || (lab->>'effective'), '') || ' + ความแรงจาก RxNorm · ยังไม่ผ่านการตรวจ', 500))
    returning id into new_id;
    update public.local_drugs set dose_id = new_id, dose_ai_status = 'done', dose_ai_note = null, dose_ai_at = now() where id in (select public.dose_group(d.auto_name));
  elsif outcome = 'done' then
    update public.local_drugs set dose_ai_status = 'done', dose_ai_note = null, dose_ai_at = now() where id in (select public.dose_group(d.auto_name));
  else
    update public.local_drugs set dose_ai_status = case when outcome = 'none' then 'none' else 'error' end, dose_ai_at = now(),
           dose_ai_note = left(coalesce(d.note, case when outcome = 'none' then 'ฉลากยาไม่มีขนาดยาแบบ มก./กก.' else 'AI ไม่ว่าง · ระบบจะลองใหม่' end), 300)
     where id in (select public.dose_group(d.auto_name));
  end if;
  update public.ai_dose_drafts set converted = true where id = d.id;
  return outcome;
end $$;

revoke execute on function public.ai_dose_convert(bigint) from public, anon, authenticated;

-- ร่าง/ข้อมูลเดิมที่ระบบร่างให้ (มี quote แต่ยังไม่มี ref): อ้างอิงจากผลค้นฉลากของยานั้น
update public.dose_drugs d
   set indications = x.inds
  from (select dd.id, jsonb_agg(case when e ? 'quote' and not (e ? 'ref') and r.ref is not null then e || jsonb_build_object('ref', r.ref) else e end order by n) as inds
          from public.dose_drugs dd
          cross join lateral jsonb_array_elements(dd.indications) with ordinality t(e, n)
          left join lateral (select public.dose_ref(a.result->'label') as ref from public.ai_dose_drafts a
                              where a.auto_name is not null and left(a.auto_name, 120) = dd.name and a.result ? 'label'
                              order by a.id desc limit 1) r on true
         group by dd.id) x
 where d.id = x.id and d.indications is distinct from x.inds;

select 'ok' as step_67_dose_ref;
