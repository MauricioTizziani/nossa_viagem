/** Traverse every server page, including projects with a lower API row cap. */
export async function readAllPages<T>(readPage: (offset: number, size: number) => Promise<{ data: T[] | null; error: unknown }>, pageSize = 500): Promise<T[]> {
  const rows: T[] = [];
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('INVALID_PAGE_SIZE');
  for (let offset = 0; ;) {
    const result = await readPage(offset, pageSize);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    if (!page.length) return rows;
    rows.push(...page);
    // Use the returned size: Supabase may cap a requested page below pageSize.
    offset += page.length;
  }
}
/** A response may commit only to the route/session generation that requested it. */
export function responseBelongsToRequest(request: { tripId: string; generation: number }, current: { tripId: string; generation: number }): boolean {
  return request.tripId === current.tripId && request.generation === current.generation;
}
