export type CustomerOption = { id: string; name: string };
type SearchableCustomer = {
  customer: CustomerOption;
  name: string;
  id: string;
  combined: string;
};

const normalize = (value: string) =>
  value.toLocaleLowerCase("ko-KR").replace(/[\s()-]/g, "");

// Normalize the directory once when it changes, not for every sort comparison
// on every keystroke. Keep the server's meaningful order within each rank.
export function indexCustomers(
  customers: CustomerOption[],
): SearchableCustomer[] {
  return customers.map((customer) => {
    const name = normalize(customer.name);
    const id = normalize(customer.id);
    return { customer, name, id, combined: name + id };
  });
}

export function matchCustomers(
  index: SearchableCustomer[],
  query: string,
  limit = 12,
): CustomerOption[] {
  if (!Number.isSafeInteger(limit) || limit < 1) return [];
  const term = normalize(query);
  if (!term) return index.slice(0, limit).map((entry) => entry.customer);
  const ranked: CustomerOption[][] = [[], [], []];
  for (const entry of index) {
    if (!entry.combined.includes(term)) continue;
    const rank =
      entry.name === term || entry.id === term
        ? 0
        : entry.name.startsWith(term) || entry.id.startsWith(term)
          ? 1
          : 2;
    if (ranked[rank].length < limit) ranked[rank].push(entry.customer);
    if (ranked[0].length === limit) break;
  }
  return ranked.flat().slice(0, limit);
}
