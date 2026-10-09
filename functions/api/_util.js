const MAX_BYTES = 100 * 1024;
const H = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return null;
  const text = await request.text();
  if (text.length > MAX_BYTES) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const ok = () => new Response('{"ok":true}', { headers: H });
// 記録の中身はエラーに含めない
export const bad = () => new Response('{"error":"bad request"}', { status: 400, headers: H });
