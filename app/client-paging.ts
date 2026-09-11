/** Rows may only be extended by a page fetched with their exact query. */
export function canAppendPage(
  loadedQuery: string | null,
  currentQuery: string,
  firstPagePending: boolean,
  nextPagePending: boolean,
) {
  return loadedQuery === currentQuery && !firstPagePending && !nextPagePending;
}
