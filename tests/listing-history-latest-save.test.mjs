import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { formatHistoryTimestamp } from "../app/history-timestamps.ts";
import { getWorkProperties, workPropertyLabel } from "../app/work-property-summary.ts";
import { WorkSummaryProperties } from "./helpers/work-summary-properties.mjs";
import { ListingHistorySummary } from "./helpers/listing-history-summary.mjs";

// Exercise the real parent modal plus its real summary, with no requests and
// entirely synthetic notes. Business-date order and save order are distinct.
const source = readFileSync(new URL("../app/work-manager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "HistoryModal");
assert.ok(node);
const code = ts.transpileModule(node.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
}).outputText;
const environment = {
  React, Modal: ({ children }) => children, Icon: () => null, EmptyState: "aside",
  targetText: workPropertyLabel, displayDate: (value) => value.replaceAll("-", "."), statusTone: () => "normal",
  getWorkProperties, workPropertyLabel, WorkSummaryProperties, ListingHistorySummary, formatHistoryTimestamp,
};
const HistoryModal = new Function(...Object.keys(environment), `${code}; return HistoryModal;`)(...Object.values(environment));
const markup = (element) => renderToStaticMarkup(element);
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
const hasClass = (element, name) => element.props.className?.split(/\s+/).includes(name);
const byClass = (tree, name) => descendants(tree).filter((element) => hasClass(element, name));
const listing = {
  identity_key: "아파트|합성단지|106|1503", status: "매물등록", property_type: "아파트", building_name: "합성단지",
  building_dong: "106", unit_number: "1503", sale_price: "35000", jeonse_price: "", monthly_rent: "",
  source_notes: "엑셀에 남아 있는 합성 원본 메모", updated_at: "2026-09-20T12:00:00Z",
};
const event = (id, values = {}) => ({
  id, event_date: "2026-09-01", status: "매물수정", customer_id: "synthetic-customer", customer_name: "합성 고객",
  notes: "합성 임차인 연락처 확인 메모", work_log_id: `work-${id}`, work_updated_at: "2026-09-13T04:05:06Z",
  created_at: "2026-09-01 01:00:00", ...values,
});
const future = event("future", { event_date: "2026-09-17", status: "잔금예정", notes: "미리 등록한 합성 미래 일정", work_updated_at: "2026-09-10T01:00:00Z" });
const edited = event("edited", { notes: "  합성 임차인 연락처 확인 방식 변경\n\n방문 전에 다시 확인하기  " });
function history(overrides = {}, callbacks = {}) {
  return HistoryModal({
    data: { title: "합성 매물 이력", subtitle: "업무일과 저장 시각 구분", listing, items: [future, edited], ...overrides },
    onClose() {}, onRefresh() {}, onOpenWork() {}, onNewWork() {}, onFollowUp() {}, onCopy() {}, ...callbacks,
  });
}
function summary(tree) {
  const element = descendants(tree).find((element) => element.type === ListingHistorySummary);
  assert.ok(element, "the actual summary is wired into the modal");
  return { element, tree: ListingHistorySummary(element.props) };
}
function timeline(tree) {
  const list = byClass(tree, "history-list")[0];
  assert.ok(list);
  return React.Children.toArray(list.props.children).filter(React.isValidElement);
}

test("9월 1일 업무를 9월 13일 저장하면 상단에 수정 내용을 보여주고 9월 17일 미래 일정은 위로 올리지 않는다", () => {
  const items = Object.freeze([Object.freeze({ ...future }), Object.freeze({ ...edited })]);
  const before = JSON.stringify(items);
  const tree = history({ items });
  const top = summary(tree).tree;
  const recent = byClass(top, "listing-latest-save")[0];
  const text = markup(recent);
  assert.match(text, /최근 저장한 업무 내용/);
  assert.match(text, /2026\.09\.01/);
  assert.match(text, /2026\.09\.13 13:05/);
  assert.match(text, /한국시간/);
  assert.match(text, /합성 임차인 연락처 확인 방식 변경/);
  assert.doesNotMatch(text, /미리 등록한 합성 미래 일정|2026\.09\.17|2026\.09\.20/);
  assert.equal(byClass(recent, "listing-latest-save-content")[0].props.children, edited.notes);
  assert.equal(JSON.stringify(items), before, "selecting the latest save does not rewrite or reorder its input");
});

test("상단 선택과 무관하게 아래 타임라인은 업무일 순서를 유지하며 각 업무일과 실제 저장 시각을 따로 읽는다", () => {
  const opened = [];
  const tree = history({}, { onOpenWork: (id) => opened.push(id) });
  const rows = timeline(tree);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => descendants(row).find((element) => element.type === "time" && element.props.dateTime).props.dateTime), ["2026-09-17", "2026-09-01"]);
  assert.match(markup(rows[0]), /업무일 2026\.09\.17/);
  assert.match(markup(rows[0]), /최근 저장.*2026\.09\.10 10:00/);
  assert.match(markup(rows[1]), /업무일 2026\.09\.01/);
  assert.match(markup(rows[1]), /최근 저장.*2026\.09\.13 13:05/);
  rows.forEach((row) => row.props.onClick());
  assert.deepEqual(opened, [future.work_log_id, edited.work_log_id]);
  const top = summary(tree).tree;
  const open = descendants(top).find((element) => element.type === "button");
  assert.equal(open.props.type, "button");
  open.props.onClick();
  assert.deepEqual(opened, [future.work_log_id, edited.work_log_id, edited.work_log_id], "the top action opens the edited work, not the future date's work");
});

test("현재 매물 상태·가격과 최근 저장한 업무 내용은 별개 표제로 구분하며 원본 메모는 처음에 접힌 채 전문을 보존한다", () => {
  const sourceNotes = `  엑셀 원본의 합성 임차인 메모\n\n<확인> & ${"합성 원문 ".repeat(90)}\n끝  `;
  const tree = history({ listing: { ...listing, source_notes: sourceNotes } });
  const current = byClass(tree, "listing-history-context")[0];
  const price = React.Children.toArray(current.props.children).find((element) => element.type === "p");
  assert.match(markup(price), /현재 매물.*매물등록.*매매 35000/);
  const top = summary(tree).tree;
  const original = descendants(top).find((element) => element.type === "details");
  assert.ok(original);
  assert.equal(Boolean(original.props.open), false);
  assert.match(markup(original), /엑셀 원본 메모/);
  assert.ok(descendants(original).some((element) => element.type === "p" && element.props.children === sourceNotes));
  assert.ok(markup(original).includes(sourceNotes.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
  assert.equal(byClass(top, "listing-latest-save-content")[0].props.children, edited.notes);
  assert.doesNotMatch(markup(byClass(top, "listing-latest-save")[0]), /엑셀 원본의 합성 임차인 메모/);
});

test("같은 업무를 다시 저장해 새 응답으로 그리면 상단 내용과 저장시각만 갱신되고 원래 업무일은 그대로다", () => {
  const initial = history({ items: [future, { ...edited, notes: "수정 전 합성 연락 메모", work_updated_at: "2026-09-09T01:00:00Z" }] });
  assert.match(markup(summary(initial).tree), /미리 등록한 합성 미래 일정/);
  const updated = history({ items: [future, edited] });
  const top = byClass(summary(updated).tree, "listing-latest-save")[0];
  assert.match(markup(top), /합성 임차인 연락처 확인 방식 변경/);
  assert.doesNotMatch(markup(top), /수정 전 합성 연락 메모|미리 등록한 합성 미래 일정/);
  assert.match(markup(top), /2026\.09\.01/);
  assert.deepEqual(timeline(initial).map((row) => row.key), timeline(updated).map((row) => row.key));
});

test("목록을 다시 읽는 중이거나 읽기에 실패하면 상단 업무 열기 연결도 중지한다", () => {
  for (const state of [{ loading: true }, { error: "합성 일시 조회 실패" }]) {
    const tree = history(state, { onOpenWork: () => assert.fail("a pending summary must not open an old work") });
    const top = summary(tree);
    assert.equal(top.element.props.onOpenWork, undefined);
    assert.equal(descendants(top.tree).filter((element) => element.type === "button").length, 0);
  }
});

test("고객·날짜별 업무 이력은 listing 전용 상단을 만들지 않고 각 업무의 updated_at을 한국 시각으로 표시한다", () => {
  const tree = history({ listing: undefined, customer: { id: "synthetic-customer", name: "합성 고객" }, items: [{
    id: "saved-work", work_date: "2026-09-01", work_type: "전화", customer_name: "합성 고객", content: "합성 연락 방식 변경", updated_at: "2026-09-13 04:05:06", property_count: 0,
  }] });
  assert.equal(descendants(tree).filter((element) => element.type === ListingHistorySummary).length, 0);
  const row = timeline(tree)[0];
  assert.match(markup(row), /업무일 2026\.09\.01/);
  assert.match(markup(row), /최근 저장.*2026\.09\.13 13:05/);
  assert.match(markup(row), /합성 연락 방식 변경/);
  const css = readFileSync(new URL("../app/workflow-history-backup.css", import.meta.url), "utf8");
  const savedStyle = css.match(/\.history-list \.history-entry-saved\s*\{([^}]*)\}/)?.[1];
  assert.ok(savedStyle, "save-time styling is more specific than the global .history-list p body rule");
  assert.match(savedStyle, /color:\s*var\(--muted\)/);
  assert.match(savedStyle, /font-size:\s*var\(--text-caption\)/);
  assert.match(savedStyle, /white-space:\s*normal/);
});

test("저장시각 없는 과거 원본 이력은 업무일을 저장시각으로 꾸며내지 않으며 연결 없는 원문은 읽기만 제공한다", () => {
  const legacy = event("original", { work_log_id: "", work_updated_at: undefined, created_at: undefined, notes: "합성 과거 원본 내용" });
  const tree = history({ items: [legacy] });
  const row = timeline(tree)[0];
  assert.equal(byClass(row, "history-entry-saved").length, 0);
  assert.equal(row.props.disabled, true);
  const top = summary(tree).tree;
  assert.match(markup(top), /저장 시각 정보 없음/);
  assert.match(markup(top), /업무일 기준/);
  assert.doesNotMatch(markup(top), /최근 저장 ·|최근 저장한 업무 내용/);
  assert.equal(descendants(top).filter((element) => element.type === "button").length, 0);
});
