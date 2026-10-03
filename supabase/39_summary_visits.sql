-- =====================================================================
--  ขั้นที่ 38: เชื่อมโยงรายการเยี่ยมกับสรุปผลงานเยี่ยมบ้าน — รันต่อจาก 38 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   one page summary (สาธารณะ) ↔ บันทึกเยี่ยม (ข้อมูลผู้ป่วย PDPA) — ตารางเชื่อมแยกต่างหาก ประชาชนมองไม่เห็นแม้แต่จำนวน
--   เห็น/เพิ่ม/ลบได้เฉพาะคนที่เห็นบันทึกเยี่ยมนั้นอยู่แล้ว (policy อ้างตาราง visits ซึ่งมี RLS ของมันเอง:
--   เจ้าหน้าที่ รพ.สต. ที่ดูแลผู้ป่วย + ผู้ดูแล · ย้ายผู้ป่วยแล้วสิทธิ์ตามไปเอง) และต้องแก้สรุปนั้นได้
-- =====================================================================

create table if not exists public.summary_visits (
  summary_id  bigint not null references public.visit_summaries(id) on delete cascade,
  visit_id    uuid not null references public.visits(id) on delete cascade,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (summary_id, visit_id)
);
create index if not exists summary_visits_visit_idx on public.summary_visits (visit_id);

alter table public.summary_visits enable row level security;
drop policy if exists svisit_read on public.summary_visits;
drop policy if exists svisit_insert on public.summary_visits;
drop policy if exists svisit_delete on public.summary_visits;
create policy svisit_read on public.summary_visits for select to authenticated
  using (exists (select 1 from public.visits v where v.id = visit_id));
create policy svisit_insert on public.summary_visits for insert to authenticated
  with check (exists (select 1 from public.visits v where v.id = visit_id)
    and exists (select 1 from public.visit_summaries s where s.id = summary_id
                and (public.is_admin() or public.is_staff_of(s.unit_id) or s.author_id = auth.uid())));
create policy svisit_delete on public.summary_visits for delete to authenticated
  using (exists (select 1 from public.visits v where v.id = visit_id)
    and exists (select 1 from public.visit_summaries s where s.id = summary_id
                and (public.is_admin() or public.is_staff_of(s.unit_id) or s.author_id = auth.uid())));
revoke all on public.summary_visits from anon, authenticated;
grant select, insert, delete on public.summary_visits to authenticated;
grant all on public.summary_visits to service_role;

select 'ok' as step_38_summary_visits;
