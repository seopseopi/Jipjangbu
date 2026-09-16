import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryWorkTypeFilter } from "./helpers/history-work-type-filter.mjs";
import { historyQueryUrl } from "../app/history-query.ts";

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

test("업무구분 필터는 전체가 기본이며 선택·초기화가 폼을 제출하지 않는다", () => {
  const changes = [];
  const props = { value: "", workTypes: ["전화", "집방문", "전화"], count: 12, onChange: (value) => changes.push(value) };
  const tree = HistoryWorkTypeFilter(props);
  const select = descendants(tree).find((item) => item.type === "select");
  assert.deepEqual(descendants(select).filter((item) => item.type === "option").map((item) => item.props.value), ["", "전화", "집방문"]);
  assert.equal(select.props.value, "");
  assert.match(renderToStaticMarkup(tree), /조회 12건/);
  select.props.onChange({ target: { value: "집방문" } });
  const reset = descendants(HistoryWorkTypeFilter({ ...props, value: "집방문" })).find((item) => item.type === "button");
  assert.equal(reset.props.type, "button");
  reset.props.onClick();
  assert.deepEqual(changes, ["집방문", ""]);
});

test("선택한 구분의 마지막 업무가 사라져도 필터와 0건 안내·전체 복귀를 유지한다", () => {
  const tree = HistoryWorkTypeFilter({ value: "집방문", workTypes: ["전화"], count: 0, onChange() {} });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /value="집방문" selected/);
  assert.match(html, /조회 0건/);
  assert.match(html, /전체 보기/);
});

test("조회 중·조회 실패는 이전 건수나 0건으로 오인시키지 않는다", () => {
  for (const loading of [true, false]) {
    const html = renderToStaticMarkup(HistoryWorkTypeFilter({ value: "전화", workTypes: [], count: loading ? 8 : undefined, loading, onChange() {} }));
    assert.doesNotMatch(html, /조회 [08]건/);
    assert.equal(html.includes("불러오는 중"), loading);
  }
});

test("고객 이력 페이지 URL은 업무구분과 물건지 연결 범위를 함께 유지한다", () => {
  const target = { kind: "customer", id: "합성 고객 &/?", name: "합성 고객" };
  for (const offset of [0, 10, 1000]) {
    const url = new URL(historyQueryUrl(target, offset, "맞춤 &/구분"), "https://test.invalid");
    assert.equal(url.searchParams.get("customerId"), target.id);
    assert.equal(url.searchParams.get("includeSource"), "1");
    assert.equal(url.searchParams.get("workType"), "맞춤 &/구분");
    assert.equal(url.searchParams.get("offset"), String(offset));
  }
  assert.equal(new URL(historyQueryUrl(target), "https://test.invalid").searchParams.has("workType"), false);
});
