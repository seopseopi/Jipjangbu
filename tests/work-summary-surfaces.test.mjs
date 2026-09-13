import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { WorkSummaryProperties } from "./helpers/work-summary-properties.mjs";
import { searchExcerpt } from "../app/search-excerpt.ts";

const properties = [
  { id: "p1", sequence: 1, property_type: "아파트", building_name: "첫번째합성단지", building_dong: "101", unit_number: "1001", sale_price: "35000", source: "" },
  { id: "p2", sequence: 2, property_type: "아파트", building_name: "두번째합성단지", building_dong: "202", unit_number: "2002", jeonse_price: "25000", source: "합성업소" },
];
const work = { id: "synthetic-work", customer_id: "synthetic-customer", customer_name: "합성 고객", work_type: "전화", work_date: "2026-09-13", content: "합성 고객의 저장된 내용", ...properties[0], property_count: 2, properties_json: JSON.stringify(properties) };
const html = (element) => renderToStaticMarkup(element);
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function compile(path, name, environment, names) {
  const source = readFileSync(new URL(`../app/${path}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && (!names || names.includes(node.name?.text))).map((node) => node.getText(ast)).join("\n");
  const output = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export /gm, "");
  return new Function(...Object.keys(environment), `${output}; return ${name};`)(...Object.values(environment));
}
const base = { React, WorkSummaryProperties, Icon: "span", useEffect: () => {}, useMemo: (callback) => callback(), useCallback: (callback) => callback, useRef: (current) => ({ current }), useId: () => "synthetic-id" };

test("공통 요약은 모든 주소와 물건 개수를 개별 읽기 항목으로 표시하며 가격도 해당 물건에 맞춘다", () => {
  const tree = WorkSummaryProperties({ work, showPrices: true });
  const result = html(tree);
  assert.match(result, /함께 기록한 물건 2개/);
  const entries = descendants(tree).filter((element) => element.props.role === "listitem");
  assert.equal(entries.length, 2);
  assert.match(html(entries[0]), /첫번째합성단지 101동 1001호/);
  assert.match(html(entries[0]), /매매 35000/);
  assert.doesNotMatch(html(entries[0]), /전세 25000/);
  assert.match(html(entries[1]), /두번째합성단지 202동 2002호/);
  assert.match(html(entries[1]), /전세 25000/);
  assert.doesNotMatch(result, /외 \d+개|<button|<input|<form/);
});

test("공통 요약은 두번째 물건 검색 일치를 표시하되 원래 물건 순서를 유지한다", () => {
  const tree = WorkSummaryProperties({ work: { ...work, ...properties[1], search_property_match: 1 } });
  const entries = descendants(tree).filter((element) => element.props.role === "listitem");
  assert.doesNotMatch(entries[0].props.className, /is-search-match/);
  assert.match(entries[1].props.className, /is-search-match/);
  assert.match(html(entries[1]), /검색 일치 물건/);
  assert.match(html(entries[0]), /첫번째합성단지/);
});

test("물건 없는 응답은 가짜 항목이 없으며 단일 물건과 이전 캐시 응답도 호환한다", () => {
  assert.equal(WorkSummaryProperties({ work: { properties_json: "[]", property_count: 0 } }), null);
  const single = { ...properties[0], property_count: 1 };
  assert.equal(WorkSummaryProperties({ work: single }), null);
  assert.match(html(WorkSummaryProperties({ work: single, showSingle: true })), /첫번째합성단지/);
  const cached = html(WorkSummaryProperties({ work: { ...single, property_count: 2, properties_json: "not-json" } }));
  assert.match(cached, /함께 기록한 물건 2개/);
  assert.match(cached, /전체 물건 주소는 업무 내용을 열어 확인/);
});

test("고객 보조 이력은 펼치기 전부터 두 주소·가격을 읽을 수 있고 펼침은 읽기 상태만 바꾼다", () => {
  const changes = [];
  const Row = compile("related-history.tsx", "HistoryRecordRow", { ...base, useState: () => [false, (value) => changes.push(typeof value === "function" ? value(false) : value)] }, ["HistoryRecordRow"]);
  const tree = Row({ record: { id: "history", workId: work.id, date: work.work_date, workType: work.work_type, customerName: work.customer_name, content: work.content, property: work, propertyCount: 2 }, current: false });
  const result = html(tree);
  assert.match(result, /첫번째합성단지 101동 1001호/);
  assert.match(result, /두번째합성단지 202동 2002호/);
  assert.match(result, /매매 35000/);
  assert.match(result, /전세 25000/);
  assert.doesNotMatch(result, /외 1개/);
  descendants(tree).find((element) => element.type === "button").props.onClick();
  assert.deepEqual(changes, [true]);
});

test("통합검색은 검색에 맞은 대표 주소와 모든 연결 주소를 유지하고 같은 업무 읽기 콜백을 호출한다", () => {
  const matchedWork = { ...work, ...properties[1], id: "synthetic-work", search_property_match: 1 };
  const states = ["2002", { workLogs: [matchedWork], customers: [], listings: [] }, "success", "", 0];
  let stateIndex = 0;
  const View = compile("global-search.tsx", "GlobalSearch", { ...base, searchExcerpt, emptyResults: () => ({ workLogs: [], customers: [], listings: [] }), useState: () => [states[stateIndex++], () => {}] });
  const calls = [];
  const tree = View({ open: true, onClose: () => calls.push("close"), onOpenWork: (id) => calls.push(id), onOpenCustomer: () => {}, onOpenListing: () => {} });
  const button = descendants(tree).find((element) => element.type === "button" && element.props.className?.includes("global-search-work"));
  const result = html(button);
  assert.match(result, /<strong>두번째합성단지 202동 2002호<\/strong>/);
  assert.match(result, /함께 기록한 물건 2개/);
  assert.match(result, /첫번째합성단지 101동 1001호/);
  assert.match(result, /is-search-match/);
  button.props.onClick();
  assert.deepEqual(calls, ["close", "synthetic-work"]);
});

test("업무현황 일정은 여러 주소를 접거나 생략하지 않고 같은 업무 읽기 콜백으로 연결한다", () => {
  const data = { summary: { monthWorkCount: 1, monthCustomerCount: 1, activeListingCount: 1, staleListingCount: 0 }, monthly: [], workTypes: [], upcoming: [work], staleListings: [] };
  const states = [data, false, "", 0];
  let stateIndex = 0;
  const View = compile("insights-view.tsx", "InsightsView", { ...base, useState: () => [states[stateIndex++], () => {}] });
  const calls = [];
  const tree = View({ onOpenWork: (id) => calls.push(id), onOpenListing: () => {} });
  const button = descendants(tree).find((element) => element.type === "button" && element.props.className?.includes("insights-upcoming-item"));
  const result = html(button);
  assert.match(result, /함께 기록한 물건 2개/);
  assert.match(result, /첫번째합성단지 101동 1001호/);
  assert.match(result, /두번째합성단지 202동 2002호/);
  button.props.onClick();
  assert.deepEqual(calls, [work.id]);
});

test("공통 요약 주소는 모바일 큰 글씨·긴 문구에서 모두 줄바꿈하며 자체 조회나 수정 기능을 만들지 않는다", () => {
  const css = readFileSync(new URL("../app/work-summary-properties.css", import.meta.url), "utf8");
  assert.match(css, /\.work-summary-property-label\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.doesNotMatch(css, /line-clamp|text-overflow:\s*ellipsis|overflow:\s*hidden/);
  const source = readFileSync(new URL("../app/work-summary-properties.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|clientJsonFetch|\/api\/|onClick|onChange/);
});
