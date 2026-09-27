// Supabase client (โหลดจาก CDN — ไม่มีขั้นตอน build)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=4.3';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true },
});

/** URL ของไฟล์ใน bucket สาธารณะ public-images */
export function publicImageUrl(path) {
  if (!path) return '';
  return sb.storage.from('public-images').getPublicUrl(path).data.publicUrl;
}
