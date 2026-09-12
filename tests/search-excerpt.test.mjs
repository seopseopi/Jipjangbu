import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchExcerpt } from "../app/search-excerpt.ts";

test("short search previews preserve text and normalize spaces, tabs and newlines", () => {
  assert.equal(searchExcerpt("  첫 상담\n\n내일\t  방문\r\n예정  ", "내일 방문"), "첫 상담 내일 방문 예정");
  assert.equal(searchExcerpt(null, "검색"), "");
  assert.equal(searchExcerpt(undefined, "검색"), "");
  assert.equal(searchExcerpt(" \n\t ", "검색"), "");
});

test("a match late in a long memo is included with surrounding context and honest ellipses", () => {
  const before = "기존 상담 기록 ".repeat(50);
  const after = "추가 확인 내용 ".repeat(50);
  const excerpt = searchExcerpt(`${before}입주 날짜 확인${after}`, "입주 날짜 확인");
  assert.ok(excerpt.startsWith("…"));
  assert.ok(excerpt.endsWith("…"));
  assert.match(excerpt, /기존 상담 기록.*입주 날짜 확인.*추가 확인 내용/);
  assert.ok(Array.from(excerpt).length <= 162);
  assert.equal(searchExcerpt(before + "마지막 상담", "마지막 상담").endsWith("…"), false);
});

test("no match or an empty query uses the beginning, and beginning matches have no leading ellipsis", () => {
  assert.equal(searchExcerpt("처음부터 읽을 수 있는 긴 메모", "없는 검색어", 8), "처음부터 읽을…");
  assert.equal(searchExcerpt("처음부터 읽을 수 있는 긴 메모", " \n ", 8), "처음부터 읽을…");
  assert.equal(searchExcerpt("처음부터 읽을 수 있는 긴 메모", "처음부터", 8), "처음부터 읽을…");
});

test("case-insensitive matching handles mixed-case and length-changing Unicode folds", () => {
  const excerpt = searchExcerpt(`${"사전 기록 ".repeat(50)}MiXeD-Case 상담${" 추가 메모".repeat(50)}`, "mixed-case");
  assert.match(excerpt, /MiXeD-Case 상담/);
  const unicode = searchExcerpt(`${"İ".repeat(200)}CHECK POINT${" 끝".repeat(100)}`, "check point", 20);
  assert.match(unicode, /CHECK POINT/);
  assert.ok(Array.from(unicode).length <= 22, "fold expansion does not shift the original text's excerpt");
});

test("grapheme-safe boundaries preserve emoji families, skin tones and decomposed Korean", () => {
  const family = "👨‍👩‍👧‍👦";
  const thumbsUp = "👍🏽";
  const decomposedHangul = "가";
  assert.equal(searchExcerpt(`${family}${thumbsUp}${decomposedHangul}추가 내용`, "", 3), `${family}${thumbsUp}${decomposedHangul}…`);
  const result = searchExcerpt(`${family.repeat(40)}${decomposedHangul.repeat(5)}${thumbsUp.repeat(40)}`, "가가", 8);
  assert.ok(result.includes(decomposedHangul.repeat(2)), "composed search matches decomposed Hangul without changing displayed characters");
  const units = Array.from(new Intl.Segmenter("ko-KR", { granularity: "grapheme" }).segment(result), (part) => part.segment);
  assert.ok(units.every((unit) => [family, thumbsUp, decomposedHangul, "…"].includes(unit)));
  assert.ok(units.length <= 10);
});

test("the length bound is safe for long queries and invalid limits", () => {
  const query = "검색".repeat(100);
  const result = searchExcerpt(`이전 ${query} 이후`, query, 12);
  assert.match(result, /^…검색/);
  assert.ok(Array.from(result).length <= 14);
  for (const length of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(searchExcerpt("내용", "내", length), "");
  }
});

test("global search shortens only memo previews, not customer IDs or the selection callbacks", () => {
  const source = readFileSync(new URL("../app/global-search.tsx", import.meta.url), "utf8");
  assert.match(source, /searchExcerpt\(item\.content, trimmedQuery\) \|\| item\.customer_name/);
  assert.match(source, /searchExcerpt\(customer\.notes, trimmedQuery\)/);
  assert.match(source, /<small>\{customer\.id\}\{notes \? ` · \$\{notes\}` : ""\}<\/small>/);
  assert.doesNotMatch(source, /searchExcerpt\((?:customer\.id|customer\.name|workTarget|listingName)/);
  assert.match(source, /onClick=\{\(\) => chooseWork\(item\.id\)\}/);
  assert.match(source, /onClick=\{\(\) => chooseCustomer\(customer\)\}/);
  assert.match(source, /onClick=\{\(\) => chooseListing\(listing\)\}/);
});
