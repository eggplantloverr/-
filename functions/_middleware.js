// 全ページ・全APIをログイン必須にする関門。弱めない・外さない。
// ログインなしで返してよいのは、ログイン画面・アイコン・manifest・ログインAPIだけ。

const COOKIE = 'kl_session';
const MAX_AGE = 60 * 60 * 24 * 365; // 1年
const LOCK_LIMIT = 10; // 1時間に10回まちがえるとロック
const LOCK_WINDOW_MS = 60 * 60 * 1000;

const PUBLIC_FILES = new Set([
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
]);

const enc = new TextEncoder();

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// 長さが違っても時間でバレないよう、HMACにかけてから比べる
async function safeEqual(secret, a, b) {
  return bytesEqual(await hmac(secret, 'cmp:' + a), await hmac(secret, 'cmp:' + b));
}

async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const sig = toHex(await hmac(env.SESSION_SECRET, 'v1.' + exp));
  return `${exp}.${sig}`;
}

async function verifyToken(env, token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!/^\d+$/.test(exp || '') || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const want = toHex(await hmac(env.SESSION_SECRET, 'v1.' + exp));
  return safeEqual(env.SESSION_SECRET, want, sig);
}

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  r.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'no-referrer');
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

const json = (obj, status = 200, extra = {}) =>
  withHeaders(
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }),
    extra,
  );

async function handleLogin(request, env) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.DB || !env.APP_PASSWORD || !env.SESSION_SECRET) return json({ error: 'server' }, 500);

  const now = Date.now();
  await env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - LOCK_WINDOW_MS).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE at >= ?').bind(now - LOCK_WINDOW_MS).first();
  if ((row?.n || 0) >= LOCK_LIMIT) return json({ error: 'locked' }, 429);

  let password = '';
  try {
    const body = await request.json();
    password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
  } catch {
    /* 空として扱う */
  }

  if (!password || !(await safeEqual(env.SESSION_SECRET, password, env.APP_PASSWORD))) {
    await env.DB.prepare('INSERT INTO login_attempts (at) VALUES (?)').bind(now).run();
    return json({ error: 'wrong' }, 401);
  }

  await env.DB.prepare('DELETE FROM login_attempts').run();
  const token = await makeToken(env);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, token, MAX_AGE) });
}

function loginPage() {
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#7c5cd6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="くすりログ">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>くすりログ</title>
<style>
:root{--bg:#faf8ff;--card:#fff;--text:#2a2340;--sub:#7a7390;--line:#e4def5;--accent:#7c5cd6;--err:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#14111d;--card:#1e1a2b;--text:#f0ecfa;--sub:#a59fbb;--line:#35304a;--accent:#9d83f0;--err:#fb923c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font-family:"Zen Kaku Gothic New",-apple-system,"Hiragino Sans",sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
main{width:100%;max-width:360px;text-align:center}
img{width:84px;height:84px;border-radius:22px}
h1{font-size:24px;margin:16px 0 24px;font-weight:700}
input,button{width:100%;height:50px;border-radius:14px;font-size:17px;font-family:inherit}
input{border:1.5px solid var(--line);background:var(--card);color:var(--text);padding:0 16px;margin-bottom:12px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{border:0;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}
button:disabled{opacity:.6}
p{min-height:1.5em;margin:14px 0 0;color:var(--err);font-size:14px}
</style>
</head>
<body>
<main>
<img src="/icon.svg" alt="">
<h1>くすりログ</h1>
<form id="f">
<input id="pw" type="password" placeholder="パスワード" autocomplete="current-password" aria-label="パスワード" required>
<button id="b" type="submit">ひらく</button>
<p id="m" role="alert"></p>
</form>
</main>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = document.getElementById('b'), m = document.getElementById('m');
  b.disabled = true; m.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('pw').value }) });
    if (r.ok) { location.replace('/'); return; }
    m.textContent = r.status === 429 ? 'まちがいが続いたので、1時間ほどロックしています。' : r.status === 401 ? 'パスワードがちがいます。' : 'うまくいきませんでした。もう一度ためしてください。';
  } catch { m.textContent = '通信できませんでした。'; }
  b.disabled = false;
});
</script>
</body>
</html>`;
  return withHeaders(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }));
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_FILES.has(path) && (request.method === 'GET' || request.method === 'HEAD')) {
    return withHeaders(await next());
  }
  if (path === '/api/login') return handleLogin(request, env);

  // 設定が足りないときは、開かずに止める(閉じる側に倒す)
  if (!env.SESSION_SECRET || !env.APP_PASSWORD || !env.DB) {
    return json({ error: 'server' }, 500);
  }

  const authed = await verifyToken(env, getCookie(request, COOKIE));
  if (!authed) {
    if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    return loginPage();
  }

  if (path === '/api/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
  }

  // 書き込みは同じサイトからだけ
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
  }

  const res = await next();
  return withHeaders(res, { 'Cache-Control': 'no-store' });
}
