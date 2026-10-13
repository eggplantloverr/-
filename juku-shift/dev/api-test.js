const assert = require('assert');
const { ctx } = require('./server.js');
const srv = require('./server.js');
// server.js の seed は main 時のみなので、ここで同じ手順を行う
const call = (a, t, p) => JSON.parse(JSON.stringify(ctx.api(a, t, p)));
ctx.createAdmin('admin@example.com', '管理者', 'admin-pass-1');
const login = (e, p) => call('login', null, { email: e, password: p });
let r = login('admin@example.com', 'wrong'); assert(!r.ok);
const adm = login('admin@example.com', 'admin-pass-1').data.token;
const mk = o => call('saveUser', adm, o);
const A = mk({ role: 'teacher', name: '先生A', email: 'ta@example.com', password: 'teacher-pass-1', subjects: ['国語'], grades: ['中学生'], maxPerWeek: 4 }).data;
const S = mk({ role: 'parent', name: '生徒A', grade: '中学生', email: 'pa@example.com', password: 'parent-pass-1' }).data;
assert(!mk({ role: 'parent', name: 'x', grade: '中学生', email: 'pa@example.com', password: 'parent-pass-1' }).ok, '重複メール');
const t = login('ta@example.com', 'teacher-pass-1').data.token;
const p = login('pa@example.com', 'parent-pass-1').data.token;
// 権限
assert(!call('board', t, { month: '2026-11' }).ok); assert(!call('board', p, { month: '2026-11' }).ok);
assert(!call('saveLesson', p, {}).ok); assert(!call('board', 'bad', {}).auth === false);
// 空き
assert(call('setAvail', t, { month: '2026-11', slots: ['2026-11-03:14', '2026-11-03:15', '2026-11-03:14'] }).ok);
assert(!call('setAvail', t, { month: '2026-11', slots: ['2026-12-03:14'] }).ok);
assert(!call('setAvail', t, { month: '2026-11', slots: ['2026-11-03:3'] }).ok);
assert.deepStrictEqual(call('mine', t, { month: '2026-11' }).data.slots, ['2026-11-03:14', '2026-11-03:15']);
// 希望
let rq = call('setRequests', p, { month: '2026-11', requests: [{ subject: '国語', date: '2026-11-03', from: '14:00', to: '16:00', len: 80, teacherId: A.id, prio: 1, note: 'メモ' }] });
assert(rq.ok, JSON.stringify(rq));
assert(!call('setRequests', p, { month: '2026-11', requests: [{ subject: '国語', date: '2026-11-03', from: '14:00', to: '14:30', len: 80 }] }).ok);
// 保護者は他人の希望を触れない/先生はboard不可
const board = call('board', adm, { month: '2026-11' }).data;
assert.strictEqual(board.requests.length, 1); assert.deepStrictEqual(board.avail[A.id], ['2026-11-03:14', '2026-11-03:15']);
assert(!JSON.stringify(board).includes('"hash"') && !JSON.stringify(board).includes('salt'));
// 授業 + 重複
const L = { date: '2026-11-03', start: '14:00', end: '15:20', teacherId: A.id, studentId: S.id, subject: '国語', requestId: board.requests[0].id };
const sv = call('saveLesson', adm, L); assert(sv.ok, JSON.stringify(sv));
assert(!call('saveLesson', adm, { ...L, start: '15:00', end: '16:00' }).ok, '重複');
assert(call('saveLesson', adm, { ...L, id: sv.data.id, start: '15:00', end: '16:00' }).ok, '自分自身は重複しない');
// 締切
assert(call('setDeadline', adm, { month: '2026-11', date: '2020-01-01' }).ok);
assert(!call('setAvail', t, { month: '2026-11', slots: [] }).ok, '締切後は不可');
assert(call('mine', p, { month: '2026-11' }).data.lessons[0].otherName === '先生A');
// パスワード変更・ロック
assert(call('changePassword', t, { oldPassword: 'teacher-pass-1', newPassword: 'new-password-1' }).ok);
assert(login('ta@example.com', 'new-password-1').ok);
for (let i = 0; i < 5; i++) login('pa@example.com', 'x');
assert(/待って/.test(login('pa@example.com', 'parent-pass-1').error));
// ユーザー削除で関連が消える
assert(call('deleteUser', adm, { id: S.id }).ok);
assert.strictEqual(call('board', adm, { month: '2026-11' }).data.lessons.length, 0);
assert(call('logout', t, {}).ok); assert(call('me', t, {}).auth);
console.log('API OK');
