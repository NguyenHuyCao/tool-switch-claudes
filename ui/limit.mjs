// Nhan biet "het gioi han dung" trong lich su phien Claude Code.
// Claude Code ghi mot dong assistant co isApiErrorMessage=true, error="rate_limit",
// noi dung dang: "You've hit your 5-hour limit · resets 2:50am (Asia/Ho_Chi_Minh)".

// Cap nhat trang thai gioi han theo tung dong (doc theo thu tu thoi gian).
export function trackLimit(state, j) {
  if (!j || j.type !== 'assistant') return state;
  if (j.isApiErrorMessage && j.error === 'rate_limit') {
    const text = messageText(j).trim().slice(0, 200);
    return { at: Date.parse(j.timestamp) || null, text, ...parseReset(text, Date.parse(j.timestamp) || Date.now()) };
  }
  // Mot tra loi binh thuong sau do = da chay lai duoc, bo canh bao.
  if (!j.isApiErrorMessage) return null;
  return state;
}

function messageText(j) {
  const c = j.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('');
  return '';
}

// "resets 2:50am", "resets 11am", "resets 14:05" -> lan gan nhat SAU thoi diem bao loi (gio cua may).
// Dang co ngay ("resets Nov 15, 2pm") -> khong tu tinh, chi giu chu goc.
export function parseReset(text, fromMs) {
  const m = /resets\s+(.+?)\s*(?:\(([^)]+)\))?\s*$/i.exec(text || '');
  if (!m) return { resetText: null, resetAt: null, kind: kindOf(text) };
  const when = m[1].trim();
  const out = { resetText: when, resetAt: null, kind: kindOf(text) };
  const t = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(when);
  if (!t) return out;
  let h = Number(t[1]);
  const min = Number(t[2] || 0);
  const ap = (t[3] || '').toLowerCase();
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return out;
  if (ap === 'am' && h === 12) h = 0;
  if (ap === 'pm' && h !== 12) h += 12;
  const d = new Date(fromMs);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= fromMs) d.setDate(d.getDate() + 1);
  out.resetAt = d.getTime();
  return out;
}

function kindOf(text) {
  const s = String(text || '').toLowerCase();
  if (s.includes('5-hour')) return '5 giờ';
  if (s.includes('weekly') || s.includes('week')) return 'tuần';
  return null;
}

// Con hieu luc? (chua toi gio reset; neu khong biet gio reset thi coi la con trong 5 gio)
export function isActive(limit, now = Date.now()) {
  if (!limit?.at) return false;
  if (limit.resetAt) return now < limit.resetAt;
  return now - limit.at < 5 * 3600 * 1000;
}
