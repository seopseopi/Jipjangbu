import assert from "node:assert/strict";
import test from "node:test";
import { createJsonClient } from "../app/client-api.ts";

function deferredFetch({ honorAbort = true } = {}) {
  const calls = [];
  const fetcher = (url, options) =>
    new Promise((resolve, reject) => {
      const call = {
        url,
        options,
        resolve: (body, status = 200) =>
          resolve(Response.json(body, { status })),
      };
      calls.push(call);
      if (honorAbort)
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
    });
  return { fetcher, calls };
}

test("identical concurrent reads share one request and return independent objects", async () => {
  const { fetcher, calls } = deferredFetch();
  const client = createJsonClient({ fetcher });
  const first = client.fetchJson("/api/customers?sort=recent");
  const second = client.fetchJson("/api/customers?sort=recent");
  assert.equal(calls.length, 1);
  calls[0].resolve({ customers: [{ name: "원래 이름" }] });
  const [a, b] = await Promise.all([first, second]);
  a.customers[0].name = "변경한 이름";
  assert.equal(b.customers[0].name, "원래 이름");
  const cached = await client.fetchJson("/api/customers?sort=recent");
  assert.equal(cached.customers[0].name, "원래 이름");
  assert.equal(calls.length, 1);
});

test("cached reads expire after 15 seconds and respect query keys", async () => {
  let timestamp = 0;
  let calls = 0;
  const client = createJsonClient({
    now: () => timestamp,
    fetcher: async () => Response.json({ value: ++calls }),
  });
  assert.equal(
    (await client.fetchJson("/api/listings?sort=building")).value,
    1,
  );
  timestamp = 14_999;
  assert.equal(
    (await client.fetchJson("/api/listings?sort=building")).value,
    1,
  );
  assert.equal((await client.fetchJson("/api/listings?sort=recent")).value, 2);
  timestamp = 15_000;
  assert.equal(
    (await client.fetchJson("/api/listings?sort=building")).value,
    3,
  );
});

test("one consumer cancelling does not cancel another consumer", async () => {
  const { fetcher, calls } = deferredFetch();
  const client = createJsonClient({ fetcher });
  const controller = new AbortController();
  const first = client.fetchJson("/api/bootstrap", {
    signal: controller.signal,
  });
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = client.fetchJson("/api/bootstrap");
  controller.abort();
  assert.equal(calls[0].options.signal.aborted, false);
  calls[0].resolve({ value: "정상 응답" });
  await rejected;
  assert.deepEqual(await second, { value: "정상 응답" });
});

test("last consumer cancellation stops network work and does not poison the next read", async () => {
  const { fetcher, calls } = deferredFetch();
  const client = createJsonClient({ fetcher });
  const controller = new AbortController();
  const first = client.fetchJson("/api/search?q=고객", {
    signal: controller.signal,
  });
  const rejected = assert.rejects(first, { name: "AbortError" });
  controller.abort();
  assert.equal(calls[0].options.signal.aborted, true);
  const next = client.fetchJson("/api/search?q=고객");
  assert.equal(calls.length, 2);
  calls[1].resolve({ value: "새 응답" });
  await rejected;
  assert.deepEqual(await next, { value: "새 응답" });
});

test("write boundaries reject late old reads and invalidate reads made during the write", async () => {
  const { fetcher, calls } = deferredFetch({ honorAbort: false });
  const client = createJsonClient({ fetcher });
  const old = client.fetchJson("/api/bootstrap");
  const rejectedOld = assert.rejects(old, { name: "AbortError" });
  const write = client.fetchJson("/api/work-logs", {
    method: "POST",
    body: "{}",
  });
  const during = client.fetchJson("/api/bootstrap");
  const rejectedDuring = assert.rejects(during, { name: "AbortError" });
  calls[1].resolve({ saved: true });
  await write;
  calls[0].resolve({ count: 1 });
  calls[2].resolve({ count: 1 });
  await Promise.all([rejectedOld, rejectedDuring]);
  const fresh = client.fetchJson("/api/bootstrap");
  calls[3].resolve({ count: 2 });
  assert.deepEqual(await fresh, { count: 2 });
});

test("failed writes also evict cached reads", async () => {
  let calls = 0;
  const client = createJsonClient({
    fetcher: async (_url, options) => {
      calls += 1;
      return options.method === "DELETE"
        ? Response.json({ error: "실패" }, { status: 500 })
        : Response.json({ calls });
    },
  });
  await client.fetchJson("/api/customers");
  await assert.rejects(
    client.fetchJson("/api/customers/a", { method: "DELETE" }),
    /실패/,
  );
  assert.equal((await client.fetchJson("/api/customers")).calls, 3);
});

test("unauthorized responses and explicit logout clearing evict all reads", async () => {
  let requests = 0;
  let unauthorized = 0;
  const client = createJsonClient({
    onUnauthorized: () => {
      unauthorized += 1;
    },
    fetcher: async (url) => {
      requests += 1;
      return url === "/api/private"
        ? Response.json({ error: "로그인 필요" }, { status: 401 })
        : Response.json({ requests });
    },
  });
  await client.fetchJson("/api/bootstrap");
  await assert.rejects(client.fetchJson("/api/private"), /로그인 필요/);
  assert.equal(unauthorized, 1);
  assert.equal((await client.fetchJson("/api/bootstrap")).requests, 3);
  client.clear();
  assert.equal((await client.fetchJson("/api/bootstrap")).requests, 4);
});

test("custom request options, auth, backups, external URLs and server reads bypass caching", async () => {
  let calls = 0;
  const fetcher = async () => Response.json({ value: ++calls });
  const client = createJsonClient({ fetcher });
  for (const [url, options] of [
    ["/api/customers", { headers: { "x-scope": "private" } }],
    ["/api/customers", { cache: "no-store" }],
    ["/api/customers", { credentials: "omit" }],
    ["/api/auth/session"],
    ["/api/backups"],
    ["https://example.com/api/customers"],
  ]) {
    const before = calls;
    await client.fetchJson(url, options);
    await client.fetchJson(url, options);
    assert.equal(calls - before, 2);
  }
  const server = createJsonClient({ fetcher, cacheReads: () => false });
  const before = calls;
  await server.fetchJson("/api/bootstrap");
  await server.fetchJson("/api/bootstrap");
  assert.equal(calls - before, 2);
});

test("read cache is bounded by entry count and retained response size", async () => {
  let calls = 0;
  const client = createJsonClient({
    fetcher: async (url) => {
      calls += 1;
      return Response.json({
        value: url === "/api/large" ? "x".repeat(1_000_001) : calls,
      });
    },
  });
  for (let index = 0; index < 33; index += 1)
    await client.fetchJson(`/api/customers?q=${index}`);
  assert.equal(calls, 33);
  await client.fetchJson("/api/customers?q=0");
  assert.equal(calls, 34);
  await client.fetchJson("/api/large");
  await client.fetchJson("/api/large");
  assert.equal(calls, 36);
});

test("already aborted reads do not issue a request", async () => {
  let called = false;
  const client = createJsonClient({
    fetcher: async () => {
      called = true;
      return Response.json({});
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.fetchJson("/api/bootstrap", { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(called, false);
});
