"use client";
import { useEffect, useId, useState } from "react";
import { directionsUrl, isMapsUrl, mapsUrl } from "@/lib/domain";
import { searchPlaces, type OsmPlace } from "@/lib/places";
import { EMPTY_PLACE, type PlaceValue } from "@/lib/types";

export function OsmAttribution() {
  return <span className="text-[11px] font-normal leading-5 text-[#687b8d]">Pesquisa: <a href="https://github.com/komoot/photon" target="_blank" rel="noopener noreferrer" className="underline">Photon</a> · Dados © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors</a></span>;
}

export default function OsmPlacePicker({ value, onChange, disabled = false }: { value: PlaceValue; onChange: (value: PlaceValue) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<"search" | "manual">((value.manual_place_name || value.manual_place_address || value.manual_place_url) ? "manual" : "search");
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OsmPlace[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const inputId = useId();
  const map = mapsUrl(value), route = directionsUrl(value);
  const hasPlace = Boolean(value.place_id || value.osm_place_id || value.manual_place_name || value.manual_place_address || value.manual_place_url);
  const showResults = mode === "search" && open && online && !disabled && results.length > 0;
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    refresh(); window.addEventListener("online", refresh); window.addEventListener("offline", refresh);
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("offline", refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]); setActive(-1); setStatus("idle");
    if (mode !== "search" || !online || disabled || query.trim().length < 3) return;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      void searchPlaces(query, controller.signal).then(places => {
        if (!controller.signal.aborted) { setResults(places); setStatus("done"); }
      }, () => { if (!controller.signal.aborted) setStatus("error"); });
    }, 800);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, mode, online, disabled]);
  function choose(place: OsmPlace) {
    if (disabled || !online) return;
    onChange({ ...place }); setQuery(""); setResults([]); setOpen(false); setActive(-1);
  }
  function manualChange(field: "manual_place_name" | "manual_place_address" | "manual_place_url", text: string) {
    onChange({ ...EMPTY_PLACE, manual_place_name: value.manual_place_name, manual_place_address: value.manual_place_address, manual_place_url: value.manual_place_url, [field]: text || null });
  }
  const inputClass = "w-full rounded-xl border border-[#d6e0eb] bg-white px-4 py-3 text-sm font-normal text-[#294969] outline-none focus:border-[#3B5F86] focus:ring-2 focus:ring-[#DCEBFA] disabled:opacity-60";
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2" aria-label="Como informar o lugar">
      <button type="button" disabled={disabled || !online} aria-pressed={mode === "search"} onClick={() => setMode("search")} className={`rounded-full px-3 py-2 text-xs font-semibold disabled:opacity-50 ${mode === "search" ? "bg-[#DCEBFA]" : "bg-[#F7F9FC]"}`}>Pesquisar lugar</button>
      <button type="button" disabled={disabled} aria-pressed={mode === "manual"} onClick={() => setMode("manual")} className={`rounded-full px-3 py-2 text-xs font-semibold ${mode === "manual" ? "bg-[#DCEBFA]" : "bg-[#F7F9FC]"}`}>Informar manualmente</button>
    </div>
    {mode === "search" && <div className="space-y-2">
      <label htmlFor={inputId} className="block text-xs font-medium">Pesquisar lugar ou endereço</label>
      <input id={inputId} type="search" role="combobox" autoComplete="off" disabled={disabled || !online} maxLength={240} value={query} placeholder="Ex.: Museu do Amanhã, Rio de Janeiro" className={inputClass} aria-autocomplete="list" aria-expanded={showResults} aria-controls={listId} aria-activedescendant={showResults && active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={event => {
          if (event.key === "Escape" && (open || query)) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(""); }
          if (showResults && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive(index => event.key === "ArrowDown" ? (index + 1) % results.length : (index <= 0 ? results.length - 1 : index - 1)); }
          if (event.key === "Enter") { event.preventDefault(); if (showResults && active >= 0) choose(results[active]); }
        }} />
      {showResults && <ul id={listId} role="listbox" aria-label="Lugares encontrados" className="max-h-64 overflow-y-auto rounded-xl border border-[#d6e0eb] bg-white">
        {results.map((place, index) => <li key={place.osm_place_id} role="option" id={`${listId}-${index}`} aria-selected={active === index}><button type="button" disabled={disabled} onClick={() => choose(place)} onMouseEnter={() => setActive(index)} className={`w-full break-words border-b border-[#edf1f6] px-4 py-3 text-left ${active === index ? "bg-[#edf4fc]" : "hover:bg-[#f7f9fc]"}`}><span className="block text-sm font-semibold">{place.osm_place_name}</span>{place.osm_place_address && <span className="mt-1 block text-xs font-normal leading-5 text-[#687b8d]">{place.osm_place_address}</span>}</button></li>)}
      </ul>}
      <p role="status" className="text-xs font-normal leading-5 text-[#687b8d]">{!online ? "A pesquisa precisa de internet. Seu formulário continua aqui." : status === "loading" ? "Pesquisando lugares…" : status === "error" ? "A pesquisa está indisponível. Tente mais tarde ou informe o local manualmente." : status === "done" && !results.length ? "Nenhum lugar encontrado. Inclua a cidade ou informe o local manualmente." : "Digite pelo menos 3 letras e escolha um resultado. Inclua a cidade para encontrar o lugar certo."}</p>
      <OsmAttribution />
    </div>}
    {mode === "manual" && <div className="space-y-3 rounded-2xl bg-[#F7F9FC] p-3">
      <p className="text-xs font-normal text-[#687b8d]">Local informado manualmente. O link não será identificado automaticamente.</p>
      <label className="block space-y-1 text-xs font-medium">Nome do local (opcional)<input disabled={disabled} maxLength={240} value={value.manual_place_name || ""} onChange={event => manualChange("manual_place_name", event.target.value)} placeholder="Nome do restaurante, parque ou museu" className={inputClass} /></label>
      <label className="block space-y-1 text-xs font-medium">Endereço (opcional)<input disabled={disabled} maxLength={1000} value={value.manual_place_address || ""} onChange={event => manualChange("manual_place_address", event.target.value)} placeholder="Rua, número, cidade" className={inputClass} /></label>
      <label className="block space-y-1 text-xs font-medium">Link do mapa (opcional)<input disabled={disabled} type="url" inputMode="url" maxLength={2048} value={value.manual_place_url || ""} onChange={event => manualChange("manual_place_url", event.target.value.trim())} placeholder="https://www.openstreetmap.org/…" className={inputClass} aria-invalid={Boolean(value.manual_place_url && !isMapsUrl(value.manual_place_url))} /></label>
      {value.manual_place_url && !isMapsUrl(value.manual_place_url) && <p className="text-xs font-normal text-[#a44444]" role="alert">Cole um link HTTPS válido de mapa.</p>}
    </div>}
    {value.osm_place_id && <div className="rounded-2xl border border-[#DCEBFA] bg-[#f5f9fe] p-4"><p className="break-words text-sm font-semibold">{value.osm_place_name}</p>{value.osm_place_address && <p className="mt-1 break-words text-xs font-normal text-[#687b8d]">{value.osm_place_address}</p>}<OsmAttribution /></div>}
    {value.place_id && <p className="text-xs font-normal text-[#687b8d]">Este local foi salvo antes da troca de mapas. Escolha um resultado da nova pesquisa para atualizar seus detalhes.</p>}
    {!hasPlace && <p className="text-xs font-normal text-[#687b8d]">Lugar: A definir. Você pode escolher depois.</p>}
    {hasPlace && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold">
      {map && online && <a href={map} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Abrir mapa</a>}
      {route && online && <a href={route} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Traçar rota</a>}
      <button type="button" disabled={disabled} onClick={() => onChange({ ...EMPTY_PLACE })} className="min-h-9 text-[#8c626f]">Remover lugar</button>
    </div>}
  </div>;
}
