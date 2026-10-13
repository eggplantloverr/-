// 画面の通しテスト(開発用サーバー http://localhost:8791 が動いている前提)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errors = [];
  const newPage = async (w = 1440, h = 900) => { const c = await b.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text())); p.on('dialog', d => d.accept()); await p.goto('http://localhost:8791'); return p; };
  const login = async (p, e, pw) => { await p.fill('input[type=email]', e); await p.fill('input[type=password]', pw); await p.click('button[type=submit]'); };
  const month = '2026-11';
  const goMonth = async (p) => { await p.waitForSelector('.monthnav b'); while (!(await p.textContent('.monthnav b')).includes('11月')) { const before = await p.textContent('.monthnav b'); await p.click('button[aria-label="次の月"]'); await p.waitForFunction(b => document.querySelector('.monthnav b').textContent !== b, before); await p.waitForTimeout(50); } };

  // 先生: ○を付ける
  const t = await newPage(); await login(t, 'ta@example.com', 'teacher-pass-1'); await t.waitForSelector('.monthnav'); await goMonth(t);
  await t.click('td[data-d="2026-11-03"][data-h="14"]');
  await t.hover('td[data-d="2026-11-03"][data-h="15"]'); // ドラッグ無しなら塗られない
  const a = await t.locator('td[data-d="2026-11-03"][data-h="15"]').boundingBox();
  const bb = await t.locator('td[data-d="2026-11-03"][data-h="17"]').boundingBox();
  await t.mouse.move(a.x + 5, a.y + 5); await t.mouse.down(); await t.mouse.move(bb.x + 5, bb.y + 5, { steps: 4 }); await t.mouse.up();
  await t.click('table.grid thead th >> nth=5');
  await t.click('button:has-text("保存する")'); await t.waitForSelector('.toast:has-text("保存しました")');
  assert.strictEqual(await t.locator('td.on').count() >= 4, true);
  await t.screenshot({ path: '/tmp/claude-0/teacher.png' });

  // 保護者: 希望を出す
  const p = await newPage(); await login(p, 'pa@example.com', 'parent-pass-1'); await p.waitForSelector('.monthnav'); await goMonth(p);
  await p.click('button:has-text("＋ 希望を追加")');
  await p.fill('.reqrow input[type=date]', '2026-11-03');
  await p.locator('.reqrow select').nth(1).selectOption('国語');
  await p.fill('.reqrow input[type=time] >> nth=0', '14:00'); await p.fill('.reqrow input[type=time] >> nth=1', '17:00');
  await p.click('button:has-text("希望を提出する")'); await p.waitForSelector('.toast:has-text("提出しました")');
  await p.screenshot({ path: '/tmp/claude-0/parent.png' });

  // 管理者: 候補から確定
  const a1 = await newPage(); await login(a1, 'admin@example.com', 'admin-pass-1'); await a1.waitForSelector('.monthnav'); await goMonth(a1);
  await a1.click('.sitem:has-text("生徒A")');
  await a1.waitForSelector('.cand:has-text("先生A")');
  await a1.screenshot({ path: '/tmp/claude-0/match.png' });
  await a1.click('.cand button:has-text("この候補で確定")');
  await a1.waitForSelector('.modal');
  assert((await a1.textContent('.modal .notice')).includes('空きに収まっています'));
  await a1.click('.modal button:has-text("確定する")'); await a1.waitForSelector('.req.done');
  await a1.click('.tab:has-text("時間割")'); await a1.waitForSelector('table.t tbody tr');
  await a1.click('button:has-text("CSV出力")'); const csv = await a1.inputValue('.modal textarea'); assert(csv.includes('先生A') && csv.includes('生徒A'), csv);
  await a1.click('.modal button:has-text("閉じる")');
  await a1.screenshot({ path: '/tmp/claude-0/sched.png' });
  await a1.click('.tab:has-text("アルバイトの空き")'); await a1.waitForSelector('table.grid td.lesson');
  await a1.screenshot({ path: '/tmp/claude-0/teachers.png', fullPage: true });
  await a1.click('.tab:has-text("ユーザー")'); await a1.screenshot({ path: '/tmp/claude-0/users.png' });
  await a1.click('.tab:has-text("設定")'); await a1.screenshot({ path: '/tmp/claude-0/settings.png' });

  // 先生側に授業が見える
  await t.reload(); await t.waitForSelector('.monthnav'); await goMonth(t); await t.waitForSelector('td.lesson');
  assert((await t.textContent('main')).includes('生徒A'));
  // 外部通信が無い
  assert.deepStrictEqual(errors, [], errors.join('\n'));
  console.log('E2E OK'); await b.close();
})().catch(async e => { console.error(e); process.exit(1); });
