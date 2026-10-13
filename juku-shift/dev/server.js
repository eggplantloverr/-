// 開発用: Code.gs を「メモリ上のスプレッドシート」で動かし、Index.html を配信する。
// 使い方: node juku-shift/dev/server.js  →  http://localhost:8791
// 本番(Apps Script)では使わない。データは再起動で消える。ダミーデータだけを入れる。
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const mem = {}; // シート名 -> 2次元配列

function makeSheet(name) {
  const cells = (mem[name] = mem[name] || []);
  return {
    appendRow(r) { cells.push(r.slice()); },
    setFrozenRows() {},
    getMaxRows() { return 1000; },
    getLastRow() { return cells.length; },
    getRange(r, c, nr, nc) {
      return {
        setNumberFormat() { return this; },
        getValues() { const o = []; for (let i = 0; i < nr; i++) o.push(Array.from({ length: nc }, (_, j) => (cells[r - 1 + i] || [])[c - 1 + j] ?? '')); return o; },
        setValues(v) { v.forEach((row, i) => { cells[r - 1 + i] = cells[r - 1 + i] || []; row.forEach((x, j) => { cells[r - 1 + i][c - 1 + j] = x; }); }); },
        clearContent() { for (let i = 0; i < nr; i++) if (cells[r - 1 + i]) cells[r - 1 + i] = []; cells.length = Math.max(1, r - 1); }
      };
    }
  };
}
const sheets = {};
const ctx = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: n => (mem[n] ? (sheets[n] = sheets[n] || makeSheet(n)) : null),
      insertSheet: n => { mem[n] = []; return (sheets[n] = makeSheet(n)); }
    }),
    getUi() { throw new Error('no ui'); }
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(x => (x > 127 ? x - 256 : x)),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => { const j = new Date(d.getTime() + 9 * 3600000).toISOString(); return f === 'yyyy-MM-dd' ? j.slice(0, 10) : j; }
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  HtmlService: {}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
module.exports = { ctx };

function call(action, token, p) { return JSON.parse(JSON.stringify(ctx.api(action, token, p))); }

// ---- ダミーデータ(実在の名前は入れない) ----
function seed() {
  ctx.createAdmin('admin@example.com', '管理者', 'admin-pass-1');
  const adm = call('login', null, { email: 'admin@example.com', password: 'admin-pass-1' }).data.token;
  const mk = (o) => call('saveUser', adm, o).data;
  const A = mk({ role: 'teacher', name: '先生A', email: 'ta@example.com', password: 'teacher-pass-1', subjects: ['国語', '英語'], grades: ['中学生', '高校生'], maxPerWeek: 4 });
  const B = mk({ role: 'teacher', name: '先生B', email: 'tb@example.com', password: 'teacher-pass-2', subjects: ['算数・数学', '理科'], grades: ['小学生', '中学生'], maxPerWeek: 3 });
  mk({ role: 'parent', name: '生徒A', grade: '中学生', email: 'pa@example.com', password: 'parent-pass-1', memo: '保護者A' });
  mk({ role: 'parent', name: '生徒B', grade: '小学生', email: 'pb@example.com', password: 'parent-pass-2' });
  return { A, B };
}
if (require.main === module) {
  seed();
  const shim = `<script>(function(){function mk(ok,ng){var o={withSuccessHandler:function(f){ok=f;return mk(ok,ng)},withFailureHandler:function(f){ng=f;return mk(ok,ng)}};
  o.api=function(a,t,p){fetch('/rpc',{method:'POST',body:JSON.stringify([a,t,p])}).then(function(r){return r.json()}).then(function(j){ok&&ok(j)},function(e){ng&&ng(e)})};return o}
  window.google={script:{run:mk()}}})();</script>`;
  http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/rpc') {
      let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
        const [a, t, p] = JSON.parse(b);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(ctx.api(a, t, p)));
      });
      return;
    }
    const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8').replace('<head>', '<head>' + shim);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  }).listen(8791, () => console.log('http://localhost:8791'));
}
