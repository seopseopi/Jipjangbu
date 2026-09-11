type WorkPage<T> = { workLogs: T[]; total: number };

/** Refresh the already-expanded journal without fetching the entire archive. */
export async function fetchWorkWindow<T>(
  fetchPage: (params: URLSearchParams, signal?: AbortSignal) => Promise<WorkPage<T>>,
  params: URLSearchParams,
  visibleCount: number,
  signal?: AbortSignal,
): Promise<WorkPage<T>> {
  const requestedCount = Number.isFinite(visibleCount)
    ? Math.max(100, Math.floor(visibleCount))
    : 100;
  const workLogs: T[] = [];
  let total = Infinity;
  let offset = 0;

  while (offset < requestedCount && offset < total) {
    signal?.throwIfAborted();
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(Math.min(1000, requestedCount - offset, total - offset)));
    pageParams.set("offset", String(offset));
    const page = await fetchPage(pageParams, signal);
    signal?.throwIfAborted();
    total = page.total;
    workLogs.push(...page.workLogs.slice(0, requestedCount - workLogs.length));
    offset += page.workLogs.length;
    if (!page.workLogs.length) break;
  }

  // A later page can report fewer records after another device deletes a row.
  return { workLogs: workLogs.slice(0, Math.min(requestedCount, total)), total };
}
