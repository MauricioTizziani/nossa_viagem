import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { sourceVersion, updateWorkerVersion } from "../scripts/update-sw-version.mjs";
import { budgetInputValue, dateKey, directionsUrl, filterActivities, formatCurrency, formatDateTime, groupActivities, isGoogleMapsUrl, isOutsideTripPeriod, isoToLocalDateTime, localDateTimeToIso, mapsUrl, nextActivity, parseBudgetCents, sortActivities, summarizeActivities, tripStatus, validateActivityInput, validateTripInput } from "../lib/domain";
import { EMPTY_PLACE, type Activity, type Trip } from "../lib/types";

const trip: Trip = { id: "trip", name: "Nossa Viagem", destination: "", start_date: null, end_date: null, timezone: "America/Sao_Paulo", person_one: null, person_two: null, initial_budget_cents: null, version: 1 };
const activity = (id: string, starts_at: string, budget_cents: number | null, type: Activity["type"] = "Atividade", name = id): Activity => ({ id, trip_id: "trip", name, starts_at, budget_cents, type, version: 1, ...EMPTY_PLACE });

test("currency uses exact integer cents, with zero distinct from undefined", () => {
  assert.equal(parseBudgetCents(""), null);
  assert.equal(parseBudgetCents("  "), null);
  assert.equal(parseBudgetCents("0"), 0);
  assert.equal(parseBudgetCents("0,01"), 1);
  assert.equal(parseBudgetCents("1234.56"), 123456);
  assert.equal(parseBudgetCents("1.234,56"), 123456);
  assert.equal(parseBudgetCents("R$ 150,00"), 15000);
  assert.equal(parseBudgetCents("1.234"), 123400);
  assert.equal(budgetInputValue(199), "1,99");
  assert.equal(budgetInputValue(0), "0,00");
  assert.equal(budgetInputValue(null), "");
  assert.equal(formatCurrency(null), "A definir");
  assert.match(formatCurrency(0), /^R\$\s0,00$/);
  assert.match(formatCurrency(15000), /^R\$\s150,00$/);
  for (const invalid of ["-1", "-0", "1,234", "1.12,00", "1e3", "Infinity", "NaN", "12 34", "10.999.999.999,99"]) assert.throws(() => parseBudgetCents(invalid));
});

test("civil schedule times are independent of the host timezone", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const deviceTimezone of ["Pacific/Honolulu", "Asia/Tokyo", "Europe/London", "America/Sao_Paulo"]) {
      process.env.TZ = deviceTimezone;
      const instant = localDateTimeToIso("2026-10-08T08:10", trip.timezone);
      assert.equal(instant, "2026-10-08T11:10:00.000Z");
      assert.equal(isoToLocalDateTime(instant, trip.timezone), "2026-10-08T08:10");
      assert.equal(formatDateTime(instant, trip.timezone), "08/10/2026 08:10");
      assert.equal(dateKey("2026-10-09T01:00:00Z", trip.timezone), "2026-10-08");
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  assert.equal(localDateTimeToIso("2026-10-08T08:10", "Asia/Kathmandu"), "2026-10-08T02:25:00.000Z");
  assert.equal(localDateTimeToIso("2026-10-08T08:10", "Pacific/Chatham"), "2026-10-07T18:25:00.000Z");
});

test("DST gaps and overlaps cannot silently move a planned time", () => {
  assert.throws(() => localDateTimeToIso("2026-03-08T02:30", "America/New_York"), /não existe/);
  assert.throws(() => localDateTimeToIso("2026-11-01T01:30", "America/New_York"), /duas vezes/);
  assert.equal(localDateTimeToIso("2026-11-01T03:30", "America/New_York"), "2026-11-01T08:30:00.000Z");
  assert.throws(() => localDateTimeToIso("2018-11-04T00:30", "America/Sao_Paulo"), /não existe/);
  assert.throws(() => localDateTimeToIso("2026-10-04T02:15", "Australia/Lord_Howe"), /não existe/);
  assert.throws(() => localDateTimeToIso("2026-02-30T12:00", trip.timezone));
  assert.throws(() => localDateTimeToIso("2026-10-08T24:00", trip.timezone));
  assert.throws(() => localDateTimeToIso("2026-10-08T12:00", "Invalid/Zone"));
});

test("activities sort chronologically, allow equal times and group in the trip zone", () => {
  const original = [activity("late", "2026-10-09T13:00:00Z", 200), activity("b", "2026-10-09T01:00:00Z", null), activity("a", "2026-10-09T01:00:00Z", 0)];
  assert.deepEqual(sortActivities(original).map((item) => item.id), ["a", "b", "late"]);
  assert.equal(original[0].id, "late");
  const groups = groupActivities(original, trip.timezone);
  assert.deepEqual(groups.map((group) => group.date), ["2026-10-08", "2026-10-09"]);
  assert.equal(groups[0].activities.length, 2);
  assert.equal(nextActivity(original, new Date("2026-10-09T02:00:00Z"))?.id, "late");
  assert.equal(nextActivity(original, new Date("2026-10-10T00:00:00Z")), null);
});

test("filters include manual and transient Google place text and accent-insensitive names", () => {
  const list = [
    { ...activity("one", "2026-10-08T15:00:00Z", 10, "Refeição", "Café especial"), manual_place_name: "Cafeteria", manual_place_address: "Rua das Flores" },
    { ...activity("two", "2026-10-09T15:00:00Z", 20, "Lazer"), place_id: "selected-place" },
    activity("three", "2026-10-09T15:00:00Z", null),
  ];
  assert.equal(filterActivities(list, { search: "cafe" }, trip.timezone).length, 1);
  assert.equal(filterActivities(list, { search: "flores" }, trip.timezone).length, 1);
  assert.equal(filterActivities(list, { search: "museu" }, trip.timezone, { "selected-place": { name: "Museu", address: "Centro", source: "google" } })[0].id, "two");
  assert.equal(filterActivities(list, { day: "2026-10-09", type: "Lazer" }, trip.timezone)[0].id, "two");
  assert.equal(filterActivities(list, { day: "all", type: "all", search: "" }, trip.timezone).length, 3);
});

test("totals reflect current rows and distinguish budgets yet to define", () => {
  const list = [activity("one", "2026-10-08T15:00:00Z", 10, "Refeição"), activity("two", "2026-10-08T15:00:00Z", 20, "Refeição"), activity("three", "2026-10-08T15:00:00Z", null, "Lazer"), activity("four", "2026-10-08T15:00:00Z", 0, "Atividade")];
  const summary = summarizeActivities(list);
  assert.equal(summary.totalCents, 30);
  assert.equal(summary.activityCount, 4);
  assert.equal(summary.undefinedBudgetCount, 1);
  assert.deepEqual(summary.byType["Refeição"], { totalCents: 30, activityCount: 2, undefinedBudgetCount: 0 });
  assert.equal(summary.byType.Lazer.undefinedBudgetCount, 1);
  assert.equal(summary.byType.Atividade.undefinedBudgetCount, 0);
  assert.equal(summarizeActivities(list.slice(1)).totalCents, 20);
});

test("manual Maps URLs reject credentials, lookalike hosts and unrelated Google endpoints", () => {
  for (const valid of ["https://maps.app.goo.gl/AbCd123", "https://goo.gl/maps/AbCd123", "https://www.google.com/maps/place/Museu", "https://maps.google.com/?q=Rua", "https://www.google.com.br/maps/search/?api=1&query=Rua"]) assert.equal(isGoogleMapsUrl(valid), true, valid);
  for (const invalid of ["http://maps.app.goo.gl/AbCd", "https://maps.app.goo.gl.evil.example/AbCd", "https://google.com.evil.example/maps", "https://evil.google.com/maps", "https://www.google.com/url?q=https://evil.example", "https://google.com@evil.example/maps", "https://user:pass@www.google.com/maps", "https://maps.app.goo.gl:8443/AbCd", "javascript:alert(1)", "/maps", "https://goo.gl/AbCd"]) assert.equal(isGoogleMapsUrl(invalid), false, invalid);
  const selected = { ...EMPTY_PLACE, place_id: "a&b" };
  assert.match(mapsUrl(selected)!, /query_place_id=a%26b/);
  assert.match(directionsUrl(selected)!, /destination_place_id=a%26b/);
  const linkOnly = { ...EMPTY_PLACE, manual_place_url: "https://maps.app.goo.gl/AbCd" };
  assert.equal(mapsUrl(linkOnly), linkOnly.manual_place_url);
  assert.equal(directionsUrl(linkOnly), null, "a link alone must not claim an identified route destination");
  assert.equal(mapsUrl(EMPTY_PLACE), null);
});

test("trip period warnings and countdown follow the trip timezone", () => {
  const planned = { ...trip, start_date: "2026-10-09", end_date: "2026-10-11" };
  assert.equal(isOutsideTripPeriod("2026-10-09T01:00:00Z", planned), true);
  assert.equal(isOutsideTripPeriod("2026-10-09T12:00:00Z", planned), false);
  assert.equal(isOutsideTripPeriod("2026-10-12T03:00:00Z", planned), true);
  assert.deepEqual(tripStatus(planned, new Date("2026-10-09T01:00:00Z")), { phase: "upcoming", days: 1, message: "Falta 1 dia para nossa aventura" });
  assert.equal(tripStatus(planned, new Date("2026-10-10T12:00:00Z")).phase, "ongoing");
  assert.equal(tripStatus(planned, new Date("2026-10-12T12:00:00Z")).phase, "finished");
  assert.equal(tripStatus(trip).phase, "unplanned");
  assert.throws(() => validateTripInput({ ...planned, end_date: "2026-10-01" }));
});

test("activity validation preserves zero, trims user text and rejects invalid fields", () => {
  const input = activity("id", "2026-10-09T12:00:00Z", 0, "Atividade", "  Passeio  ");
  assert.equal(validateActivityInput(input).name, "Passeio");
  assert.equal(validateActivityInput(input).budget_cents, 0);
  assert.throws(() => validateActivityInput({ ...input, name: "   " }));
  assert.throws(() => validateActivityInput({ ...input, budget_cents: -1 }));
  assert.throws(() => validateActivityInput({ ...input, budget_cents: 0.1 }));
  assert.throws(() => validateActivityInput({ ...input, starts_at: "2026-10-09T12:00" }));
  assert.throws(() => validateActivityInput({ ...input, place_id: "place", manual_place_name: "Manual" }));
  assert.throws(() => validateActivityInput({ ...input, manual_place_url: "https://example.com" }));
  assert.equal(validateActivityInput({ ...input, manual_place_url: "  HTTPS://WWW.GOOGLE.COM:443/maps/place/Museu  " }).manual_place_url, "https://www.google.com/maps/place/Museu");
  assert.equal(validateActivityInput({ ...input, manual_place_url: "https://MAPS.APP.GOO.GL:443/AbCd" }).manual_place_url, "https://maps.app.goo.gl/AbCd");
});

test("PWA worker precaches a clean public shell and ignores private/API/Google requests", async () => {
  const listeners = new Map<string, (event: { request?: Request; waitUntil: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void }) => void>();
  const stored = new Map<string, Response>();
  const requests: { url: string; credentials?: RequestCredentials }[] = [];
  const cache = {
    put: async (key: string | Request, response: Response) => { stored.set(typeof key === "string" ? key : key.url, response); },
    match: async (key: string | Request) => stored.get(typeof key === "string" ? key : key.url)?.clone(),
  };
  let offline = false;
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: { location: { origin: "https://nossaviagem.example" }, addEventListener: (name: string, callback: typeof listeners extends Map<string, infer C> ? C : never) => listeners.set(name, callback), clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async (url: string, options: RequestInit = {}) => {
      if (offline) throw new Error("offline");
      requests.push({ url, credentials: options.credentials });
      if (url === "/") return new Response('<html><script src="/_next/static/chunks/page-hash.js"></script><link href="/_next/static/css/style-hash.css" /></html>', { headers: { "Content-Type": "text/html" } });
      return new Response("asset");
    },
    URL, Set, Promise, Response,
  });
  const installing: Promise<unknown>[] = [];
  listeners.get("install")!({ waitUntil: (promise) => installing.push(promise) });
  await Promise.all(installing);
  assert.ok(stored.has("/"));
  assert.ok(stored.has("/_next/static/chunks/page-hash.js"));
  assert.ok(stored.has("/_next/static/css/style-hash.css"));
  assert.ok(requests.every((request) => request.credentials === "omit"));
  for (const request of [
    new Request("https://nossaviagem.example/api/invite", { method: "POST" }),
    new Request("https://nossaviagem.example/auth/v1/token"),
    new Request("https://nossaviagem.example/?invite=secret"),
    new Request("https://nossaviagem.example/", { headers: { Authorization: "Bearer private" } }),
    new Request("https://nossaviagem.example/", { headers: { Cookie: "session=private" } }),
    new Request("https://maps.googleapis.com/maps/api/js?key=test"),
    new Request("https://project.supabase.co/rest/v1/activities"),
  ]) {
    let intercepted = false;
    listeners.get("fetch")!({ request, waitUntil: () => {}, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, request.url);
  }
  offline = true;
  let response: Promise<Response> | undefined;
  const navigate = { url: "https://nossaviagem.example/#invite=secret", method: "GET", mode: "navigate", headers: new Headers() } as Request;
  listeners.get("fetch")!({ request: navigate, waitUntil: () => {}, respondWith: (promise) => { response = promise; } });
  assert.ok(response);
  assert.match(await (await response).text(), /page-hash/);
  assert.ok([...stored.keys()].every((key) => !key.includes("invite") && !key.includes("secret")));
});

test("PWA release version follows app, icons and dependency/config content, excluding itself and environment", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "nossa-viagem-sw-"));
  try {
    await Promise.all(["app", "components", "lib", "public/icons"].map((path) => mkdir(join(fixture, path), { recursive: true })));
    await Promise.all([
      writeFile(join(fixture, "app/page.tsx"), "initial page"),
      writeFile(join(fixture, "components/Header.tsx"), "header"),
      writeFile(join(fixture, "lib/domain.ts"), "domain"),
      writeFile(join(fixture, "public/icons/icon-192.png"), "icon"),
      writeFile(join(fixture, "public/logo.png"), "logo"),
      writeFile(join(fixture, "public/sw.js"), 'const SHELL_CACHE = "nossa-viagem-shell-v1";\n'),
    ]);
    const initial = await sourceVersion(fixture);
    assert.equal(await sourceVersion(fixture), initial);
    await writeFile(join(fixture, "public/sw.js"), 'const SHELL_CACHE = "nossa-viagem-shell-other";\n');
    assert.equal(await sourceVersion(fixture), initial);
    await writeFile(join(fixture, "app/page.tsx"), "updated page");
    const updated = await sourceVersion(fixture);
    assert.notEqual(updated, initial);
    await writeFile(join(fixture, "public/icons/icon-192.png"), "updated icon");
    const iconUpdated = await sourceVersion(fixture);
    assert.notEqual(iconUpdated, updated);
    await writeFile(join(fixture, "package-lock.json"), '{"lockfileVersion":3,"version":"1.0.0"}');
    const lockAdded = await sourceVersion(fixture);
    assert.notEqual(lockAdded, iconUpdated);
    await writeFile(join(fixture, "package-lock.json"), '{"lockfileVersion":3,"version":"1.0.1"}');
    const lockUpdated = await sourceVersion(fixture);
    assert.notEqual(lockUpdated, lockAdded);
    await writeFile(join(fixture, "next.config.ts"), "export default {reactStrictMode:true};");
    const configUpdated = await sourceVersion(fixture);
    assert.notEqual(configUpdated, lockUpdated);
    await writeFile(join(fixture, ".env.local"), "PRIVATE_TOKEN=never-included");
    assert.equal(await sourceVersion(fixture), configUpdated);
    assert.equal(await updateWorkerVersion(fixture), configUpdated);
    const worker = await readFile(join(fixture, "public/sw.js"), "utf8");
    assert.ok(worker.includes(`nossa-viagem-shell-${configUpdated}`));
    assert.equal(await sourceVersion(fixture), configUpdated);
    await updateWorkerVersion(fixture);
    assert.equal(await readFile(join(fixture, "public/sw.js"), "utf8"), worker);
  } finally {
    if (dirname(resolve(fixture)) !== resolve(tmpdir()) || !basename(fixture).startsWith("nossa-viagem-sw-")) throw new Error("Unexpected temporary fixture path.");
    await rm(fixture, { recursive: true, force: true });
  }
});
