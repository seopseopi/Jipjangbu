import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getWorkProperties, workPropertyLabel } from "../app/work-property-summary.ts";
import { getPropertyDisplayGroups } from "../app/property-display.ts";

// Exercise the actual home layout and navigation with synthetic records only.
const source = readFileSync(new URL("../app/work-manager.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("work-manager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findAll(predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(ast);
  return found;
}
function evaluate(code, environment = {}) {
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(environment), `${output}; return result;`)(...Object.values(environment));
}
function declaration(name) {
  const node = findAll((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)[0];
  assert.ok(node, `${name} is a production component or callback`);
  return node.getText(ast);
}
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
const html = (element) => renderToStaticMarkup(element);
const noop = () => {};
function EmptyState({ title }) { return React.createElement("p", null, title); }
EmptyState.propTypes = { title: () => null };
const production = evaluate(`${declaration("DashboardView")}\n${declaration("WorkTable")}\nconst result = { DashboardView, WorkTable };`, {
  React, Icon: () => null, seoulDate: () => "2026-09-13", displayDate: (value) => value,
  statusTone: () => "normal", workTypeIcon: () => "journal", EmptyState,
  getWorkProperties, workPropertyLabel, getPropertyDisplayGroups,
});
const work = (id, date) => ({ id, work_date: date, customer_name: "합성 고객", customer_id: `synthetic-customer-${id}`, content: "합성 업무 내용", work_type: "전화", property_count: 0 });
const dashboard = {
  metrics: { today_count: 1, active_listing_count: 3, customer_count: 4, upcoming_count: 2 },
  today: [work("today-work", "2026-09-13")], upcoming: [work("next-work", "2026-09-14")], recent: [work("recent-work", "2026-09-12")],
};
function render(extra = {}) {
  return production.DashboardView({
    dashboard, onOpen: noop, onCustomerHistory: noop, onListingHistory: noop,
    onNavigate: noop, onOpenSchedule: noop, onOpenToday: noop,
    followUps: React.createElement("aside", { className: "synthetic-followups" }, "챙겨야 할 일"), ...extra,
  });
}
function button(tree, label) {
  const found = descendants(tree).find((item) => item.type === "button" && html(item).includes(label));
  assert.ok(found, `${label} remains reachable`);
  return found;
}

test("간소화한 홈은 최근 업무·할 일을 유지하고 오늘·7일 미리보기와 소개·빠른등록은 제거한다", () => {
  const opened = [], customerHistory = noop, listingHistory = noop;
  const tree = render({ onOpen: (id) => opened.push(id), onCustomerHistory: customerHistory, onListingHistory: listingHistory });
  const grid = descendants(tree).find((item) => item.props.className === "home-body-grid");
  const children = React.Children.toArray(grid.props.children);
  assert.equal(children.length, 2);
  assert.match(children[0].props.className, /recent-panel/);
  assert.equal(children[1].props.className, "synthetic-followups");
  assert.deepEqual(descendants(tree).filter((item) => item.type === production.WorkTable).map((item) => item.props.items), [dashboard.recent]);
  assert.doesNotMatch(html(tree), /home-hero|dashboard-schedule|앞으로 7일|자주 하는 업무|전화 상담|방문 예약/);
  const recent = descendants(tree).find((item) => item.type === production.WorkTable && item.props.items === dashboard.recent);
  assert.equal(recent.props.items, dashboard.recent);
  assert.equal(recent.props.onCustomerHistory, customerHistory);
  assert.equal(recent.props.onListingHistory, listingHistory);
  recent.props.onOpen("recent-work");
  assert.deepEqual(opened, ["recent-work"]);
  assert.doesNotMatch(html(tree), /오늘 업무와 다가오는 일정을 한눈에/);
  assert.doesNotMatch(html(tree), /연락할 일과 일정을 확인/);
});

test("요약의 오늘 업무·7일 일정 버튼은 팝업을 열고 매물·고객·업무일지 바로가기는 유지한다", () => {
  const navigated = [], today = [], scheduled = [];
  const tree = render({ onNavigate: (view) => navigated.push(view), onOpenToday: () => today.push(true), onOpenSchedule: () => scheduled.push(7) });
  for (const label of ["전체 매물 보기", "고객 목록 보기", "전체 보기"]) button(tree, label).props.onClick();
  assert.deepEqual(navigated, ["listings", "customers", "journal"]);
  button(tree, "오늘 업무 보기").props.onClick();
  assert.deepEqual(today, [true]);
  button(tree, "7일 일정 확인").props.onClick();
  assert.deepEqual(scheduled, [7]);
});

test("남아 있는 최근 업무 카드는 고객명 옆에 ID를 표시하고 원래 업무를 연다", () => {
  const opened = [];
  const tree = render({ onOpen: (id) => opened.push(id) });
  const schedules = descendants(tree).filter((item) => item.type === production.WorkTable);
  assert.equal(schedules.length, 1);
  for (const schedule of schedules) {
    const rows = production.WorkTable(schedule.props);
    const item = schedule.props.items[0];
    const customer = descendants(rows).find((node) => node.props.className === "work-record-customer-link");
    assert.ok(customer);
    const [name, identifier] = React.Children.toArray(customer.props.children);
    assert.equal(name.type, "b");
    assert.equal(name.props.children, item.customer_name);
    assert.equal(identifier.props.className, "work-customer-id");
    assert.equal(identifier.props.children, item.customer_id);
    assert.ok(html(rows).indexOf(item.customer_name) < html(rows).indexOf(item.customer_id));
    descendants(rows).find((node) => node.props.className === "work-record-open").props.onClick();
  }
  assert.deepEqual(opened, ["recent-work"]);
});

test("고객 ID가 없어도 이름을 유지하고 긴 고객명·ID는 좁은 화면에서 자연스럽게 줄바꿈한다", () => {
  const item = { ...dashboard.today[0], customer_id: "" };
  const tree = production.WorkTable({ items: [item], onOpen: noop, empty: "빈 목록" });
  assert.doesNotMatch(html(tree), /schedule-customer-id|고객 ID:/);
  assert.match(html(tree), /합성 고객/);
  const longItem = { ...item, customer_name: "긴 합성 고객 이름 ".repeat(20), customer_id: "synthetic-id-".repeat(30) };
  const longTree = production.WorkTable({ items: [longItem], onOpen: noop, empty: "빈 목록" });
  assert.ok(html(longTree).includes(longItem.customer_name));
  assert.ok(html(longTree).includes(longItem.customer_id));
  const css = readFileSync(new URL("../app/work-reading-list.css", import.meta.url), "utf8");
  assert.match(css, /\.work-record-customer-link\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.work-record-customer-link b\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.work-record-customer-link \.work-customer-id\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.home-body-grid \.work-record-customer-link \.work-customer-id\s*\{[^}]*flex-basis:\s*auto/);
});

test("홈 업무는 날짜·업무구분·고객 순서의 머리말을 본문보다 먼저 표시하고 빈 목록 안내를 유지한다", () => {
  const items = ["잔금예정", "집방문예정", "집방문예약", "전화"].map((work_type, index) => ({ ...dashboard.today[0], id: String(index), work_type }));
  const tree = production.WorkTable({ items, onOpen: noop, onCustomerHistory: noop, onListingHistory: noop });
  const records = descendants(tree).filter((node) => node.props.className === "table-row work-record-row");
  assert.equal(records.length, 4);
  for (const [index, record] of records.entries()) {
    const [meta, body] = React.Children.toArray(record.props.children);
    assert.equal(meta.props.className, "work-record-meta");
    assert.deepEqual(React.Children.toArray(meta.props.children).slice(0, 3).map((node) => node.props["data-label"]), ["일자", "업무구분", "고객"]);
    assert.ok(html(meta).includes(items[index].work_type));
    assert.ok(html(body).includes(items[index].content));
  }
  for (const empty of ["오늘 등록된 업무가 없습니다.", "앞으로 7일간 등록된 일정이 없습니다."]) {
    assert.ok(html(production.WorkTable({ items: [], empty })).includes(empty));
  }
});

test("홈 요약은 오늘 업무 바로 다음에 다가오는 일정을 두고 매물·고객은 그 뒤에 배치한다", () => {
  const tree = render();
  const grid = descendants(tree).find((item) => item.props.className === "metric-grid");
  const cards = React.Children.toArray(grid.props.children);
  const labels = cards.map((card) => renderToStaticMarkup(descendants(card).find((item) => item.props.className === "metric-label")));
  for (const [index, expected] of ["오늘 업무", "다가오는 일정", "진행 중 매물", "전체 고객"].entries()) {
    assert.ok(labels[index].includes(expected));
  }
  assert.ok(html(cards[0]).includes("1<small>건"));
  assert.ok(html(cards[1]).includes("2<small>건"));
  assert.ok(html(cards[2]).includes("3<small>건"));
  assert.ok(html(cards[3]).includes("4<small>명"));
  assert.match(html(cards[1]), /7일 일정 확인/);
});

test("오늘 건수 버튼은 오늘 전체 업무를 최근 수정순으로 재조회하고 저장 후 갱신도 같은 조건을 유지한다", async () => {
  const requests = [], states = [];
  const runtime = evaluate(`${declaration("openTodayHistory")}\n${declaration("refreshHistory")}\nconst result = { openTodayHistory, refreshHistory };`, {
    seoulDate: () => "2026-09-16", historyOpenVersion: { current: 0 },
    setHistoryModal: (next) => { states.push(typeof next === "function" ? next(states.at(-1)) : next); },
    fetchAllWorkLogs: async (params) => { requests.push(Object.fromEntries(params)); return dashboard.today; },
  });
  runtime.openTodayHistory();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [{ from: "2026-09-16", to: "2026-09-16", sort: "updated" }]);
  assert.equal(states[0].loading, true);
  assert.equal(states.at(-1).loading, false);
  assert.equal(states.at(-1).items, dashboard.today);
  assert.match(states.at(-1).subtitle, /1건 · 최근 수정순/);
  await runtime.refreshHistory(states.at(-1));
  assert.deepEqual(requests[1], requests[0]);
});

test("다시 연락할 일 메뉴는 없애되 홈의 할 일 전체보기와 숨겨진 관리 화면 주소는 유지한다", () => {
  const nav = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "navItems")[0];
  const navItems = evaluate(`const result = ${nav.initializer.getText(ast)};`);
  assert.deepEqual(navItems.map(([view]) => view), ["today", "calendar", "journal", "listings", "customers", "insights", "trash", "settings", "structures"]);
  assert.deepEqual(navItems[1], ["calendar", "업무 달력"]);
  assert.deepEqual(navItems[6], ["insights", "업무 현황"]);
  assert.doesNotMatch(JSON.stringify(navItems), /다시 연락할 일/);
  const title = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "titles")[0];
  const titles = evaluate(`const result = ${title.initializer.getText(ast)};`, { dateLabel: "합성 날짜" });
  assert.equal(titles.tasks, "챙겨야 할 일");
  const all = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(ast) === "onShowAll");
  assert.equal(all.length, 1, "the compact home panel retains its only full-list entry point");
  const selected = [];
  evaluate(`const result = ${all[0].initializer.expression.getText(ast)};`, { navigate: (view) => selected.push(view) })();
  assert.deepEqual(selected, ["tasks"]);
  const syncNode = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "syncView")[0];
  for (const [hash, expected] of [["#tasks", "tasks"], ["#calendar", "calendar"], ["#insights", "insights"], ["#not-a-view", "today"]]) {
    const views = [], currentView = { current: "today" };
    const sync = evaluate(`const result = ${syncNode.initializer.getText(ast)};`, {
      navItems, currentView, followUpBusy: { current: false }, workBusy: { current: false }, customerBusy: { current: false }, followUpDirty: { current: false },
      workOpenVersion: { current: 0 }, workReadVersion: { current: 0 }, setWorkReader: noop, setReaderReference: noop,
      setWorkOpening: noop,
      setNotice: noop, setView: (view) => views.push(view),
      window: { location: { hash, pathname: "/" }, history: { pushState: noop }, confirm: () => true },
    });
    sync();
    assert.deepEqual(views, [expected]);
    assert.equal(currentView.current, expected);
  }
  assert.match(source, /view === "tasks" && \(\s*<FollowUpsView/);
});

test("홈 일정은 넓은 왼쪽·모바일 첫 순서이고 좁아진 할 일 영역은 제목·버튼을 줄바꿈한다", () => {
  const layout = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/follow-ups.css", import.meta.url), "utf8");
  assert.match(layout, /\.home-body-grid,\s*\.content-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.6fr\)\s+minmax\(280px,\s*1fr\)/);
  const mobileStart = layout.indexOf("@media (max-width: 920px)");
  assert.ok(mobileStart >= 0);
  const mobile = layout.slice(mobileStart, layout.indexOf("@media", mobileStart + 1));
  assert.match(mobile, /\.home-body-grid,\s*\.content-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.followup-compact\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.followup-compact \.followup-heading\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.followup-compact \.followup-urgency\s*\{[^}]*repeat\(auto-fit,\s*minmax\(min\(100%,\s*132px\),\s*1fr\)\)/);
  assert.match(css, /\.followup-compact \.followup-form-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.followup-compact \.followup-form-actions > button\s*\{[^}]*white-space:\s*normal/);
});
