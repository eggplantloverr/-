// 画面に必要な記録をまとめて返す。ログインは _middleware.js で確認済み。
export async function onRequestGet({ env }) {
  const p = await env.DB.prepare('SELECT data FROM profile WHERE id = 1').first();
  const rows = await env.DB.prepare('SELECT date, data FROM days ORDER BY date').all();
  const days = {};
  for (const r of rows.results || []) {
    try {
      days[r.date] = JSON.parse(r.data);
    } catch {
      /* 壊れた行は飛ばす */
    }
  }
  let profile = null;
  try {
    profile = p ? JSON.parse(p.data) : null;
  } catch {
    profile = null;
  }
  return new Response(JSON.stringify({ profile, days }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
