type DirectoryCustomer = { id: string; name?: string; directory_sort_date?: string };

// SQLite's NOCASE folds ASCII only; code-point ordering then matches its UTF-8
// BINARY tie-breaker, including Korean and supplementary Unicode characters.
function compareSqliteText(left: string, right: string) {
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x < y ? -1 : 1;
    a += x > 0xffff ? 2 : 1;
    b += y > 0xffff ? 2 : 1;
  }
  return a < left.length ? 1 : b < right.length ? -1 : 0;
}

function recentDirectory<T extends DirectoryCustomer>(customers: T[]): T[] {
  return customers.map((customer) => ({
    customer,
    date: customer.directory_sort_date ?? "1900-01-01",
    name: (customer.name ?? "").replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
  })).sort((left, right) => compareSqliteText(right.date, left.date)
    || compareSqliteText(left.name, right.name)
    || compareSqliteText(left.customer.id, right.customer.id))
    .map(({ customer }) => customer);
}

// Collect every ID safely first, then restore the picker's useful recent-work
// recommendations. Never page through a mutable display order.
export async function fetchCustomerDirectory<T extends DirectoryCustomer>(
  read: (url: string) => Promise<{ customers: T[] }>,
): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (;;) {
    // Customer IDs do not change when another device records work or edits a
    // name. A keyset therefore cannot skip existing customers as recent/name
    // ordering changes between requests.
    const params = new URLSearchParams({ directory: "1" });
    if (after !== null) params.set("after", after);
    const data = await read(`/api/customers?${params}`);
    if (!Array.isArray(data.customers)) throw new Error("고객 명부를 불러오지 못했습니다.");
    for (const customer of data.customers) {
      if (!customer || typeof customer.id !== "string" || seen.has(customer.id)) {
        throw new Error("고객 명부가 변경되었습니다. 다시 불러와 주세요.");
      }
      seen.add(customer.id);
      result.push(customer);
    }
    if (data.customers.length < 1000) return recentDirectory(result);
    after = data.customers[data.customers.length - 1].id;
  }
}
