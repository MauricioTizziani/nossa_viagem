import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleReport, describeReportFilters, displayReportDay, paginateReport, REPORT_COLUMNS, REPORT_HEIGHT, REPORT_LINE_HEIGHT, REPORT_CELL_PADDING, REPORT_WIDTH, scheduleReportFingerprint, wrapReportText } from '../lib/scheduleReport';
import { createReportZip } from '../lib/reportZip';
import { EMPTY_PLACE, type Activity, type Trip } from '../lib/types';

const trip: Trip = { id: 'trip-a', name: 'Férias / São João: 🌅', destination: 'São Paulo', start_date: '2026-11-08', end_date: '2026-11-10', timezone: 'America/Manaus', initial_budget_cents: 90000, person_one: null, person_two: null, version: 1 };
const activity = (id: string, changes: Partial<Activity> = {}): Activity => ({ ...EMPTY_PLACE, id, trip_id: trip.id, starts_at: '2026-11-09T02:45:00Z', budget_cents: null, name: `Atividade ${id}`, observation: null, type: 'Atividade', version: 1, ...changes });
const source = (activities: Activity[]) => ({ trip, activities, syncedAt: '2026-11-08T23:00:00Z', offline: false });
const generate = (activities: Activity[]) => createScheduleReport(source(activities), null, '2026-11-09T02:00:00Z');

test('report uses the selected trip zone, saved places and planned integer cents; zero is not undefined', () => {
  const report = generate([activity('b', { budget_cents: 15000, type: 'Refeição', manual_place_name: 'Café da Sé', manual_place_address: 'Praça da Sé, 1', observation: 'Atenção à reserva.\n\nSem amendoim.' }), activity('a', { budget_cents: 0 }), activity('c')]);
  assert.equal(report.rows[0].cells[2], 'Atividade a', 'ties have a stable ID order');
  assert.equal(report.rows[0].cells[0], '08/11/2026\n22:45');
  assert.match(report.rows[0].cells[1], /R\$\s0,00/);
  assert.equal(report.rows[2].cells[1], 'A definir');
  assert.equal(report.rows[1].cells[3], 'Café da Sé\nPraça da Sé, 1');
  assert.equal(report.rows[1].cells[4], 'Refeição');
  assert.equal(report.rows[1].cells[5], 'Atenção à reserva.\n\nSem amendoim.');
  assert.equal(report.rows[2].cells[5], '—');
  assert.match(report.summary.join('\n'), /Total previsto das atividades exportadas: R\$\s150,00/);
  assert.match(report.summary[2], /1 atividade com orçamento/);
  assert.equal(report.filename, 'cronograma-ferias-sao-joao-completo');
  assert.match(report.header.join('\n'), /08\/11\/2026 22:00/);
  assert.ok(!JSON.stringify(report).includes(trip.id));
});

test('a selected day includes exactly its trip-timezone date, preserves midnight boundaries and ignores filters', () => {
  const activities = [
    activity('boundary-before', { starts_at: '2026-11-09T03:59:00Z', budget_cents: 0 }),
    activity('boundary-after', { starts_at: '2026-11-10T03:59:00Z', budget_cents: 15000, type: 'Refeição', observation: 'Mesa reservada' }),
    activity('other-day', { starts_at: '2026-11-10T04:00:00Z', budget_cents: 400 }),
    activity('outside-trip-period', { starts_at: '2026-11-16T03:59:00Z', budget_cents: null }),
  ];
  const daily = createScheduleReport(source(activities), { kind: 'day', day: '2026-11-08' }, '2026-11-20T13:00:00Z');
  assert.equal(daily.title, 'Cronograma do dia');
  assert.deepEqual(daily.rows.map(row => row.cells[2]), ['Atividade boundary-before']);
  assert.equal(daily.rows[0].cells[0], '08/11/2026\n23:59');
  assert.deepEqual(daily.summary, ['Resumo do dia · 1 atividade exportada', 'Total previsto das atividades exportadas: R$ 0,00']);
  assert.match(daily.header.join('\n'), /Domingo, 08\/11\/2026/);
  assert.equal(daily.filename, 'cronograma-ferias-sao-joao-2026-11-08', 'uses the selected day, not generation date');
  const next = createScheduleReport(source(activities), { kind: 'day', day: '2026-11-09' });
  assert.deepEqual(next.rows.map(row => row.cells[2]), ['Atividade boundary-after']);
  assert.equal(next.rows[0].cells[0], '09/11/2026\n23:59');
  const following = createScheduleReport(source(activities), { kind: 'day', day: '2026-11-10' });
  assert.deepEqual(following.rows.map(row => row.cells[2]), ['Atividade other-day']);
  assert.equal(following.rows[0].cells[0], '10/11/2026\n00:00');
  const outside = createScheduleReport(source(activities), { kind: 'day', day: '2026-11-15' });
  assert.equal(outside.rows.length, 1, 'days outside the trip period remain available');
  assert.equal(outside.rows[0].cells[1], 'A definir');
  assert.equal(displayReportDay('2026-11-08'), 'Domingo, 08/11/2026');
  assert.throws(() => createScheduleReport(source(activities), { kind: 'day', day: '2026-11-12' }), /Não existem atividades/);
  assert.throws(() => createScheduleReport(source(activities), { kind: 'day', day: 'inválida' }), /Escolha um dia válido/);
});

test('filters use the same semantics as the schedule and identify a partial/offline report', () => {
  const report = createScheduleReport({ ...source([activity('a', { type: 'Refeição', observation: 'Reservar mesa' }), activity('b')]), offline: true }, { day: '2026-11-08', type: 'Refeição', search: 'reservar' });
  assert.equal(report.rows.length, 1);
  assert.match(report.header.join('\n'), /Relatório parcial.*Dia: 08\/11\/2026.*Refeição.*reservar/);
  assert.match(report.header.join('\n'), /Cópia offline.*Última sincronização/);
  assert.equal(describeReportFilters({ type: 'all', day: 'all', search: ' ' }), '');
  assert.throws(() => createScheduleReport(source([activity('a')]), { search: 'ausente' }), /Não existem atividades/);
  assert.throws(() => generate([]), /Não existem atividades/);
  assert.throws(() => generate([activity('foreign', { trip_id: 'trip-b' })]), /confirmar os dados desta viagem/);
});

test('wrapping retains accents, newlines and unbroken tokens without clipping', () => {
  const text = 'Refeição com atenção\n\n' + 'https://exemplo/'.repeat(40);
  const lines = wrapReportText(text, 100, value => Array.from(value).length * 10);
  assert.ok(lines.every(line => line.length <= 10));
  assert.ok(lines.includes(''));
  assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('pagination keeps normal rows intact, preserves all continuation content and counts each activity once', () => {
  assert.ok(REPORT_WIDTH > REPORT_HEIGHT);
  assert.equal(REPORT_COLUMNS.reduce((a, b) => a + b), REPORT_WIDTH - 128);
  const largeObservation = Array.from({ length: 95 }, (_, i) => `Observação linha ${i}: refeição e ação`);
  const rows = [
    [['08/11/2026', '10:00'], ['R$ 0,00'], ['Atividade 1'], ['Lugar'], ['Lazer'], ['Observação curta']],
    [['08/11/2026', '11:00'], ['A definir'], ['Atividade com conteúdo muito extenso'], ['Local', 'Endereço'], ['Refeição'], largeObservation],
    [['08/11/2026', '12:00'], ['R$ 20,00'], ['Última atividade'], ['Lugar'], ['Atividade'], ['Fim']],
  ];
  const available = 500;
  const pages = paginateReport(rows, available);
  const fragments = pages.flatMap(page => page.rows);
  assert.equal(fragments.filter(row => !row.continuation).length, 3);
  assert.deepEqual(fragments.filter(row => row.rowIndex === 1).flatMap(row => row.cells[5]), largeObservation);
  assert.ok(fragments.filter(row => row.continuation).every(row => row.cells[2].includes('(continuação)') && row.cells[0][0] === '08/11/2026'));
  assert.ok(pages.every(page => page.rows.reduce((sum, row) => sum + row.height, 0) + (page.summary ? 164 : 0) <= available));
  assert.ok(fragments.every(row => row.height === Math.max(...row.cells.map(cell => cell.length)) * REPORT_LINE_HEIGHT + REPORT_CELL_PADDING * 2));
  assert.equal(pages.filter(page => page.summary).length, 1);
  assert.equal(pages.at(-1)?.summary, true);
  const ordinary = paginateReport(Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ['linha 1', 'linha 2'])), 500);
  assert.ok(ordinary.flatMap(page => page.rows).every(row => !row.continuation));
});

test('a changed observation invalidates the preview, while finance metadata does not', () => {
  const rows = [activity('a')];
  assert.equal(scheduleReportFingerprint(trip, rows), scheduleReportFingerprint({ ...trip, initial_budget_cents: 100, version: 2 }, rows));
  assert.notEqual(scheduleReportFingerprint(trip, rows), scheduleReportFingerprint(trip, [{ ...rows[0], observation: 'Nova nota' }]));
  assert.notEqual(scheduleReportFingerprint(trip, rows), scheduleReportFingerprint({ ...trip, timezone: 'UTC' }, rows));
});

test('ZIP contains the exact file bytes, valid CRC32, safe names and a central directory', async () => {
  const file = new File(['123456789'], 'cronograma-pagina-01.png', { type: 'image/png' });
  const zip = await createReportZip([file], new AbortController().signal);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(zip.type, 'application/zip');
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926, 'standard CRC32 test vector');
  assert.equal(view.getUint32(18, true), 9);
  const nameLength = view.getUint16(26, true);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + nameLength)), file.name);
  assert.equal(new TextDecoder().decode(bytes.slice(30 + nameLength, 30 + nameLength + 9)), '123456789');
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 1);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(createReportZip([file], aborted.signal), { name: 'AbortError' });
});
