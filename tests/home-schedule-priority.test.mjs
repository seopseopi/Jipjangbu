import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

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
const WorkTable = () => null;
function EmptyState({ title }) { return React.createElement("p", null, title); }
EmptyState.propTypes = { title: () => null };
const production = evaluate(`${declaration("DashboardView")}\n${declaration("WorkRows")}\nconst result = { DashboardView, WorkRows };`, {
  React, Icon: () => null, seoulDate: () => "2026-09-13", displayDate: (value) => value,
  statusTone: () => "normal", workTypeIcon: () => "journal", EmptyState,
  WorkSummaryProperties: () => null, WorkTable,
});
const work = (id, date) => ({ id, work_date: date, customer_name: "합성 고객", content: "합성 업무 내용", work_type: "전화", property_count: 0 });
const dashboard = {
  metrics: { today_count: 1, active_listing_count: 3, customer_count: 4, upcoming_count: 2 },
  today: [work("today-work", "2026-09-13")], upcoming: [work("next-work", "2026-09-14")], recent: [work("recent-work", "2026-09-12")],
};
function render(extra = {}) {
  return production.DashboardView({
    dashboard, onOpen: noop, onCustomerHistory: noop, onListingHistory: noop,
    onNavigate: noop, onOpenSchedule: noop, onQuickWork: noop,
    followUps: React.createElement("aside", { className: "synthetic-followups" }, "챙겨야 할 일"), ...extra,
  });
}
function button(tree, label) {
  const found = descendants(tree).find((item) => item.type === "button" && html(item).includes(label));
  assert.ok(found, `${label} remains reachable`);
  return found;
}

test("홈은 오늘 업무·7일 일정을 먼저 두고 챙겨야 할 일은 다음에 두며 기존 기록·읽기 연결을 유지한다", () => {
  const opened = [], customerHistory = noop, listingHistory = noop;
  const tree = render({ onOpen: (id) => opened.push(id), onCustomerHistory: customerHistory, onListingHistory: listingHistory });
  const grid = descendants(tree).find((item) => item.props.className === "home-body-grid");
  const children = React.Children.toArray(grid.props.children);
  assert.equal(children.length, 2);
  assert.match(children[0].props.className, /dashboard-schedule/);
  assert.equal(children[1].props.className, "synthetic-followups");
  assert.ok(html(children[0]).indexOf("오늘 업무") < html(children[0]).indexOf("앞으로 7일"));
  const schedules = descendants(children[0]).filter((item) => item.type === production.WorkRows);
  assert.deepEqual(schedules.map((item) => item.props.items), [dashboard.today, dashboard.upcoming]);
  assert.equal(schedules[1].props.showDate, true);
  for (const schedule of schedules) button(production.WorkRows(schedule.props), "합성 고객").props.onClick();
  assert.deepEqual(opened, ["today-work", "next-work"]);
  const recent = descendants(tree).find((item) => item.type === WorkTable);
  assert.equal(recent.props.items, dashboard.recent);
  assert.equal(recent.props.onCustomerHistory, customerHistory);
  assert.equal(recent.props.onListingHistory, listingHistory);
  recent.props.onOpen("recent-work");
  assert.deepEqual(opened, ["today-work", "next-work", "recent-work"]);
  assert.match(html(tree), /오늘 업무와 다가오는 일정을 한눈에/);
  assert.doesNotMatch(html(tree), /연락할 일과 일정을 확인/);
});

test("홈 재배치 뒤에도 빠른 업무 등록·목록·달력·7일 전체 일정 동작은 유지한다", () => {
  const navigated = [], quick = [], scheduled = [];
  const tree = render({ onNavigate: (view) => navigated.push(view), onQuickWork: (type) => quick.push(type), onOpenSchedule: () => scheduled.push(7) });
  for (const label of ["전화 상담", "방문 예약", "매물 등록"]) button(tree, label).props.onClick();
  assert.deepEqual(quick, ["전화", "집방문예약", "매물등록"]);
  for (const label of ["매물 목록 보기", "고객 목록 보기", "달력 보기", "전체 보기"]) button(tree, label).props.onClick();
  assert.deepEqual(navigated, ["listings", "customers", "calendar", "journal"]);
  button(tree, "7일 일정 확인").props.onClick();
  button(tree, "전체 2건 보기").props.onClick();
  assert.deepEqual(scheduled, [7, 7]);
  assert.match(html(tree), /가까운 일정 1건 미리보기/);
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

test("다시 연락할 일 메뉴는 없애되 홈의 할 일 전체보기와 숨겨진 관리 화면 주소는 유지한다", () => {
  const nav = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "navItems")[0];
  const navItems = evaluate(`const result = ${nav.initializer.getText(ast)};`);
  assert.deepEqual(navItems.map(([view]) => view), ["today", "insights", "journal", "listings", "customers", "calendar", "trash", "settings"]);
  assert.doesNotMatch(JSON.stringify(navItems), /다시 연락할 일/);
  const title = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "titles")[0];
  const titles = evaluate(`const result = ${title.initializer.getText(ast)};`, { dateLabel: "합성 날짜" });
  assert.deepEqual(titles.tasks, ["챙겨야 할 일", "따로 적어 둔 확인 사항을 관리합니다"]);
  const all = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(ast) === "onShowAll");
  assert.equal(all.length, 1, "the compact home panel retains its only full-list entry point");
  const selected = [];
  evaluate(`const result = ${all[0].initializer.expression.getText(ast)};`, { navigate: (view) => selected.push(view) })();
  assert.deepEqual(selected, ["tasks"]);
  const syncNode = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "syncView")[0];
  for (const [hash, expected] of [["#tasks", "tasks"], ["#calendar", "calendar"], ["#not-a-view", "today"]]) {
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
