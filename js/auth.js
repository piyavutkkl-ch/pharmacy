// สถานะการเข้าสู่ระบบ + โปรไฟล์ (role มาจากตาราง profiles ซึ่งผู้ใช้แก้เองไม่ได้)
import { sb } from './supabase.js?v=4.3';

export const ROLE_LABEL = { citizen: 'ประชาชนทั่วไป', staff: 'เจ้าหน้าที่ รพ.สต.', admin: 'ผู้ดูแลระบบ' };
export const ROLE_HOME = { citizen: '#/me', staff: '#/staff', admin: '#/admin' };

export const auth = { ready: false, session: null, profile: null, error: null };
const listeners = new Set();
export function onAuth(fn) { listeners.add(fn); }
function emit() { listeners.forEach((fn) => fn(auth)); }

async function loadProfile() {
  auth.profile = null; auth.error = null;
  if (!auth.session) return;
  const { data, error } = await sb.from('profiles')
    .select('id,email,full_name,avatar_url,role,unit_id,phone,address,home_unit_id,unit:units!profiles_unit_id_fkey(name)')
    .eq('id', auth.session.user.id).single();
  if (error) auth.error = error; else auth.profile = data;
}

export async function initAuth() {
  const { data } = await sb.auth.getSession();
  auth.session = data.session;
  await loadProfile();
  auth.ready = true;
  emit();
  sb.auth.onAuthStateChange((event, session) => {
    // ห้ามเรียก Supabase ต่อในตัว callback โดยตรง (จะค้าง) — เลื่อนไปทำหลังจากนี้
    setTimeout(async () => {
      const sameUser = (session?.user?.id || null) === (auth.session?.user?.id || null);
      auth.session = session;
      if (sameUser && event !== 'USER_UPDATED') return;
      await loadProfile();
      emit();
    }, 0);
  });
}

export function signIn() {
  sessionStorage.setItem('pcps_after_login', '1');
  return sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
  });
}

export async function signOut() {
  await sb.auth.signOut();
  location.hash = '#/';
}

/** ใช้หลังกลับจากหน้า Google: พาไปหน้าตามสิทธิ์ครั้งเดียว */
export function takePostLoginRedirect() {
  if (!sessionStorage.getItem('pcps_after_login') || !auth.profile) return null;
  sessionStorage.removeItem('pcps_after_login');
  return ROLE_HOME[auth.profile.role] || '#/';
}

export const isAdmin = () => auth.profile?.role === 'admin';
export const isStaff = () => auth.profile?.role === 'staff';
