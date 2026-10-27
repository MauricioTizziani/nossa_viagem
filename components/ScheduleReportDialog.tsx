'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileImage, LoaderCircle, RefreshCw, Share2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Activity, ActivityFilters, Trip } from '../lib/types';
import { createScheduleReport, describeReportFilters, displayReportDay, REPORT_HEIGHT, REPORT_WIDTH, scheduleReportFingerprint, type ScheduleReport, type ScheduleReportSelection, type ScheduleReportSource } from '../lib/scheduleReport';
import { canShareReportFiles, renderScheduleReportPng } from '../lib/scheduleReportPng';
import { createReportZip } from '../lib/reportZip';
import { dateKey, groupActivities } from '../lib/domain';
import { friendlyError } from '../lib/useTravelData';
import Modal from './Modal';
import styles from './ScheduleReportDialog.module.css';

interface PreparedReport {
  model: ScheduleReport;
  fingerprint: string;
  scope: string;
  pages: { file: File; url: string }[];
  zip?: { url: string; name: string };
}
function release(report: PreparedReport | null) {
  report?.pages.forEach(page => URL.revokeObjectURL(page.url));
  if (report?.zip) URL.revokeObjectURL(report.zip.url);
}

/** The preview uses the very same PNG File that is downloaded and shared. */
function ScheduleReportPage({ page, index, total, disabled, onShare }: { page: PreparedReport['pages'][number]; index: number; total: number; disabled: boolean; onShare: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  return <figure className={styles.page}>
    <figcaption className={styles.pageTools}>
      <strong>{page.file.name} · Página {index + 1} de {total}</strong>
      <div>
        <button type="button" onClick={() => setZoomed(value => !value)} aria-pressed={zoomed}>{zoomed ? <ZoomOut size={16}/> : <ZoomIn size={16}/>}{zoomed ? 'Ajustar' : 'Ampliar'}</button>
        <a href={disabled ? undefined : page.url} aria-disabled={disabled} download={page.file.name}><Download size={16}/>Baixar PNG{total > 1 ? ` · ${index + 1}` : ''}</a>
        {total > 1 && <button type="button" disabled={disabled} onClick={onShare}><Share2 size={16}/>Compartilhar página {index + 1}</button>}
      </div>
    </figcaption>
    <div className={styles.imageViewport} tabIndex={0} role="region" aria-label={`Prévia da página ${index + 1}${zoomed ? ', ampliada; role para conferir' : ''}`}>
      <img className={zoomed ? styles.zoomed : styles.fitted} src={page.url} alt={`Cronograma de viagem, página ${index + 1} de ${total}. Use Ampliar para conferir os detalhes.`} width={REPORT_WIDTH} height={REPORT_HEIGHT} loading="lazy"/>
    </div>
  </figure>;
}

export default function ScheduleReportDialog({ trip, activities, filters, online, scheduleComplete, loadSource, onClose }: {
  trip: Trip; activities: Activity[]; filters: ActivityFilters; online: boolean; scheduleComplete: boolean;
  loadSource: (signal: AbortSignal) => Promise<ScheduleReportSource>; onClose: () => void;
}) {
  const [scope, setScope] = useState<'all' | 'day' | 'filtered'>('all');
  const [selectedDay, setSelectedDay] = useState('');
  const [prepared, setPrepared] = useState<PreparedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = useRef<PreparedReport | null>(null);
  const controller = useRef<AbortController | null>(null);
  const shareLock = useRef(false);
  const mounted = useRef(true);
  const reportDays = useMemo(() => groupActivities(activities, trip.timezone).map(group => ({ date: group.date, count: group.activities.length })), [activities, trip.timezone]);
  const filterLabel = describeReportFilters(filters);
  const scopeKey = JSON.stringify([scope, scope === 'day' ? selectedDay : scope === 'filtered' ? filters : null]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); release(current.current); current.current = null; };
  }, []);

  const changed = Boolean(prepared && (prepared.fingerprint !== scheduleReportFingerprint(trip, activities) || prepared.scope !== scopeKey));
  const ready = Boolean(prepared && !busy && !sharing && !changed);
  const close = () => { if (!shareLock.current) { controller.current?.abort(); onClose(); } };
  function invalidateGeneration() {
    controller.current?.abort(); controller.current = null;
    setBusy(false); setProgress(''); setError(''); setMessage('');
  }
  function selectScope(next: 'all' | 'day' | 'filtered') {
    if (next === scope) return;
    invalidateGeneration();
    setScope(next);
    if (next === 'day' && !selectedDay) setSelectedDay(reportDays[0]?.date ?? '');
  }
  function selectDay(day: string) {
    if (day === selectedDay) return;
    invalidateGeneration(); setSelectedDay(day);
  }

  async function generate() {
    if (controller.current || shareLock.current) return;
    if (scope === 'day' && !selectedDay) { setError('Escolha um dia com atividades para gerar o relatório.'); return; }
    const generationScope = scopeKey;
    const selection: ScheduleReportSelection = scope === 'day' ? { kind: 'day', day: selectedDay }
      : scope === 'filtered' ? { kind: 'filters', filters: { ...filters } } : 'complete';
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setMessage(''); setProgress('Buscando todas as atividades da viagem…');
    let candidate: PreparedReport | null = null;
    try {
      const source = await loadSource(abort.signal);
      abort.signal.throwIfAborted();
      const model = createScheduleReport(source, selection);
      const pages = await renderScheduleReportPng(model, abort.signal, (page, total) => { if (controller.current === abort) setProgress(`Preparando página ${page} de ${total}…`); });
      candidate = { model, scope: generationScope, fingerprint: scheduleReportFingerprint(source.trip, source.activities), pages: pages.map(page => ({ file: page.file, url: URL.createObjectURL(page.file) })) };
      if (pages.length > 1) {
        if (controller.current === abort) setProgress('Preparando o download do conjunto…');
        try {
          const zip = await createReportZip(pages.map(page => page.file), abort.signal);
          candidate.zip = { url: URL.createObjectURL(zip), name: `${model.filename}.zip` };
        } catch { abort.signal.throwIfAborted(); setMessage('O conjunto não pôde ser preparado. Você pode baixar todas as páginas individualmente.'); }
      }
      abort.signal.throwIfAborted();
      release(current.current); current.current = candidate; setPrepared(candidate); candidate = null;
    } catch (err) {
      if (!abort.signal.aborted && mounted.current) {
        const detail = err instanceof Error ? err.message : '';
        setError(/^(Não |O cronograma|O cabeçalho)/.test(detail) ? detail : friendlyError(err));
      }
    } finally {
      release(candidate);
      if (controller.current === abort) controller.current = null;
      if (mounted.current) { setBusy(false); setProgress(''); }
    }
  }

  async function share(files: File[]) {
    if (!ready || shareLock.current) return;
    setError(''); setMessage('');
    if (!navigator.onLine) { setMessage('Você está offline. Baixe as imagens e envie pelo WhatsApp quando tiver conexão.'); return; }
    if (!canShareReportFiles(files)) {
      setMessage(files.length > 1 && prepared?.pages.some(page => canShareReportFiles([page.file]))
        ? 'Este aparelho não compartilha todas as imagens juntas. Use “Compartilhar página” em cada página, ou baixe o conjunto.'
        : 'Baixe a imagem e anexe o arquivo na conversa do WhatsApp. O compartilhamento de arquivos não está disponível neste navegador.');
      return;
    }
    shareLock.current = true; setSharing(true);
    try {
      // No query, rendering or await before this call: preserve the click activation.
      await navigator.share({ files });
      if (mounted.current) setMessage('Compartilhamento encerrado. O aplicativo não confirma o envio ao destinatário.');
    } catch (err) {
      if (mounted.current) {
        if (err instanceof DOMException && err.name === 'AbortError') setMessage('Compartilhamento cancelado. As imagens continuam disponíveis.');
        else setError('Não foi possível abrir o compartilhamento. Tente novamente ou baixe as imagens e anexe os arquivos no WhatsApp.');
      }
    } finally { shareLock.current = false; if (mounted.current) setSharing(false); }
  }

  return <Modal title="Relatório do cronograma" subtitle={trip.name} className={styles.dialog} closeLabel="Fechar relatório" onClose={close}>
    <div className={styles.content}>
      <p className={styles.intro}>Confira seu cronograma em uma tabela horizontal. As imagens incluem as observações e os orçamentos previstos.</p>
      <fieldset className={styles.scope} disabled={sharing}>
        <legend>Conteúdo do relatório</legend>
        <label><input type="radio" name="report-scope" value="all" checked={scope === 'all'} onChange={() => selectScope('all')}/>Cronograma completo</label>
        <label><input type="radio" name="report-scope" value="day" checked={scope === 'day'} onChange={() => selectScope('day')} disabled={!online && !scheduleComplete}/><span>Cronograma de um dia<small>Inclui todas as atividades da data escolhida, no fuso de {trip.timezone}.</small></span></label>
        {scope === 'day' && <label className={styles.dayChoice}><span>Dia do cronograma<select aria-label="Dia do cronograma" value={selectedDay} onChange={event => selectDay(event.target.value)} disabled={!reportDays.length}><option value="" disabled>Selecione um dia</option>{selectedDay && !reportDays.some(item => item.date === selectedDay) && <option value={selectedDay}>{displayReportDay(selectedDay)} — sem atividades</option>}{reportDays.map(({ date, count }) => <option key={date} value={date}>{displayReportDay(date)} — {count} {count === 1 ? 'atividade' : 'atividades'}</option>)}</select></span></label>}
        {filterLabel && <label><input type="radio" name="report-scope" value="filtered" checked={scope === 'filtered'} onChange={() => selectScope('filtered')}/><span>Somente atividades dos filtros atuais<small>{filterLabel}</small></span></label>}
      </fieldset>
      {scope === 'day' && !online && !scheduleComplete && <p className={styles.notice}>A cópia deste cronograma pode estar incompleta. Conecte-se e sincronize a viagem antes de escolher os dias para exportação.</p>}
      {!online && <p className={styles.notice}>Você está offline. A geração usa o cronograma completo sincronizado neste aparelho e informa a última sincronização na imagem. Conecte-se para enviar pelo WhatsApp.</p>}
      <div className={styles.actions}>
        <button className={styles.primary} type="button" onClick={() => void generate()} disabled={busy || sharing}>{busy ? <LoaderCircle size={18} className="spin"/> : prepared ? <RefreshCw size={18}/> : <FileImage size={18}/>}{busy ? 'Gerando relatório…' : prepared ? 'Atualizar relatório' : 'Gerar relatório'}</button>
        {prepared && (prepared.pages.length === 1
          ? <a className={styles.secondary} href={ready ? prepared.pages[0].url : undefined} aria-disabled={!ready} download={prepared.pages[0].file.name}><Download size={18}/>Baixar PNG</a>
          : prepared.zip && <a className={styles.secondary} href={ready ? prepared.zip.url : undefined} aria-disabled={!ready} download={prepared.zip.name}><Download size={18}/>Baixar todas as páginas (ZIP)</a>)}
        <button className={styles.secondary} type="button" disabled={!ready || !online} onClick={() => prepared && void share(prepared.pages.map(page => page.file))}><Share2 size={18}/>{sharing ? 'Compartilhando…' : 'Enviar pelo WhatsApp'}</button>
      </div>
      <p className={styles.help}>Escolha o WhatsApp no menu de compartilhamento para enviar a imagem. Se não estiver disponível, baixe a imagem e anexe o arquivo na conversa do WhatsApp.</p>
      {busy && <p className={styles.notice} role="status">Gerando relatório… {progress}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.notice} role="status">{message}</p>}
      {changed && <p className={styles.notice} role="status">O cronograma ou a seleção mudou. Esta prévia pode estar desatualizada. Use “Atualizar relatório” antes de baixar ou compartilhar.</p>}
      {prepared && <>
        <div className={styles.previewHeading}><h3>Pré-visualização</h3><span>{prepared.pages.length} {prepared.pages.length === 1 ? 'imagem' : 'imagens'} · PNG · {REPORT_WIDTH} × {REPORT_HEIGHT}</span></div>
        <div className={styles.summary}>{prepared.model.summary.map(line => <p key={line}>{line}</p>)}</div>
        {prepared.pages.map((page, index) => <ScheduleReportPage key={page.url} page={page} index={index} total={prepared.pages.length} disabled={!ready} onShare={() => void share([page.file])}/>)}
        <details className={styles.textPreview}><summary>Conferir conteúdo em texto</summary><p>{prepared.model.title}</p><p>{prepared.model.tripName}</p>{prepared.model.header.map((line, i) => <p key={i}>{line}</p>)}<div className={styles.textTable}><table><caption>Cronograma exportado</caption><thead><tr>{['Data e hora', 'Orçamento previsto (R$)', 'Nome da atividade', 'Lugar', 'Tipo', 'Observação'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{prepared.model.rows.map((row, i) => <tr key={i}>{row.cells.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></details>
      </>}
      <div className={styles.close}><button type="button" className={styles.secondary} disabled={sharing} onClick={close}>Fechar</button></div>
    </div>
  </Modal>;
}
