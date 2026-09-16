import assert from "node:assert/strict";
import test from "node:test";
import { findWorkDraftIssue } from "../app/work-form-rules.ts";
import { initialWorkDraft, workModalHandler, workModalSource } from "./helpers/work-copy.mjs";

const record = {
  id: "synthetic-original", legacy_id: 123, work_date: "2025-10-01", work_type: "집방문",
  customer_id: "synthetic-customer", customer_name: "합성 고객", content: "  원문 첫 줄\n둘째 줄 & <내용>  ",
  created_at: "2025-10-01", updated_at: "2026-09-01",
  details: Array.from({ length: 10 }, (_, index) => ({ id: `old-property-${index}`, work_log_id: "synthetic-original", sequence: index + 1,
    property_type: "아파트", building_name: "합성단지", building_dong: "106", unit_number: String(1001 + index), size_type: "33A",
    sale_price: index === 0 ? 0 : "35000", jeonse_price: "25000", monthly_rent: "1000/50", source: `합성업소 ${index + 1}` })),
};
const customers = [{ id: record.customer_id }, { id: "synthetic-other" }];
const lookups = { workTypes: ["집방문", "전화", "매물등록"] };

function submitHarness(draft, read, options = {}) {
  const requests = [], saved = [], errors = [], busy = [];
  const savePendingRef = { current: false };
  const submit = workModalHandler("submit", {
    ...draft, modal: { mode: "copy", item: record }, saving: false, savePendingRef,
    savingMountedRef: { current: true }, customers, lookups, findWorkDraftIssue,
    setSaving() {}, setErrorField() {}, setError: (message) => { if (message) errors.push(message); }, onBusyChange: (value) => busy.push(value),
    jsonFetch: async (url, init) => { requests.push({ url, method: init.method, body: JSON.parse(init.body) }); return read(url, init); },
    onSaved: async (...args) => saved.push(args), ...options,
  });
  return { submit: () => submit({ preventDefault() {} }), requests, saved, errors, busy, savePendingRef };
}

test("복사 초안은 오늘 날짜·고객·구분·원문·10개 매물 전체를 유지하고 원본 식별자를 제외한다", () => {
  const original = structuredClone(record), snapshot = JSON.stringify(original);
  Object.freeze(original.details);
  original.details.forEach(Object.freeze);
  Object.freeze(original);
  const draft = initialWorkDraft({ mode: "copy", item: original });
  assert.equal(draft.item, undefined, "never enter update mode");
  assert.equal(draft.workDate, "2026-09-16");
  assert.equal(draft.customerId, original.customer_id);
  assert.equal(draft.workType, original.work_type);
  assert.equal(draft.content, original.content);
  assert.equal(draft.details.length, 10);
  for (const [index, detail] of draft.details.entries()) {
    assert.equal(detail.unitNumber, String(1001 + index));
    assert.equal(detail.source, `합성업소 ${index + 1}`);
    assert.equal(detail.salePrice, index === 0 ? "0" : "35000");
    assert.equal(detail.jeonsePrice, "25000");
    assert.equal(detail.monthlyRent, "1000/50");
    assert.deepEqual(Object.keys(detail), ["propertyType", "buildingName", "buildingDong", "unitNumber", "sizeType", "salePrice", "jeonsePrice", "monthlyRent", "source"]);
  }
  draft.details[0].unitNumber = "새 호수";
  draft.content = "새 내용";
  assert.equal(JSON.stringify(original), snapshot);
});

test("물건·내용 없는 업무도 복사할 수 있고 일반 수정은 원래 날짜와 ID를 유지한다", () => {
  const empty = initialWorkDraft({ mode: "copy", item: { ...record, content: "", details: [] } });
  assert.equal(empty.content, "");
  assert.equal(empty.details.length, 1);
  assert(Object.values(empty.details[0]).every((value) => value === ""));
  const edit = initialWorkDraft({ mode: "edit", item: record });
  assert.equal(edit.item, record);
  assert.equal(edit.workDate, record.work_date);
});

test("복사 후 바꾼 날짜·고객·구분·내용·매물을 POST로 신규 저장하고 생성 결과를 넘긴다", async () => {
  const draft = initialWorkDraft({ mode: "copy", item: record });
  Object.assign(draft, { workDate: "2026-09-20", customerId: "synthetic-other", workType: "전화", content: "다음 상담" });
  draft.details = draft.details.slice(1);
  draft.details[0].salePrice = "36000";
  const created = { ...record, id: "synthetic-new", work_date: draft.workDate, content: draft.content };
  const h = submitHarness(draft, async () => ({ workLog: created }));
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/work-logs");
  assert.equal(h.requests[0].method, "POST");
  assert.deepEqual(h.requests[0].body, { workDate: draft.workDate, customerId: draft.customerId, workType: draft.workType, content: draft.content, details: draft.details });
  assert.deepEqual(h.saved, [["업무를 복사해 새 업무로 저장했습니다.", created]]);
  assert.deepEqual(h.errors, []);
});

test("복사 저장 연속 클릭은 React 재렌더 전에 일어나도 한 번만 전송한다", async () => {
  let finish;
  const h = submitHarness(initialWorkDraft({ mode: "copy", item: record }), () => new Promise((resolve) => { finish = resolve; }));
  const first = h.submit();
  await h.submit();
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.savePendingRef.current, true);
  finish({ workLog: { ...record, id: "new" } });
  await first;
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.busy, [true, false]);
});

test("복사 저장 실패는 초안을 보존하고 잠금을 해제해 재시도할 수 있다", async () => {
  const draft = initialWorkDraft({ mode: "copy", item: record }), before = JSON.stringify(draft);
  let fail = true;
  const h = submitHarness(draft, async () => { if (fail) throw new Error("합성 저장 실패"); return { workLog: { ...record, id: "new" } }; });
  await h.submit();
  assert.deepEqual(h.errors, ["합성 저장 실패"]);
  assert.equal(h.savePendingRef.current, false);
  assert.equal(h.saved.length, 0);
  assert.equal(JSON.stringify(draft), before);
  fail = false;
  await h.submit();
  assert.equal(h.saved.length, 1);
});

test("복사본의 필수값이 빠졌거나 원본 고객을 선택할 수 없으면 저장을 막는다", async () => {
  for (const changes of [{ customerId: "deleted-customer" }, { workDate: "" }, { workType: "" }, { workType: "매물등록", details: [] }]) {
    const h = submitHarness({ ...initialWorkDraft({ mode: "copy", item: record }), ...changes }, () => assert.fail("invalid copy must not write"));
    await h.submit();
    assert.equal(h.requests.length, 0);
    assert.equal(h.errors.length, 1);
    assert.equal(h.savePendingRef.current, false);
  }
});

test("편집한 복사본 취소에는 확인이 있고 거절·저장 중에는 원본으로 돌아가지 않는다", () => {
  for (const [dirty, saving, approved, expected] of [[true, false, false, 0], [true, false, true, 1], [false, false, false, 1], [true, true, true, 0]]) {
    let closed = 0, prompted = 0;
    const close = workModalHandler("requestClose", { dirty, saving, window: { confirm: () => { prompted++; return approved; } }, onClose: () => closed++ });
    close();
    assert.equal(closed, expected);
    assert.equal(prompted, dirty && !saving ? 1 : 0);
  }
  assert.match(workModalSource, /업무 복사 · 새 업무 등록/);
  assert.match(workModalSource, /새 업무로 저장/);
  assert.match(workModalSource, /원본은 바뀌지 않습니다/);
  assert.match(workModalSource, /if \(!saving && item\) onDelete/);
});
