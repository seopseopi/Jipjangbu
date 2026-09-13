import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarSubjects } from "./helpers/calendar-subjects.mjs";
import { calendarWorkPresentation } from "./helpers/calendar-presentation.mjs";

const property = (overrides = {}) => ({ id: "synthetic-property", sequence: 1, property_type: "아파트", building_name: "합성단지", building_dong: "106", unit_number: "1503", source: "합성업소", ...overrides });
const work = (overrides = {}) => ({ customer_id: "합성고객ID", customer_name: "합성 고객", work_type: "매물등록", property_count: 1, properties_json: JSON.stringify([property()]), ...overrides });
const html = (element) => renderToStaticMarkup(element);
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function elements(tree, className) { return descendants(tree).filter((element) => element.props.className?.split(/\s+/).includes(className)); }
const visible = (tree) => elements(tree, "calendar-subject-label").map((element) => element.props.children);

test("단일 물건의 10개 업무종별은 기존 캘린더 표시문구를 그대로 유지한다", () => {
  for (const work_type of ["매물등록", "매물수정", "매물취소", "가계약", "계약서작성", "잔금", "중도금", "계약취소", "타계약확인", "경매확인"]) {
    const item = work({ work_type });
    const tree = CalendarSubjects({ item });
    assert.deepEqual(visible(tree), calendarWorkPresentation(item).entries, work_type);
    assert.equal(elements(tree, "calendar-subject-building").length, 0);
    assert.equal(elements(tree, "calendar-subject-number").length, 0);
    assert.equal(elements(tree, "calendar-subject-customer").length, 0);
  }
});

test("한 단지 물건 10개는 건물명 한번과 모든 동호수·개별 단독/업소 접미사를 원래 순서로 표시한다", () => {
  const sources = ["", "마전현대", "합성협력1", "합성협력2", "", "합성협력3", "마전현대", "합성협력4", "", "합성협력5"];
  const properties = sources.map((source, index) => property({ id: `ten-${index}`, sequence: index + 1, unit_number: String(1501 + index), source }));
  const item = work({ work_type: "가계약", property_count: 10, properties_json: JSON.stringify(properties) });
  const tree = CalendarSubjects({ item });
  assert.deepEqual(elements(tree, "calendar-subject-building").map((element) => element.props.children), ["합성단지"]);
  assert.deepEqual(visible(tree), sources.map((source, index) => `106동 ${1501 + index}호 (${!source || source === "마전현대" ? "단독" : source})`));
  const rows = elements(tree, "calendar-subject-property");
  assert.equal(rows.length, 10);
  rows.forEach((row, index) => {
    const full = calendarWorkPresentation(item).entries[index];
    assert.equal(row.props["aria-label"], `물건 ${index + 1} · ${full}`);
    assert.equal(row.props.title, full);
  });
  assert.doesNotMatch(html(tree), /외 \d|더 보기|<button|<input/);
});

test("물건 중심의 부동산 고객과 자체결정은 축약 후에도 각 물건에 고객ID를 유지한다", () => {
  for (const customer_name of ["합성부동산", "부동산", "자체결정"]) {
    const item = work({ customer_name, work_type: "중도금", property_count: 2, properties_json: JSON.stringify([property(), property({ id: "second", unit_number: "1504", source: "다른업소" })]) });
    const tree = CalendarSubjects({ item });
    assert.deepEqual(visible(tree), ["106동 1503호 (합성고객ID)", "106동 1504호 (합성고객ID)"]);
    assert.doesNotMatch(html(tree), /다른업소/);
  }
});

test("부동산써브 예외와 주소전용 업무는 기존 업무종별 의미를 바꾸지 않는다", () => {
  const properties_json = JSON.stringify([property(), property({ id: "second", unit_number: "1504", source: "" })]);
  const contract = CalendarSubjects({ item: work({ customer_name: "부동산써브", work_type: "계약서작성", property_count: 2, properties_json }) });
  assert.deepEqual(visible(contract), ["106동 1503호 (합성업소)", "106동 1504호 (단독)"]);
  for (const work_type of ["매물등록", "매물수정", "매물취소", "타계약확인", "경매확인"]) {
    const tree = CalendarSubjects({ item: work({ customer_name: "부동산써브", work_type, property_count: 2, properties_json }) });
    assert.deepEqual(visible(tree), ["106동 1503호", "106동 1504호"]);
  }
});

test("전화·방문·예정·신규 업무는 고객을 첫 정보로 두고 전체 연결 물건을 보조 정보로 보존한다", () => {
  for (const work_type of ["전화", "집방문", "잔금예정", "계약파기", "새업무종별"]) {
    const item = work({ work_type, customer_name: "합성부동산", property_count: 2, properties_json: JSON.stringify([property(), property({ id: "second", unit_number: "1504" })]) });
    const tree = CalendarSubjects({ item });
    assert.match(tree.props.className, /is-customer-focused/);
    const children = React.Children.toArray(tree.props.children);
    assert.equal(children[0].props.className, "calendar-subject-customer");
    assert.equal(children[0].props.children, "합성고객ID 합성부동산");
    assert.deepEqual(visible(tree), ["106동 1503호", "106동 1504호"]);
  }
});

test("떨어진 동일 단지·서로 다른 물건구분은 합치지 않으며 불완전한 주소도 그대로 구분한다", () => {
  const properties = [
    property({ id: "first" }),
    property({ id: "second", building_name: "다른단지", building_dong: "", unit_number: "2002호" }),
    property({ id: "third", unit_number: "1504" }),
    property({ id: "fourth", property_type: "상가", building_dong: "", unit_number: "" }),
  ];
  const tree = CalendarSubjects({ item: work({ properties_json: JSON.stringify(properties), property_count: 4 }) });
  assert.equal(elements(tree, "calendar-subject-building").length, 0);
  assert.deepEqual(visible(tree), ["합성단지 106동 1503호", "다른단지 2002호", "합성단지 106동 1504호", "합성단지"]);
  assert.deepEqual(elements(tree, "calendar-subject-number").map((element) => element.props.children), [[1, "."], [2, "."], [3, "."], [4, "."]]);
});

test("연결 물건 없는 업무와 이전 요약 응답은 고객 또는 기존 단일 주소로 안전하게 표시한다", () => {
  const empty = CalendarSubjects({ item: work({ properties_json: "[]", property_count: 0 }) });
  assert.deepEqual(elements(empty, "calendar-subject-customer").map((element) => element.props.children), ["합성 고객"]);
  assert.equal(elements(empty, "calendar-subject-property").length, 0);
  const cached = CalendarSubjects({ item: work({ properties_json: undefined, ...property() }) });
  assert.deepEqual(visible(cached), ["합성단지 106동 1503호"]);
});

test("긴 단지·업소명은 전문 접근성을 유지하며 월간 셀과 모바일에서 말줄임·개별 테두리 없이 줄바꿈한다", () => {
  const name = "긴합성단지".repeat(35);
  const source = "긴합성협력업소".repeat(25);
  const tree = CalendarSubjects({ item: work({ work_type: "잔금", properties_json: JSON.stringify([property({ building_name: name, source }), property({ id: "second", building_name: name, unit_number: "1504", source })]), property_count: 2 }) });
  assert.equal(elements(tree, "calendar-subject-building")[0].props.children, name);
  assert.equal(elements(tree, "calendar-subject-property")[0].props.title, `${name} 106동 1503호 (${source})`);
  const css = readFileSync(new URL("../app/calendar-subjects.css", import.meta.url), "utf8");
  assert.match(css, /\.calendar-cell button \.calendar-subject-label[^}]*overflow:\s*visible[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.calendar-subject-property[^}]*border:\s*0[^}]*background:\s*transparent/);
  assert.match(css, /\.calendar-agenda-event \.calendar-subject-customer[^}]*font-size:\s*var\(--text-base\)/);
  assert.doesNotMatch(css, /line-clamp|text-overflow:\s*ellipsis|overflow:\s*hidden/);
  const code = readFileSync(new URL("../app/calendar-subjects.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(code, /fetch\(|clientJsonFetch|onClick|onChange|<button|<form/);
});
