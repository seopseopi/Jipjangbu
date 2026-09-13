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
  { work_log_id: "future-work", event_date: "2026-12-31", status: "잔금예정", notes: "미래 업무일의 기록", work_updated_at: "2026-09-12 01:00:00" },
  { work_log_id: "changed-work", event_date: "2026-08-20", status: "매물수정", notes: "과거 업무에서 고친 내용\n둘째 줄", work_updated_at: "2026-09-13 04:05:06" },
];

test("상단은 한 업무만 선택하지 않고 API 업무일 순서의 전체 내용을 연속 메모로 보여 준다", () => {
  const original = JSON.stringify(events);
  const tree = ListingHistorySummary({ events });
  const memo = byClass(tree, "listing-history-memo");
  assert.equal(memo.props.children, "미래 업무일의 기록\n(잔금예정) (2026-12-31)\n\n과거 업무에서 고친 내용\n둘째 줄\n(매물수정) (2026-08-20)");
  assert.match(markup(tree), /전체 매물 이력/);
  assert.match(markup(tree), /업무일 최신순 · 2건/);
  assert.doesNotMatch(markup(tree), /최근 저장|한국시간|업무 내용 보기|<button/);
  assert.equal(JSON.stringify(events), original);
});

test("열 개를 넘는 모든 이력은 본문에 포함되며 같은 내용과 같은 업무ID도 제거하지 않는다", () => {
  const history = Array.from({ length: 27 }, (_, index) => ({ ...events[index % 2], notes: index === 26 ? "마지막 27번째 내용" : "동일한 내용도 별도 이력" }));
  const tree = ListingHistorySummary({ events: history });
  const memo = byClass(tree, "listing-history-memo").props.children;
  assert.equal(memo.split("동일한 내용도 별도 이력").length - 1, 26);
  assert.match(memo, /마지막 27번째 내용/);
  assert.match(markup(tree), /업무일 최신순 · 27건/);
  assert.doesNotMatch(markup(tree), /더 보기|<details|외 \d+건|\shidden=/);
});

test("업무일·저장시각이 뒤섞여 있어도 입력 순서를 임의 정렬하지 않는다", () => {
  const history = [events[1], events[0], { ...events[1], notes: "세 번째 재방문 기록", work_updated_at: "2099-12-31 00:00:00" }];
  const memo = byClass(ListingHistorySummary({ events: history }), "listing-history-memo").props.children;
  assert.ok(memo.indexOf("과거 업무에서 고친 내용") < memo.indexOf("미래 업무일의 기록"));
  assert.ok(memo.indexOf("미래 업무일의 기록") < memo.indexOf("세 번째 재방문 기록"));
  assert.doesNotMatch(memo, /2099/);
});

test("엑셀 원본은 이벤트가 있을 때만 별도 닫힌 참고 영역으로 보존한다", () => {
  const sourceNotes = "  옛 엑셀 원문\n\n<확인> & 메모\n끝  ";
  const tree = ListingHistorySummary({ events, sourceNotes });
  const details = descendants(tree).find((element) => element.type === "details");
  assert.ok(details);
  assert.equal(details.props.open, undefined);
  assert.match(markup(details), /엑셀 원본 메모/);
  assert.equal(descendants(details).find((element) => element.type === "p").props.children, sourceNotes);
  assert.doesNotMatch(byClass(tree, "listing-history-memo").props.children, /옛 엑셀 원문/);
  assert.match(markup(details), /&lt;확인&gt; &amp; 메모/);
});

test("이벤트가 없고 원본만 남아 있으면 원본 전문을 기본 본문에 한 번만 표시한다", () => {
  const sourceNotes = "  원본만 있는 매물\n공백과 줄바꿈  ";
  const tree = ListingHistorySummary({ events: [], sourceNotes });
  assert.equal(byClass(tree, "listing-history-memo").props.children, sourceNotes);
  assert.match(markup(tree), /전체 매물 이력/);
  assert.match(markup(tree), /엑셀 원본 메모/);
  assert.equal(descendants(tree).some((element) => element.type === "details"), false);
  assert.equal(markup(tree).split("원본만 있는 매물").length - 1, 1);
  assert.doesNotMatch(markup(tree), /업무일 최신순 · 0건/);
});

test("내용 없는 상태 변경도 날짜·업무만으로 간결하게 남기며 옛 원본으로 대체하지 않는다", () => {
  const tree = ListingHistorySummary({ events: [{ ...events[0], notes: " \n " }, { ...events[1], notes: null }], sourceNotes: "대체하면 안 되는 원본" });
  const memo = byClass(tree, "listing-history-memo").props.children;
  assert.doesNotMatch(memo, /기록된 내용 없음/);
  assert.match(memo, /\(잔금예정\) \(2026-12-31\)/);
  assert.match(memo, /\(매물수정\) \(2026-08-20\)/);
  assert.doesNotMatch(memo, /대체하면 안 되는 원본/);
});

test("날짜·업무가 없는 기록은 내용을 보존하고 식별정보나 저장시각을 추정하지 않는다", () => {
  const tree = ListingHistorySummary({ events: [{ notes: "날짜 없는 기록" }, { notes: "유형만 남은 기록", status: "상담" }] });
  assert.equal(byClass(tree, "listing-history-memo").props.children, "날짜 없는 기록\n\n유형만 남은 기록\n(상담)");
  assert.doesNotMatch(markup(tree), /undefined|null|Invalid Date|최근 저장|시각 정보 없음/);
  assert.equal(byClass(ListingHistorySummary({ events: [{}] }), "listing-history-memo").props.children, "기록된 내용 없음");
});

test("긴 원문·줄바꿈·앞뒤 공백은 유지하고 HTML은 일반 문자로 안전하게 표시한다", () => {
  const notes = `  첫줄\n${"아주 긴 메모 ".repeat(1500)}\n<script>합성문자</script>\n마지막줄  `;
  const tree = ListingHistorySummary({ events: [{ ...events[1], notes }] });
  const memo = byClass(tree, "listing-history-memo").props.children;
  assert.equal(memo, `${notes}\n(매물수정) (2026-08-20)`);
  assert.match(markup(tree), /&lt;script&gt;합성문자&lt;\/script&gt;/);
  assert.doesNotMatch(markup(tree), /<script>/);
  assert.equal(tree.props.className, "listing-saved-summary");
  const css = readFileSync(new URL("../app/listing-history-summary.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.listing-history-summary\s*\{|line-clamp|text-overflow:\s*ellipsis|max-height|overflow:\s*hidden/);
  assert.match(css, /\.listing-history-memo\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
});

test("이벤트와 원본이 모두 없으면 빈 상자나 가짜 기록을 만들지 않는다", () => {
  assert.equal(ListingHistorySummary({ events: [] }), null);
  assert.equal(ListingHistorySummary({ events: [], sourceNotes: " \n " }), null);
});
