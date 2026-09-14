"use client";

const READ_TTL_MS = 15_000;
const MAX_READ_ENTRIES = 32;
const MAX_READ_BYTES = 2_000_000;

type PendingRead = {
  controller: AbortController;
  promise: Promise<string>;
  users: number;
};

function aborted() {
  return new DOMException("요청이 취소되었습니다.", "AbortError");
}

/** A short-lived, page-local optimization only. Every write invalidates all reads. */
export function createJsonClient({
  fetcher = (...args: Parameters<typeof fetch>) => fetch(...args),
  now = Date.now,
  onUnauthorized = () => {},
  cacheReads = () => true,
}: {
  fetcher?: typeof fetch;
  now?: () => number;
  onUnauthorized?: () => void;
  cacheReads?: () => boolean;
} = {}) {
  const reads = new Map<string, { body: string; expiresAt: number }>();
  const pending = new Map<string, PendingRead>();
  let generation = 0;
  let writes = 0;
  let readBytes = 0;

  function invalidateCompletedReads() {
    reads.clear();
    readBytes = 0;
    return [...pending.values()].some((entry) => !entry.controller.signal.aborted);
  }

  function clear() {
    generation += 1;
    invalidateCompletedReads();
    for (const entry of pending.values()) entry.controller.abort();
    pending.clear();
  }

  function remember(key: string, body: string) {
    const bytes = body.length * 2;
    if (bytes > MAX_READ_BYTES) return;
    const previous = reads.get(key);
    if (previous) readBytes -= previous.body.length * 2;
    reads.delete(key);
    while (
      reads.size >= MAX_READ_ENTRIES ||
      readBytes + bytes > MAX_READ_BYTES
    ) {
      const oldest = reads.keys().next().value;
      if (oldest === undefined) break;
      readBytes -= reads.get(oldest)!.body.length * 2;
      reads.delete(oldest);
    }
    reads.set(key, { body, expiresAt: now() + READ_TTL_MS });
    readBytes += bytes;
  }

  async function request(url: string, options?: RequestInit) {
    const response = await fetcher(url, {
      credentials: "same-origin",
      ...options,
    });
    if (response.status === 401) {
      clear();
      onUnauthorized();
    }
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : {
          error: response.ok
            ? undefined
            : "서버 연결이 잠시 불안정합니다. 다시 시도해 주세요.",
        };
    if (!response.ok) {
      const message =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof data.error === "string"
          ? data.error
          : "요청을 처리하지 못했습니다.";
      throw Object.assign(new Error(message), { status: response.status });
    }
    return JSON.stringify(data);
  }

  function subscribe(
    entry: PendingRead,
    signal?: AbortSignal | null,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(aborted());
      entry.users += 1;
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        entry.users -= 1;
        return true;
      };
      const onAbort = () => {
        if (!finish()) return;
        reject(aborted());
        if (entry.users === 0) entry.controller.abort();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (body) => {
          if (finish()) resolve(body);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    if (options?.signal?.aborted) throw aborted();
    const method = (options?.method ?? "GET").toUpperCase();
    const mutation = method !== "GET" && method !== "HEAD";
    if (mutation) {
      writes += 1;
      clear();
      try {
        return JSON.parse(await request(url, options)) as T;
      } finally {
        writes -= 1;
        clear();
      }
    }
    // Custom headers/options, auth, downloads and external URLs never share a cache.
    const eligible =
      cacheReads() &&
      method === "GET" &&
      /^\/api\/(?!auth(?:\/|\?|$)|backups(?:\/|\?|$))/.test(url) &&
      (options?.credentials === undefined ||
        options.credentials === "same-origin") &&
      Object.keys(options ?? {}).every((key) =>
        ["method", "signal", "credentials"].includes(key),
      );
    if (!eligible) return JSON.parse(await request(url, options)) as T;
    const version = generation;
    const cached = reads.get(url);
    if (!writes && cached && cached.expiresAt > now()) {
      // Parse separately for each caller: components cannot mutate another caller's data.
      return JSON.parse(cached.body) as T;
    }
    let entry = pending.get(url);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      entry = { controller, users: 0, promise: Promise.resolve("") };
      const current = entry;
      entry.promise = request(url, { ...options, signal: controller.signal })
        .then((body) => {
          if (generation !== version || controller.signal.aborted)
            throw aborted();
          if (!writes) remember(url, body);
          return body;
        })
        .finally(() => {
          if (pending.get(url) === current) pending.delete(url);
        });
      pending.set(url, entry);
    }
    const body = await subscribe(entry, options?.signal);
    if (generation !== version || options?.signal?.aborted) throw aborted();
    return JSON.parse(body) as T;
  }

  return { fetchJson, clear, invalidateCompletedReads };
}

const client = createJsonClient({
  cacheReads: () => typeof window !== "undefined",
  onUnauthorized: () => {
    if (typeof window === "undefined") return;
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  },
});

export const clientJsonFetch = client.fetchJson;
export const clearClientReadCache = client.clear;
// A focus refresh must not cancel the very reads the visible screen is waiting on.
// Writes, logout and authorization failures still use clear() above.
export const invalidateCompletedClientReads = client.invalidateCompletedReads;
