import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ListingHistorySummary } from "./helpers/listing-history-summary.mjs";
import { HistoryWorkTypeFilter } from "./helpers/history-work-type-filter.mjs";
import { WorkSummaryProperties } from "./helpers/work-summary-properties.mjs";
import { formatHistoryTimestamp } from "../app/history-timestamps.ts";
import { createHistoryRequestScope, HISTORY_PAGE_SIZE, historyQueryUrl, mergeHistoryRecords, retryInterruptedHistoryRead } from "../app/history-query.ts";

const source = readFileSync(new URL("../app/related-history.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("related-history.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function compile(names, environment) {
  const declarations = names.map((name) => {
    const node = ast.statements.find((candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
    assert.ok(node, `${name} exists`);
    return node.getText(ast);
  });
  const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export /gm, "");
  return new Function(...Object.keys(environment), `${compiled}; return ${names.at(-1)};`)(...Object.values(environment));
}
const shared = { React, Icon: () => null, ListingHistorySummary, WorkSummaryProperties, formatHistoryTimestamp, HistoryWorkTypeFilter };
const Row = compile(["HistoryRecordRow"], { ...shared, useId: React.useId, useState: React.useState });
const markup = (tree) => renderToStaticMarkup(tree);
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function panelHarness(target, read, workTypes = ["전화", "집방문", "매물등록", "매물수정", "잔금예정"]) {
  const states = [], effects = [], cleanups = new Map(), requests = [];
  let cursor = 0;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  };
  const useRef = (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = { current: initial };
    return states[index];
  };
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const useCallback = (callback, deps) => {
    const index = cursor++;
    if (!sameDeps(states[index]?.deps, deps)) states[index] = { deps, callback };
    return states[index].callback;
  };
  const useEffect = (effect, deps) => {
    const index = cursor++;
    if (!sameDeps(states[index]?.deps, deps)) {
      states[index] = { deps };
      effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); });
    }
  };
  const Panel = compile(["errorMessage", "HistoryPanel"], {
    ...shared, useState, useRef, useEffect, useId: () => "synthetic-panel", useCallback,
    createHistoryRequestScope, HISTORY_PAGE_SIZE, historyQueryUrl, mergeHistoryRecords, retryInterruptedHistoryRead, HistoryRecordRow: Row,
    clientJsonFetch: (url, options) => { requests.push({ url, options }); return read(url, options); },
  });
  const render = () => { cursor = 0; return Panel({ target, workTypes, onClose() {} }); };
  const settle = async () => { render(); for (const effect of effects.splice(0)) effect(); await new Promise((resolve) => setImmediate(resolve)); return render(); };
  return {
    render, requests,
    mount: settle,
    settle,
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}
const listingTarget = { kind: "listing", key: "아파트|합성단지|106|1503", name: "합성단지 106동 1503호" };
const customerTarget = { kind: "customer", id: "synthetic-customer", name: "합성 고객" };
const events = [
  { id: "future", work_log_id: "future-work", event_date: "2026-12-31", status: "잔금예정", customer_name: "합성 고객", notes: "미래 업무의 원래 메모", work_updated_at: "2026-09-10 03:00:00", created_at: "2026-09-10 03:00:00" },
  { id: "changed", work_log_id: "changed-work", event_date: "2026-08-20", status: "매물수정", customer_name: "합성 고객", notes: "과거 업무에서 방금 고친 메모", work_updated_at: "2026-09-13 05:10:00", created_at: "2026-08-20 03:00:00" },
];

test("보조 매물 이력은 전체 연속 메모를 먼저 표시하고 개별 업무 목록은 처음 접어 둔다", async (t) => {
  const sourceNotes = events.map((event) => `${event.notes}\n(${event.status}) (${event.event_date})`).join("\n\n");
  const h = panelHarness(listingTarget, async () => ({ listing: { source_notes: sourceNotes }, events }));
  t.after(() => h.dispose());
  const tree = await h.mount();
  const summary = descendants(tree).find((element) => element.type === ListingHistorySummary);
  assert.ok(summary);
  assert.equal(summary.props.events, events);
  assert.equal(summary.props.sourceNotes, sourceNotes);
  assert.equal(summary.props.onOpenWork, undefined, "inline history cannot navigate away from the draft");
  const memoHtml = markup(summary);
  assert.match(memoHtml, /과거 업무에서 방금 고친 메모/);
  assert.match(memoHtml, /미래 업무의 원래 메모/);
  assert.doesNotMatch(memoHtml, /2026\.09\.13 14:10|최근 저장|엑셀 원본 메모|<details/);
  for (const event of events) assert.equal(memoHtml.split(event.notes).length - 1, 1);
  assert.ok(memoHtml.indexOf(events[0].notes) < memoHtml.indexOf(events[1].notes));
  assert.doesNotMatch(markup(tree), /한국\s*시간/);
  const records = descendants(tree).filter((element) => element.type === Row).map((element) => element.props.record);
  assert.deepEqual(records.map((record) => record.id), ["future", "changed"]);
  assert.deepEqual(records.map((record) => record.savedAt), ["2026.09.10 12:00", "2026.09.13 14:10"]);
  assert.match(markup(tree), /업무일 최신순 · 2건/);
  assert.match(markup(tree), /업무일 · 2026\.12\.31/);
  const detail = descendants(tree).find((element) => element.type === "details" && element.props.className === "listing-individual-records");
  assert.ok(detail);
  assert.equal(detail.props.open, undefined);
  assert.match(markup(detail), /개별 업무 보기 · 2건/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.method, undefined);
});

test("보조 이력의 저장 시각은 유효한 이벤트 시각으로 대체하고 없을 때 날짜를 추정하지 않는다", async (t) => {
  const h = panelHarness(listingTarget, async () => ({ listing: {}, events: [
    { ...events[0], work_updated_at: "broken", created_at: "2026-09-13T20:03:00Z" },
    { ...events[1], work_updated_at: undefined, created_at: undefined },
  ] }));
  t.after(() => h.dispose());
  const tree = await h.mount();
  const rows = descendants(tree).filter((element) => element.type === Row);
  assert.equal(rows[0].props.record.savedAt, "2026.09.14 05:03");
  assert.equal(rows[1].props.record.savedAt, "");
  assert.match(markup(rows[0]), /최근 저장 · 2026\.09\.14 05:03/);
  assert.doesNotMatch(markup(rows[0]), /한국\s*시간/);
  assert.doesNotMatch(markup(rows[1]), /최근 저장 ·|한국시간|Invalid Date/);
});

test("보조 매물의 개별 업무 목록도 상태 이력과 별개로 전체 업무를 표시한다", async (t) => {
  const works = Array.from({ length: 12 }, (_, i) => ({ id: `work-${i}`, work_date: "2026-09-16", work_type: "전화", customer_name: "합성 고객", customer_id: "합성 업소", content: `상담 ${i}`, property_count: 0 }));
  const h = panelHarness(listingTarget, async () => ({ listing: {}, events, workLogs: works }));
  t.after(() => h.dispose());
  let tree = await h.mount();
  assert.match(markup(tree), /개별 업무 보기 · 12건/);
  assert.match(markup(tree), /합성 고객.*합성 업소/);
  assert.equal(descendants(tree).filter((element) => element.type === Row).length, 10);
  descendants(tree).find((element) => element.type === "button" && markup(element).includes("10건 더 보기")).props.onClick();
  tree = await h.settle();
  assert.deepEqual(descendants(tree).filter((element) => element.type === Row).map((element) => element.props.record.id), works.map((work) => work.id));
  assert.equal(h.requests.length, 1);
  assert.equal(descendants(tree).find((element) => element.type === ListingHistorySummary).props.events, events);
});

test("고객 보조 이력은 원래 업무일과 업무 저장시각을 분리하고 매물 원본 요약을 만들지 않는다", async (t) => {
  const h = panelHarness(customerTarget, async () => ({ workLogs: [
    { id: "customer-work", work_date: "2026-08-20", work_type: "전화", content: "고객 상담 메모", customer_name: "합성 고객", customer_id: "합성 ID", property_count: 0, updated_at: "2026-09-13 01:02:00" },
    { id: "legacy-work", work_date: "2026-07-20", work_type: "전화", content: "기존 메모", customer_name: "합성 고객", property_count: 0 },
  ], total: 2 }));
  t.after(() => h.dispose());
  const tree = await h.mount(), rows = descendants(tree).filter((element) => element.type === Row);
  assert.equal(rows[0].props.record.savedAt, "2026.09.13 10:02");
  assert.match(markup(rows[0]), /합성 고객.*합성 ID/);
  assert.equal(rows[1].props.record.savedAt, "");
  assert.match(markup(rows[0]), /업무일 · 2026\.08\.20/);
  assert.match(markup(rows[0]), /최근 저장 · 2026\.09\.13 10:02/);
  assert.doesNotMatch(markup(rows[0]), /한국\s*시간/);
  assert.equal(descendants(tree).some((element) => element.type === ListingHistorySummary), false);
  assert.equal(descendants(tree).some((element) => element.type === "details" && element.props.className === "listing-individual-records"), false);
  const request = new URL(h.requests[0].url, "https://test.invalid");
  assert.equal(request.searchParams.get("customerId"), customerTarget.id);
  assert.equal(request.searchParams.get("includeSource"), "1");
  assert.equal(request.searchParams.get("limit"), "10");
});

test("매물 조회 실패는 빈 이력이나 성공한 전체 메모로 표시하지 않으며 재조회로 회복한다", async (t) => {
  let fails = true;
  const h = panelHarness(listingTarget, async () => { if (fails) throw new Error("합성 이력 조회 실패"); return { listing: {}, events }; });
  t.after(() => h.dispose());
  const failed = await h.mount();
  assert.match(markup(failed), /합성 이력 조회 실패/);
  assert.doesNotMatch(markup(failed), /전체 매물 이력|이 물건에 저장된 업무·매물 이력이 없습니다/);
  fails = false;
  const retry = descendants(failed).find((element) => element.type === "button" && markup(element).includes("다시 불러오기"));
  retry.props.onClick();
  const restored = await h.settle();
  assert.match(markup(restored), /과거 업무에서 방금 고친 메모/);
  assert.doesNotMatch(markup(restored), /합성 이력 조회 실패/);
});

test("원본만 남은 매물은 원본을 기본 본문에 표시하고 없는 매물의 404는 빈 이력으로 구분한다", async (t) => {
  for (const missing of [false, true]) {
    const h = panelHarness(listingTarget, async () => {
      if (missing) throw new Error("매물을 찾을 수 없습니다.");
      return { listing: { source_notes: "옛 원본 메모" }, events: [] };
    });
    t.after(() => h.dispose());
    const tree = await h.mount(), html = markup(tree);
    assert.match(html, missing ? /이 물건에 저장된 업무·매물 이력이 없습니다/ : /연결된 개별 업무 기록은 없습니다/);
    assert.doesNotMatch(html, /최근 저장한 업무 내용|role="alert"/);
    if (missing) assert.doesNotMatch(html, /엑셀 원본 메모/);
    else {
      assert.match(html, /<p class="listing-history-memo">옛 원본 메모<\/p>/);
      assert.doesNotMatch(html, /<details|이 물건에 저장된 업무·매물 이력이 없습니다/);
      assert.equal(html.split("옛 원본 메모").length - 1, 1);
    }
  }
});

test("매물 전체 메모는 10건 미리보기와 무관하게 27건 모두 표시하며 개별 더보기는 조회를 추가하지 않는다", async (t) => {
  const history = Array.from({ length: 27 }, (_, index) => ({ ...events[index % 2], id: `event-${index}`, work_log_id: `work-${index}`, notes: `합성 이력 ${index + 1}` }));
  const h = panelHarness(listingTarget, async () => ({ listing: {}, events: history }));
  t.after(() => h.dispose());
  let tree = await h.mount();
  const summary = descendants(tree).find((element) => element.type === ListingHistorySummary);
  assert.equal(summary.props.events.length, 27);
  const html = markup(summary);
  for (let index = 1; index <= 27; index += 1) assert.match(html, new RegExp(`합성 이력 ${index}(?:\\n|<)`));
  assert.equal(descendants(tree).filter((element) => element.type === Row).length, 10);
  const details = descendants(tree).find((element) => element.type === "details" && element.props.className === "listing-individual-records");
  assert.equal(details.props.open, undefined);
  const more = descendants(details).find((element) => element.type === "button" && markup(element).includes("10건 더 보기"));
  more.props.onClick();
  tree = h.render();
  assert.equal(descendants(tree).filter((element) => element.type === Row).length, 20);
  assert.equal(h.requests.length, 1);
  assert.equal(descendants(tree).find((element) => element.type === ListingHistorySummary).props.events.length, 27);
});

test("펼친 저장 업무도 업무일과 실제 저장시각을 따로 보여주고 없는 시각은 생략한다", () => {
  for (const updated_at of ["2026-09-13 01:02:00", undefined]) {
    const saved = { id: "synthetic", work_date: "2026-08-20", work_type: "전화", customer_name: "합성 고객", content: "내용", details: [], updated_at };
    let cursor = 0;
    const View = compile(["errorMessage", "propertyLabel", "priceLabel", "SavedWorkDetails"], {
      ...shared, useEffect() {}, useState: () => [[saved, "", 0][cursor++], () => {}],
    });
    const html = markup(View({ workId: "synthetic" }));
    assert.match(html, /<dt>업무일<\/dt><dd>2026-08-20/);
    assert.equal(html.includes("<dt>최근 저장</dt>"), Boolean(updated_at));
    assert.doesNotMatch(html, /한국\s*시간/);
    if (updated_at) assert.match(html, /2026\.09\.13 10:02/);
  }
});

const filterControl = (tree) => descendants(tree).find((item) => item.type === HistoryWorkTypeFilter);
const historyRows = (tree) => descendants(tree).filter((item) => item.type === Row);
const moreButton = (tree) => descendants(tree).find((item) => item.type === "button" && markup(item).includes("10건 더 보기"));
const savedWork = (id, work_type = "전화") => ({ id, work_type, work_date: "2026-09-16", customer_name: "합성 고객", customer_id: "합성ID", content: `합성 메모 ${id}`, property_count: 0 });

test("보조 이력은 변경이력 없는 물건의 전체 업무를 바로 표시하고 구분·더보기·빈 결과를 지원한다", async (t) => {
  const works = Array.from({ length: 23 }, (_, i) => savedWork(`visit-${i}`, i < 12 ? "집방문" : "전화"));
  const h = panelHarness(listingTarget, async () => ({ listing: null, events: [], workLogs: works }));
  t.after(() => h.dispose());
  let tree = await h.mount();
  assert.match(markup(tree), /매물 변경 이력은 없으며/);
  assert.doesNotMatch(markup(tree), /<details|role="alert"|이 물건에 저장된 업무·매물 이력이 없습니다/);
  assert.equal(historyRows(tree).length, 10);
  assert.equal(filterControl(tree).props.count, 23);
  moreButton(tree).props.onClick();
  tree = h.render();
  assert.equal(historyRows(tree).length, 20);
  filterControl(tree).props.onChange("집방문");
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 12);
  assert(historyRows(tree).every((row) => row.props.record.workType === "집방문"));
  moreButton(tree).props.onClick();
  tree = h.render();
  assert.equal(historyRows(tree).length, 12);
  filterControl(tree).props.onChange("잔금예정");
  tree = await h.settle();
  assert.match(markup(tree), /잔금예정 업무 이력이 없습니다/);
  assert.equal(filterControl(tree).props.count, 0);
  filterControl(tree).props.onChange("");
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 23);
  assert.equal(h.requests.length, 1, "filtering all work does not re-fetch or drop later records");
});

test("보조 매물 구분 선택은 첫 10건 밖의 업무도 필터하고 더보기·원문·전체 복귀를 유지한다", async (t) => {
  const works = Array.from({ length: 24 }, (_, index) => savedWork(`record-${index}`, index < 11 ? "전화" : "집방문"));
  const snapshot = JSON.stringify(works);
  const h = panelHarness(listingTarget, async () => ({ listing: { source_notes: "합성 원본" }, events, workLogs: works }));
  t.after(() => h.dispose());
  let tree = await h.mount();
  filterControl(tree).props.onChange("집방문");
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 13);
  assert.equal(historyRows(tree).length, 10);
  assert.equal(historyRows(tree)[0].props.record.workId, "record-11");
  assert(historyRows(tree).every((item) => item.props.record.workType === "집방문"));
  assert.equal(descendants(tree).some((item) => item.type === ListingHistorySummary), false, "no duplicate memo above filtered records");
  assert.equal(descendants(tree).find((item) => item.props.className === "listing-individual-records").props.open, true);
  moreButton(tree).props.onClick();
  tree = h.render();
  assert.equal(historyRows(tree).length, 13);
  assert.equal(moreButton(tree), undefined);
  filterControl(tree).props.onChange("");
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 24);
  assert.equal(historyRows(tree).length, 10, "reset also resets the visible page");
  assert.equal(descendants(tree).find((item) => item.type === ListingHistorySummary).props.sourceNotes, "합성 원본");
  assert.equal(h.requests.length, 1, "listing filter reuses the full read snapshot");
  assert.equal(JSON.stringify(works), snapshot);
});

test("보조 고객 이력은 현재 페이지 밖의 업무구분을 서버에서 조회하고 다음 페이지에도 조건을 보낸다", async (t) => {
  const works = Array.from({ length: 23 }, (_, index) => savedWork(`record-${index}`, index < 11 ? "전화" : "집방문"));
  const h = panelHarness(customerTarget, async (url) => {
    const params = new URL(url, "https://test.invalid").searchParams;
    assert.equal(params.get("includeSource"), "1");
    const records = params.get("workType") ? works.filter((work) => work.work_type === params.get("workType")) : works;
    const offset = Number(params.get("offset"));
    return { workLogs: records.slice(offset, offset + 10), total: records.length };
  });
  t.after(() => h.dispose());
  let tree = await h.mount();
  assert.equal(filterControl(tree).props.count, 23);
  assert(filterControl(tree).props.workTypes.includes("집방문"));
  filterControl(tree).props.onChange("집방문");
  tree = h.render();
  assert.equal(historyRows(tree).length, 0, "hide old records immediately");
  assert.equal(filterControl(tree).props.count, undefined);
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 12);
  assert.equal(historyRows(tree).length, 10);
  moreButton(tree).props.onClick();
  tree = await h.settle();
  assert.equal(historyRows(tree).length, 12);
  assert(historyRows(tree).every((item) => item.props.record.workType === "집방문"));
  const page = new URL(h.requests.at(-1).url, "https://test.invalid").searchParams;
  assert.equal(page.get("workType"), "집방문");
  assert.equal(page.get("offset"), "10");
  filterControl(tree).props.onChange("");
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 23);
  assert.equal(historyRows(tree).length, 10);
  const reset = new URL(h.requests.at(-1).url, "https://test.invalid").searchParams;
  assert.equal(reset.has("workType"), false);
  assert.equal(reset.get("offset"), "0");
});

test("보조 고객 더보기 도중 구분을 바꾸면 취소를 무시한 이전 응답도 새 목록에 섞이지 않는다", async (t) => {
  let finishOldPage;
  const h = panelHarness(customerTarget, async (url) => {
    const params = new URL(url, "https://test.invalid").searchParams;
    if (params.get("workType")) return { workLogs: [], total: 0 };
    if (params.get("offset") === "10") return new Promise((resolve) => { finishOldPage = resolve; });
    return { workLogs: Array.from({ length: 10 }, (_, i) => savedWork(`old-${i}`)), total: 20 };
  });
  t.after(() => h.dispose());
  let tree = await h.mount();
  moreButton(tree).props.onClick();
  const oldRequest = h.requests.at(-1);
  filterControl(h.render()).props.onChange("집방문");
  assert.equal(oldRequest.options.signal.aborted, true);
  tree = await h.settle();
  finishOldPage({ workLogs: [savedWork("late-old")], total: 20 });
  tree = await h.settle();
  assert.equal(filterControl(tree).props.value, "집방문");
  assert.equal(filterControl(tree).props.count, 0);
  assert.equal(historyRows(tree).length, 0);
  assert.match(markup(tree), /집방문 업무 이력이 없습니다/);
  assert.equal(moreButton(tree), undefined);
});

test("보조 고객 필터 조회 실패는 0건과 구분하고 같은 조건의 재시도를 지원한다", async (t) => {
  let fail = true;
  const h = panelHarness(customerTarget, async (url) => {
    const params = new URL(url, "https://test.invalid").searchParams;
    if (params.get("workType") === "집방문") {
      if (fail) throw new Error("합성 통신 오류");
      assert.equal(params.get("offset"), "0");
      return { workLogs: [savedWork("visit", "집방문")], total: 1 };
    }
    return { workLogs: [savedWork("call")], total: 1 };
  });
  t.after(() => h.dispose());
  let tree = await h.mount();
  filterControl(tree).props.onChange("집방문");
  tree = await h.settle();
  assert.match(markup(tree), /합성 통신 오류/);
  assert.doesNotMatch(markup(tree), /조회 0건|업무 이력이 없습니다/);
  assert.equal(historyRows(tree).length, 0);
  fail = false;
  descendants(tree).find((item) => item.type === "button" && markup(item).includes("다시 불러오기")).props.onClick();
  tree = await h.settle();
  assert.equal(filterControl(tree).props.value, "집방문");
  assert.equal(filterControl(tree).props.count, 1);
  assert.equal(historyRows(tree)[0].props.record.workId, "visit");
});

test("보조 매물에 없는 구분은 빈 결과를 명시하고 전체로 되돌리면 원본만 있는 메모도 복구한다", async (t) => {
  const h = panelHarness(listingTarget, async () => ({ listing: { source_notes: "유형 미확인 합성 메모" }, events: [], workLogs: [] }));
  t.after(() => h.dispose());
  let tree = await h.mount();
  filterControl(tree).props.onChange("집방문");
  tree = await h.settle();
  assert.equal(filterControl(tree).props.count, 0);
  assert.match(markup(tree), /집방문 업무 이력이 없습니다/);
  assert.doesNotMatch(markup(tree), /유형 미확인 합성 메모/);
  filterControl(tree).props.onChange("");
  tree = await h.settle();
  assert.match(markup(tree), /유형 미확인 합성 메모/);
});
