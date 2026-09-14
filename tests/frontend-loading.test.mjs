import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Evaluate the production callbacks with synthetic data; never contact a site.
const source = readFileSync(new URL("../app/work-manager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, environment) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `${name} exists in the shipped component`);
  if (ts.isCallExpression(result)) result = result.arguments[0];
  const compiled = ts.transpileModule(`const value = ${result.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(environment), `${compiled}; return value;`)(...Object.values(environment));
}
function state(current) {
  const box = { current };
  box.set = (value) => { box.current = typeof value === "function" ? value(box.current) : value; };
  return box;
}
function referenceHarness(overrides = {}) {
  const calls = [], customers = state([]), lookups = state(null), requested = { current: false };
  const loader = callback("loadReferenceData", {
    requestVersion: { current: { references: 0 } }, customerDirectoryRequested: requested,
    appliedReferenceVersion: { current: 0 },
    jsonFetch: async (url) => { calls.push(url); return { workTypes: ["매물등록"] }; },
    fetchCustomerDirectory: async () => { calls.push("full-customer-directory"); return [{ id: "synthetic-customer" }]; },
    setLookups: lookups.set, setCustomers: customers.set,
    ...overrides,
  });
  return { calls, customers, lookups, requested, loader };
}

test("home reference loading no longer downloads the full customer directory", async () => {
  const h = referenceHarness();
  await h.loader(false);
  assert.deepEqual(h.calls, ["/api/lookups"]);
  assert.deepEqual(h.lookups.current, { workTypes: ["매물등록"] });
  assert.deepEqual(h.customers.current, []);
  assert.equal(h.requested.current, false);
});

test("opening a work form loads the complete directory and subsequent focus/write refreshes keep it current", async () => {
  const h = referenceHarness();
  await h.loader();
  assert.equal(h.requested.current, true);
  assert.deepEqual(h.customers.current, [{ id: "synthetic-customer" }]);
  h.calls.length = 0;
  await h.loader(false);
  assert.deepEqual(h.calls, ["/api/lookups", "full-customer-directory"]);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a pending or failed newer focus refresh cannot discard the valid directory needed to open a work form", async () => {
  const first = deferred(), focus = deferred();
  let reads = 0;
  const h = referenceHarness({ fetchCustomerDirectory: () => ++reads === 1 ? first.promise : focus.promise });
  const form = state(null), opening = state(null);
  const open = callback("openWork", {
    workOpenVersion: { current: 0 }, setWorkOpening: opening.set, setWorkModal: form.set,
    loadReferenceData: h.loader, jsonFetch: assert.fail,
    isAborted: (error) => error?.name === "AbortError",
  });
  const task = open(undefined, "synthetic-customer");
  const refresh = h.loader(false);
  const rejectedRefresh = assert.rejects(refresh, /synthetic focus failure/);
  first.resolve([{ id: "synthetic-customer" }]);
  await task;
  assert.equal(form.current.mode, "new");
  assert.deepEqual(h.customers.current, [{ id: "synthetic-customer" }]);
  assert.deepEqual(h.lookups.current, { workTypes: ["매물등록"] });
  focus.reject(new Error("synthetic focus failure"));
  await rejectedRefresh;
  assert.deepEqual(h.customers.current, [{ id: "synthetic-customer" }]);
});

test("an older directory response never replaces an already applied newer successful focus refresh", async () => {
  const first = deferred(), focus = deferred();
  let reads = 0;
  const h = referenceHarness({ fetchCustomerDirectory: () => ++reads === 1 ? first.promise : focus.promise });
  const a = h.loader(), b = h.loader(false);
  focus.resolve([{ id: "newer-customer" }]);
  await b;
  first.resolve([{ id: "older-customer" }]);
  await a;
  assert.deepEqual(h.customers.current, [{ id: "newer-customer" }]);
});

test("home starts dashboard and lightweight references concurrently without requesting form-only data", async () => {
  const calls = [];
  let finishDashboard, finishReferences;
  const dashboard = new Promise((resolve) => { finishDashboard = resolve; });
  const references = new Promise((resolve) => { finishReferences = resolve; });
  const refresh = callback("refreshBase", {
    refreshDashboard: () => { calls.push("dashboard"); return dashboard; },
    loadReferenceData: (includeCustomers) => { calls.push(["references", includeCustomers]); return references; },
  });
  const task = refresh();
  assert.deepEqual(calls, ["dashboard", ["references", false]]);
  finishDashboard();
  finishReferences();
  await task;
});

test("focus refresh no longer uses the write/logout invalidation that aborts pending reads", async () => {
  const calls = [];
  const refresh = callback("refreshVisibleData", {
    document: { visibilityState: "visible" }, lastFocusRefresh: { current: 0 },
    focusRefreshInFlight: { current: false },
    clearClientReadCache: () => assert.fail("focus must not cancel pending work input requests"),
    invalidateCompletedClientReads: () => calls.push("expire-completed"),
    setInsightsRefreshKey() {}, setFollowUpRefreshKey() {},
    currentView: { current: "journal" }, workLogs: [],
    refreshBase: async () => calls.push("base"),
    loadWorkLogs: async () => calls.push("journal"),
    loadCalendar: assert.fail, loadListings: assert.fail, loadCustomers: assert.fail,
    showLoadError: assert.fail,
  });
  refresh();
  assert.deepEqual(calls, ["expire-completed", "base", "journal"]);
});

test("focus events share a slow first refresh and revalidate once afterwards for changes from another device", async () => {
  const first = deferred(), fresh = deferred(), calls = [], inFlight = { current: false };
  let reads = 0, insightsRefreshes = 0, followUpRefreshes = 0;
  const refresh = callback("refreshVisibleData", {
    document: { visibilityState: "visible" }, lastFocusRefresh: { current: 0 }, focusRefreshInFlight: inFlight,
    invalidateCompletedClientReads: () => { calls.push("expire-completed"); return true; },
    setInsightsRefreshKey() { insightsRefreshes += 1; }, setFollowUpRefreshKey() { followUpRefreshes += 1; }, currentView: { current: "today" }, workLogs: [],
    refreshBase: () => { calls.push("base"); return ++reads === 1 ? first.promise : fresh.promise; },
    loadWorkLogs: assert.fail, loadCalendar: assert.fail, loadListings: assert.fail, loadCustomers: assert.fail, showLoadError: assert.fail,
  });
  refresh();
  refresh();
  assert.deepEqual(calls, ["expire-completed", "base"]);
  assert.equal(inFlight.current, true);
  first.resolve({ version: "before-other-device-change" });
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["expire-completed", "base", "expire-completed", "base"]);
  assert.equal(inFlight.current, true);
  refresh();
  assert.equal(reads, 2);
  fresh.resolve({ version: "after-other-device-change" });
  await new Promise(setImmediate);
  assert.equal(inFlight.current, false);
  assert.equal(reads, 2);
  assert.equal(insightsRefreshes, 1, "the child view's fresh, independently cancelled request must not restart again");
  assert.equal(followUpRefreshes, 1);
});
