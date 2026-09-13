import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingHistorySummary } from "./helpers/listing-history-summary.mjs";

const markup = (tree) => renderToStaticMarkup(tree);
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
const byClass = (tree, name) => descendants(tree).find((element) => element.props.className?.split(/\s+/).includes(name));
const events = [
  { work_log_id: "future-work", event_date: "2026-12-31", status: "잔금예정", notes: "미래 업무일의 이전 저장 내용", work_updated_at: "2026-09-12 01:00:00", created_at: "2026-09-12 01:00:00" },
  { work_log_id: "recent-save", event_date: "2026-08-20", status: "매물수정", notes: "지금 수정하여 저장한 내용\n둘째 줄", work_updated_at: "2026-09-13 04:05:06", created_at: "2026-08-20 01:00:00" },
];

test("상단은 최신 업무일이 아닌 최근 저장한 업무의 전체 내용을 표시하고 같은 업무를 연다", () => {
  const original = JSON.stringify(events), opened = [];
  const tree = ListingHistorySummary({ events, onOpenWork: (id) => opened.push(id) });
  const latest = byClass(tree, "listing-latest-save"), html = markup(latest);
  assert.match(html, /최근 저장한 업무 내용/);
  assert.match(html, /지금 수정하여 저장한 내용\n둘째 줄/);
  assert.match(html, /업무일 · <time dateTime="2026-08-20">2026\.08\.20/);
  assert.match(html, /매물수정/);
  assert.match(html, /최근 저장 · 2026\.09\.13 13:05/);
  assert.doesNotMatch(html, /한국\s*시간/);
  assert.doesNotMatch(html, /미래 업무일의 이전 저장 내용|2026\.12\.31/);
  const button = descendants(tree).find((element) => element.type === "button");
  assert.equal(button.props.type, "button");
  button.props.onClick();
  assert.deepEqual(opened, ["recent-save"]);
  assert.equal(JSON.stringify(events), original, "reading does not reorder or mutate date-sorted history");
});

test("엑셀 원본 메모는 처음 닫힌 별도 접기 영역이며 공백·줄바꿈·특수문자를 보존한다", () => {
  const sourceNotes = "  옛 엑셀 원문\n\n<확인> & 메모\n끝  ";
  const tree = ListingHistorySummary({ events, sourceNotes });
  const details = descendants(tree).find((element) => element.type === "details");
  assert.ok(details);
  assert.equal(details.props.open, undefined);
  assert.match(markup(details), /엑셀 원본 메모/);
  assert.equal(descendants(details).find((element) => element.type === "p").props.children, sourceNotes);
  assert.doesNotMatch(markup(byClass(tree, "listing-latest-save")), /옛 엑셀 원문/);
  assert.match(markup(details), /&lt;확인&gt; &amp; 메모/);
  assert.equal(details.props.onToggle, undefined, "native disclosure never fetches or changes stored records");
});

test("최신 업무 내용이 비어 있으면 빈 내용을 알리고 오래된 원본 메모로 대체하지 않는다", () => {
  const tree = ListingHistorySummary({ events: [{ ...events[1], notes: " \n " }], sourceNotes: "대체하면 안 되는 옛 원본" });
  const latest = markup(byClass(tree, "listing-latest-save"));
  assert.match(latest, /기록된 내용 없음/);
  assert.doesNotMatch(latest, /대체하면 안 되는 옛 원본/);
  assert.match(markup(tree), /엑셀 원본 메모/);
});

test("저장 시각이 전부 없거나 무효이면 최근 저장으로 단정하지 않고 업무일 기준임을 알린다", () => {
  for (const timestamp of [undefined, "invalid", "2026-02-30 15:00:00", "2026-09-13"]) {
    const tree = ListingHistorySummary({ events: events.map((event) => ({ ...event, work_updated_at: timestamp, created_at: undefined })) });
    const html = markup(tree);
    assert.match(html, /최근 업무 내용/);
    assert.match(html, /저장 시각 정보 없음 · 업무일 기준으로 표시합니다/);
    assert.match(html, /미래 업무일의 이전 저장 내용/);
    assert.doesNotMatch(html, /최근 저장한 업무 내용|최근 저장 ·|한국시간|Invalid Date|NaN/);
  }
});

test("잘못된 업무 저장 시각은 유효한 이벤트 시각으로 대체하고 한국시간 날짜 경계를 적용한다", () => {
  const tree = ListingHistorySummary({ events: [{ ...events[1], work_updated_at: "bad-value", created_at: "2026-09-13T20:03:00Z" }] });
  assert.match(markup(tree), /최근 저장 · 2026\.09\.14 05:03/);
  assert.doesNotMatch(markup(tree), /한국\s*시간/);
  assert.doesNotMatch(markup(tree), /저장 시각 정보 없음|bad-value/);
});

test("유효한 업무 저장 시각이 있으면 재생성된 이벤트 시각을 최근 저장으로 잘못 선택하지 않는다", () => {
  const tree = ListingHistorySummary({ events: [
    { ...events[0], created_at: "2026-09-15 10:00:00" },
    events[1],
  ] });
  assert.match(markup(tree), /지금 수정하여 저장한 내용/);
  assert.doesNotMatch(markup(tree), /미래 업무일의 이전 저장 내용/);
});

test("연결 업무나 열기 콜백이 없으면 편집·이동 버튼 없이 내용만 표시한다", () => {
  for (const props of [{ events }, { events: [{ ...events[1], work_log_id: "" }], onOpenWork: assert.fail }]) {
    const html = markup(ListingHistorySummary(props));
    assert.doesNotMatch(html, /<button|<input|<form/);
    assert.match(html, /지금 수정하여 저장한 내용/);
  }
});

test("새 기록이 없을 때 원본만 별도로 제공하며 모든 내용이 비어 있으면 빈 상자를 만들지 않는다", () => {
  const tree = ListingHistorySummary({ events: [], sourceNotes: "원본만 존재" });
  assert.equal(byClass(tree, "listing-latest-save"), undefined);
  assert.match(markup(tree), /원본만 존재|엑셀 원본 메모/);
  assert.equal(ListingHistorySummary({ events: [] }), null);
  assert.equal(ListingHistorySummary({ events: [], sourceNotes: " \n " }), null);
});

test("최근 저장 원문은 전문을 유지하고 기존 가격 요약 CSS와 독립된 이름을 사용한다", () => {
  const notes = `  첫줄\n${"아주 긴 메모 ".repeat(1500)}\n마지막줄  `;
  const tree = ListingHistorySummary({ events: [{ ...events[1], notes }] });
  assert.equal(byClass(tree, "listing-latest-save-content").props.children, notes);
  assert.equal(tree.props.className, "listing-saved-summary");
  const css = readFileSync(new URL("../app/listing-history-summary.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.listing-history-summary\s*\{|line-clamp|text-overflow:\s*ellipsis|max-height|overflow:\s*hidden/);
  assert.match(css, /\.listing-latest-save-content\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.listing-source-notes > p\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
});
