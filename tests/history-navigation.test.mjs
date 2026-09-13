import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { hasPropertyDraft, propertyFromListing } from "../app/listing-draft.ts";

// Exercise the actual component's async handlers, with only their I/O replaced.
const source = readFileSync(new URL("../app/work-manager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, environment) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, `Handler ${name} exists`);
  const js = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(environment), `${js}; return ${name};`)(...Object.values(environment));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function stateBox(initial = null) {
  const state = { current: initial };
  state.set = (next) => { state.current = typeof next === "function" ? next(state.current) : next; };
  return state;
}

test("explicitly editing work A then B cannot replace B's draft with A's late response", async () => {
  const a = deferred(), b = deferred(), state = stateBox(), version = { current: 0 };
  const open = handler("openWork", {
    workOpenVersion: version,
    loadReferenceData: async () => {},
    jsonFetch: (url) => url.endsWith("/a") ? a.promise : b.promise,
    setWorkModal: state.set,
    showLoadError: assert.fail,
  });
  const first = open("a"), second = open("b");
  b.resolve({ workLog: { id: "b" } });
  await second;
  state.current.unsavedDraft = "keep this";
  a.resolve({ workLog: { id: "a" } });
  await first;
  assert.equal(state.current.item.id, "b");
  assert.equal(state.current.unsavedDraft, "keep this");
});

test("closing the originating history invalidates a pending explicit edit open", async () => {
  const pending = deferred(), state = stateBox(), version = { current: 0 };
  const open = handler("openWork", {
    workOpenVersion: version, loadReferenceData: async () => {},
    jsonFetch: () => pending.promise, setWorkModal: state.set, showLoadError: assert.fail,
  });
  const task = open("a");
  version.current += 1;
  pending.resolve({ workLog: { id: "a" } });
  await task;
  assert.equal(state.current, null);
});

test("customer history opens immediately and accepts only the latest requested customer's records", async () => {
  const a = deferred(), b = deferred(), state = stateBox(), version = { current: 0 };
  const open = handler("showCustomerHistory", {
    historyOpenVersion: version, setGlobalSearchOpen: () => {}, setHistoryModal: state.set,
    fetchAllWorkLogs: (params) => params.get("customerId") === "a" ? a.promise : b.promise,
  });
  const first = open({ id: "a", name: "예시 A" });
  assert.equal(state.current.loading, true);
  const second = open({ id: "b", name: "예시 B" });
  b.resolve([{ id: "b-work" }]);
  await second;
  a.resolve([{ id: "a-work" }]);
  await first;
  assert.equal(state.current.customer.id, "b");
  assert.deepEqual(state.current.items, [{ id: "b-work" }]);
});

test("closing history prevents a late error from reopening it", async () => {
  const pending = deferred(), state = stateBox(), version = { current: 0 };
  const open = handler("showCustomerHistory", {
    historyOpenVersion: version, setGlobalSearchOpen: () => {}, setHistoryModal: state.set,
    fetchAllWorkLogs: () => pending.promise,
  });
  const task = open({ id: "a", name: "예시 A" });
  version.current += 1;
  state.set(null);
  pending.reject(new Error("offline"));
  await task;
  assert.equal(state.current, null);
});

test("refreshing after editing retains the history's rows until their replacement arrives", async () => {
  const customer = { id: "a", name: "예시" }, oldItems = [{ id: "work", content: "before" }];
  const state = stateBox({ customer, items: oldItems });
  const pending = deferred();
  const open = handler("showCustomerHistory", {
    historyOpenVersion: { current: 0 }, setGlobalSearchOpen: () => {}, setHistoryModal: state.set,
    fetchAllWorkLogs: () => pending.promise,
  });
  const task = open(customer, true);
  assert.equal(state.current.items, oldItems);
  pending.resolve([{ id: "work", content: "after" }]);
  await task;
  assert.equal(state.current.items[0].content, "after");
  const saved = source.slice(source.indexOf("onSaved={async (message) =>"), source.indexOf("{customerModal &&"));
  assert.match(saved, /refreshHistory\(historyModal\)/);
  assert.doesNotMatch(saved, /setHistoryModal\(null\)/);
});

test("deleting a listing's last event clears obsolete history but leaves its target retryable", async () => {
  const key = "아파트|예시||101";
  const state = stateBox({ title: "예시", items: [{ id: "deleted" }], listing: { identity_key: key } });
  const open = handler("showListingByKey", {
    historyOpenVersion: { current: 0 }, setGlobalSearchOpen: () => {}, setHistoryModal: state.set,
    jsonFetch: async () => { throw new Error("매물을 찾을 수 없습니다."); },
    targetText: () => "예시",
  });
  await open(key, true);
  assert.deepEqual(state.current.items, []);
  assert.equal(state.current.listing, undefined);
  assert.equal(state.current.listingKey, key);
  assert.match(state.current.error, /저장된 매물 이력이 없습니다/);
});

test("work table and editor expose separate history controls without nested buttons or submit side effects", () => {
  const table = source.slice(source.indexOf("function WorkTable("), source.indexOf("function ListingsView("));
  assert.match(table, /className="table-row work-record-row"/);
  assert.match(table, /고객 이력 보기/);
  assert.match(table, /매물 이력 보기/);
  assert.match(table, /업무 내용 보기/);
  assert.doesNotMatch(table, /업무 수정|내용 확인 및 수정|외 \{Number\(item\.property_count\) - 1\}건/);
  assert.match(table, /const properties = getWorkProperties\(item\)/);
  assert.match(table, /getPropertyDisplayGroups\(properties\)/);
  assert.match(table, /group\.items\.map/);
  assert.doesNotMatch(table, /<button\s+className="table-row/);
  for (const button of table.matchAll(/<button\b[\s\S]*?>/g)) assert.match(button[0], /type="button"/);
  const editor = source.slice(source.indexOf("function WorkModal("), source.indexOf("function CustomerModal("));
  assert.match(editor, /<RelatedHistory/);
  assert.match(editor, /onClose=\{closeReferenceHistory\}/);
  assert.match(editor, /currentWorkId=\{item\?\.id\}/);
});

const existingListing = {
  identity_key: "아파트|예시||101", property_type: "아파트", building_name: "예시",
  building_dong: "", unit_number: "101", size_type: "33", sale_price: "확인 필요",
  jeonse_price: "", monthly_rent: "", source_notes: "새 상담으로 복사하면 안 되는 원문",
};
function listingImportHarness(initial, index, confirm) {
  const details = stateBox(initial);
  const changes = { closed: 0, notice: "", history: "open" };
  const apply = handler("applyExistingListing", {
    listingPickerIndex: index, saving: false, details: initial, hasPropertyDraft, propertyFromListing,
    window: { confirm }, setDetails: details.set,
    setReferenceHistory: (value) => { changes.history = value; },
    setListingLoadedMessage: (value) => { changes.notice = value; },
    closeListingPicker: () => { changes.closed += 1; },
  });
  return { apply, details, changes };
}

test("an existing listing fills only the chosen empty property without saving or changing customer/content", () => {
  const other = { ...propertyFromListing(existingListing), buildingName: "다른 물건" };
  const empty = Object.fromEntries(Object.keys(other).map((key) => [key, ""]));
  const harness = listingImportHarness([other, empty], 1, () => assert.fail("empty property needs no overwrite prompt"));
  harness.apply(existingListing);
  assert.equal(harness.details.current[0], other);
  assert.deepEqual(harness.details.current[1], propertyFromListing(existingListing));
  assert.equal(harness.changes.closed, 1);
  assert.equal(harness.changes.history, null);
  assert.match(harness.changes.notice, /물건 2/);
  const body = source.slice(source.indexOf("function applyExistingListing("), source.indexOf("const [initialValues]"));
  assert.doesNotMatch(body, /jsonFetch|setCustomerId|setContent|setWorkDate|setWorkType/);
});

test("declining listing replacement keeps the entered property and search panel unchanged", () => {
  const draft = { ...propertyFromListing(existingListing), buildingName: "작성 중인 주소", source: "입력 중인 출처" };
  let prompts = 0;
  const initial = [draft];
  const harness = listingImportHarness(initial, 0, () => { prompts += 1; return false; });
  harness.apply(existingListing);
  assert.equal(prompts, 1);
  assert.equal(harness.details.current, initial);
  assert.equal(harness.changes.closed, 0);
  assert.equal(harness.changes.history, "open");
});

test("confirming listing replacement copies property fields only and never injects historical notes", () => {
  const draft = { ...propertyFromListing(existingListing), buildingName: "작성 중인 주소", source: "입력 중인 출처" };
  let prompts = 0;
  const harness = listingImportHarness([draft], 0, () => { prompts += 1; return true; });
  harness.apply(existingListing);
  assert.equal(prompts, 1);
  assert.deepEqual(harness.details.current[0], propertyFromListing(existingListing));
  assert.equal(harness.details.current[0].source, "");
  assert.equal(harness.changes.closed, 1);
});
