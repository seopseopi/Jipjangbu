import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createHistoryRequestScope,
  createPropertyHistoryTarget,
  HISTORY_PAGE_SIZE,
  historyQueryUrl,
  historyTargetKey,
  mergeHistoryRecords,
  retryInterruptedHistoryRead,
} from "../app/history-query.ts";

const property = {
  propertyType: " 아파트 ",
  buildingName: " GREEN 타워 ",
  buildingDong: " A ",
  unitNumber: " 101 ",
};

test("inline property history uses trimmed, Korean-lowercase listing identity", () => {
  assert.deepEqual(createPropertyHistoryTarget(property), {
    kind: "listing",
    key: "아파트|green 타워|a|101",
    name: "아파트 GREEN 타워 A동 101호",
  });
  assert.equal(
    createPropertyHistoryTarget({ ...property, buildingDong: " " }).key,
    "아파트|green 타워||101",
  );
  for (const required of ["propertyType", "buildingName", "unitNumber"]) {
    assert.equal(createPropertyHistoryTarget({ ...property, [required]: " " }), null);
  }
});

test("history URLs keep customer and property identifiers as data and bound customer pages", () => {
  const customer = { kind: "customer", id: "고객 &/? 1", name: "테스트" };
  const url = new URL(historyQueryUrl(customer, 10), "https://test.invalid");
  assert.equal(url.pathname, "/api/work-logs");
  assert.equal(url.searchParams.get("customerId"), customer.id);
  assert.equal(url.searchParams.get("limit"), String(HISTORY_PAGE_SIZE));
  assert.equal(url.searchParams.get("offset"), "10");
  assert.equal(new URL(historyQueryUrl(customer, -1), url).searchParams.get("offset"), "0");
  const listing = { kind: "listing", key: "아파트|A &/B||101", name: "물건" };
  assert.equal(historyQueryUrl(listing), `/api/listings/${encodeURIComponent(listing.key)}`);
});

test("history panel identity ignores label changes but distinguishes customers and listings", () => {
  const a = { kind: "customer", id: "a", name: "첫 이름" };
  assert.equal(historyTargetKey(a), historyTargetKey({ ...a, name: "새 이름" }));
  assert.notEqual(historyTargetKey(a), historyTargetKey({ ...a, id: "b" }));
  assert.notEqual(historyTargetKey(a), historyTargetKey({ kind: "listing", key: "a", name: "물건" }));
});

test("history pagination deduplicates overlapping rows without reordering or mutating prior records", () => {
  const previous = [{ id: "newest" }, { id: "middle" }];
  const incoming = [{ id: "middle" }, { id: "older" }, { id: "older" }];
  assert.deepEqual(mergeHistoryRecords(previous, incoming), [
    { id: "newest" }, { id: "middle" }, { id: "older" },
  ]);
  assert.equal(previous.length, 2);
  assert.equal(incoming.length, 3);
});

test("one panel cannot start duplicate pagination requests before React rerenders", async () => {
  const scope = createHistoryRequestScope();
  let finish;
  let calls = 0;
  const first = scope.run(() => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  });
  assert.equal(scope.busy, true);
  assert.deepEqual(await scope.run(async () => { calls += 1; }), { status: "ignored" });
  finish("page one");
  assert.deepEqual(await first, { status: "success", value: "page one" });
  assert.equal(calls, 1);
  assert.equal(scope.busy, false);
  assert.deepEqual(await scope.run(async () => "page two"), { status: "success", value: "page two" });
});

test("closing history aborts requests and ignores a late response even when fetch disregards abort", async () => {
  const scope = createHistoryRequestScope();
  let finish;
  let signal;
  const request = scope.run((value) => {
    signal = value;
    return new Promise((resolve) => { finish = resolve; });
  });
  scope.dispose();
  assert.equal(signal.aborted, true);
  finish("old customer's private history");
  assert.deepEqual(await request, { status: "ignored" });
  assert.deepEqual(await scope.run(async () => "never called"), { status: "ignored" });
});

test("failed history requests release their lock so retry works", async () => {
  const scope = createHistoryRequestScope();
  const failure = new Error("offline");
  assert.deepEqual(await scope.run(async () => { throw failure; }), { status: "error", error: failure });
  assert.equal(scope.busy, false);
  assert.deepEqual(await scope.run(async () => []), { status: "success", value: [] });
});

test("shared-client invalidation retries once, but an explicitly closed view does not retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await retryInterruptedHistoryRead(async () => {
    calls += 1;
    if (calls === 1) throw new DOMException("cache invalidated", "AbortError");
    return "refreshed";
  }, controller.signal);
  assert.equal(result, "refreshed");
  assert.equal(calls, 2);
  controller.abort();
  calls = 0;
  await assert.rejects(retryInterruptedHistoryRead(async () => {
    calls += 1;
    throw new DOMException("closed", "AbortError");
  }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("read-only inline history has no mutations, navigation, nested modal or implicit form submits", async () => {
  const source = await readFile(new URL("../app/related-history.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<Modal|<form|onOpenWork|window\.location|method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  for (const button of source.matchAll(/<button\b[\s\S]*?>/g)) {
    assert.match(button[0], /type="button"/);
  }
  assert.match(source, /조회만 하며 작성 중 내용은 바뀌지 않습니다/);
  assert.match(source, /현재 수정 중 · 저장된 내용/);
  assert.match(source, /\/api\/work-logs\/\$\{encodeURIComponent\(workId\)\}/);
  assert.match(source, /work\.details\.map/);
  assert.match(source, /aria-expanded=/);
});
