// Kreato - trang quan ly phien Claude Code tren may (chi chay o 127.0.0.1).
// node server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trackLimit, isActive } from './limit.mjs';

const HOME = os.homedir();
const BASE = path.join(HOME, '.claude');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KC = path.join(HERE, '..', 'kc.cmd');
const PORT = Number(process.argv[2] || 4717);
// Ma khoa giu co dinh qua cac lan khoi dong de tab dang mo khong bi "token".
const TOKEN_FILE = path.join(HERE, '.token');
const TOKEN = (() => {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (/^[0-9a-f]{48}$/.test(t)) return t; } catch { /* chua co */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
})();
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME_RE = /^[a-z0-9_-]{1,20}$/;
const WIN = process.env.SystemRoot || 'C:\\Windows';
const CMD = process.env.ComSpec || path.join(WIN, 'System32', 'cmd.exe');
const EXPLORER = path.join(WIN, 'explorer.exe');

// ---------- nhat ky: server chay an nen moi loi phai ghi ra file ----------
const LOG_FILE = path.join(HERE, 'server.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* khong ghi duoc log cung khong duoc lam chet server */ }
  process.stdout.write(line);
}
// Mot loi le (tien trinh con, file khoa...) khong duoc lam tat ca trang.
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

function detach(file, args, opts = {}) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', ...opts });
  child.on('error', (e) => log('spawn loi', file, e));
  child.unref();
  return child;
}

// ---------- ho so (tai khoan) ----------
function profileDir(name) { return name === 'a' ? BASE : path.join(HOME, `.claude-${name}`); }

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function listProfiles() {
  const names = ['a'];
  for (const d of fs.readdirSync(HOME, { withFileTypes: true })) {
    if (d.isDirectory() && d.name.startsWith('.claude-')) {
      const n = d.name.slice(8);
      if (NAME_RE.test(n)) names.push(n);
    }
  }
  return names.map((name) => {
    const dir = profileDir(name);
    const acc = readJson(path.join(dir, '.claude.json'))?.oauthAccount
      || (name === 'a' ? readJson(path.join(HOME, '.claude.json'))?.oauthAccount : null) || {};
    let shared = null;
    if (name !== 'a') {
      shared = ['projects', 'agents', 'commands', 'skills'].filter((s) => {
        try { return fs.lstatSync(path.join(dir, s)).isSymbolicLink(); } catch { return false; }
      }).length;
    }
    return {
      name, dir,
      loggedIn: fs.existsSync(path.join(dir, '.credentials.json')),
      email: acc.emailAddress || null,
      org: acc.organizationName || null,
      accountUuid: UUID_RE.test(acc.accountUuid || '') ? acc.accountUuid : null,
      orgUuid: UUID_RE.test(acc.organizationUuid || '') ? acc.organizationUuid : null,
      shared,
    };
  });
}

// ---------- app Claude desktop ----------
// App luu moi phien thanh claude-code-sessions/<accountUuid>/<orgUuid>/local_<id>.json va chi hien phien cua
// tai khoan dang dang nhap. Noi dung hoi thoai (cliSessionId) nam o ~/.claude/projects, dung chung.
// "Chuyen phien sang tai khoan khac" = chuyen file mo ta do sang thu muc cua tai khoan kia. Khong dung dang nhap.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_RE = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BACKUP_DIR = path.join(HERE, '..', 'backups');

function appDataDir() {
  const root = path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Claude-Data');
  try {
    const d = fs.readdirSync(root, { withFileTypes: true }).find((x) => x.isDirectory() && x.name.startsWith('claude_'));
    return d ? path.join(root, d.name) : null;
  } catch { return null; }
}

function desktopInfo() {
  const app = appDataDir();
  if (!app) return { ok: false };
  const sessionsRoot = path.join(app, 'claude-code-sessions');
  // Chi doc dung mot khoa; khong bao gio doc / ghi cac khoa oauth:* trong file nay.
  const active = readJson(path.join(app, 'config.json'))?.lastKnownAccountUuid || null;
  return { ok: true, sessionsRoot, activeAccount: UUID_RE.test(active || '') ? active : null, running: desktopRunning(app) };
}

// App dang chay thi giu khoa file "lockfile" (khoa 1 phien ban cua Electron): mo ra se bi EBUSY.
function desktopRunning(app) {
  const p = path.join(app, 'lockfile');
  if (!fs.existsSync(p)) return false;
  try { fs.closeSync(fs.openSync(p, 'r+')); return false; } catch (e) { return e.code === 'EBUSY' || e.code === 'EPERM'; }
}

// cliSessionId -> { localId, file, account, org, title }
function desktopMap() {
  const info = desktopInfo();
  const out = new Map();
  if (!info.ok) return out;
  let accs = [];
  try { accs = fs.readdirSync(info.sessionsRoot).filter((a) => UUID_RE.test(a)); } catch { return out; }
  for (const acc of accs) {
    let orgs = [];
    try { orgs = fs.readdirSync(path.join(info.sessionsRoot, acc)).filter((o) => UUID_RE.test(o)); } catch { continue; }
    for (const org of orgs) {
      const dir = path.join(info.sessionsRoot, acc, org);
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && LOCAL_RE.test(f.slice(0, -5))); } catch { continue; }
      for (const f of files) {
        const file = path.join(dir, f);
        const j = readJson(file);
        if (!j?.cliSessionId || !ID_RE.test(j.cliSessionId)) continue;
        const prev = out.get(j.cliSessionId);
        const m = fs.statSync(file).mtimeMs;
        if (prev && prev.mtime > m) continue; // neu trung, lay ban moi nhat
        out.set(j.cliSessionId, { localId: f.slice(0, -5), file, account: acc, org, title: j.title || null, archived: !!j.isArchived, mtime: m });
      }
    }
  }
  return out;
}

// Bo cac truong gan voi tai khoan cu (phien Remote Control, connector cua to chuc cu).
function sanitizeForAccount(j) {
  delete j.bridgeSessionIds;
  delete j.remoteMcpServersConfig;
  j.remoteControlUserEnabled = false;
  j.remoteControlAutoEligible = false;
  j.isArchived = false;
  return j;
}

function moveDesktopSession(cliId, target) {
  const info = desktopInfo();
  if (!info.ok) throw httpError(409, 'Không thấy dữ liệu của app Claude desktop trên máy này');
  if (!target.accountUuid || !target.orgUuid) throw httpError(409, `Hồ sơ ${target.name} chưa có mã tài khoản — mở terminal hồ sơ đó một lần để Claude ghi lại`);
  const d = desktopMap().get(cliId);
  if (!d) throw httpError(409, 'Phiên này chưa từng mở trong app desktop — chỉ mở tiếp được ở terminal');
  if (d.account === target.accountUuid && d.org === target.orgUuid) return { localId: d.localId, already: true };
  // App dang mo bang tai khoan dang giu phien: no co the ghi de file ngay sau khi ta chuyen di.
  if (info.running && info.activeAccount === d.account) {
    throw httpError(409, 'App desktop đang đăng nhập đúng tài khoản đang giữ phiên này. Đăng xuất / chuyển app sang tài khoản khác (hoặc thoát hẳn app) rồi bấm lại.');
  }
  const j = readJson(d.file);
  if (!j) throw httpError(500, 'Không đọc được file mô tả phiên');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(d.file, path.join(BACKUP_DIR, `${stamp}_${d.account.slice(0, 8)}_${d.localId}.json`));
  const destDir = path.join(info.sessionsRoot, target.accountUuid, target.orgUuid);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${d.localId}.json`);
  const tmp = dest + '.kc-tmp';
  fs.writeFileSync(tmp, JSON.stringify(sanitizeForAccount(j)));
  fs.renameSync(tmp, dest);
  fs.rmSync(d.file);
  log('chuyen phien app', d.localId, d.account.slice(0, 8), '->', target.accountUuid.slice(0, 8));
  return { localId: d.localId, already: false };
}

function httpError(code, msg) { const e = new Error(msg); e.status = code; return e; }

// ---------- phien dang chay ----------
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function runningMap() {
  const out = new Map();
  for (const p of listProfiles()) {
    const dir = path.join(p.dir, 'sessions');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); } catch { continue; }
    for (const f of files) {
      const j = readJson(path.join(dir, f));
      if (!j?.sessionId || !j.pid || !alive(j.pid)) continue;
      out.set(j.sessionId, {
        pid: j.pid, status: j.status || 'unknown', profile: p.name,
        where: j.entrypoint === 'claude-desktop' ? 'app desktop' : 'terminal',
        since: j.statusUpdatedAt || j.updatedAt || null,
      });
    }
  }
  return out;
}

// ---------- quet lich su phien ----------
const cache = new Map(); // file -> {mtimeMs,size,info}

async function readSlice(file, start, len) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

function scanLines(text, info, isTail) {
  const lines = text.split('\n');
  if (isTail) lines.shift(); // dong dau co the bi cat
  for (const l of lines) {
    if (!l || l[0] !== '{') continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.cwd && (!info.cwd || isTail)) info.cwd = j.cwd;
    if (j.gitBranch && (!info.branch || isTail)) info.branch = j.gitBranch;
    if (j.version) info.version = j.version;
    if (j.type === 'custom-title' && j.customTitle) info.title = j.customTitle;
    else if (j.type === 'agent-name' && j.agentName && !info.title) info.title = j.agentName;
    else if (j.type === 'summary' && j.summary && !info.summary) info.summary = j.summary;
    else if (j.type === 'last-prompt' && j.lastPrompt) info.lastPrompt = j.lastPrompt;
    else if (j.type === 'queue-operation' && j.content && !info.firstPrompt) info.firstPrompt = String(j.content);
    if (j.entrypoint) info.entrypoint = j.entrypoint;
    info.limit = trackLimit(info.limit, j);
  }
}

async function sessionInfo(file, st) {
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.info;
  const id = path.basename(file, '.jsonl');
  const info = { id, file, size: st.size, mtime: st.mtimeMs };
  const HEAD = 256 * 1024, TAIL = 512 * 1024;
  scanLines(await readSlice(file, 0, Math.min(HEAD, st.size)), info, false);
  if (st.size > HEAD) scanLines(await readSlice(file, Math.max(HEAD, st.size - TAIL), TAIL), info, true);
  info.title = info.title || info.summary || (info.firstPrompt || info.lastPrompt || '(không tên)').slice(0, 80);
  if (info.lastPrompt) info.lastPrompt = info.lastPrompt.slice(0, 160);
  delete info.firstPrompt;
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

let index = new Map(); // id -> info

async function listSessions() {
  const roots = new Set();
  for (const p of listProfiles()) {
    try { roots.add(fs.realpathSync(path.join(p.dir, 'projects'))); } catch { /* chua co */ }
  }
  const files = [];
  for (const root of roots) {
    for (const d of await fsp.readdir(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      for (const f of await fsp.readdir(dir)) {
        if (f.endsWith('.jsonl') && ID_RE.test(f.slice(0, -6))) files.push(path.join(dir, f));
      }
    }
  }
  const running = runningMap();
  const dmap = desktopMap();
  const profs = listProfiles();
  const out = [];
  for (const f of files) {
    try {
      const st = await fsp.stat(f);
      if (st.size === 0) continue;
      const info = await sessionInfo(f, st);
      const d = dmap.get(info.id);
      const desktop = d ? {
        localId: d.localId,
        owner: profs.find((p) => p.accountUuid === d.account)?.name || null,
        archived: d.archived,
      } : null;
      if (d?.title) info.title = d.title; // ten dat trong app uu tien hon
      out.push({ ...info, file: undefined, desktop, running: running.get(info.id) || null, cwdExists: !!info.cwd && fs.existsSync(info.cwd),
        limit: isActive(info.limit) ? info.limit : null });
    } catch { /* bo qua file loi */ }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  index = new Map(out.map((s) => [s.id, s]));
  notifyLimits(out);
  return out;
}

// ---------- thong bao Windows khi mot phien vua het gioi han ----------
const NOTIFIED_FILE = path.join(HERE, '.notified.json');
let notified = new Set(readJson(NOTIFIED_FILE) || []);

function fmtTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function notifyLimits(sessions) {
  const fresh = sessions.filter((s) => s.limit?.at && Date.now() - s.limit.at < 30 * 60 * 1000
    && !notified.has(`${s.id}:${s.limit.at}`));
  if (!fresh.length) return;
  for (const s of fresh) notified.add(`${s.id}:${s.limit.at}`);
  notified = new Set([...notified].slice(-200));
  try { fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notified])); } catch (e) { log('khong ghi duoc .notified.json', e); }
  const s = fresh[0];
  const when = s.limit.resetAt ? `reset lúc ${fmtTime(s.limit.resetAt)}` : (s.limit.resetText ? `reset ${s.limit.resetText}` : 'chưa rõ giờ reset');
  const more = fresh.length > 1 ? ` (và ${fresh.length - 1} phiên khác)` : '';
  toastWin(`Hết giới hạn${s.limit.kind ? ' ' + s.limit.kind : ''} · ${when}`, `${s.title}${more} đã dừng. Bấm để mở trang và chuyển tài khoản.`);
  log('thong bao het gioi han', s.id.slice(0, 8), when);
}

// Ten phien lay tu lich su -> truyen qua bien moi truong, escape XML trong PowerShell (khong ghep vao lenh).
const TOAST_PS = `
$t=[Security.SecurityElement]::Escape($env:KC_TITLE); $b=[Security.SecurityElement]::Escape($env:KC_BODY); $u=[Security.SecurityElement]::Escape($env:KC_URL)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast activationType='protocol' launch='$u'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
`;
const TOAST_B64 = Buffer.from(TOAST_PS, 'utf16le').toString('base64');

function toastWin(title, body) {
  const env = { ...process.env, KC_TITLE: title.slice(0, 120), KC_BODY: body.slice(0, 250), KC_URL: `http://127.0.0.1:${PORT}/` };
  // Khong detached: PowerShell 5.1 khong co console se thoat ngay (xem restart-app).
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', TOAST_B64], { env, windowsHide: true, stdio: 'ignore' });
  ps.on('error', (e) => log('toast loi', e));
  ps.on('exit', (c) => { if (c) log('toast ket thuc, ma', c); });
}

// Quet nen moi phut de van bao khi trang dang dong.
setInterval(() => { listSessions().catch((e) => log('quet nen loi', e)); }, 60 * 1000).unref();

async function findSession(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return undefined;
  if (!index.has(id)) await listSessions(); // server vua khoi dong / phien moi
  return index.get(id);
}

function gitStatus(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'status', '--porcelain=v1', '--branch'], { timeout: 15000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ ok: false });
      const lines = stdout.split('\n').filter(Boolean);
      const head = lines.shift() || '';
      resolve({ ok: true, branch: head.replace(/^## /, ''), changed: lines.length });
    });
  });
}

// ---------- mo cua so terminal ----------
function openWindow(cwd, title, kcArgs) {
  // Moi tham so da duoc kiem tra bang regex nen ghep chuoi an toan.
  const cmd = `/c start "${title}" cmd /k "${KC}" ${kcArgs.join(' ')}`;
  log('mo cua so', title, kcArgs.join(' '), 'tai', cwd);
  detach(CMD, [cmd], { cwd, windowsVerbatimArguments: true, windowsHide: false });
}

// ---------- HTTP ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 10000) { reject(new Error('qua lon')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, { error: 'host' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace('__KC_TOKEN__', TOKEN);
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      return send(res, 200, { ok: true, pid: process.pid, since: STARTED });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const profiles = listProfiles();
      const di = desktopInfo();
      const desktop = { ok: di.ok, running: !!di.running, active: profiles.find((p) => p.accountUuid === di.activeAccount)?.name || null };
      return send(res, 200, { profiles, desktop, sessions: await listSessions(), kc: KC });
    }

    // Moi thao tac co tac dung phu: can token + cung nguon goc
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    const origin = req.headers.origin;
    if (req.headers['x-kc-token'] !== TOKEN || (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, '')))) {
      return send(res, 403, { error: 'token' });
    }
    const body = await readBody(req);
    const profiles = listProfiles();
    const prof = (n) => profiles.find((p) => p.name === n);

    if (url.pathname === '/api/git') {
      const s = (await findSession(body.id));
      if (!s?.cwdExists) return send(res, 404, { error: 'Không tìm thấy thư mục của phiên' });
      return send(res, 200, await gitStatus(s.cwd));
    }
    if (url.pathname === '/api/open') {
      const s = (await findSession(body.id));
      const p = prof(body.profile);
      if (!s || !ID_RE.test(s.id)) return send(res, 404, { error: 'Không tìm thấy phiên' });
      if (!p) return send(res, 400, { error: 'Không có hồ sơ này' });
      if (!p.loggedIn) return send(res, 409, { error: `Hồ sơ ${p.name} chưa đăng nhập` });
      if (!s.cwdExists) return send(res, 409, { error: 'Thư mục của phiên không còn tồn tại' });
      const run = runningMap().get(s.id);
      if (run) return send(res, 409, { error: `Phiên đang chạy (${run.where}, pid ${run.pid}). Dừng nó trước để không ghi chồng lịch sử.` });
      openWindow(s.cwd, `kc-${p.name}`, [p.name, '--resume', s.id]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/move') {
      // Chuyen phien cua app desktop sang tai khoan khac, roi (neu app dang o tai khoan do) mo luon.
      const s = (await findSession(body.id));
      const p = prof(body.profile);
      if (!s) return send(res, 404, { error: 'Không tìm thấy phiên' });
      if (!p) return send(res, 400, { error: 'Không có hồ sơ này' });
      const run = runningMap().get(s.id);
      if (run) return send(res, 409, { error: `Phiên đang chạy (${run.where}, pid ${run.pid}). Dừng nó trước để không ghi chồng lịch sử.` });
      if (!s.cwdExists) return send(res, 409, { error: 'Thư mục của phiên không còn tồn tại' });
      const r = moveDesktopSession(s.id, p);
      await listSessions();
      const di = desktopInfo();
      const appOnTarget = di.running && di.activeAccount === p.accountUuid;
      return send(res, 200, { ok: true, ...r, link: `claude://claude.ai/epitaxy/${r.localId}`, appOnTarget, appRunning: !!di.running });
    }
    if (url.pathname === '/api/restart-app') {
      // Server chay ngoai app (WMI) nen khong chet theo app. Chay tach ra de tra loi ngay.
      log('khoi dong lai app desktop');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, '..', 'restart-app.ps1')];
      if (body.dryRun === true) args.push('-DryRun');
      // KHONG dung detached: PowerShell 5.1 khong co console thi thoat ngay, khong chay gi (da do thuc te).
      const ps = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' });
      ps.on('error', (e) => log('restart-app spawn loi', e));
      ps.on('exit', (c) => log('restart-app ket thuc, ma', c));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/open-app') {
      const s = (await findSession(body.id));
      if (!s?.desktop || !LOCAL_RE.test(s.desktop.localId)) return send(res, 404, { error: 'Phiên này không có trong app desktop' });
      detach(CMD, ['/c', 'start', '', `claude://claude.ai/epitaxy/${s.desktop.localId}`]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/new') {
      const s = (await findSession(body.id));
      const p = prof(body.profile);
      if (!s?.cwdExists || !p?.loggedIn) return send(res, 409, { error: 'Thiếu thư mục hoặc hồ sơ chưa đăng nhập' });
      openWindow(s.cwd, `kc-${p.name}`, [p.name]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/login') {
      const p = prof(body.profile);
      if (!p) return send(res, 400, { error: 'Không có hồ sơ này' });
      openWindow(HOME, `kc-login-${p.name}`, ['login', p.name]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/setup') {
      if (!NAME_RE.test(body.name || '') || body.name === 'a') return send(res, 400, { error: 'Tên chỉ gồm a-z, 0-9, - _ (tối đa 20), khác "a"' });
      await new Promise((resolve, reject) => execFile(CMD, ['/c', KC, 'setup', body.name], { windowsHide: true, timeout: 30000 },
        (err, out, errOut) => (err ? reject(new Error(errOut || err.message)) : resolve())));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/folder') {
      const s = (await findSession(body.id));
      if (!s?.cwdExists) return send(res, 404, { error: 'Không tìm thấy thư mục' });
      detach(EXPLORER, [s.cwd]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/test-notify') {
      toastWin('Thử thông báo · Phiên Claude', 'Nếu bạn thấy dòng này, thông báo hết giới hạn sẽ hiện như vậy.');
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/stop') {
      send(res, 200, { ok: true });
      log('tat theo yeu cau');
      setTimeout(() => process.exit(0), 200);
      return;
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!e.status) log('loi xu ly', req.method, req.url, e);
    if (res.headersSent) return res.end();
    return send(res, e.status || 500, { error: String(e.message || e).slice(0, 300) });
  }
});

const STARTED = Date.now();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`Cong ${PORT} dang duoc dung - co the trang da mo san: http://127.0.0.1:${PORT}`);
    process.exit(0);
  }
  log('server loi', e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const u = `http://127.0.0.1:${PORT}`;
  log(`Trang quan ly phien: ${u}  (pid ${process.pid})`);
  if (!process.argv.includes('--no-open')) detach(CMD, ['/c', 'start', '', u]);
});
