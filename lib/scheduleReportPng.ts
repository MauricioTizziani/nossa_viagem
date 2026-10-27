import { REPORT_CELL_PADDING, REPORT_COLUMNS, REPORT_FONT_SIZE, REPORT_HEADINGS, REPORT_HEIGHT, REPORT_LINE_HEIGHT, REPORT_MARGIN, REPORT_WIDTH, paginateReport, wrapReportText, type ScheduleReport, type ReportPage } from './scheduleReport';

const NAVY = '#3B5F86';
const PALE = '#DCEBFA';
const BORDER = '#CBD9E8';
const INK = '#233E5A';
const CONTENT_WIDTH = REPORT_WIDTH - REPORT_MARGIN * 2;
const TABLE_HEADING_HEIGHT = 90;
const BOTTOM = REPORT_HEIGHT - REPORT_MARGIN - 48;

export interface ReportPng { file: File; page: number }
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Draw text directly: user content is never parsed as HTML and no remote image is fetched. */
export async function renderScheduleReportPng(report: ScheduleReport, signal: AbortSignal, progress: (page: number, total: number) => void): Promise<ReportPng[]> {
  const family = getComputedStyle(document.body).fontFamily || 'Arial, sans-serif';
  await document.fonts.load(`${REPORT_FONT_SIZE}px ${family}`);
  await document.fonts.load(`600 40px ${family}`);
  await document.fonts.ready;
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_WIDTH; canvas.height = REPORT_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Não foi possível preparar a imagem neste navegador. Tente novamente.');
  const font = (size = REPORT_FONT_SIZE, weight = 400) => { ctx.font = `${weight} ${size}px ${family}`; };
  const wrap = (value: string, width = CONTENT_WIDTH) => wrapReportText(value, width, text => ctx.measureText(text).width);
  const textLines = (lines: string[], x: number, y: number, lineHeight: number) => {
    for (const line of lines) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
  };
  try {
    font(38, 600); const title = wrap(report.tripName);
    font(24); const metadata = report.header.flatMap(value => wrap(value));
    const tableY = 138 + title.length * 48 + metadata.length * 32 + 22;
    font();
    const rows: string[][][] = [];
    for (let i = 0; i < report.rows.length; i++) {
      signal.throwIfAborted();
      rows.push(report.rows[i].cells.map((cell, column) => wrap(cell, REPORT_COLUMNS[column] - REPORT_CELL_PADDING * 2)));
      if (i % 25 === 24) await yieldToBrowser();
    }
    const pages = paginateReport(rows, BOTTOM - tableY - TABLE_HEADING_HEIGHT);
    const files: ReportPng[] = [];
    const draw = (page: ReportPage, index: number) => {
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, REPORT_WIDTH, REPORT_HEIGHT);
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = NAVY; ctx.fillRect(REPORT_MARGIN, REPORT_MARGIN, 8, 52);
      font(48, 600); ctx.fillText(report.title, REPORT_MARGIN + 26, REPORT_MARGIN);
      font(38, 600); textLines(title, REPORT_MARGIN, 138, 48);
      font(24); ctx.fillStyle = '#536B84';
      textLines(metadata, REPORT_MARGIN, 138 + title.length * 48, 32);
      ctx.fillStyle = PALE; ctx.fillRect(REPORT_MARGIN, tableY, CONTENT_WIDTH, TABLE_HEADING_HEIGHT);
      font(25, 600); ctx.fillStyle = NAVY;
      let x = REPORT_MARGIN;
      REPORT_HEADINGS.forEach((heading, column) => {
        const lines = wrap(heading, REPORT_COLUMNS[column] - REPORT_CELL_PADDING * 2);
        textLines(lines, x + REPORT_CELL_PADDING, tableY + 14, 30); x += REPORT_COLUMNS[column];
      });
      let y = tableY + TABLE_HEADING_HEIGHT;
      font();
      for (const row of page.rows) {
        ctx.fillStyle = row.rowIndex % 2 === 0 ? '#FFFFFF' : '#F5F9FD';
        ctx.fillRect(REPORT_MARGIN, y, CONTENT_WIDTH, row.height);
        ctx.strokeStyle = BORDER; ctx.lineWidth = 1;
        x = REPORT_MARGIN;
        row.cells.forEach((lines, column) => {
          ctx.strokeRect(x, y, REPORT_COLUMNS[column], row.height);
          ctx.fillStyle = INK;
          ctx.textAlign = column === 1 ? 'right' : 'left';
          textLines(lines, column === 1 ? x + REPORT_COLUMNS[column] - REPORT_CELL_PADDING : x + REPORT_CELL_PADDING, y + REPORT_CELL_PADDING, REPORT_LINE_HEIGHT);
          x += REPORT_COLUMNS[column];
        });
        y += row.height;
      }
      ctx.textAlign = 'left';
      ctx.strokeStyle = BORDER; ctx.strokeRect(REPORT_MARGIN, tableY, CONTENT_WIDTH, TABLE_HEADING_HEIGHT);
      if (page.summary) {
        ctx.fillStyle = PALE; ctx.fillRect(REPORT_MARGIN, y + 24, CONTENT_WIDTH, 140);
        font(27, 600); ctx.fillStyle = NAVY;
        textLines(report.summary, REPORT_MARGIN + 24, y + 42, 36);
      }
      ctx.fillStyle = '#536B84'; font(23);
      ctx.fillText('Nossa Viagem · Cronograma', REPORT_MARGIN, REPORT_HEIGHT - REPORT_MARGIN);
      ctx.textAlign = 'right'; ctx.fillText(`Página ${index + 1} de ${pages.length}`, REPORT_WIDTH - REPORT_MARGIN, REPORT_HEIGHT - REPORT_MARGIN);
    };
    for (let index = 0; index < pages.length; index++) {
      signal.throwIfAborted(); progress(index + 1, pages.length);
      draw(pages[index], index);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value?.size && value.type === 'image/png' ? resolve(value) : reject(new Error('Não foi possível gerar um PNG válido. Tente novamente.')), 'image/png'));
      const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('O arquivo gerado não é uma imagem PNG válida. Tente novamente.');
      const suffix = pages.length > 1 ? `-pagina-${String(index + 1).padStart(2, '0')}` : '';
      files.push({ file: new File([blob], `${report.filename}${suffix}.png`, { type: 'image/png' }), page: index + 1 });
      await yieldToBrowser();
    }
    signal.throwIfAborted();
    return files;
  } finally {
    // Keep compressed PNGs only; one reusable canvas bounds memory on phones.
    canvas.width = 0; canvas.height = 0;
  }
}

export function canShareReportFiles(files: File[]): boolean {
  try { return files.length > 0 && window.isSecureContext && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }); }
  catch { return false; }
}
