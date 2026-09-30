import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Redactor } from '../src/lib/redact.js';

test('replaces secret values with their names', () => {
  const r = new Redactor({ MY_KEY: 'abc-123-secret' });
  assert.equal(r.apply('curl -H "x: abc-123-secret"'), 'curl -H "x: [secret:MY_KEY]"');
});

test('catches a secret split across stream chunks', () => {
  const r = new Redactor({ MY_KEY: 'abc-123-secret' });
  const out = r.push('token abc-1') + r.push('23-sec') + r.push('ret done') + r.flush();
  assert.equal(out, 'token [secret:MY_KEY] done');
});

test('holds nothing back when the tail cannot start a secret', () => {
  const r = new Redactor({ MY_KEY: 'abc-123-secret' });
  assert.equal(r.push('hello world'), 'hello world');
});

test('flush releases a held partial match untouched', () => {
  const r = new Redactor({ MY_KEY: 'abc-123-secret' });
  assert.equal(r.push('ends with abc-1'), 'ends with ');
  assert.equal(r.flush(), 'abc-1');
});

test('ignores very short values that would match everywhere', () => {
  const r = new Redactor({ TINY: 'a' });
  assert.equal(r.apply('banana'), 'banana');
});
