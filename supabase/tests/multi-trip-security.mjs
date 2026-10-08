import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Every record below exists only in this isolated local PostgreSQL fixture.
const db = new PGlite({ extensions: { pgcrypto } });
const owner = '10000000-0000-4000-8000-000000000101';
const tripMember = '10000000-0000-4000-8000-000000000102';
const collectionMember = '10000000-0000-4000-8000-000000000103';
const outsider = '10000000-0000-4000-8000-000000000104';
const tripOnlyDevice = '10000000-0000-4000-8000-000000000105';
const collectionOwnerDevice = '10000000-0000-4000-8000-000000000106';
const exhaustedDevice = '10000000-0000-4000-8000-000000000107';
const legacyTrip = '20000000-0000-4000-8000-000000000101';
const unownedTrip = '20000000-0000-4000-8000-000000000102';
const legacyActivity = '30000000-0000-4000-8000-000000000101';
const legacyExpense = '40000000-0000-4000-8000-000000000101';
const secondTrip = '20000000-0000-4000-8000-000000000103';
let collectionId;
let second;
async function as(role, user = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [user, role]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
async function rows(sql, values = []) { return (await db.query(sql, values)).rows; }
async function row(sql, values = []) { return (await rows(sql, values))[0]; }
async function create({ id = secondTrip, collection = collectionId, name = 'Outra aventura', destination = null,
  start = null, end = null, timezone = 'America/Sao_Paulo', budget = 0 } = {}) {
  return row('select * from public.create_private_trip($1,$2,$3,$4,$5,$6,$7,null,null,$8)',
    [id, collection, name, destination, start, end, timezone, budget]);
}
async function saveActivity(trip, id, budget = 10000) {
  return row("select * from public.save_activity($1,$2,0,'2026-10-10T15:00:00Z',$3,'Passeio','Lazer',null,null,null,null,null,null,null,null,null)", [trip, id, budget]);
}
async function spend(trip, id, amount = 5000, activity = null) {
  return row("select * from public.save_expense($1,$2,0,'Pagamento antecipado','Outros',$3,'2020-01-01',$4,null)", [trip,id,amount,activity]);
}
const migrationUrl = new URL('../migrations/202610080006_multiplas_viagens.sql', import.meta.url);

before(async () => {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema public,auth,extensions to anon,authenticated,service_role;
    insert into auth.users(id) values('${owner}'),('${tripMember}'),('${collectionMember}'),('${outsider}'),('${tripOnlyDevice}'),('${collectionOwnerDevice}'),('${exhaustedDevice}');
    create publication supabase_realtime;`);
  for (const filename of ['202610080001_nossa_viagem.sql','202610080002_openstreetmap.sql'])
    await db.exec(await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8'));
  await db.exec(`insert into public.trips(id,name) values('${legacyTrip}','Viagem preservada'),('${unownedTrip}','Sem proprietário original');
    insert into public.trip_members(trip_id,user_id,role) values('${legacyTrip}','${owner}','owner'),('${legacyTrip}','${tripMember}','member'),('${unownedTrip}','${tripMember}','member');
    insert into public.activities(id,trip_id,starts_at,name,type,budget_cents) values('${legacyActivity}','${legacyTrip}',now(),'Registro original','Lazer',12000);`);
  for (const filename of ['202610080003_acesso_livre.sql','202610080004_gastos.sql','202610080005_orcamento_inicial.sql'])
    await db.exec(await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8'));
  await db.exec(`insert into public.trip_expenses(id,trip_id,description,category,amount_cents,expense_date,activity_id)
    values('${legacyExpense}','${legacyTrip}','Registro preservado','Outros',8000,'2020-01-01','${legacyActivity}');`);
  await db.exec(await readFile(migrationUrl,'utf8'));
  collectionId = (await row('select collection_id from public.trips where id=$1',[legacyTrip])).collection_id;
});
after(async () => { await db.close(); });

test('incremental migration preserves IDs, data, budgets and original authorization scopes on repeated execution', async () => {
  await as('postgres');
  for (let run = 0; run < 2; run += 1) await db.exec(await readFile(migrationUrl, 'utf8'));
  assert.equal((await row('select count(*)::int as n from public.trips')).n,2);
  assert.equal((await row('select count(*)::int as n from public.trip_collections')).n,2);
  assert.equal((await row('select collection_id from public.trips where id=$1',[legacyTrip])).collection_id,collectionId);
  assert.equal((await row('select initial_budget_cents from public.trips where id=$1',[legacyTrip])).initial_budget_cents,null);
  assert.equal(Number((await row('select budget_cents from public.activities where id=$1',[legacyActivity])).budget_cents),12000);
  const expense = await row('select * from public.trip_expenses where id=$1',[legacyExpense]);
  assert.equal(expense.activity_id,legacyActivity);
  assert.equal(Number(expense.amount_cents),8000);
  assert.equal((await row('select count(*)::int as n from public.trip_members')).n,3);
  assert.deepEqual(await rows('select user_id,role from public.collection_members'),[]);
  assert.ok((await rows("select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'")).every((r) => r.relrowsecurity));
  await as('authenticated',tripMember);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,0);
  assert.equal((await rows('select * from public.list_authorized_trips()')).length,2);
  assert.equal((await row('select private.is_collection_member($1) as yes',[collectionId])).yes,false);
  await as('authenticated',owner);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,0,'an old owner invite never gains broader collection access');
  assert.equal((await row('select private.is_trip_owner($1) as yes',[legacyTrip])).yes,true);
  assert.equal((await row('select * from public.list_authorized_trips()')).collection_role,null);
});

test('the old automatic public association is disabled and knowing IDs reveals no private data', async () => {
  await as('authenticated',outsider);
  assert.equal((await rows('select * from public.trips')).length,0);
  assert.equal((await rows('select * from public.activities')).length,0);
  assert.equal((await rows('select * from public.trip_expenses')).length,0);
  assert.equal((await rows('select * from public.list_authorized_trips()')).length,0);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,0);
  await assert.rejects(db.query('select * from public.open_shared_trip()'),/permission denied/);
  await assert.rejects(create({id:'20000000-0000-4000-8000-000000000110'}),/ACCESS_DENIED/);
  await assert.rejects(saveActivity(legacyTrip,'30000000-0000-4000-8000-000000000110'),/ACCESS_DENIED/);
  await assert.rejects(db.query('select * from public.set_trip_archived($1,1,true)',[legacyTrip]),/ACCESS_DENIED/);
  await assert.rejects(db.query('select * from public.provision_collection_owner($1)',[legacyTrip]),/permission denied/);
  await as('anon');
  for(const sql of ['select * from public.trips','select * from public.list_authorized_trips()','select * from public.collection_members','select * from public.list_authorized_collections()'])
    await assert.rejects(db.query(sql),/permission denied/);
});

test('legacy collection access is granted only through explicit service recovery and a scoped new invite', async () => {
  await as('authenticated',owner);
  await assert.rejects(db.query('select * from public.create_collection_invite($1)',[collectionId]),/ACCESS_DENIED/);
  await assert.rejects(create({id:'20000000-0000-4000-8000-000000000109'}),/ACCESS_DENIED/);
  await as('service_role');
  const recovery=await row('select * from public.provision_collection_owner($1)',[legacyTrip]);
  assert.equal(recovery.collection_id,collectionId);
  await as('authenticated',owner);
  assert.equal((await row('select public.redeem_collection_invite($1) as id',[recovery.token])).id,collectionId);
  assert.equal((await row('select private.is_collection_owner($1) as yes',[collectionId])).yes,true);
  assert.equal((await row('select * from public.list_authorized_trips()')).collection_role,'owner');
});

test('atomic second-trip creation starts empty and idempotent retries do not duplicate a trip or collection', async () => {
  await as('authenticated',owner);
  second = await create();
  assert.equal(second.initial_budget_cents === null,false);
  assert.equal(Number(second.initial_budget_cents),0);
  assert.equal(second.collection_id,collectionId);
  assert.equal((await rows('select * from public.activities where trip_id=$1',[secondTrip])).length,0);
  assert.equal((await rows('select * from public.trip_expenses where trip_id=$1',[secondTrip])).length,0);
  assert.equal((await row('select initial_budget_cents from public.trips where id=$1',[legacyTrip])).initial_budget_cents,null);
  assert.equal((await create()).id,secondTrip);
  await assert.rejects(create({name:'Uma duplicata diferente'}),/VERSION_CONFLICT/);
  await as('postgres');
  assert.equal((await row('select count(*)::int as n from public.trips')).n,3);
  assert.equal((await row('select count(*)::int as n from public.trip_collections')).n,2);
  await as('authenticated',tripMember);
  assert.equal((await rows('select * from public.trips where id=$1',[secondTrip])).length,0,'legacy member retains access only to original trips');
});

test('new anonymous identity creates one private collection with a secure owner and rollback leaves no orphan', async () => {
  await as('authenticated',outsider);
  const freshId='20000000-0000-4000-8000-000000000111';
  const created = await create({id:freshId,collection:null,name:'Coleção privada nova',budget:50000});
  assert.notEqual(created.collection_id,collectionId);
  assert.equal((await create({id:freshId,collection:null,name:'Coleção privada nova',budget:50000})).id,freshId);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,1);
  assert.equal((await row('select role from public.trip_members where trip_id=$1',[freshId])).role,'owner');
  await as('postgres');
  const before = (await row('select count(*)::int as n from public.trip_collections')).n;
  await as('authenticated',outsider);
  const invalidId='20000000-0000-4000-8000-000000000112';
  for(const invalid of [{name:'\u00a0\t '},{budget:null},{budget:-1},{start:'2026-10-10',end:'2026-10-09'},{timezone:'Invalid/Zone'}])
    await assert.rejects(create({id:invalidId,collection:null,...invalid}),/check constraint|INVALID_INITIAL_BUDGET|INVALID_TIMEZONE/);
  await as('postgres');
  assert.equal((await row('select count(*)::int as n from public.trip_collections')).n,before);
  assert.equal((await rows('select * from public.trips where id=$1',[invalidId])).length,0);
  await as('authenticated',owner);
  assert.equal((await rows('select * from public.trips where id=$1',[freshId])).length,0);
});

test('trip-only invites remain trip-only while explicit collection invites cover existing and future trips', async () => {
  await as('authenticated',owner);
  const tripInvite = await row("select * from public.create_trip_invite($1,'owner')",[legacyTrip]);
  const collectionInvite = await row('select * from public.create_collection_invite($1)',[collectionId]);
  await as('authenticated',tripOnlyDevice);
  assert.equal((await row('select public.redeem_trip_invite($1) as id',[tripInvite.token])).id,legacyTrip);
  assert.equal((await rows('select * from public.list_authorized_trips()')).length,1);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,0);
  await assert.rejects(db.query('select * from public.create_collection_invite($1)',[collectionId]),/ACCESS_DENIED/);
  await as('authenticated',collectionMember);
  assert.equal((await row('select public.redeem_collection_invite($1) as id',[collectionInvite.token])).id,collectionId);
  assert.equal((await row('select public.redeem_collection_invite($1) as id',[collectionInvite.token])).id,collectionId);
  assert.deepEqual((await rows('select id from public.list_authorized_trips()')).map((r)=>r.id).sort(),[legacyTrip,secondTrip].sort());
  await assert.rejects(db.query('select * from public.create_collection_invite($1)',[collectionId]),/ACCESS_DENIED/);
  await assert.rejects(db.query('select * from public.collection_invites'),/permission denied/);
  await as('authenticated',exhaustedDevice);
  await assert.rejects(db.query('select public.redeem_collection_invite($1)',[collectionInvite.token]),/INVALID_INVITE/);
  await as('authenticated',owner);
  const future = await create({id:'20000000-0000-4000-8000-000000000113',name:'Aventura futura',budget:250000});
  await as('authenticated',collectionMember);
  assert.equal((await rows('select * from public.trips where id=$1',[future.id])).length,1);
  await as('authenticated',tripOnlyDevice);
  assert.equal((await rows('select * from public.trips where id=$1',[future.id])).length,0);
  await as('postgres');
  await db.exec(await readFile(migrationUrl,'utf8'));
  assert.equal((await rows('select * from public.collection_members where user_id=$1',[tripOnlyDevice])).length,0,'re-running never expands old invites');
});

test('collection invite tokens are hashed, owner-only, bounded, revocable and expiry aware', async () => {
  await as('authenticated',owner);
  const invite = await row("select * from public.create_collection_invite($1,'owner',1,24)",[collectionId]);
  assert.match(invite.token,/^[0-9a-f]{64}$/);
  const list = await rows('select * from public.list_collection_invites($1)',[collectionId]);
  assert.deepEqual(Object.keys(list[0]).sort(),['created_at','expires_at','id','last_used_at','max_uses','revoked_at','role','use_count']);
  for(const options of [['admin',1,24],['member',0,24],['member',21,24],['member',1,0],['member',1,169]])
    await assert.rejects(db.query('select * from public.create_collection_invite($1,$2,$3,$4)',[collectionId,...options]),/INVALID_INVITE_OPTIONS/);
  await as('postgres');
  const stored = await row("select encode(token_hash,'hex') as hash from public.collection_invites where id=$1",[invite.invite_id]);
  assert.notEqual(stored.hash,invite.token);
  assert.equal(stored.hash,(await row("select encode(extensions.digest($1,'sha256'),'hex') as hash",[invite.token])).hash);
  await as('authenticated',collectionOwnerDevice);
  await row('select public.redeem_collection_invite($1)',[invite.token]);
  assert.equal((await row('select private.is_trip_owner($1) as yes',[secondTrip])).yes,true);
  const revoked = await row('select * from public.create_collection_invite($1)',[collectionId]);
  await db.query('select public.revoke_collection_invite($1)',[revoked.invite_id]);
  const expired = await row('select * from public.create_collection_invite($1)',[collectionId]);
  await as('postgres');
  await db.query("update public.collection_invites set expires_at=now()-interval '1 second' where id=$1",[expired.invite_id]);
  await as('authenticated',exhaustedDevice);
  for(const token of [revoked.token,expired.token,'abc','0'.repeat(64)])
    await assert.rejects(db.query('select public.redeem_collection_invite($1)',[token]),/INVALID_INVITE/);
});

test('all activities and expenses stay scoped even when the device can access both trips', async () => {
  await as('authenticated',owner);
  const secondActivity='30000000-0000-4000-8000-000000000103';
  const secondExpense='40000000-0000-4000-8000-000000000103';
  await saveActivity(secondTrip,secondActivity,30000);
  await spend(secondTrip,secondExpense,15000,secondActivity);
  await assert.rejects(spend(secondTrip,'40000000-0000-4000-8000-000000000104',1000,legacyActivity),/EXPENSE_ACTIVITY_MISMATCH/);
  await assert.rejects(db.query("select * from public.save_expense($1,$2,1,'Tentativa de mover','Outros',15000,'2020-01-01',null,null)",[legacyTrip,secondExpense]),/VERSION_CONFLICT/);
  await as('postgres');
  await assert.rejects(db.query('update public.activities set trip_id=$1 where id=$2',[legacyTrip,secondActivity]),/ACTIVITY_TRIP_IMMUTABLE/);
  await assert.rejects(db.query('update public.trip_expenses set trip_id=$1 where id=$2',[legacyTrip,secondExpense]),/EXPENSE_TRIP_IMMUTABLE/);
  await assert.rejects(db.query('update public.trip_expenses set activity_id=$1 where id=$2',[legacyActivity,secondExpense]),/EXPENSE_ACTIVITY_MISMATCH/);
  const otherCollection = (await row('select collection_id from public.trips where id=$1',[unownedTrip])).collection_id;
  await assert.rejects(db.query('update public.trips set collection_id=$1 where id=$2',[otherCollection,secondTrip]),/TRIP_COLLECTION_IMMUTABLE/);
  await as('authenticated',owner);
  const totals = await rows('select id,initial_budget_cents,total_spent_cents from public.list_authorized_trips()');
  assert.equal(Number(totals.find((t)=>t.id===legacyTrip).total_spent_cents),8000);
  assert.equal(Number(totals.find((t)=>t.id===secondTrip).total_spent_cents),15000);
  assert.equal(Number(totals.find((t)=>t.id===secondTrip).initial_budget_cents),0);
  const first = await rows('select * from public.list_authorized_trips(1,0,null,\'all\')');
  const next = await rows('select * from public.list_authorized_trips(1,1,null,\'all\')');
  assert.notEqual(first[0].id,next[0].id);
  const searched = await row("select * from public.list_authorized_trips(1,0,'Outra aventura','all')");
  assert.equal(Number(searched.total_spent_cents),15000);
});

test('classification respects each calendar timezone and retains the complete last day', async () => {
  await as('postgres');
  const calendar = await row("select (now() at time zone 'Pacific/Kiritimati')::date::text as today");
  await as('authenticated',owner);
  const ongoing = await create({id:'20000000-0000-4000-8000-000000000120',name:'Último dia',start:calendar.today,end:calendar.today,timezone:'Pacific/Kiritimati',budget:40000});
  const past = await row("select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text as yesterday");
  const historical = await create({id:'20000000-0000-4000-8000-000000000121',name:'Memória',start:past.yesterday,end:past.yesterday,budget:60000});
  assert.ok((await rows("select id from public.list_authorized_trips(100,0,null,'ongoing')")).some((t)=>t.id===ongoing.id));
  assert.ok(!(await rows("select id from public.list_authorized_trips(100,0,null,'past')")).some((t)=>t.id===ongoing.id));
  assert.ok((await rows("select id from public.list_authorized_trips(100,0,null,'past')")).some((t)=>t.id===historical.id));
  await spend(historical.id,'40000000-0000-4000-8000-000000000121',7000);
  assert.equal(Number((await row("select * from public.list_authorized_trips(100,0,'Memória','past')")).total_spent_cents),7000);
  await db.query("select * from public.update_trip($1,1,'Memória',null,null,null,'America/Sao_Paulo',null,null)",[historical.id]);
  assert.ok((await rows("select id from public.list_authorized_trips(100,0,null,'undated')")).some((t)=>t.id===historical.id));
  assert.equal((await rows('select * from public.trip_expenses where trip_id=$1',[historical.id])).length,1);
});

test('archive and restore preserve every record and budget; stale versions and outsiders fail', async () => {
  await as('authenticated',owner);
  const before = await row('select * from public.trips where id=$1',[secondTrip]);
  const archived = await row('select * from public.set_trip_archived($1,$2,true)',[secondTrip,before.version]);
  assert.ok(archived.archived_at);
  assert.equal((await rows('select * from public.list_authorized_trips()')).some((t)=>t.id===secondTrip),false);
  assert.equal((await rows("select * from public.list_authorized_trips(50,0,null,'archived')")).some((t)=>t.id===secondTrip),true);
  assert.equal((await rows('select * from public.activities where trip_id=$1',[secondTrip])).length,1);
  assert.equal((await rows('select * from public.trip_expenses where trip_id=$1',[secondTrip])).length,1);
  await assert.rejects(db.query('select * from public.set_trip_archived($1,$2,false)',[secondTrip,before.version]),/VERSION_CONFLICT/);
  const restored = await row('select * from public.set_trip_archived($1,$2,false)',[secondTrip,archived.version]);
  assert.equal(restored.archived_at,null);
  assert.equal(restored.start_date,before.start_date);
  assert.equal(restored.end_date,before.end_date);
  assert.equal(Number(restored.initial_budget_cents),Number(before.initial_budget_cents));
  assert.equal(Number((await row("select * from public.list_authorized_trips(1,0,'Outra aventura','all')")).total_spent_cents),15000);
});

test('explicit service-only collection recovery does not reinterpret a trip recovery token', async () => {
  await as('service_role');
  const tripRecovery = await row('select * from public.provision_trip_owner($1)',[unownedTrip]);
  const collectionRecovery = await row('select * from public.provision_collection_owner($1)',[unownedTrip]);
  await as('authenticated',exhaustedDevice);
  assert.equal((await row('select public.redeem_trip_invite($1) as id',[tripRecovery.token])).id,unownedTrip);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,0);
  assert.equal((await row('select public.redeem_collection_invite($1) as id',[collectionRecovery.token])).id,collectionRecovery.collection_id);
  assert.equal((await row('select private.is_collection_owner($1) as yes',[collectionRecovery.collection_id])).yes,true);
  await as('postgres');
  const retained = (await row('select count(*)::int as n from public.trips')).n;
  await db.exec(await readFile(migrationUrl,'utf8'));
  assert.equal((await row('select count(*)::int as n from public.trips')).n,retained);
  await as('authenticated',tripOnlyDevice);
  assert.equal((await rows('select * from public.list_authorized_collections()')).length,0);
});
