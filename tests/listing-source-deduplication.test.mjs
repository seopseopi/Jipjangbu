import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { ListingHistorySummary } from "./helpers/listing-history-summary.mjs";

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
const event = { event_date: "2026-09-01", status: "매물등록", notes: "입주 협의\n임차인 연락처 추가" };
function extra(tree) {
  const details = descendants(tree).find((element) => element.type === "details");
  return details && descendants(details).find((element) => element.type === "p").props.children;
}

test("이미 업무에 포함된 날짜별 원본과 빈 상태 기록은 별도 표시하지 않는다", () => {
  const events = [event, { event_date: "2023-06-21", status: "타계약확인", notes: "" }];
  const sourceNotes = "입주 협의(매물등록)(2026-09-01)\n(타계약확인)(2023-06-21)";
  const before = JSON.stringify({ events, sourceNotes });
  assert.equal(extra(ListingHistorySummary({ events, sourceNotes })), undefined);
  assert.equal(JSON.stringify({ events, sourceNotes }), before);
});

test("원본의 일부만 이력에 포함되면 미포함 기록과 알 수 없는 끝 메모만 보존한다", () => {
  const missing = "\n  별도 보관 내용 <확인>  (매물수정)(2020-05-11)";
  const tail = "\n[기존 등록일자: NO매물]  ";
  const tree = ListingHistorySummary({ events: [event], sourceNotes: `입주 협의(매물등록)(2026-09-01)${missing}${tail}` });
  assert.equal(extra(tree), `${missing}\n\n${tail}`);
  assert.doesNotMatch(extra(tree), /입주 협의|임차인 연락처/);
});

test("같은 날짜·유형이어도 현재 업무와 다른 원문을 추측해서 제거하지 않는다", () => {
  const sourceNotes = "원본에만 있는 특약(매물등록)(2026-09-01)";
  assert.equal(extra(ListingHistorySummary({ events: [event], sourceNotes })), sourceNotes);
});

test("같은 내용이어도 날짜나 유형이 다른 원본은 별도 기록으로 보존한다", () => {
  for (const sourceNotes of ["입주 협의(매물등록)(2025-09-01)", "입주 협의(매물수정)(2026-09-01)"]) {
    assert.equal(extra(ListingHistorySummary({ events: [event], sourceNotes })), sourceNotes);
  }
});

test("날짜 표기가 없는 원문은 한 업무에 전문이 포함될 때만 중복 표시를 없앤다", () => {
  assert.equal(extra(ListingHistorySummary({ events: [event], sourceNotes: " 입주\n협의 " })), undefined);
  const sourceNotes = "입주 협의 및 별도 협의";
  assert.equal(extra(ListingHistorySummary({ events: [event, { ...event, notes: "별도 협의" }], sourceNotes })), sourceNotes);
});

test("식별할 수 없는 원본 형식·공백·HTML 문자는 손실 없이 남긴다", () => {
  const sourceNotes = "  <확인> & 보관\n입주 협의(매물등록)(2026/09/01)  ";
  assert.equal(extra(ListingHistorySummary({ events: [event], sourceNotes })), sourceNotes);
});
