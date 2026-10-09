import { readJson, ok, bad } from './_util.js';

export async function onRequestPut({ request, env }) {
  const body = await readJson(request);
  if (!body || !Array.isArray(body.meds) || !Array.isArray(body.temps) || !Array.isArray(body.steps)) return bad();
  await env.DB.prepare(
    'INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  )
    .bind(JSON.stringify(body), Date.now())
    .run();
  return ok();
}
