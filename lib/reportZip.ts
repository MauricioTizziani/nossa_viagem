/** ZIP STORE: PNGs are already compressed. No dependency or consecutive automatic downloads. */
export async function createReportZip(files: File[], signal: AbortSignal): Promise<Blob> {
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  for (const file of files) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const name = new TextEncoder().encode(file.name);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x21, true); // DOS date 1980-01-01; no local clock conversion.
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, name.length, true);
    local.set(name, 30); parts.push(local, file);
    const central = new Uint8Array(46 + name.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x21, true); entry.setUint32(16, crc, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true); central.set(name, 46);
    directory.push(central); offset += local.length + bytes.length;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (files.length > 65535 || offset >= 0xffffffff) throw new Error('O conjunto é muito grande para ZIP. Baixe as páginas individualmente.');
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, directory.reduce((sum, entry) => sum + entry.length, 0), true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
