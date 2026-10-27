import { dateKey, filterActivities, formatCurrency, formatDateTime, sortActivities } from './domain';
import type { Activity, ActivityFilters, Trip } from './types';

export interface ScheduleReportSource {
  trip: Trip;
  activities: Activity[];
  syncedAt: string;
  offline: boolean;
}
export interface ScheduleReport {
  tripName: string;
  timezone: string;
  header: string[];
  generatedAt: string;
  filename: string;
  rows: { cells: string[] }[];
  summary: string[];
}
export const REPORT_WIDTH = 2000;
export const REPORT_HEIGHT = 1414;
export const REPORT_MARGIN = 64;
export const REPORT_LINE_HEIGHT = 34;
export const REPORT_FONT_SIZE = 26;
export const REPORT_COLUMNS = [220, 220, 330, 370, 170, 562];
export const REPORT_HEADINGS = ['Data e hora', 'Orçamento previsto (R$)', 'Nome da atividade', 'Lugar', 'Tipo', 'Observação'];
const civilDate = (value: string) => value.split('-').reverse().join('/');

export function describeReportFilters(filters: ActivityFilters): string {
  return [filters.day && filters.day !== 'all' ? `Dia: ${civilDate(filters.day)}` : '', filters.type && filters.type !== 'all' ? `Tipo: ${filters.type}` : '', filters.search?.trim() ? `Pesquisa: “${filters.search.trim()}”` : ''].filter(Boolean).join(' · ');
}

/** Only fields displayed in the report; expense/permission changes do not invalidate it. */
export function scheduleReportFingerprint(trip: Trip, activities: Activity[]): string {
  return JSON.stringify([trip.id, trip.name, trip.destination, trip.start_date, trip.end_date, trip.timezone,
    sortActivities(activities).map(a => [a.id, a.starts_at, a.budget_cents, a.name, a.type, a.observation, a.osm_place_name, a.osm_place_address, a.manual_place_name, a.manual_place_address])]);
}

export function reportFilename(tripName: string, generatedAt: string, timezone: string): string {
  const slug = tripName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/g, '') || 'viagem';
  return `cronograma-${slug}-${dateKey(generatedAt, timezone)}`;
}

export function createScheduleReport(source: ScheduleReportSource, filters: ActivityFilters | null, generatedAt = new Date().toISOString()): ScheduleReport {
  const { trip } = source;
  if (!trip.id || source.activities.some(a => a.trip_id !== trip.id)) throw new Error('Não foi possível confirmar os dados desta viagem. Reabra a viagem e tente novamente.');
  const activities = filters ? filterActivities(source.activities, filters, trip.timezone) : sortActivities(source.activities);
  if (!activities.length) throw new Error('Não existem atividades para exportar no escopo escolhido.');
  const period = [trip.start_date ? `Início: ${civilDate(trip.start_date)}` : '', trip.end_date ? `Término: ${civilDate(trip.end_date)}` : ''].filter(Boolean).join(' · ');
  const undefinedCount = activities.filter(a => a.budget_cents === null).length;
  const total = activities.reduce((sum, a) => sum + (a.budget_cents ?? 0), 0);
  return {
    tripName: trip.name, timezone: trip.timezone, generatedAt,
    filename: reportFilename(trip.name, generatedAt, trip.timezone),
    header: [trip.destination ? `Destino: ${trip.destination}` : '', period,
      `Gerado em ${formatDateTime(generatedAt, trip.timezone)} · Fuso: ${trip.timezone}`,
      filters ? `Relatório parcial · ${describeReportFilters(filters) || 'Filtros atuais'}` : 'Cronograma completo',
      source.offline ? `Cópia offline · Última sincronização: ${formatDateTime(source.syncedAt, trip.timezone)}` : '',
    ].filter(Boolean),
    rows: activities.map(a => {
      const name = a.osm_place_name || a.manual_place_name;
      const address = a.osm_place_address || a.manual_place_address;
      return { cells: [formatDateTime(a.starts_at, trip.timezone).replace(' ', '\n'), formatCurrency(a.budget_cents), a.name,
        [name, address && address !== name ? address : ''].filter(Boolean).join('\n') || 'A definir', a.type, a.observation?.trim() ? a.observation : '—'] };
    }),
    summary: [`Resumo geral · ${activities.length} ${activities.length === 1 ? 'atividade exportada' : 'atividades exportadas'}`,
      `Total previsto das atividades exportadas: ${formatCurrency(total)}`,
      ...(undefinedCount ? [`${undefinedCount} ${undefinedCount === 1 ? 'atividade com orçamento' : 'atividades com orçamento'} “A definir”`] : [])],
  };
}

export type MeasureText = (text: string) => number;
/** Wrap by measured glyph width, retaining explicit newlines and all non-whitespace text. */
export function wrapReportText(value: string, width: number, measure: MeasureText): string[] {
  const result: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+|[^\S\n]+/gu) ?? []) {
      if (measure(line + token) <= width) { line += token; continue; }
      if (line) { result.push(line.trimEnd()); line = ''; }
      // A URL or an unbroken word may be wider than a column. Never clip it.
      for (const glyph of Array.from(token.trimStart())) {
        if (line && measure(line + glyph) > width) { result.push(line); line = ''; }
        line += glyph;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}

export interface ReportFragment {
  rowIndex: number;
  continuation: boolean;
  cells: string[][];
  height: number;
}
export interface ReportPage { rows: ReportFragment[]; summary: boolean }
const CELL_PADDING = 18;
export const REPORT_CELL_PADDING = CELL_PADDING;
export const REPORT_SUMMARY_HEIGHT = 164;

/** Keep ordinary rows intact; only oversize rows continue onto a new landscape page. */
export function paginateReport(rows: string[][][], availableHeight: number, summaryHeight = REPORT_SUMMARY_HEIGHT): ReportPage[] {
  const pages: ReportPage[] = [];
  let page: ReportPage = { rows: [], summary: false };
  let used = 0;
  const next = () => { pages.push(page); page = { rows: [], summary: false }; used = 0; };
  const maxLines = Math.floor((availableHeight - CELL_PADDING * 2) / REPORT_LINE_HEIGHT);
  // Two lines of identification plus the continuation label must fit.
  if (maxLines < 5) throw new Error('O cabeçalho ficou muito extenso. Reduza o texto dos filtros para gerar o relatório.');
  rows.forEach((cells, rowIndex) => {
    const count = Math.max(1, ...cells.map(cell => cell.length));
    const height = count * REPORT_LINE_HEIGHT + CELL_PADDING * 2;
    if (height <= availableHeight) {
      if (used + height > availableHeight && page.rows.length) next();
      page.rows.push({ rowIndex, continuation: false, cells, height }); used += height;
      return;
    }
    if (page.rows.length) next();
    let offset = 0;
    while (offset < count) {
      const continuation = offset > 0;
      const take = maxLines - (continuation ? 1 : 0);
      const fragment = cells.map((cell, column) => {
        const lines = cell.slice(offset, offset + take);
        // Repeat date, budget and type, and identify the activity on every continuation.
        if (continuation && (column === 0 || column === 1 || column === 4)) return [...cell];
        if (continuation && column === 2 && !lines.length) return cell.slice(0, 2);
        return lines;
      });
      if (continuation) fragment[2] = ['(continuação)', ...fragment[2]];
      const fragmentHeight = Math.max(1, ...fragment.map(cell => cell.length)) * REPORT_LINE_HEIGHT + CELL_PADDING * 2;
      page.rows.push({ rowIndex, continuation, cells: fragment, height: fragmentHeight }); used += fragmentHeight;
      offset += take;
      if (offset < count) next();
    }
  });
  if (used + summaryHeight > availableHeight) next();
  page.summary = true; pages.push(page);
  return pages;
}
