import assert from 'node:assert/strict';
import test from 'node:test';
import { tripStatus, validateTripInput } from '../lib/domain';
import { orderedTrips, tripPeriod } from '../lib/trips';
import type { Trip } from '../lib/types';

function trip(id: string, start_date: string | null, end_date: string | null, extra: Partial<Trip> = {}): Trip {
  return { id, name: id, destination: '', start_date, end_date, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, initial_budget_cents: 0, version: 1, ...extra };
}

test('a trip remains ongoing through its whole last day in its own timezone', () => {
  const journey = trip('last-day', '2026-10-08', '2026-10-10');
  assert.equal(tripStatus(journey, new Date('2026-10-10T03:00:00Z')).phase, 'ongoing');
  assert.equal(tripStatus(journey, new Date('2026-10-11T02:59:59Z')).phase, 'ongoing');
  assert.equal(tripStatus(journey, new Date('2026-10-11T03:00:00Z')).phase, 'finished');
});

test('the same instant uses each trip calendar and does not assume the device timezone', () => {
  const now = new Date('2026-10-08T02:00:00Z');
  assert.equal(tripStatus(trip('br', '2026-10-08', '2026-10-08'), now).phase, 'upcoming');
  assert.equal(tripStatus(trip('jp', '2026-10-08', '2026-10-08', { timezone: 'Asia/Tokyo' }), now).phase, 'ongoing');
});

test('missing either date stays explicitly undated and does not invent a period', () => {
  const now = new Date('2026-10-08T15:00:00Z');
  for (const value of [trip('none', null, null), trip('start', '2026-10-01', null), trip('end', null, '2026-10-01')]) assert.equal(tripStatus(value, now).phase, 'unplanned');
  assert.equal(tripPeriod(trip('none', null, null)), 'Datas a definir');
  assert.match(tripPeriod(trip('start', '2026-10-01', null)), /término a definir/);
  assert.match(tripPeriod(trip('end', null, '2026-10-01')), /Início a definir/);
});

test('list order places current trips, nearest upcoming, most recently finished and undated last without mutating records', () => {
  const values = [trip('old', '2026-08-01', '2026-08-12'), trip('far', '2026-12-01', '2026-12-03'), trip('none', null, null), trip('near', '2026-10-10', '2026-10-12'), trip('recent', '2026-10-01', '2026-10-07'), trip('current', '2026-10-08', '2026-10-09')];
  const before = structuredClone(values);
  assert.deepEqual(orderedTrips(values, new Date('2026-10-08T15:00:00Z')).map(value => value.id), ['current', 'near', 'far', 'recent', 'old', 'none']);
  assert.deepEqual(values, before);
});

test('archive visibility does not overwrite date classification or budget', () => {
  const value = trip('archived', '2026-10-01', '2026-10-03', { archived_at: '2026-10-05T12:00:00Z', initial_budget_cents: 12345 });
  assert.equal(tripStatus(value, new Date('2026-10-08T15:00:00Z')).phase, 'finished');
  assert.equal(value.initial_budget_cents, 12345);
  assert.equal(value.start_date, '2026-10-01');
});

test('creating a trip requires its own integer budget, accepts zero and rejects whitespace names or reversed dates', () => {
  assert.throws(() => validateTripInput(trip('blank', null, null, { name: '   ' }), { requireInitialBudget: true }), /nome/);
  assert.throws(() => validateTripInput(trip('unset', null, null, { initial_budget_cents: null }), { requireInitialBudget: true }), /orçamento inicial/);
  assert.equal(validateTripInput(trip('zero', null, null), { requireInitialBudget: true }).initial_budget_cents, 0);
  assert.throws(() => validateTripInput(trip('negative', null, null, { initial_budget_cents: -1 }), { requireInitialBudget: true }), /não negativo/);
  assert.throws(() => validateTripInput(trip('fractional', null, null, { initial_budget_cents: 1.5 }), { requireInitialBudget: true }), /não negativo/);
  assert.throws(() => validateTripInput(trip('reversed', '2026-10-12', '2026-10-10'), { requireInitialBudget: true }), /anterior/);
});
