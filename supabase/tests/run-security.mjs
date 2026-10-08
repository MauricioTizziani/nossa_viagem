/**
 * Executes the actual migration against local PostgreSQL (PGlite + pgcrypto).
 * Auth roles/claims are a test fixture; live Supabase Auth and Realtime require
 * the two-device acceptance checks documented in README.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const owner = '10000000-0000-4000-8000-000000000001';
const member = '10000000-0000-4000-8000-000000000002';
const stranger = '10000000-0000-4000-8000-000000000003';
const anotherDevice = '10000000-0000-4000-8000-000000000004';
const activityId = '20000000-0000-4000-8000-000000000001';
const otherActivityId = '20000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000007';
const secretActivityId = '30000000-0000-4000-8000-000000000001';
const dinnerId = '20000000-0000-4000-8000-000000000030';
const fuelId = '40000000-0000-4000-8000-000000000001';
const lodgingId = '40000000-0000-4000-8000-000000000002';
const lunchId = '40000000-0000-4000-8000-000000000003';
const tollId = '40000000-0000-4000-8000-000000000004';
let tripId;
let otherTripId;
let ownerToken;

async function as(role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [id, role]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
async function row(sql, values = []) { return (await db.query(sql, values)).rows[0]; }
async function fails(sql, values = [], expected = /permission denied|ACCESS_DENIED/) {
  await assert.rejects(db.query(sql, values), expected);
}
async function save({ id = activityId, trip = tripId, version = 0, starts = '2026-10-10T15:00:00Z', budget = null,
  name = 'Passeio', type = 'Lazer', place = null, manualName = null, manualAddress = null, manualUrl = null,
  osmId = null, osmName = null, osmAddress = null, lat = null, lon = null } = {}) {
  return row('select * from public.save_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
    [trip, id, version, starts, budget, name, type, place, manualName, manualAddress, manualUrl, osmId, osmName, osmAddress, lat, lon]);
}
// Example values used only inside this local database; nothing reaches a real trip.
async function spend({ id = fuelId, trip = tripId, version = 0, description = 'Gasolina — viagem de ida', category = 'Combustível',
  amount = 20000, date = '2026-10-09', activity = null, notes = null } = {}) {
  return row('select * from public.save_expense($1,$2,$3,$4,$5,$6,$7,$8,$9)', [trip, id, version, description, category, amount, date, activity, notes]);
}
async function expenseTotal(trip = tripId) {
  const totals = await row('select coalesce(sum(amount_cents),0)::bigint as total, count(*)::int as n from public.trip_expenses where trip_id=$1', [trip]);
  return { total: Number(totals.total), count: totals.n };
}
async function newInvite({ role = 'member', uses = 1, hours = 24 } = {}) {
  await as('authenticated', owner);
  return row('select * from public.create_trip_invite($1,$2,$3,$4)', [tripId, role, uses, hours]);
}

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '');
    $$;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    insert into auth.users(id) values ('${owner}'),('${member}'),('${stranger}'),('${anotherDevice}');
    create publication supabase_realtime;
  `);
  const migration = await readFile(new URL('../migrations/202610080001_nossa_viagem.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec("insert into public.trips(id,name) values('aaaaaaaa-0000-4000-8000-000000000001','Upgrade'); insert into public.activities(id,trip_id,starts_at,name,type,place_id) values('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',now(),'Existing place','Lazer','legacy-reference');");
  await db.exec(await readFile(new URL('../migrations/202610080002_openstreetmap.sql', import.meta.url), 'utf8'));
  const preserved = await row("select * from public.activities where id='bbbbbbbb-0000-4000-8000-000000000001'");
  assert.equal(preserved.place_id, 'legacy-reference');
  assert.equal(preserved.osm_place_id, null);
  await db.exec("delete from public.trips where id='aaaaaaaa-0000-4000-8000-000000000001'");
  await as('service_role');
  const result = await row('select * from public.provision_trip_owner()');
  tripId = result.trip_id;
  ownerToken = result.token;
  const other = await row('select * from public.provision_trip_owner()');
  otherTripId = other.trip_id;
  await as('authenticated', owner);
  assert.equal((await row('select public.redeem_trip_invite($1) as id', [ownerToken])).id, tripId);
});
after(async () => { await db.close(); });

test('the migration enables RLS on every exposed application table', async () => {
  await as('postgres');
  const result = await db.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname");
  assert.equal(result.rows.length, 4);
  assert.ok(result.rows.every((item) => item.relrowsecurity));
  const receipts = await row("select relrowsecurity from pg_class where oid = 'private.invite_redemptions'::regclass");
  assert.equal(receipts.relrowsecurity, true);
});

test('bootstrap creates an empty trip and grants the first owner only through a secret invite', async () => {
  await as('authenticated', owner);
  const trip = await row('select * from public.trips where id=$1', [tripId]);
  assert.equal(trip.name, 'Nossa Viagem');
  assert.equal(trip.timezone, 'America/Sao_Paulo');
  assert.equal(trip.destination, null);
  assert.equal(trip.start_date, null);
  assert.equal(trip.person_one, null);
  assert.equal((await row('select count(*)::integer as count from public.activities')).count, 0);
  assert.equal((await row('select role from public.trip_members where trip_id=$1', [tripId])).role, 'owner');
  await fails('select * from public.provision_trip_owner()');
});

test('an unauthenticated visitor has no data or RPC access', async () => {
  await as('anon');
  await fails('select * from public.trips');
  await fails('select * from public.activities');
  await fails('select * from public.trip_members');
  await fails('select public.redeem_trip_invite($1)', [ownerToken]);
  await fails('select * from public.provision_trip_owner()');
});

test('a signed-in anonymous stranger sees no trips and cannot associate by trip ID', async () => {
  await as('authenticated', stranger);
  assert.equal((await row('select count(*)::integer as count from public.trips')).count, 0);
  assert.equal((await row('select count(*)::integer as count from public.trip_members')).count, 0);
  await fails("insert into public.trip_members(trip_id,user_id,role) values($1,$2,'owner')", [tripId, stranger]);
  await fails('select * from public.create_trip_invite($1)', [tripId]);
  await fails('select * from public.list_trip_invites($1)', [tripId]);
  await assert.rejects(save({ trip: tripId }), /ACCESS_DENIED/);
});

test('owners cannot mutate access tables directly or read invitation hashes', async () => {
  await as('authenticated', owner);
  await fails('select * from public.trip_invites');
  await fails('select * from private.invite_redemptions');
  await fails("update public.trip_members set role='owner' where user_id=$1", [member]);
  await fails('delete from public.trip_members where trip_id=$1', [tripId]);
  await fails("insert into public.trips(name) values('Public trip')");
  await fails('delete from public.trips where id=$1', [tripId]);
});

test('invites have 256 bits of fresh randomness and persist only their SHA-256 digest', async () => {
  const first = await newInvite();
  const second = await newInvite();
  assert.match(first.token, /^[0-9a-f]{64}$/);
  assert.notEqual(first.token, second.token);
  await as('postgres');
  const stored = await row('select encode(token_hash,\'hex\') as hash, octet_length(token_hash) as bytes from public.trip_invites where id=$1', [first.invite_id]);
  assert.equal(stored.bytes, 32);
  assert.notEqual(stored.hash, first.token);
  assert.equal((await row("select encode(extensions.digest($1,'sha256'),'hex') as hash", [first.token])).hash, stored.hash);
  assert.equal((await row("select count(*)::integer as count from information_schema.columns where table_schema='public' and table_name='trip_invites' and column_name='token'")).count, 0);
});

test('invalid invite options are rejected rather than granting indefinite access', async () => {
  await as('authenticated', owner);
  for (const values of [[tripId, 'admin', 1, 24], [tripId, 'member', 0, 24], [tripId, 'member', 21, 24], [tripId, 'member', 1, 0], [tripId, 'member', 1, 169]]) {
    await fails('select * from public.create_trip_invite($1,$2,$3,$4)', values, /INVALID_INVITE_OPTIONS/);
  }
});

test('invite redemption authorizes a new device and replay is idempotent for that same session', async () => {
  const invite = await newInvite();
  await as('authenticated', member);
  assert.equal((await row('select public.redeem_trip_invite($1) as id', [invite.token])).id, tripId);
  assert.equal((await row('select public.redeem_trip_invite($1) as id', [invite.token])).id, tripId);
  assert.equal((await row('select role from public.trip_members where trip_id=$1', [tripId])).role, 'member');
  assert.equal((await row('select count(*)::integer as count from public.trips')).count, 1);
  await as('authenticated', stranger);
  await fails('select public.redeem_trip_invite($1)', [invite.token], /INVALID_INVITE/);
  await as('postgres');
  assert.equal((await row('select use_count from public.trip_invites where id=$1', [invite.invite_id])).use_count, 1);
});

test('a member can edit but cannot create, enumerate, or revoke invitations', async () => {
  await as('authenticated', member);
  await fails('select * from public.create_trip_invite($1)', [tripId]);
  await fails('select * from public.list_trip_invites($1)', [tripId]);
  await fails('select public.revoke_trip_invite($1)', ['ffffffff-ffff-4fff-8fff-ffffffffffff']);
});

test('expired, revoked and malformed invites are rejected without new membership', async () => {
  const expired = await newInvite();
  const revoked = await newInvite();
  await as('postgres');
  await db.query("update public.trip_invites set expires_at=now()-interval '1 second' where id=$1", [expired.invite_id]);
  await as('authenticated', owner);
  await row('select public.revoke_trip_invite($1)', [revoked.invite_id]);
  await as('authenticated', stranger);
  for (const token of [expired.token, revoked.token, '', 'abc', '0'.repeat(64)]) {
    await fails('select public.redeem_trip_invite($1)', [token], /INVALID_INVITE/);
  }
  assert.equal((await row('select count(*)::integer as count from public.trip_members')).count, 0);
});

test('owners can inspect only safe invitation metadata', async () => {
  await as('authenticated', owner);
  const invites = await db.query('select * from public.list_trip_invites($1)', [tripId]);
  assert.ok(invites.rows.length > 0);
  assert.deepEqual(Object.keys(invites.rows[0]).sort(), ['created_at', 'expires_at', 'id', 'last_used_at', 'max_uses', 'revoked_at', 'role', 'use_count']);
});

test('more than two devices can be authorized without downgrading an existing owner', async () => {
  const invite = await newInvite({ uses: 2 });
  await as('authenticated', owner);
  await row('select public.redeem_trip_invite($1)', [invite.token]);
  assert.equal((await row('select role from public.trip_members where trip_id=$1', [tripId])).role, 'owner');
  await as('authenticated', anotherDevice);
  await row('select public.redeem_trip_invite($1)', [invite.token]);
  await as('postgres');
  assert.equal((await row('select count(*)::integer as count from public.trip_members where trip_id=$1', [tripId])).count, 3);
});

test('activities persist precise centavos and the same instant across display timezones', async () => {
  await as('authenticated', owner);
  const saved = await save({ name: '  Jantar especial  ', type: 'Refeição', budget: 15001, starts: '2026-10-10T12:00:00-03:00' });
  assert.equal(saved.name, 'Jantar especial');
  assert.equal(Number(saved.budget_cents), 15001);
  assert.equal(saved.version, 1);
  await db.exec("set timezone='Asia/Tokyo'");
  const result = await row("select to_char(starts_at at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI') as local_time, extract(epoch from starts_at)::bigint as epoch from public.activities where id=$1", [activityId]);
  assert.equal(result.local_time, '2026-10-10 12:00');
  assert.equal(Number(result.epoch), Date.parse('2026-10-10T15:00:00Z') / 1000);
});

test('a successful creation retry with the same UUID/data never inserts a duplicate', async () => {
  await as('authenticated', owner);
  const again = await save({ name: 'Jantar especial', type: 'Refeição', budget: 15001 });
  assert.equal(again.version, 1);
  assert.equal((await row('select count(*)::integer as count from public.activities where id=$1', [activityId])).count, 1);
  await assert.rejects(save({ name: 'Different data' }), /VERSION_CONFLICT/);
});

test('members cannot write activities or trip fields directly', async () => {
  await as('authenticated', owner);
  await fails("update public.activities set name='Bypass' where id=$1", [activityId]);
  await fails('delete from public.activities where id=$1', [activityId]);
  await fails("insert into public.activities(id,trip_id,starts_at,name,type) values($1,$2,now(),'Bypass','Lazer')", [otherActivityId, tripId]);
  await fails("update public.trips set name='Bypass' where id=$1", [tripId]);
});

test('a member can update at the current version; stale and missing records conflict', async () => {
  await as('authenticated', member);
  const changed = await save({ version: 1, name: 'Jantar revisado', type: 'Refeição', budget: 16000 });
  assert.equal(changed.version, 2);
  await as('authenticated', owner);
  await assert.rejects(save({ version: 1, name: 'Lost edit' }), /VERSION_CONFLICT/);
  await assert.rejects(save({ id: otherActivityId, version: 1 }), /VERSION_CONFLICT/);
  assert.equal((await row('select name from public.activities where id=$1', [activityId])).name, 'Jantar revisado');
});

test('budget null and zero remain distinct and calculations use stored integers', async () => {
  await as('authenticated', member);
  const missing = await save({ id: '20000000-0000-4000-8000-000000000003', budget: null });
  const free = await save({ id: '20000000-0000-4000-8000-000000000004', budget: 0 });
  assert.equal(missing.budget_cents, null);
  assert.equal(Number(free.budget_cents), 0);
  const summary = await row('select sum(budget_cents)::bigint as total, count(*) filter(where budget_cents is null)::integer as undefined from public.activities where trip_id=$1', [tripId]);
  assert.equal(Number(summary.total), 16000);
  assert.equal(summary.undefined, 1);
});

test('database constraints reject invalid names, types, budgets, and non-finite instants', async () => {
  await as('authenticated', owner);
  const id = '20000000-0000-4000-8000-000000000005';
  for (const input of [{ name: '   ' }, { name: '\t\n' }, { name: '\u00a0\u2003' }, { type: 'Hotel' }, { budget: -1 }, { budget: 1000000000000 }, { starts: 'infinity' }]) {
    await assert.rejects(save({ id, ...input }), /check constraint|not-null constraint/);
  }
});

test('two activities may share a time and past instants remain editable', async () => {
  await as('authenticated', owner);
  const saved = await save({ id: '20000000-0000-4000-8000-000000000006', starts: '2000-01-01T15:00:00Z' });
  assert.equal(saved.version, 1);
  assert.ok((await row('select count(*)::integer as count from public.activities where starts_at=$1', ['2026-10-10T15:00:00Z'])).count >= 2);
});

test('Google places retain only a place ID; manual Google Maps links are validated', async () => {
  await as('authenticated', owner);
  const google = await save({ id: '20000000-0000-4000-8000-000000000007', place: 'ChIJvalidReference' });
  assert.equal(google.place_id, 'ChIJvalidReference');
  assert.equal(google.manual_place_name, null);
  await assert.rejects(save({ id: otherActivityId, place: 'ChIJreference', manualName: 'Returned API name' }), /place_source_exclusive/);
  await assert.rejects(save({ id: otherActivityId, manualUrl: 'https://www.google.com.evil.test/maps/place/a' }), /manual_maps_url_valid/);
  await assert.rejects(save({ id: otherActivityId, manualUrl: 'javascript:alert(1)' }), /manual_maps_url_valid/);
  const manual = await save({ id: otherActivityId, manualName: '  Lugar informado  ', manualUrl: 'https://maps.app.goo.gl/Example' });
  assert.equal(manual.manual_place_name, 'Lugar informado');
  assert.equal(manual.place_id, null);
});

test('trip settings validate period/timezone and use optimistic concurrency', async () => {
  await as('authenticated', owner);
  const updateSql = 'select * from public.update_trip($1,$2,$3,$4,$5,$6,$7,$8,$9)';
  const values = [tripId, 1, 'Nossa aventura', null, '2026-10-10', '2026-10-15', 'America/Sao_Paulo', null, null];
  const changed = await row(updateSql, values);
  assert.equal(changed.version, 2);
  await fails(updateSql, values, /VERSION_CONFLICT/);
  await fails(updateSql, [tripId, 2, 'Nossa aventura', null, '2026-10-15', '2026-10-10', 'America/Sao_Paulo', null, null], /trip_period_order/);
  await fails(updateSql, [tripId, 2, 'Nossa aventura', null, null, null, 'Unknown/Zone', null, null], /INVALID_TIMEZONE/);
});

test('activity changes signal the trip without causing conflicts in unrelated trip settings', async () => {
  await as('authenticated', owner);
  const before = await row('select version from public.trips where id=$1', [tripId]);
  await save({ version: 2, name: 'Jantar mais tarde', starts: '2026-10-10T16:00:00Z', type: 'Refeição', budget: 16000 });
  const after = await row('select version from public.trips where id=$1', [tripId]);
  assert.equal(after.version, before.version);
  await as('postgres');
  const published = await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'");
  assert.deepEqual(published.rows.map((item) => item.tablename), ['trips']);
});

test('deletion requires the current version and removes the record from totals', async () => {
  await as('authenticated', owner);
  await fails('select public.delete_activity($1,$2)', [activityId, 2], /VERSION_CONFLICT/);
  await row('select public.delete_activity($1,$2)', [activityId, 3]);
  assert.equal((await row('select count(*)::integer as count from public.activities where id=$1', [activityId])).count, 0);
  assert.equal(Number((await row('select coalesce(sum(budget_cents),0)::bigint as total from public.activities where trip_id=$1', [tripId])).total), 0);
});

test('knowing another trip/activity UUID never grants cross-trip read or write', async () => {
  await as('postgres');
  await db.query("insert into public.activities(id,trip_id,starts_at,name,type) values('30000000-0000-4000-8000-000000000001',$1,now(),'Secret','Atividade')", [otherTripId]);
  await as('authenticated', member);
  assert.equal((await row('select count(*)::integer as count from public.trips where id=$1', [otherTripId])).count, 0);
  assert.equal((await row('select count(*)::integer as count from public.activities where trip_id=$1', [otherTripId])).count, 0);
  await assert.rejects(save({ trip: otherTripId }), /ACCESS_DENIED/);
  await fails('select public.delete_activity($1,$2)', ['30000000-0000-4000-8000-000000000001', 1]);
  await fails('select * from public.update_trip($1,1,\'Intrusion\',null,null,null,\'America/Sao_Paulo\',null,null)', [otherTripId]);
});

test('service-only recovery grants a new owner of the same trip without exposing bootstrap to visitors', async () => {
  await as('service_role');
  const recovery = await row('select * from public.provision_trip_owner($1)', [tripId]);
  assert.equal(recovery.trip_id, tripId);
  await as('authenticated', stranger);
  await row('select public.redeem_trip_invite($1)', [recovery.token]);
  assert.equal((await row('select role from public.trip_members where trip_id=$1', [tripId])).role, 'owner');
  await fails('select * from public.provision_trip_owner($1)', [tripId]);
});

test('OSM places persist real metadata and coordinates with idempotent replay and version checks', async () => {
  await as('authenticated', owner);
  const input = { id: '20000000-0000-4000-8000-000000000010', osmId: 'W/372720167', osmName: '  Museu do Amanhã  ', osmAddress: 'Praça Mauá, 1', lat: -22.8940683, lon: -43.1794045 };
  const result = await save(input);
  assert.equal(result.osm_place_name, 'Museu do Amanhã');
  assert.equal(result.osm_latitude, input.lat);
  assert.equal(result.osm_longitude, input.lon);
  assert.equal(result.manual_place_name, null);
  assert.equal(result.place_id, null);
  assert.equal((await save(input)).version, 1);
  await assert.rejects(save({ ...input, lat: -22 }), /VERSION_CONFLICT/);
  assert.equal((await save({ ...input, version: 1, osmName: 'Nome revisado' })).version, 2);
  await assert.rejects(save({ ...input, version: 1 }), /VERSION_CONFLICT/);
});

test('OSM partial, nonfinite, malformed and mixed sources are rejected by the database', async () => {
  await as('authenticated', owner);
  const input = { id: '20000000-0000-4000-8000-000000000011', osmId: 'N/123', osmName: 'Lugar real', lat: 0, lon: 0 };
  for (const change of [{ lat: null }, { lon: null }, { lat: 91 }, { lon: -181 }, { lat: 'NaN' }, { lon: 'Infinity' }, { osmName: null }, { osmId: 'X/123' }, { osmId: 'N/0' }, { osmId: null }, { osmAddress: 'x'.repeat(1001) }]) {
    await assert.rejects(save({ ...input, ...change }), /osm_place_valid/);
  }
  for (const change of [{ manualName: 'Manual' }, { place: 'legacy' }]) await assert.rejects(save({ ...input, ...change }), /place_source_exclusive/);
  await as('anon');
  await assert.rejects(save(input), /permission denied/);
  await as('authenticated', member);
  await assert.rejects(save({ ...input, trip: otherTripId }), /ACCESS_DENIED/);
});

test('OSM manual links are allowed only on known hosts and map paths', async () => {
  await as('authenticated', owner);
  const id = '20000000-0000-4000-8000-000000000012';
  for (const manualUrl of ['https://openstreetmap.org.evil.test/node/123', 'https://user@www.openstreetmap.org/', 'https://www.openstreetmap.org/login', 'http://www.openstreetmap.org/', 'https://www.openstreetmap.org:8443/']) await assert.rejects(save({ id, manualUrl }), /manual_maps_url_valid/);
  const result = await save({ id, manualUrl: 'https://www.openstreetmap.org/?mlat=0&mlon=0#map=17/0/0' });
  assert.equal(result.osm_latitude, null, 'a typed link never invents coordinates');
  assert.equal(result.osm_place_id, null);
  assert.match(result.manual_place_url, /openstreetmap/);
});

test('open access upgrade preserves records and selects one shared trip for every visitor', async () => {
  await as('postgres');
  const beforeTrips = (await row('select count(*)::int as n from public.trips')).n;
  const beforeActivities = (await row('select count(*)::int as n from public.activities')).n;
  const migration = await readFile(new URL('../migrations/202610080003_acesso_livre.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  assert.equal((await row('select trip_id from private.shared_trip')).trip_id, tripId);
  assert.equal((await row('select count(*)::int as n from public.trips')).n, beforeTrips);
  assert.equal((await row('select count(*)::int as n from public.activities')).n, beforeActivities);
  await db.exec(migration);
  assert.equal((await row('select count(*)::int as n from private.shared_trip')).n, 1);
  await db.exec("insert into auth.users(id) values('10000000-0000-4000-8000-000000000005'),('10000000-0000-4000-8000-000000000006')");
});

test('new anonymous sessions join automatically, without invitations, and share CRUD with version checks', async () => {
  const first = '10000000-0000-4000-8000-000000000005';
  const second = '10000000-0000-4000-8000-000000000006';
  await as('authenticated', first);
  const opened = await row('select * from public.open_shared_trip()');
  assert.equal(opened.trip_id, tripId);
  assert.equal(opened.role, 'member');
  assert.deepEqual(await row('select * from public.open_shared_trip()'), opened);
  assert.equal((await row('select count(*)::int as n from public.trip_members where user_id=$1', [first])).n, 1);
  const id = '20000000-0000-4000-8000-000000000020';
  const saved = await save({ id, name: 'Livre', budget: 1500 });
  await as('authenticated', second);
  assert.equal((await row('select * from public.open_shared_trip()')).trip_id, tripId);
  assert.equal((await row('select name from public.activities where id=$1', [id])).name, 'Livre');
  assert.equal((await save({ id, version: saved.version, name: 'Livre revisado' })).version, 2);
  await assert.rejects(save({ id, version: 1 }), /VERSION_CONFLICT/);
  const currentTrip = await row('select * from public.trips where id=$1', [tripId]);
  const changed = await row('select * from public.update_trip($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tripId,currentTrip.version,'Nossa viagem aberta',currentTrip.destination,currentTrip.start_date,currentTrip.end_date,currentTrip.timezone,currentTrip.person_one,currentTrip.person_two]);
  assert.equal(changed.version, currentTrip.version + 1);
  await row('select public.delete_activity($1,2)', [id]);
  assert.equal((await row('select count(*)::int as n from public.activities where id=$1', [id])).n, 0);
});

test('open mode disables invite RPCs and keeps internal config, other trips and raw writes restricted', async () => {
  await as('anon');
  await fails('select * from public.open_shared_trip()');
  await as('authenticated', '10000000-0000-4000-8000-000000000005');
  await fails('select * from private.shared_trip');
  await fails("update public.trips set name='Raw write' where id=$1", [tripId]);
  await fails('select * from public.create_trip_invite($1)', [tripId]);
  await fails('select * from public.list_trip_invites($1)', [tripId]);
  await fails('select public.redeem_trip_invite($1)', [ownerToken]);
  await assert.rejects(save({ trip: otherTripId }), /ACCESS_DENIED/);
  await as('postgres');
  assert.equal((await row("select relrowsecurity from pg_class where oid='private.shared_trip'::regclass")).relrowsecurity, true);
});

test('expense migration applies after 003, re-runs safely, preserves data and protects the new table with RLS', async () => {
  await as('postgres');
  const beforeTrips = (await row('select count(*)::int as n from public.trips')).n;
  const beforeActivities = (await row('select count(*)::int as n from public.activities')).n;
  const migration = await readFile(new URL('../migrations/202610080004_gastos.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.equal((await row('select count(*)::int as n from public.trips')).n, beforeTrips);
  assert.equal((await row('select count(*)::int as n from public.activities')).n, beforeActivities);
  const tables = await db.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname");
  assert.deepEqual(tables.rows.map((item) => item.relname), ['activities', 'trip_expenses', 'trip_invites', 'trip_members', 'trips']);
  assert.ok(tables.rows.every((item) => item.relrowsecurity));
  assert.equal((await row("select count(*)::int as n from pg_policies where schemaname='public' and tablename='trip_expenses'")).n, 1);
  assert.equal((await row("select count(*)::int as n from pg_policies where schemaname='public' and tablename='trip_expenses' and 'anon' = any(roles)")).n, 0);
  assert.deepEqual((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows.map((item) => item.tablename), ['trips']);
  // A Windows-1252 client stores the UTF-8 bytes of í (C3 AD) as two characters.
  await db.exec('alter table public.trip_expenses drop constraint trip_expenses_category_check');
  await db.exec(`alter table public.trip_expenses add constraint trip_expenses_category_check check (category in ('Combust' || chr(195) || chr(173) || 'vel', 'Hospedagem', 'Alimenta' || chr(195) || chr(167) || chr(195) || chr(163) || 'o', 'Transporte', 'Passeios e lazer', 'Compras', 'Outros'))`);
  const brokenId = '40000000-0000-4000-8000-000000000099';
  await db.query(`insert into public.trip_expenses(id, trip_id, description, category, amount_cents, expense_date) values ($1, $2, 'Gasolina', 'Combust' || chr(195) || chr(173) || 'vel', 60000, '2026-11-08')`, [brokenId, tripId]);
  await db.exec(migration);
  assert.equal((await row('select category from public.trip_expenses where id=$1', [brokenId])).category, 'Combustível');
  await db.query('delete from public.trip_expenses where id=$1', [brokenId]);
  await as('authenticated', member);
  await assert.rejects(db.query("select public.save_expense($1,$2,0,'Gasolina','Combustivel',100,'2026-11-08',null,null)", [tripId, '40000000-0000-4000-8000-000000000098']), /trip_expenses_category_check/);
  await as('postgres');
  await db.exec(`insert into auth.users(id) values('${outsider}')`);
});

test('members register fuel, prepaid lodging and meals without schedule activities; totals ignore budgets', async () => {
  await as('authenticated', member);
  const activitiesBefore = (await row('select count(*)::int as n from public.activities where trip_id=$1', [tripId])).n;
  const fuel = await spend({ description: '  Gasolina — viagem de ida  ', notes: '   ' });
  assert.equal(fuel.description, 'Gasolina — viagem de ida');
  assert.equal(fuel.notes, null);
  assert.equal(fuel.version, 1);
  assert.equal(fuel.activity_id, null);
  const lodging = await spend({ id: lodgingId, description: 'Airbnb — hospedagem', category: 'Hospedagem', amount: 60000, date: '2026-09-20', notes: '  Hospedagem já paga antecipadamente  ' });
  assert.equal(lodging.notes, 'Hospedagem já paga antecipadamente');
  await spend({ id: lunchId, description: 'Almoço de domingo', category: 'Alimentação', amount: 8000, date: '2026-10-11' });
  assert.deepEqual(await expenseTotal(), { total: 88000, count: 3 }, 'R$ 200,00 + R$ 600,00 + R$ 80,00 = R$ 880,00, including the prepaid lodging');
  assert.equal((await row('select count(*)::int as n from public.activities where trip_id=$1', [tripId])).n, activitiesBefore, 'expenses never create activities');
  const dinner = await save({ id: dinnerId, name: 'Jantar especial', type: 'Refeição', budget: 15000, starts: '2026-10-11T22:00:00Z' });
  assert.equal(Number(dinner.budget_cents), 15000);
  assert.deepEqual(await expenseTotal(), { total: 88000, count: 3 }, 'a planned budget never enters the expense total');
  const byCategory = await db.query('select category, sum(amount_cents)::bigint as total from public.trip_expenses where trip_id=$1 group by category order by category', [tripId]);
  assert.deepEqual(byCategory.rows.map((item) => [item.category, Number(item.total)]), [['Alimentação', 8000], ['Combustível', 20000], ['Hospedagem', 60000]]);
});

test('the expense date is stored as a calendar date, unchanged by the session timezone', async () => {
  await as('authenticated', member);
  for (const zone of ['Asia/Tokyo', 'Pacific/Honolulu', 'UTC']) {
    await db.exec(`set timezone='${zone}'`);
    if (zone === 'Asia/Tokyo') await spend({ id: tollId, description: 'Pedágio', category: 'Transporte', amount: 1230, date: '2026-10-05' });
    assert.equal((await row("select to_char(expense_date,'YYYY-MM-DD') as day from public.trip_expenses where id=$1", [tollId])).day, '2026-10-05');
  }
  assert.deepEqual(await expenseTotal(), { total: 89230, count: 4 });
});

test('an expense retry with the same UUID/data never duplicates; different data and stale versions conflict', async () => {
  await as('authenticated', member);
  const replay = await spend();
  assert.equal(replay.version, 1);
  assert.equal((await row('select count(*)::int as n from public.trip_expenses where id=$1', [fuelId])).n, 1);
  await assert.rejects(spend({ amount: 20001 }), /VERSION_CONFLICT/);
  await as('authenticated', owner);
  const changed = await spend({ version: 1, amount: 21000, notes: 'Abastecimento antes de sair' });
  assert.equal(changed.version, 2);
  assert.equal(Number(changed.amount_cents), 21000);
  await as('authenticated', member);
  await assert.rejects(spend({ version: 1, amount: 22000 }), /VERSION_CONFLICT/);
  await assert.rejects(spend({ id: '40000000-0000-4000-8000-000000000099', version: 1 }), /VERSION_CONFLICT/);
  assert.equal(Number((await row('select amount_cents from public.trip_expenses where id=$1', [fuelId])).amount_cents), 21000);
  assert.deepEqual(await expenseTotal(), { total: 90230, count: 4 });
});

test('linking an expense to an activity keeps the total and requires an activity of the same trip, also at the database level', async () => {
  await as('authenticated', member);
  const before = await expenseTotal();
  const linked = await spend({ id: lunchId, version: 1, description: 'Almoço de domingo', category: 'Alimentação', amount: 8000, date: '2026-10-11', activity: dinnerId });
  assert.equal(linked.activity_id, dinnerId);
  assert.equal(linked.version, 2);
  assert.deepEqual(await expenseTotal(), before, 'linking creates no second expense');
  const dinner = await row('select budget_cents, version from public.activities where id=$1', [dinnerId]);
  assert.equal(Number(dinner.budget_cents), 15000, 'the activity budget is untouched');
  assert.equal(dinner.version, 1);
  await assert.rejects(spend({ id: '40000000-0000-4000-8000-000000000005', activity: secretActivityId }), /EXPENSE_ACTIVITY_MISMATCH/);
  await assert.rejects(spend({ id: '40000000-0000-4000-8000-000000000005', activity: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }), /EXPENSE_ACTIVITY_MISMATCH/);
  await fails('update public.trip_expenses set activity_id=$2 where id=$1', [lunchId, secretActivityId]);
  await as('postgres');
  await fails('update public.trip_expenses set activity_id=$2 where id=$1', [lunchId, secretActivityId], /EXPENSE_ACTIVITY_MISMATCH/);
  await fails('update public.trip_expenses set trip_id=$2 where id=$1', [lunchId, otherTripId], /EXPENSE_TRIP_IMMUTABLE/);
  assert.equal((await row('select activity_id from public.trip_expenses where id=$1', [lunchId])).activity_id, dinnerId);
});

test('database constraints reject blank descriptions, unknown categories, non-positive amounts and oversized text', async () => {
  await as('authenticated', owner);
  const id = '40000000-0000-4000-8000-000000000006';
  for (const input of [{ description: '   ' }, { description: '\t\n' }, { description: '\u00a0\u2003' }, { description: 'x'.repeat(201) }, { category: 'Hotel' }, { category: 'Refeição' },
    { amount: 0 }, { amount: -1 }, { amount: 1000000000000 }, { date: 'infinity' }, { notes: 'n'.repeat(2001) }]) {
    await assert.rejects(spend({ id, ...input }), /check constraint|not-null constraint/);
  }
  await assert.rejects(spend({ id, amount: null }), /not-null constraint/);
  await assert.rejects(spend({ id, date: null }), /not-null constraint/);
  await assert.rejects(spend({ id, description: null }), /not-null constraint/);
  assert.equal((await row('select count(*)::int as n from public.trip_expenses where id=$1', [id])).n, 0);
});

test('deleting a linked activity preserves its expenses; deleting an expense never touches the activity', async () => {
  await as('authenticated', member);
  const before = await expenseTotal();
  await row('select public.delete_activity($1,$2)', [dinnerId, 1]);
  const lunch = await row('select activity_id, amount_cents, version from public.trip_expenses where id=$1', [lunchId]);
  assert.equal(lunch.activity_id, null, 'only the link is removed');
  assert.equal(Number(lunch.amount_cents), 8000);
  assert.deepEqual(await expenseTotal(), before, 'the expense total is unchanged after deleting the activity');
  const walk = await save({ id: '20000000-0000-4000-8000-000000000031', name: 'Passeio no parque', type: 'Lazer', budget: null });
  const tickets = await spend({ id: '40000000-0000-4000-8000-000000000007', description: 'Ingressos do passeio', category: 'Passeios e lazer', amount: 5000, date: '2026-10-12', activity: walk.id });
  await fails('select public.delete_expense($1,$2)', [tickets.id, 7], /VERSION_CONFLICT/);
  await row('select public.delete_expense($1,$2)', [tickets.id, tickets.version]);
  assert.equal((await row('select count(*)::int as n from public.trip_expenses where id=$1', [tickets.id])).n, 0);
  const activity = await row('select name, version, budget_cents from public.activities where id=$1', [walk.id]);
  assert.equal(activity.name, 'Passeio no parque');
  assert.equal(activity.version, 1);
  assert.equal(activity.budget_cents, null, 'an absent budget is not turned into zero by expenses');
  assert.deepEqual(await expenseTotal(), before);
});

test('outsiders and anonymous visitors cannot read or modify expenses, and expenses never cross trips', async () => {
  await as('postgres');
  await db.query("insert into public.trip_expenses(id,trip_id,description,category,amount_cents,expense_date) values('40000000-0000-4000-8000-000000000050',$1,'Secreto','Outros',100,'2026-10-01')", [otherTripId]);
  await as('authenticated', outsider);
  assert.equal((await row('select count(*)::int as n from public.trip_expenses')).n, 0);
  await assert.rejects(spend({ id: '40000000-0000-4000-8000-000000000051' }), /ACCESS_DENIED/);
  await fails('select public.delete_expense($1,$2)', [fuelId, 2]);
  await as('anon');
  await fails('select * from public.trip_expenses');
  await assert.rejects(spend({ id: '40000000-0000-4000-8000-000000000051' }), /permission denied/);
  await fails('select public.delete_expense($1,$2)', [fuelId, 2], /permission denied/);
  await as('authenticated', member);
  assert.equal((await row('select count(*)::int as n from public.trip_expenses where trip_id=$1', [otherTripId])).n, 0);
  await fails("insert into public.trip_expenses(id,trip_id,description,category,amount_cents,expense_date) values('40000000-0000-4000-8000-000000000052',$1,'Direto','Outros',100,'2026-10-01')", [tripId]);
  await fails('delete from public.trip_expenses where id=$1', [fuelId]);
  await assert.rejects(spend({ id: '40000000-0000-4000-8000-000000000053', trip: otherTripId }), /ACCESS_DENIED/);
  await assert.rejects(spend({ id: fuelId, version: 2, trip: otherTripId, amount: 21000 }), /ACCESS_DENIED/, 'trip_id cannot be used to move an expense');
  await fails('select public.delete_expense($1,$2)', ['40000000-0000-4000-8000-000000000050', 1]);
  assert.equal((await row('select trip_id from public.trip_expenses where id=$1', [fuelId])).trip_id, tripId);
  await as('postgres');
  assert.equal((await row('select count(*)::int as n from public.trip_expenses where trip_id=$1', [otherTripId])).n, 1);
});

test('expense changes signal the trip for synchronization without changing trip settings versions', async () => {
  await as('authenticated', member);
  const before = await row('select version, updated_at from public.trips where id=$1', [tripId]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await spend({ id: '40000000-0000-4000-8000-000000000008', description: 'Estacionamento do passeio', category: 'Transporte', amount: 1500, date: '2026-10-12' });
  const after = await row('select version, updated_at from public.trips where id=$1', [tripId]);
  assert.equal(after.version, before.version);
  assert.ok(new Date(after.updated_at) > new Date(before.updated_at));
});

test('fresh open installation creates exactly one empty shared trip for all sessions', async () => {
  const fresh = new PGlite({ extensions: { pgcrypto } });
  try {
    await fresh.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create schema extensions; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      grant usage on schema public,auth,extensions to anon,authenticated,service_role;
      insert into auth.users(id) values('${owner}'),('${member}'); create publication supabase_realtime;`);
    for (const filename of ['202610080001_nossa_viagem.sql','202610080002_openstreetmap.sql','202610080003_acesso_livre.sql','202610080004_gastos.sql']) await fresh.exec(await readFile(new URL(`../migrations/${filename}`,import.meta.url),'utf8'));
    const created = (await fresh.query('select * from public.trips')).rows;
    assert.equal(created.length, 1);
    assert.equal(created[0].destination, null);
    assert.equal((await fresh.query('select count(*)::int as n from public.trip_expenses')).rows[0].n, 0, 'no fictitious expenses are seeded');
    assert.equal((await fresh.query("select relrowsecurity from pg_class where oid='public.trip_expenses'::regclass")).rows[0].relrowsecurity, true);
    await fresh.exec('set role authenticated');
    for (const user of [owner,member]) {
      await fresh.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      const opened = (await fresh.query('select * from public.open_shared_trip()')).rows[0];
      assert.equal(opened.trip_id, created[0].id);
    }
    assert.equal((await fresh.query('select count(*)::int as n from public.activities')).rows[0].n, 0);
    assert.equal((await fresh.query('select count(*)::int as n from public.trips')).rows[0].n, 1);
  } finally { await fresh.close(); }
});