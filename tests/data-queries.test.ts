import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllPages, responseBelongsToRequest } from '../lib/dataQueries';

test('a complete trip loads more than 1000 rows without losing its totals to server pagination', async () => {
  const source = Array.from({ length: 1507 }, (_, id) => ({ id, amount_cents: 101 }));
  const visited: number[] = [];
  const rows = await readAllPages(async (offset, size) => { visited.push(offset); return { data: source.slice(offset, offset + size), error: null }; });
  assert.equal(rows.length, source.length);
  assert.equal(rows.reduce((sum, row) => sum + row.amount_cents, 0), 152207);
  assert.deepEqual(visited, [0, 500, 1000, 1500, 1507]);
});
test('a lower project row cap still retrieves every row and fails instead of returning partial totals', async () => {
  const source = Array.from({ length: 735 }, (_, id) => id);
  const rows = await readAllPages(async (offset, size) => ({ data: source.slice(offset, offset + Math.min(size, 200)), error: null }));
  assert.deepEqual(rows, source);
  await assert.rejects(readAllPages(async offset => ({ data: offset ? null : source.slice(0, 200), error: offset ? new Error('network interrupted') : null })), /network interrupted/);
});
test('delayed responses from a previous trip or session cannot commit to a new route', async () => {
  const requested = { tripId: 'trip-a', generation: 0 };
  let current = { ...requested };
  const committed: string[] = [];
  let finish!: () => void;
  const delayed = new Promise<void>(resolve => { finish = resolve; }).then(() => {
    if (responseBelongsToRequest(requested, current)) committed.push(requested.tripId);
  });
  current = { tripId: 'trip-b', generation: 1 };
  finish(); await delayed;
  assert.deepEqual(committed, []);
  assert.equal(responseBelongsToRequest({ tripId: 'trip-b', generation: 1 }, current), true);
  current.generation++;
  assert.equal(responseBelongsToRequest({ tripId: 'trip-b', generation: 1 }, current), false);
});
