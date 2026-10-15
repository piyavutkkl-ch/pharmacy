// ผู้ดูแล › ตั้งค่า › ฐานข้อมูลยา (#/admin/settings/drugs)
//   รายการยา รพ.สต. อ.ควนกาหลง (local_drugs · 58_local_drugs.sql): เพิ่ม/แก้/ซ่อน/ลบ + ผูกกับข้อมูลยาในบัญชียาหลัก (mono_refs → drug_monographs.ref)
//   บัญชียาหลักแห่งชาติ (drug_monographs · 57_drug_monographs.sql): ค้นหา เพิ่ม แก้ ลบ · หัวข้อในยาแก้เป็นข้อความ "## หัวข้อ" + บรรทัดเนื้อหา
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { resetDrugInfo } from './dose.js?v=4.4';

let locals = [], monos = [], bound = false, editLocal = null, editMono = null, links = [], dmShown = 30;

export async function initDrugsAdmin() {
  if (!bound) bind();
  $('#ldList').innerHTML = $('#dmList').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%;margin-top:10px"></div>';
  await Promise.all([loadLocals(), loadMonos()]);
  if (!editLocal) resetLocal();
}

async function loadLocals() {
  const { data, error } = await sb.from('local_drugs').select('*').order('sort').order('id');
  if (error) { toast(errText(error), 'err'); $('#ldList').innerHTML = '<p class="empty">โหลดรายการยาไม่สำเร็จ</p>'; return; }
  locals = data;
  $('#ldCats').innerHTML = [...new Set(locals.map((l) => l.category))].map((c) => `<option value="${esc(c)}">`).join('');
  renderLocals();
}
async function loadMonos() {
  const all = [];
  for (let from = 0; ; from += 1000) {   // ครั้งละ ≤ 1000 แถว
    const { data, error } = await sb.from('drug_monographs').select('*').order('sort').order('id').range(from, from + 999);
    if (error) { toast(errText(error), 'err'); $('#dmList').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ</p>'; return; }
    all.push(...data);
    if (data.length < 1000) break;
  }
  monos = all;
  $('#dmGroups').innerHTML = [...new Set(monos.map((m) => m.group_name))].map((g) => `<option value="${esc(g)}">`).join('');
  renderMonos(); renderLocals(); renderLinks();
}
const byRef = (r) => monos.find((m) => m.ref === r);
const changed = () => resetDrugInfo();   // หน้าข้อมูลยาโหลดใหม่ครั้งถัดไป

function bind() {
  bound = true;
  $('#ldForm').addEventListener('submit', saveLocal);
  $('#ldCancel').addEventListener('click', resetLocal);
  ['#ldQ', '#ldFilter'].forEach((s) => $(s).addEventListener(s === '#ldQ' ? 'input' : 'change', renderLocals));
  $('#ldList').addEventListener('click', onLocalList);
  $('#ldLinkQ').addEventListener('input', renderPick);
  $('#ldLinkOut').addEventListener('click', (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    const name = b.dataset.link;
    links = [...new Set([...links, ...monos.filter((m) => m.name === name).map((m) => m.ref)])];
    $('#ldLinkQ').value = ''; renderPick(); renderLinks();
  });
  $('#ldLinks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unlink]'); if (!b) return;
    links = links.filter((r) => byRef(r)?.name !== b.dataset.unlink && r !== b.dataset.unlink); renderLinks();
  });
  $('#dmNew').addEventListener('click', () => openMonoForm(null));
  $('#dmCancel').addEventListener('click', () => { $('#dmForm').hidden = true; editMono = null; });
  $('#dmForm').addEventListener('submit', saveMono);
  $('#dmQ').addEventListener('input', () => { dmShown = 30; renderMonos(); });
  $('#dmMore').addEventListener('click', () => { dmShown += 50; renderMonos(); });
  $('#dmList').addEventListener('click', onMonoList);
}

/* ======================= รายการยา รพ.สต. ======================= */
function linkNames(refs) { return [...new Set((refs || []).map((r) => byRef(r)?.name || r))]; }
function renderLocals() {
  const q = $('#ldQ').value.trim().toLowerCase(), f = $('#ldFilter').value;
  const list = locals.filter((l) => (!q || [l.name, l.code, l.category, ...linkNames(l.mono_refs)].join(' ').toLowerCase().includes(q))
    && (f === 'all' || (f === 'unlinked' ? !(l.mono_refs || []).length : !l.active)));
  $('#ldCount').textContent = `(${locals.length})`;
  $('#ldList').innerHTML = !locals.length ? '<p class="empty">ยังไม่มีรายการยา</p>' : !list.length ? '<p class="empty">ไม่พบยาที่ค้นหา</p>'
    : list.map((l) => `<div class="li"><div class="l"><b>${esc(l.name)}</b>`
      + `<span class="small muted">${[l.code && `รหัส ${esc(l.code)}`, esc(l.category), (l.pack_size || l.unit) && `บรรจุ ${esc([l.pack_size, l.unit].filter(Boolean).join(' '))}`].filter(Boolean).join(' · ')}</span>`
      + `<span class="small">${(l.mono_refs || []).length ? `ข้อมูลยา: ${esc(linkNames(l.mono_refs).join(', '))}` : '<span class="chip c-fix">ยังไม่ผูกข้อมูลยา</span>'}</span>`
      + `${l.active ? '' : '<div class="meta"><span class="chip c-off">ซ่อน</span></div>'}</div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-ld-edit="${l.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-ld-del="${l.id}">ลบ</button></div></div>`).join('');
}
function renderLinks() {
  const names = linkNames(links);
  $('#ldLinks').innerHTML = names.length ? names.map((n) => `<span class="chip c-role">${esc(n)}<button type="button" class="nt-x" data-unlink="${esc(n)}" aria-label="เลิกผูก ${esc(n)}">×</button></span>`).join('')
    : '<span class="small muted">ยังไม่ได้ผูก</span>';
}
function renderPick() {
  const q = $('#ldLinkQ').value.trim().toLowerCase();
  if (q.length < 2) { $('#ldLinkOut').innerHTML = ''; return; }
  const names = [...new Map(monos.filter((m) => m.name.toLowerCase().includes(q)).map((m) => [m.name, m])).values()].slice(0, 12);
  $('#ldLinkOut').innerHTML = names.length ? names.map((m) => `<button type="button" class="btn btn-o btn-sm btn-wrap" data-link="${esc(m.name)}">+ ${esc(m.name)} <span class="small muted">${esc(m.sub_code)} ${esc(m.sub_name)}</span></button>`).join('')
    : '<span class="small muted">ไม่พบในบัญชียาหลัก · เพิ่มข้อมูลยาใหม่ได้ในกล่องด้านล่าง</span>';
}
function resetLocal() {
  editLocal = null; links = [];
  ['#ldName', '#ldCode', '#ldCat', '#ldPack', '#ldUnit', '#ldNote', '#ldLinkQ'].forEach((s) => { $(s).value = ''; });
  $('#ldSort').value = locals.length ? Math.max(...locals.map((l) => l.sort)) + 1 : 1; $('#ldActive').checked = true;
  $('#ldSubmit').textContent = 'เพิ่มยา'; $('#ldCancel').hidden = true; $('#ldMsg').textContent = '';
  renderLinks(); renderPick();
}
function editLocalForm(l) {
  editLocal = l; links = [...(l.mono_refs || [])];
  $('#ldName').value = l.name; $('#ldCode').value = l.code || ''; $('#ldCat').value = l.category; $('#ldPack').value = l.pack_size || '';
  $('#ldUnit').value = l.unit || ''; $('#ldNote').value = l.note || ''; $('#ldSort').value = l.sort; $('#ldActive').checked = l.active;
  $('#ldSubmit').textContent = 'บันทึกการแก้ไข'; $('#ldCancel').hidden = false; $('#ldMsg').textContent = '';
  renderLinks();
  $('#ldForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('#ldName').focus();
}
async function saveLocal(e) {
  e.preventDefault();
  const name = $('#ldName').value.trim(), category = $('#ldCat').value.trim();
  if (!name) { $('#ldName').focus(); $('#ldMsg').textContent = 'กรุณากรอกชื่อยา'; return; }
  if (!category) { $('#ldCat').focus(); $('#ldMsg').textContent = 'กรุณาระบุหมวดยา'; return; }
  const code = $('#ldCode').value.trim() || null;
  if (code && locals.some((l) => l.code === code && l.id !== editLocal?.id)) { $('#ldCode').focus(); $('#ldMsg').textContent = 'รหัสยานี้มีในรายการแล้ว'; return; }
  const row = { name, code, category, pack_size: $('#ldPack').value.trim(), unit: $('#ldUnit').value.trim(), note: $('#ldNote').value.trim() || null,
    mono_refs: links, sort: +$('#ldSort').value || 0, active: $('#ldActive').checked, updated_at: new Date().toISOString() };
  const btn = $('#ldSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = editLocal ? await sb.from('local_drugs').update(row).eq('id', editLocal.id) : await sb.from('local_drugs').insert(row);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast(editLocal ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มยาแล้ว'); changed();
  await loadLocals(); resetLocal();
}
async function onLocalList(e) {
  const ed = e.target.closest('[data-ld-edit]'), del = e.target.closest('[data-ld-del]');
  if (ed) { const l = locals.find((x) => x.id === +ed.dataset.ldEdit); if (l) editLocalForm(l); return; }
  if (!del) return;
  const l = locals.find((x) => x.id === +del.dataset.ldDel);
  if (!l || !confirm(`ลบ "${l.name}" ออกจากรายการยา รพ.สต.?\n(ข้อมูลยาในบัญชียาหลักไม่ถูกลบ)`)) return;
  const { error } = await sb.from('local_drugs').delete().eq('id', l.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบยาแล้ว'); changed();
  if (editLocal?.id === l.id) resetLocal();
  loadLocals();
}

/* ======================= บัญชียาหลักแห่งชาติ ======================= */
function renderMonos() {
  const q = $('#dmQ').value.trim().toLowerCase();
  const list = monos.filter((m) => !q || [m.name, m.group_name, m.sub_name, m.sub_code].join(' ').toLowerCase().includes(q));
  $('#dmCount').textContent = `(${monos.length})`;
  $('#dmList').innerHTML = !monos.length ? '<p class="empty">ยังไม่มีข้อมูลยา</p>' : !list.length ? '<p class="empty">ไม่พบข้อมูลยาที่ค้นหา</p>'
    : list.slice(0, dmShown).map((m) => `<div class="li"><div class="l"><b>${esc(m.name)}</b>`
      + `<span class="small muted">กลุ่มยา ${m.group_no} ${esc(m.group_name)} › ${esc(m.sub_code)} ${esc(m.sub_name)}</span>`
      + `<span class="small muted">${(m.forms || []).map((f) => esc([f.form, f.acct].filter(Boolean).join(' · '))).join(' / ')}${(m.sections || []).length ? ` · ${(m.sections || []).map((x) => esc(x.title)).join(', ')}` : ''}</span></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-dm-edit="${m.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-dm-del="${m.id}">ลบ</button></div></div>`).join('');
  $('#dmMore').hidden = list.length <= dmShown;
  if (list.length > dmShown) $('#dmMore').textContent = `แสดงเพิ่ม (เหลืออีก ${list.length - dmShown} รายการ)`;
}
/** หัวข้อในยา ⇄ ข้อความ "## หัวข้อ\nบรรทัด…" */
const sectionsText = (secs) => (secs || []).map((x) => `## ${x.title}\n${(x.body || []).join('\n')}`).join('\n');
function parseSections(txt) {
  const out = [];
  for (const raw of String(txt).split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const h = line.match(/^##\s*(.+)$/);
    if (h) out.push({ title: h[1].trim().slice(0, 100), body: [] });
    else { if (!out.length) out.push({ title: 'รายละเอียด', body: [] }); out[out.length - 1].body.push(line); }
  }
  return out.filter((x) => x.body.length || x.title);
}
const formsText = (forms) => (forms || []).map((f) => [f.form, f.acct].filter(Boolean).join(' | ')).join('\n');
const parseForms = (txt) => String(txt).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [form, acct = ''] = l.split('|').map((x) => x.trim());
  return { form, acct };
});
function openMonoForm(m) {
  editMono = m;
  $('#dmTitle').textContent = m ? `แก้ไข: ${m.name}` : 'เพิ่มข้อมูลยาใหม่';
  $('#dmName').value = m?.name || ''; $('#dmGroupNo').value = m?.group_no ?? ''; $('#dmGroup').value = m?.group_name || '';
  $('#dmSubCode').value = m?.sub_code || ''; $('#dmSub').value = m?.sub_name || '';
  $('#dmForms').value = formsText(m?.forms); $('#dmFlags').value = (m?.flags || []).join(', '); $('#dmSections').value = sectionsText(m?.sections);
  $('#dmMsg').textContent = ''; $('#dmForm').hidden = false;
  $('#dmForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('#dmName').focus();
}
async function saveMono(e) {
  e.preventDefault();
  const name = $('#dmName').value.trim();
  if (!name) { $('#dmName').focus(); $('#dmMsg').textContent = 'กรุณากรอกชื่อยา'; return; }
  const row = {
    name, group_no: +$('#dmGroupNo').value || 0, group_name: $('#dmGroup').value.trim() || 'อื่น ๆ',
    sub_code: $('#dmSubCode').value.trim() || String(+$('#dmGroupNo').value || 0), sub_name: $('#dmSub').value.trim(),
    forms: parseForms($('#dmForms').value), flags: $('#dmFlags').value.split(',').map((x) => x.trim()).filter(Boolean),
    sections: parseSections($('#dmSections').value), updated_at: new Date().toISOString(),
  };
  const btn = $('#dmSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = editMono ? await sb.from('drug_monographs').update(row).eq('id', editMono.id)
    : await sb.from('drug_monographs').insert({ ...row, no: 0, ref: `custom:${Date.now()}`, sort: (monos.length ? Math.max(...monos.map((m) => m.sort)) : 0) + 1 });
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast(editMono ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มข้อมูลยาแล้ว'); changed();
  $('#dmForm').hidden = true; editMono = null;
  loadMonos();
}
async function onMonoList(e) {
  const ed = e.target.closest('[data-dm-edit]'), del = e.target.closest('[data-dm-del]');
  if (ed) { const m = monos.find((x) => x.id === +ed.dataset.dmEdit); if (m) openMonoForm(m); return; }
  if (!del) return;
  const m = monos.find((x) => x.id === +del.dataset.dmDel); if (!m) return;
  const used = locals.filter((l) => (l.mono_refs || []).includes(m.ref));
  if (!confirm(`ลบข้อมูลยา "${m.name}" (${m.sub_code} ${m.sub_name})?` + (used.length ? `\nยา รพ.สต. ที่ผูกไว้ ${used.length} รายการจะไม่แสดงข้อมูลส่วนนี้` : ''))) return;
  const { error } = await sb.from('drug_monographs').delete().eq('id', m.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบข้อมูลยาแล้ว'); changed();
  loadMonos();
}
