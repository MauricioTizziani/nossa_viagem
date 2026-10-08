import { EMPTY_PLACE, type PlaceValue } from "./types";

export type OsmPlace = PlaceValue & {
  osm_place_id: string;
  osm_place_name: string;
  osm_latitude: number;
  osm_longitude: number;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Accept only real, bounded Point coordinates and valid OSM references. */
export function parsePhotonResults(payload: unknown): OsmPlace[] {
  const features = record(payload).features;
  if (!Array.isArray(features)) throw new Error("Resposta inválida da pesquisa de lugares.");
  const results: OsmPlace[] = [];
  const seen = new Set<string>();
  for (const feature of features.slice(0, 30)) {
    const properties = record(record(feature).properties);
    const geometry = record(record(feature).geometry);
    const coordinates = geometry.coordinates;
    if (geometry.type !== "Point" || !Array.isArray(coordinates)) continue;
    const [longitude, latitude] = coordinates;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const osmType = text(properties.osm_type);
    const osmId = typeof properties.osm_id === "number" && Number.isSafeInteger(properties.osm_id) && properties.osm_id > 0 ? String(properties.osm_id) : text(properties.osm_id);
    if (!/^[NWR]$/.test(osmType) || !/^[1-9]\d{0,19}$/.test(osmId)) continue;
    const id = `${osmType}/${osmId}`;
    if (seen.has(id)) continue;
    const street = [text(properties.street), text(properties.housenumber)].filter(Boolean).join(", ");
    const address = [...new Set([street, text(properties.district), text(properties.city) || text(properties.county), text(properties.state), text(properties.postcode), text(properties.country)].filter(Boolean))].join(" · ");
    const name = text(properties.name) || street || text(properties.city) || text(properties.county);
    if (!name || name.length > 240 || address.length > 1000) continue;
    results.push({ ...EMPTY_PLACE, osm_place_id: id, osm_place_name: name, osm_place_address: address || null, osm_latitude: latitude, osm_longitude: longitude });
    seen.add(id);
    if (results.length === 6) break;
  }
  return results;
}

export function photonEndpoint() {
  const endpoint = new URL(process.env.NEXT_PUBLIC_PHOTON_URL || "https://photon.komoot.io/api/");
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("O endereço da pesquisa de lugares é inválido.");
  return endpoint;
}

// Short-lived memory cache only. No query history is stored on disk or Supabase.
const cache = new Map<string, { at: number; places: OsmPlace[] }>();
export async function searchPlaces(query: string, signal: AbortSignal): Promise<OsmPlace[]> {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (normalized.length < 3) return [];
  if (normalized.length > 240) throw new Error("Digite uma pesquisa de até 240 caracteres.");
  const endpoint = photonEndpoint();
  const key = `${endpoint.href}|${normalized.toLocaleLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 600_000) return cached.places;
  endpoint.searchParams.set("q", normalized);
  endpoint.searchParams.set("limit", "6");
  const response = await fetch(endpoint, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]), cache: "no-store", credentials: "omit", referrerPolicy: "origin" });
  if (!response.ok) throw new Error("A pesquisa está indisponível. Tente mais tarde ou informe o local manualmente.");
  const places = parsePhotonResults(await response.json());
  if (signal.aborted) throw new DOMException("Consulta cancelada", "AbortError");
  if (cache.size >= 40) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), places });
  return places;
}
