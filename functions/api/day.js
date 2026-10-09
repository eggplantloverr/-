import { readJson, ok, bad } from './_util.js';

export async function onRequestPut({ request, env }) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad();
  const body = await readJson(request);
  if (!body || typeof body.taken !== 'object' || body.taken === null || !Array.isArray(body.extras)) return bad();
  body.date = date;
  await env.DB.prepare(
    'INSERT INTO days (date, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  )
    .bind(date, JSON.stringify(body), Date.now())
    .run();
  return ok();
}
