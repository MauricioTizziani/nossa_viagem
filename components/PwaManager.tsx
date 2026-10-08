"use client";

import { useEffect, useRef, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PwaManager({ hasUnsavedChanges = false }: { hasUnsavedChanges?: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [workerError, setWorkerError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const reloadApproved = useRef(false);
  const unsavedChanges = useRef(hasUnsavedChanges);
  unsavedChanges.current = hasUnsavedChanges;
  const updateActivated = useRef(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const isInstalled = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    isInstalled();
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); setShowInstructions(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    standalone.addEventListener("change", isInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); standalone.removeEventListener("change", isInstalled); };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let alive = true;
    let registration: ServiceWorkerRegistration | undefined;
    const onControllerChange = () => {
      if (!reloadApproved.current) return;
      updateActivated.current = true;
      if (!unsavedChanges.current) window.location.reload();
      else setUpdating(false);
    };
    const check = () => { if (registration && navigator.onLine) void registration.update().catch(() => {}); };
    const visibleCheck = () => { if (document.visibilityState === "visible") check(); };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", visibleCheck);
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((value) => {
      if (!alive) return;
      registration = value;
      if (value.waiting) setWaitingWorker(value.waiting);
      value.addEventListener("updatefound", () => {
        const worker = value.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (alive && worker.state === "installed" && navigator.serviceWorker.controller) setWaitingWorker(value.waiting ?? worker);
          if (alive && worker.state === "redundant" && !value.active) setWorkerError(true);
        });
      });
    }, () => { if (alive) setWorkerError(true); });
    return () => {
      alive = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", visibleCheck);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) { setShowInstructions((current) => !current); return; }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setShowInstructions(false);
    } catch {
      setInstallPrompt(null);
      setShowInstructions(true);
    }
  };

  const update = () => {
    if (!waitingWorker || hasUnsavedChanges || updating) return;
    reloadApproved.current = true;
    setUpdating(true);
    if (updateActivated.current) window.location.reload();
    else waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <div className="space-y-3">
      {!installed && <button type="button" onClick={() => { void install(); }} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d6e0eb] bg-white/80 px-4 py-2 text-xs font-semibold text-[#3B5F86] transition hover:bg-[#DCEBFA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B5F86]" aria-expanded={showInstructions}><span aria-hidden="true">↧</span> Instalar aplicativo</button>}
      {showInstructions && <div className="max-w-lg rounded-2xl border border-[#DCEBFA] bg-white p-4 text-sm leading-relaxed text-[#526c84]">
        <p className="font-semibold text-[#3B5F86]">Nossa Viagem sempre por perto</p>
        <p className="mt-2">No iPhone, abra no Safari, toque em Compartilhar e em “Adicionar à Tela de Início”. No Android ou computador, abra o menu do navegador e procure “Instalar aplicativo” ou “Adicionar à tela inicial”.</p>
        <p className="mt-2 text-xs">A instalação depende do navegador. Abra a viagem com internet antes de consultar o cronograma offline.</p>
        <button type="button" onClick={() => setShowInstructions(false)} className="mt-3 min-h-9 font-semibold text-[#3B5F86]">Entendi</button>
      </div>}
      {waitingWorker && <div role="status" className="rounded-2xl border border-[#d6e0eb] bg-[#eef5fd] p-4 text-sm text-[#3B5F86]">
        <p className="font-semibold">Uma nova versão de Nossa Viagem está pronta.</p>
        <p className="mt-1 text-xs leading-relaxed">{hasUnsavedChanges ? "Salve ou feche seu formulário antes de atualizar. Suas alterações em andamento continuam aqui." : "Atualize para receber as melhorias. O aplicativo será reaberto."}</p>
        <button type="button" disabled={hasUnsavedChanges || updating} onClick={update} className="mt-3 min-h-10 rounded-full bg-[#3B5F86] px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{updating ? "Atualizando…" : "Atualizar agora"}</button>
      </div>}
      {workerError && <p className="text-xs text-[#687b8d]">A consulta offline ainda não está pronta. Reabra o aplicativo com internet para tentar novamente.</p>}
    </div>
  );
}
