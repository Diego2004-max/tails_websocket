import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDelta, type SheetEvent } from './delta';
import { compareStreamIds } from '../../../../shared/domain';
import { ReconnectPolicy } from '../../../../shared/reconnect';

const ev = (id: string, c1: number, correction = false): SheetEvent => ({
  id, sheetId: 'E14-0001-0001-01', table: 1, station: 1, municipality: 1, version: 1, correction, delta: { C1: c1, tables: 1 }, at: 0,
});

test('addDelta merges deltas and keeps the highest id', () => {
  let acc = addDelta(null, 'dept', ev('10-0', 5));
  acc = addDelta(acc, 'dept', ev('12-1', -2, true));
  assert.equal(acc.delta.C1, 3);
  assert.equal(acc.id, '12-1');
  assert.equal(acc.corrections, 1);
});

test('compareStreamIds orders by ms then sequence', () => {
  assert.equal(compareStreamIds('10-1', '10-2'), -1);
  assert.equal(compareStreamIds('11-0', '10-9'), 1);
  assert.equal(compareStreamIds('10-0', '10-0'), 0);
});

test('full jitter stays under the exponential ceiling', () => {
  const p = new ReconnectPolicy(500, 30_000, true, () => 0.999);
  for (let i = 0; i < 10; i++) assert.ok(p.next() <= 30_000);
});
