import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ListingHistorySummary } from "./helpers/listing-history-summary.mjs";
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
const shared = { React, Icon: () => null, ListingHistorySummary, WorkSummaryProperties, formatHistoryTimestamp };
const Row = compile(["HistoryRecordRow"], { ...shared, useId: React.useId, useState: React.useState });
const markup = (tree) => renderToStaticMarkup(tree);
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function panelHarness(target, read) {
  const states = [], effects = [], cleanups = [], requests = [];
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
  const useEffect = (effect) => {
    const index = cursor++;
    if (!(index in states)) { states[index] = true; effects.push(effect); }
  };
  const Panel = compile(["errorMessage", "HistoryPanel"], {
    ...shared, useState, useRef, useEffect, useId: () => "synthetic-panel", useCallback: (callback) => callback,
    createHistoryRequestScope, HISTORY_PAGE_SIZE, historyQueryUrl, mergeHistoryRecords, retryInterruptedHistoryRead, HistoryRecordRow: Row,
    clientJsonFetch: (url, options) => { requests.push({ url, options }); return read(url, options); },
  });
  const render = () => { cursor = 0; return Panel({ target, onClose() {} }); };
  return {
    render, requests,
    async mount() { render(); for (const effect of effects.splice(0)) cleanups.push(effect()); await new Promise((resolve) => setImmediate(resolve)); return render(); },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return render(); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}
const listingTarget = { kind: "listing", key: "아파트|합성단지|106|1503", name: "합성단지 106동 1503호" };
const customerTarget = { kind: "customer", id: "synthetic-customer", name: "합성 고객" };
const events = [
  { id: "future", work_log_id: "future-work", event_date: "2026-12-31", status: "잔금예정", customer_name: "합성 고객", notes: "미래 업무의 원래 메모", work_updated_at: "2026-09-10 03:00:00", created_at: "2026-09-10 03:00:00" },
  { id: "changed", work_log_id: "changed-work", event_date: "2026-08-20", status: "매물수정", customer_name: "합성 고객", notes: "과거 업무에서 방금 고친 메모", work_updated_at: "2026-09-13 05:10:00", created_at: "2026-08-20 03:00:00" },
];

test("보조 매물 이력도 같은 최근 저장 요약을 쓰되 개별 이력은 원래 업무일 순서로 유지한다", async (t) => {
  const sourceNotes = "  엑셀 최초 원문\n기존 줄바꿈  ";
  const h = panelHarness(listingTarget, async () => ({ listing: { source_notes: sourceNotes }, events }));
  t.after(() => h.dispose());
  const tree = await h.mount();
  const summary = descendants(tree).find((element) => element.type === ListingHistorySummary);
  assert.ok(summary);
  assert.equal(summary.props.events, events);
  assert.equal(summary.props.sourceNotes, sourceNotes);
  assert.equal(summary.props.onOpenWork, undefined, "inline history cannot navigate away from the draft");
  const latestHtml = markup(summary);
  assert.match(latestHtml, /과거 업무에서 방금 고친 메모/);
  assert.match(latestHtml, /2026\.09\.13 14:10/);
  assert.doesNotMatch(markup(tree), /한국\s*시간/);
  assert.doesNotMatch(latestHtml, /미래 업무의 원래 메모/);
  const records = descendants(tree).filter((element) => element.type === Row).map((element) => element.props.record);
  assert.deepEqual(records.map((record) => record.id), ["future", "changed"]);
  assert.deepEqual(records.map((record) => record.savedAt), ["2026.09.10 12:00", "2026.09.13 14:10"]);
  assert.match(markup(tree), /총 2건 · 업무일 최신순/);
  assert.match(markup(tree), /업무일 · 2026\.12\.31/);
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

test("고객 보조 이력은 원래 업무일과 업무 저장시각을 분리하고 매물 원본 요약을 만들지 않는다", async (t) => {
  const h = panelHarness(customerTarget, async () => ({ workLogs: [
    { id: "customer-work", work_date: "2026-08-20", work_type: "전화", content: "고객 상담 메모", customer_name: "합성 고객", property_count: 0, updated_at: "2026-09-13 01:02:00" },
    { id: "legacy-work", work_date: "2026-07-20", work_type: "전화", content: "기존 메모", customer_name: "합성 고객", property_count: 0 },
  ], total: 2 }));
  t.after(() => h.dispose());
  const tree = await h.mount(), rows = descendants(tree).filter((element) => element.type === Row);
  assert.equal(rows[0].props.record.savedAt, "2026.09.13 10:02");
  assert.equal(rows[1].props.record.savedAt, "");
  assert.match(markup(rows[0]), /업무일 · 2026\.08\.20/);
  assert.match(markup(rows[0]), /최근 저장 · 2026\.09\.13 10:02/);
  assert.doesNotMatch(markup(rows[0]), /한국\s*시간/);
  assert.equal(descendants(tree).some((element) => element.type === ListingHistorySummary), false);
  const request = new URL(h.requests[0].url, "https://test.invalid");
  assert.equal(request.searchParams.get("customerId"), customerTarget.id);
  assert.equal(request.searchParams.get("limit"), "10");
});

test("매물 조회 실패는 예전 원본 메모를 최근 저장 성공처럼 표시하지 않으며 재조회로 회복한다", async (t) => {
  let fails = true;
  const h = panelHarness(listingTarget, async () => { if (fails) throw new Error("합성 이력 조회 실패"); return { listing: {}, events }; });
  t.after(() => h.dispose());
  const failed = await h.mount();
  assert.match(markup(failed), /합성 이력 조회 실패/);
  assert.doesNotMatch(markup(failed), /최근 저장한 업무 내용|이 물건에 저장된 매물 변경 이력이 없습니다/);
  fails = false;
  const retry = descendants(failed).find((element) => element.type === "button" && markup(element).includes("다시 불러오기"));
  retry.props.onClick();
  const restored = await h.settle();
  assert.match(markup(restored), /과거 업무에서 방금 고친 메모/);
  assert.doesNotMatch(markup(restored), /합성 이력 조회 실패/);
});

test("원본만 남은 매물은 닫힌 원본 메모와 변경 이력 없음만 표시하며 404도 안전하게 빈 이력이 된다", async (t) => {
  for (const missing of [false, true]) {
    const h = panelHarness(listingTarget, async () => {
      if (missing) throw new Error("매물을 찾을 수 없습니다.");
      return { listing: { source_notes: "옛 원본 메모" }, events: [] };
    });
    t.after(() => h.dispose());
    const tree = await h.mount(), html = markup(tree);
    assert.match(html, /이 물건에 저장된 매물 변경 이력이 없습니다/);
    assert.doesNotMatch(html, /최근 저장한 업무 내용|role="alert"/);
    if (missing) assert.doesNotMatch(html, /엑셀 원본 메모/);
    else assert.match(html, /<details class="listing-source-notes"><summary/);
  }
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
