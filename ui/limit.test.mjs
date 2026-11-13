// node --test limit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackLimit, parseReset, isActive } from './limit.mjs';

const err = (ts, text) => ({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', timestamp: ts,
  message: { content: [{ type: 'text', text }] } });
const ok = (ts) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: 'xong' }] } });

test('nhan ra loi het gioi han 5 gio va tinh gio reset sau thoi diem bao', () => {
  const at = new Date(2026, 10, 13, 23, 43).getTime();
  const s = trackLimit(null, err(new Date(at).toISOString(), "You've hit your 5-hour limit · resets 2:50am (Asia/Ho_Chi_Minh)"));
  assert.equal(s.kind, '5 giờ');
  assert.equal(s.resetText, '2:50am');
  assert.equal(s.resetAt, new Date(2026, 10, 14, 2, 50).getTime()); // sang ngay hom sau
  assert.ok(isActive(s, at + 60_000));
  assert.ok(!isActive(s, s.resetAt + 1));
});

test('tra loi binh thuong sau loi thi bo canh bao', () => {
  let s = trackLimit(null, err('2026-11-13T16:43:25.963Z', "You've hit your 5-hour limit · resets 2:50am"));
  assert.ok(s);
  s = trackLimit(s, { type: 'user', timestamp: '2026-11-13T19:00:00Z' });
  assert.ok(s, 'dong cua nguoi dung khong xoa canh bao');
  s = trackLimit(s, ok('2026-11-13T20:00:00Z'));
  assert.equal(s, null);
});

test('loi khac (xac thuc) khong bi coi la het gioi han', () => {
  const s = trackLimit(null, { type: 'assistant', isApiErrorMessage: true, error: 'authentication_failed', timestamp: 'x', message: { content: 'Failed' } });
  assert.equal(s, null);
});

test('gio dang 12pm, 12am, 24h va dang co ngay', () => {
  const from = new Date(2026, 10, 13, 8, 0).getTime();
  assert.equal(new Date(parseReset('resets 12pm', from).resetAt).getHours(), 12);
  assert.equal(new Date(parseReset('resets 12am', from).resetAt).getHours(), 0);
  assert.equal(new Date(parseReset('resets 14:05', from).resetAt).getMinutes(), 5);
  const withDate = parseReset("You've hit your weekly limit · resets Nov 15, 2pm (Asia/Ho_Chi_Minh)", from);
  assert.equal(withDate.resetAt, null);
  assert.equal(withDate.resetText, 'Nov 15, 2pm');
  assert.equal(withDate.kind, 'tuần');
  assert.equal(parseReset('resets 13pm', from).resetAt, null);
});

test('khong biet gio reset thi coi la con han trong 5 gio', () => {
  const s = { at: 1000, resetAt: null };
  assert.ok(isActive(s, 1000 + 3600_000));
  assert.ok(!isActive(s, 1000 + 6 * 3600_000));
});
