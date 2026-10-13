/**
 * 個別指導塾 シフト管理 - サーバー側 (Google Apps Script)
 * スプレッドシートに「コンテナバインド」して使う。データはそのスプレッドシートのシートに保存される。
 * 画面は Index.html。ブラウザからは google.script.run.api(action, token, payload) だけを呼ぶ。
 */

var GRADES = ['小学生', '中学生', '高校生'];
var SESSION_DAYS = 7;
var MAX_FAILS = 5;
var LOCK_MIN = 10;
var ROLES = { admin: '管理者', teacher: 'アルバイト', parent: '保護者(生徒)' };

var SHEETS = {
  Users: ['id', 'email', 'role', 'name', 'salt', 'hash', 'grade', 'subjects', 'grades', 'maxPerWeek', 'memo', 'fails', 'lockUntil'],
  Sessions: ['hash', 'userId', 'expires'],
  Avail: ['key', 'month', 'teacherId', 'slots'],
  Requests: ['id', 'month', 'studentId', 'subject', 'date', 'from', 'to', 'len', 'teacherId', 'prio', 'note'],
  Lessons: ['id', 'date', 'start', 'end', 'teacherId', 'studentId', 'subject', 'note', 'requestId'],
  Settings: ['key', 'value']
};

/* ---------- 入口 ---------- */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('シフト管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('シフト管理')
      .addItem('管理者アカウントを作成', 'menuCreateAdmin_')
      .addToUi();
  } catch (e) { /* UIが無い環境では何もしない */ }
}

function menuCreateAdmin_() {
  var ui = SpreadsheetApp.getUi();
  var em = ui.prompt('管理者のメールアドレス');
  if (em.getSelectedButton() !== ui.Button.OK) return;
  var nm = ui.prompt('管理者の名前');
  if (nm.getSelectedButton() !== ui.Button.OK) return;
  var pw = ui.prompt('パスワード(8文字以上)');
  if (pw.getSelectedButton() !== ui.Button.OK) return;
  try {
    createAdmin(em.getResponseText(), nm.getResponseText(), pw.getResponseText());
    ui.alert('管理者を作成しました。Webアプリのページからログインできます。');
  } catch (e) {
    ui.alert(e instanceof UserError ? e.message : '作成できませんでした');
  }
}

/** 管理者を作る(メニューから実行。画面からは作れない) */
function createAdmin(email, name, password) {
  return withLock_(function () {
    var users = readAll_('Users');
    email = email_(email);
    if (users.some(function (u) { return u.email === email; })) throw new UserError('そのメールアドレスは登録済みです');
    pwCheck_(password);
    var u = newUser_({ email: email, role: 'admin', name: text_(name, 40, '名前'), password: password });
    users.push(u);
    writeAll_('Users', users);
    return u.id;
  });
}

function UserError(message) { this.message = message; this.name = 'UserError'; }
UserError.prototype = Object.create(Error.prototype);

function api(action, token, p) {
  try {
    p = p || {};
    if (action === 'login') return { ok: true, data: login_(p) };
    var u = auth_(token);
    if (!u) return { ok: false, error: 'ログインしてください', auth: true };
    var def = ACTIONS[action];
    if (!def) return { ok: false, error: '不明な操作です' };
    if (def.roles.indexOf(u.role) < 0) return { ok: false, error: 'この操作はできません' };
    var run = function () { return def.run(u, p, token); };
    return { ok: true, data: def.write ? withLock_(run) : run() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    try { console.error(String((e && e.stack) || e)); } catch (x) { /* ignore */ }
    return { ok: false, error: 'サーバーでエラーが起きました' };
  }
}

/* ---------- シート入出力 ---------- */

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    // 日付や時刻が自動で別の型に変わらないよう、全部テキストにする
    sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat('@');
  }
  return sh;
}

function readAll_(name) {
  var sh = sheet_(name);
  var cols = SHEETS[name];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return v.map(function (row) {
    var o = {};
    for (var j = 0; j < cols.length; j++) o[cols[j]] = row[j] === null || row[j] === undefined ? '' : String(row[j]);
    return o;
  });
}

function writeAll_(name, rows) {
  var sh = sheet_(name);
  var cols = SHEETS[name];
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (rows.length) {
    var data = rows.map(function (r) {
      return cols.map(function (c) { return r[c] === undefined || r[c] === null ? '' : String(r[c]); });
    });
    sh.getRange(2, 1, data.length, cols.length).setValues(data);
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- 入力チェック ---------- */

function email_(s) {
  s = String(s || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 100) throw new UserError('メールアドレスの形式が正しくありません');
  return s;
}
function pwCheck_(s) {
  if (typeof s !== 'string' || s.length < 8 || s.length > 100) throw new UserError('パスワードは8文字以上にしてください');
}
function text_(s, max, label) {
  s = String(s === undefined || s === null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim();
  if (s.length > max) throw new UserError(label + 'は' + max + '文字以内にしてください');
  return s;
}
function month_(s) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(s))) throw new UserError('月の指定が正しくありません');
  return String(s);
}
function date_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new UserError('日付の形式が正しくありません');
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) throw new UserError('存在しない日付です');
  return String(s);
}
function time_(s) {
  var m = /^(\d{2}):(\d{2})$/.exec(String(s));
  if (!m || +m[1] > 23 || +m[2] > 59) throw new UserError('時刻の形式が正しくありません');
  return String(s);
}
function toMin_(t) { return +t.slice(0, 2) * 60 + +t.slice(3); }
function list_(arr, allowed, label) {
  if (!Array.isArray(arr)) arr = [];
  var out = [];
  arr.forEach(function (x) {
    x = String(x);
    if (allowed.indexOf(x) < 0) throw new UserError(label + 'に不正な値があります');
    if (out.indexOf(x) < 0) out.push(x);
  });
  return out;
}
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

/* ---------- 認証 ---------- */

function sha_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function pwHash_(salt, pw) {
  var h = salt + pw;
  for (var i = 0; i < 1000; i++) h = sha_(h + salt);
  return h;
}
function newUser_(o) {
  var salt = uid_() + uid_();
  return {
    id: uid_(), email: o.email, role: o.role, name: o.name, salt: salt, hash: pwHash_(salt, o.password),
    grade: o.grade || '', subjects: o.subjects || '', grades: o.grades || '', maxPerWeek: o.maxPerWeek || '',
    memo: o.memo || '', fails: '0', lockUntil: '0'
  };
}
function nowMs_() { return new Date().getTime(); }

function login_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var users = readAll_('Users');
  var u = users.filter(function (x) { return x.email === email; })[0];
  var bad = new UserError('メールアドレスまたはパスワードが違います');
  return withLock_(function () {
    if (!u) { pwHash_('x', String(p.password || '')); throw bad; }
    if (+u.lockUntil > nowMs_()) throw new UserError('ログインに何度も失敗したため、しばらく待ってからやり直してください');
    if (pwHash_(u.salt, String(p.password || '')) !== u.hash) {
      u.fails = String((+u.fails || 0) + 1);
      if (+u.fails >= MAX_FAILS) { u.lockUntil = String(nowMs_() + LOCK_MIN * 60000); u.fails = '0'; }
      writeAll_('Users', users);
      throw bad;
    }
    u.fails = '0'; u.lockUntil = '0';
    writeAll_('Users', users);
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    var now = nowMs_();
    var sessions = readAll_('Sessions').filter(function (s) { return +s.expires > now; });
    sessions.push({ hash: sha_(token), userId: u.id, expires: String(now + SESSION_DAYS * 86400000) });
    writeAll_('Sessions', sessions);
    return { token: token, user: pubUser_(u, true) };
  });
}

function auth_(token) {
  if (!token || typeof token !== 'string') return null;
  var h = sha_(token), now = nowMs_();
  var s = readAll_('Sessions').filter(function (x) { return x.hash === h && +x.expires > now; })[0];
  if (!s) return null;
  return readAll_('Users').filter(function (u) { return u.id === s.userId; })[0] || null;
}

function split_(s) { return s ? String(s).split(',').filter(Boolean) : []; }

function pubUser_(u, full) {
  var o = {
    id: u.id, role: u.role, name: u.name, grade: u.grade,
    subjects: split_(u.subjects), grades: split_(u.grades), maxPerWeek: +u.maxPerWeek || 0
  };
  if (full) { o.email = u.email; o.memo = u.memo; }
  return o;
}

/* ---------- 設定 ---------- */

function settings_() {
  var rows = readAll_('Settings'), m = {};
  rows.forEach(function (r) { m[r.key] = r.value; });
  var subjects;
  try { subjects = JSON.parse(m.subjects || ''); } catch (e) { subjects = null; }
  if (!Array.isArray(subjects) || !subjects.length) subjects = ['国語', '算数・数学', '英語', '理科', '社会'];
  var deadlines = {};
  Object.keys(m).forEach(function (k) { if (k.indexOf('deadline:') === 0) deadlines[k.slice(9)] = m[k]; });
  return {
    subjects: subjects,
    hourFrom: +m.hourFrom || 13,
    hourTo: +m.hourTo || 22,
    deadlines: deadlines
  };
}
function setSetting_(key, value) {
  var rows = readAll_('Settings').filter(function (r) { return r.key !== key; });
  if (value !== '' && value !== null && value !== undefined) rows.push({ key: key, value: String(value) });
  writeAll_('Settings', rows);
}
function todayJst_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function isLocked_(month) {
  var d = settings_().deadlines[month];
  return !!d && todayJst_() > d;
}

/* ---------- 操作の定義 ---------- */

var ACTIONS = {
  me: { roles: ['admin', 'teacher', 'parent'], run: function (u) {
    var st = settings_();
    var out = { user: pubUser_(u, true), settings: { subjects: st.subjects, hourFrom: st.hourFrom, hourTo: st.hourTo }, grades: GRADES };
    if (u.role === 'parent') {
      // 保護者には「希望の先生を選ぶための名前と担当科目」だけ見せる
      out.teachers = readAll_('Users').filter(function (x) { return x.role === 'teacher'; }).map(function (x) {
        return { id: x.id, name: x.name, subjects: split_(x.subjects), grades: split_(x.grades) };
      });
    }
    return out;
  } },

  logout: { roles: ['admin', 'teacher', 'parent'], write: true, run: function (u, p, token) {
    var h = sha_(token);
    writeAll_('Sessions', readAll_('Sessions').filter(function (s) { return s.hash !== h; }));
    return true;
  } },

  changePassword: { roles: ['admin', 'teacher', 'parent'], write: true, run: function (u, p) {
    var users = readAll_('Users');
    var me = users.filter(function (x) { return x.id === u.id; })[0];
    if (pwHash_(me.salt, String(p.oldPassword || '')) !== me.hash) throw new UserError('いまのパスワードが違います');
    pwCheck_(p.newPassword);
    me.salt = uid_() + uid_();
    me.hash = pwHash_(me.salt, p.newPassword);
    writeAll_('Users', users);
    return true;
  } },

  /** 先生・保護者が自分の月のデータを取る */
  mine: { roles: ['teacher', 'parent'], run: function (u, p) {
    var month = month_(p.month);
    var users = readAll_('Users');
    var byId = {};
    users.forEach(function (x) { byId[x.id] = x; });
    var out = { month: month, deadline: settings_().deadlines[month] || '', locked: isLocked_(month), lessons: [] };
    var isT = u.role === 'teacher';
    out.lessons = readAll_('Lessons').filter(function (l) {
      return l.date.slice(0, 7) === month && (isT ? l.teacherId === u.id : l.studentId === u.id);
    }).map(function (l) {
      var o = byId[isT ? l.studentId : l.teacherId];
      return { id: l.id, date: l.date, start: l.start, end: l.end, subject: l.subject, note: l.note, requestId: l.requestId,
        otherName: o ? o.name : '', otherGrade: o && isT ? o.grade : '' };
    }).sort(lessonCmp_);
    if (isT) {
      var a = readAll_('Avail').filter(function (x) { return x.key === month + '|' + u.id; })[0];
      out.slots = a ? split_(a.slots) : [];
    } else {
      out.requests = readAll_('Requests').filter(function (r) { return r.month === month && r.studentId === u.id; }).map(reqOut_);
    }
    return out;
  } },

  setAvail: { roles: ['teacher'], write: true, run: function (u, p) {
    var month = month_(p.month), st = settings_();
    if (isLocked_(month)) throw new UserError('締切を過ぎているため変更できません。管理者に連絡してください');
    var slots = [];
    (Array.isArray(p.slots) ? p.slots : []).forEach(function (s) {
      var m = /^(\d{4}-\d{2}-\d{2}):(\d{1,2})$/.exec(String(s));
      if (!m) throw new UserError('空き時間の形式が正しくありません');
      date_(m[1]);
      if (m[1].slice(0, 7) !== month) throw new UserError('対象の月ではない日付が含まれています');
      var h = +m[2];
      if (h < st.hourFrom || h >= st.hourTo) throw new UserError('授業時間帯の外が含まれています');
      var key = m[1] + ':' + h;
      if (slots.indexOf(key) < 0) slots.push(key);
    });
    slots.sort();
    if (slots.length > 600) throw new UserError('件数が多すぎます');
    var key = month + '|' + u.id;
    var rows = readAll_('Avail').filter(function (x) { return x.key !== key; });
    rows.push({ key: key, month: month, teacherId: u.id, slots: slots.join(',') });
    writeAll_('Avail', rows);
    return { saved: slots.length };
  } },

  setRequests: { roles: ['parent'], write: true, run: function (u, p) {
    var month = month_(p.month), st = settings_();
    if (isLocked_(month)) throw new UserError('締切を過ぎているため変更できません。管理者に連絡してください');
    var list = Array.isArray(p.requests) ? p.requests : [];
    if (list.length > 40) throw new UserError('希望は40件までです');
    var teachers = readAll_('Users').filter(function (x) { return x.role === 'teacher'; }).map(function (x) { return x.id; });
    var old = readAll_('Requests');
    var mineOld = old.filter(function (r) { return r.month === month && r.studentId === u.id; }).map(function (r) { return r.id; });
    var out = list.map(function (r, i) {
      var n = '(' + (i + 1) + '件目) ';
      var subject = String(r.subject || '');
      if (st.subjects.indexOf(subject) < 0) throw new UserError(n + '科目を選んでください');
      var date = date_(r.date);
      if (date.slice(0, 7) !== month) throw new UserError(n + '対象の月の日付にしてください');
      var from = time_(r.from), to = time_(r.to);
      var len = parseInt(r.len, 10);
      if (!(len >= 20 && len <= 240)) throw new UserError(n + '授業の長さは20〜240分にしてください');
      if (toMin_(to) - toMin_(from) < len) throw new UserError(n + '希望の時間帯が授業の長さより短くなっています');
      var tid = String(r.teacherId || '');
      if (tid && teachers.indexOf(tid) < 0) throw new UserError(n + '希望の先生が見つかりません');
      var prio = parseInt(r.prio, 10);
      if (!(prio >= 1 && prio <= 3)) prio = 1;
      var id = String(r.id || '');
      if (mineOld.indexOf(id) < 0) id = uid_();
      return { id: id, month: month, studentId: u.id, subject: subject, date: date, from: from, to: to, len: len,
        teacherId: tid, prio: prio, note: text_(r.note, 200, 'メモ') };
    });
    var rows = old.filter(function (r) { return !(r.month === month && r.studentId === u.id); }).concat(out);
    writeAll_('Requests', rows);
    return { requests: out.map(reqOut_) };
  } },

  /* ----- 管理者 ----- */

  board: { roles: ['admin'], run: function (u, p) {
    var month = month_(p.month);
    var avail = {};
    readAll_('Avail').filter(function (a) { return a.month === month; }).forEach(function (a) { avail[a.teacherId] = split_(a.slots); });
    var st = settings_();
    return {
      month: month,
      settings: { subjects: st.subjects, hourFrom: st.hourFrom, hourTo: st.hourTo },
      deadline: st.deadlines[month] || '',
      grades: GRADES,
      users: readAll_('Users').filter(function (x) { return x.role !== 'admin'; }).map(function (x) { return pubUser_(x, true); }),
      avail: avail,
      requests: readAll_('Requests').filter(function (r) { return r.month === month; }).map(reqOut_),
      lessons: readAll_('Lessons').filter(function (l) { return l.date.slice(0, 7) === month; }).map(lessonOut_).sort(lessonCmp_)
    };
  } },

  saveUser: { roles: ['admin'], write: true, run: function (u, p) {
    var users = readAll_('Users'), st = settings_();
    var role = p.role === 'teacher' || p.role === 'parent' ? p.role : null;
    if (!role) throw new UserError('役割を選んでください');
    var email = email_(p.email);
    var name = text_(p.name, 40, '名前');
    if (!name) throw new UserError('名前を入力してください');
    var id = String(p.id || '');
    var cur = id ? users.filter(function (x) { return x.id === id && x.role !== 'admin'; })[0] : null;
    if (id && !cur) throw new UserError('ユーザーが見つかりません');
    if (users.some(function (x) { return x.email === email && x.id !== id; })) throw new UserError('そのメールアドレスは登録済みです');
    var f = {
      email: email, role: role, name: name, memo: text_(p.memo, 200, 'メモ'),
      grade: '', subjects: '', grades: '', maxPerWeek: ''
    };
    if (role === 'parent') {
      if (GRADES.indexOf(p.grade) < 0) throw new UserError('学年を選んでください');
      f.grade = p.grade;
    } else {
      f.subjects = list_(p.subjects, st.subjects, '科目').join(',');
      f.grades = list_(p.grades, GRADES, '学年').join(',');
      var mx = parseInt(p.maxPerWeek, 10);
      f.maxPerWeek = mx > 0 && mx <= 50 ? String(mx) : '';
    }
    if (cur) {
      Object.keys(f).forEach(function (k) { cur[k] = f[k]; });
      if (p.password) {
        pwCheck_(p.password);
        cur.salt = uid_() + uid_();
        cur.hash = pwHash_(cur.salt, p.password);
        cur.fails = '0'; cur.lockUntil = '0';
        writeAll_('Sessions', readAll_('Sessions').filter(function (s) { return s.userId !== cur.id; }));
      }
    } else {
      pwCheck_(p.password);
      f.password = p.password;
      cur = newUser_(f);
      users.push(cur);
    }
    writeAll_('Users', users);
    return pubUser_(cur, true);
  } },

  deleteUser: { roles: ['admin'], write: true, run: function (u, p) {
    var id = String(p.id || '');
    var users = readAll_('Users');
    var t = users.filter(function (x) { return x.id === id; })[0];
    if (!t || t.role === 'admin') throw new UserError('削除できません');
    writeAll_('Users', users.filter(function (x) { return x.id !== id; }));
    writeAll_('Sessions', readAll_('Sessions').filter(function (s) { return s.userId !== id; }));
    writeAll_('Avail', readAll_('Avail').filter(function (a) { return a.teacherId !== id; }));
    writeAll_('Requests', readAll_('Requests').filter(function (r) { return r.studentId !== id; }));
    writeAll_('Lessons', readAll_('Lessons').filter(function (l) { return l.teacherId !== id && l.studentId !== id; }));
    return true;
  } },

  saveLesson: { roles: ['admin'], write: true, run: function (u, p) {
    var users = readAll_('Users'), st = settings_();
    var date = date_(p.date), start = time_(p.start), end = time_(p.end);
    if (toMin_(end) <= toMin_(start)) throw new UserError('終了時刻は開始時刻より後にしてください');
    var teacher = users.filter(function (x) { return x.id === p.teacherId && x.role === 'teacher'; })[0];
    var student = users.filter(function (x) { return x.id === p.studentId && x.role === 'parent'; })[0];
    if (!teacher) throw new UserError('先生を選んでください');
    if (!student) throw new UserError('生徒を選んでください');
    var subject = String(p.subject || '');
    if (st.subjects.indexOf(subject) < 0) throw new UserError('科目を選んでください');
    var id = String(p.id || '');
    var lessons = readAll_('Lessons');
    var clash = lessons.filter(function (l) {
      return l.id !== id && l.date === date && toMin_(l.start) < toMin_(end) && toMin_(start) < toMin_(l.end) &&
        (l.teacherId === teacher.id || l.studentId === student.id);
    })[0];
    if (clash) {
      throw new UserError(clash.teacherId === teacher.id
        ? 'その先生は同じ時間に別の授業が入っています(' + clash.start + '〜' + clash.end + ')'
        : 'その生徒は同じ時間に別の授業が入っています(' + clash.start + '〜' + clash.end + ')');
    }
    var rec = { id: id, date: date, start: start, end: end, teacherId: teacher.id, studentId: student.id,
      subject: subject, note: text_(p.note, 200, 'メモ'), requestId: String(p.requestId || '') };
    var i = -1;
    lessons.forEach(function (l, k) { if (l.id === id) i = k; });
    if (i >= 0) { rec.requestId = rec.requestId || lessons[i].requestId; lessons[i] = rec; }
    else { rec.id = uid_(); lessons.push(rec); }
    writeAll_('Lessons', lessons);
    return lessonOut_(rec);
  } },

  deleteLesson: { roles: ['admin'], write: true, run: function (u, p) {
    var id = String(p.id || '');
    writeAll_('Lessons', readAll_('Lessons').filter(function (l) { return l.id !== id; }));
    return true;
  } },

  saveSettings: { roles: ['admin'], write: true, run: function (u, p) {
    var subjects = (Array.isArray(p.subjects) ? p.subjects : []).map(function (s) { return text_(s, 20, '科目名'); }).filter(Boolean);
    subjects = subjects.filter(function (s, i) { return subjects.indexOf(s) === i; });
    if (!subjects.length || subjects.length > 20) throw new UserError('科目は1〜20個にしてください');
    if (subjects.some(function (s) { return s.indexOf(',') >= 0; })) throw new UserError('科目名に「,」は使えません');
    var from = parseInt(p.hourFrom, 10), to = parseInt(p.hourTo, 10);
    if (!(from >= 0 && to <= 24 && from < to)) throw new UserError('授業時間帯の指定が正しくありません');
    setSetting_('subjects', JSON.stringify(subjects));
    setSetting_('hourFrom', from);
    setSetting_('hourTo', to);
    return true;
  } },

  setDeadline: { roles: ['admin'], write: true, run: function (u, p) {
    var month = month_(p.month);
    setSetting_('deadline:' + month, p.date ? date_(p.date) : '');
    return true;
  } }
};

function reqOut_(r) {
  return { id: r.id, month: r.month, studentId: r.studentId, subject: r.subject, date: r.date, from: r.from, to: r.to,
    len: +r.len, teacherId: r.teacherId, prio: +r.prio || 1, note: r.note };
}
function lessonOut_(l) {
  return { id: l.id, date: l.date, start: l.start, end: l.end, teacherId: l.teacherId, studentId: l.studentId,
    subject: l.subject, note: l.note, requestId: l.requestId };
}
function lessonCmp_(a, b) {
  return (a.date + a.start) < (b.date + b.start) ? -1 : (a.date + a.start) > (b.date + b.start) ? 1 : 0;
}
