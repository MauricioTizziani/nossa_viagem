import test from "node:test";
import assert from "node:assert/strict";
import { parsePhotonResults, searchPlaces } from "../lib/places";
import { directionsUrl, filterActivities, isMapsUrl, mapsUrl, validateActivityInput } from "../lib/domain";
import { EMPTY_PLACE, type Activity } from "../lib/types";

const feature = (properties = {}, coordinates: unknown[] = [-43.1794045, -22.8940683]) => ({ type: "Feature", properties: { osm_type: "W", osm_id: 372720167, name: "Museu do Amanhã", street: "Praça Mauá", housenumber: "1", city: "Rio de Janeiro", country: "Brasil", ...properties }, geometry: { type: "Point", coordinates } });
const selected = () => parsePhotonResults({ features: [feature()] })[0];
const activity = (): Activity => ({ ...selected(), id: "a", trip_id: "t", version: 1, starts_at: "2030-04-10T15:00:00Z", name: "Passeio", budget_cents: null, type: "Lazer" });

test("Photon parses real OSM identity and longitude/latitude in the correct order", () => {
  const place = selected();
  assert.equal(place.osm_place_id, "W/372720167");
  assert.equal(place.osm_place_name, "Museu do Amanhã");
  assert.equal(place.osm_place_address, "Praça Mauá, 1 · Rio de Janeiro · Brasil");
  assert.equal(place.osm_latitude, -22.8940683);
  assert.equal(place.osm_longitude, -43.1794045);
  assert.equal(place.manual_place_name, null);
  assert.equal(place.place_id, null);
  assert.match(mapsUrl(place)!, /mlat=-22\.8940683&mlon=-43\.1794045/);
  assert.equal(new URL(directionsUrl(place)!).searchParams.get("route"), ";-22.8940683,-43.1794045");
});

test("Photon ignores malformed identities, coordinates and duplicates without inventing values", () => {
  const results = parsePhotonResults({ features: [feature(), feature(), feature({ osm_type: "unknown" }), feature({ osm_id: -1 }), feature({}, [180, 91]), feature({}, ["-43", -22]), feature({}, [Infinity, 1]), feature({ name: "", street: "", city: "" }), feature({ osm_id: 10, name: "x".repeat(241) })] });
  assert.equal(results.length, 1);
  assert.throws(() => parsePhotonResults({ nope: [] }));
  assert.equal(parsePhotonResults({ features: [] }).length, 0);
  assert.equal(parsePhotonResults({ features: Array.from({ length: 20 }, (_, i) => feature({ osm_id: i + 1 })) }).length, 6);
});

test("OSM links reject lookalike hosts, credentials, unexpected endpoints and unsafe protocols", () => {
  for (const url of ["https://www.openstreetmap.org/?mlat=1&mlon=2#map=17/1/2", "https://openstreetmap.org/node/123", "https://osm.org/go/abcd--", "https://www.openstreetmap.org/search?query=Rua", "https://www.openstreetmap.org/directions?to=Rua"]) assert.equal(isMapsUrl(url), true, url);
  for (const url of ["https://www.openstreetmap.org.evil.test/node/1", "https://user@www.openstreetmap.org/", "http://www.openstreetmap.org/", "https://www.openstreetmap.org:8080/", "https://www.openstreetmap.org/login", "javascript:alert(1)"]) assert.equal(isMapsUrl(url), false, url);
  assert.equal(mapsUrl({ ...EMPTY_PLACE, manual_place_name: "Praça Mauá" })?.startsWith("https://www.openstreetmap.org/search?"), true);
  assert.equal(directionsUrl({ ...EMPTY_PLACE, manual_place_url: "https://osm.org/go/abcd" }), null);
});

test("OSM validation rejects partial or mixed sources and searches saved place text offline", () => {
  const input = activity();
  assert.equal(validateActivityInput(input).osm_place_name, "Museu do Amanhã");
  for (const change of [{ osm_latitude: null }, { osm_latitude: NaN }, { osm_longitude: 181 }, { osm_place_id: "W/0" }, { manual_place_name: "Manual" }, { place_id: "legacy" }, { osm_place_id: null }]) assert.throws(() => validateActivityInput({ ...input, ...change }));
  assert.equal(filterActivities([input], { search: "museu" }).length, 1);
  assert.equal(filterActivities([input], { search: "maua" }).length, 1);
});

test("search requests omit credentials, avoid persistent caches and reuse recent searches", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.get("limit"), "6");
    assert.equal(options?.cache, "no-store");
    assert.equal(options?.credentials, "omit");
    return new Response(JSON.stringify({ features: [feature()] }));
  };
  try {
    const signal = new AbortController().signal;
    assert.deepEqual(await searchPlaces("Mu", signal), []);
    const first = await searchPlaces("Museu  teste", signal);
    assert.deepEqual(await searchPlaces("  museu teste  ", signal), first);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("search failure and canceled replies never become selected places or cached success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 429 });
  try { await assert.rejects(searchPlaces("consulta indisponível", new AbortController().signal)); }
  finally { globalThis.fetch = original; }
  const controller = new AbortController();
  globalThis.fetch = async () => { controller.abort(); return new Response(JSON.stringify({ features: [feature()] })); };
  try { await assert.rejects(searchPlaces("consulta cancelada", controller.signal), /cancelada/); }
  finally { globalThis.fetch = original; }
});
