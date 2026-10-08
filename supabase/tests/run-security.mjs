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
