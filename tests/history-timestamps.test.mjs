import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { formatHistoryTimestamp, latestSavedListingEvent } from "../app/history-timestamps.ts";

test("SQLite UTC 저장 시각과 ISO 시간대를 동일한 한국 시각으로 표시한다", () => {
  for (const value of ["2026-09-13 08:52:25", "2026-09-13T08:52:25", "2026-09-13T08:52:25Z", "2026-09-13T17:52:25+09:00", "2026-09-13T04:52:25-0400", " 2026-09-13 08:52:25.123456 ", "2026-09-13T08:52Z"]) {
    assert.equal(formatHistoryTimestamp(value), "2026.09.13 17:52", value);
  }
});

test("UTC 날짜와 연도 경계·윤년을 한국 날짜 기준으로 변환한다", () => {
  assert.equal(formatHistoryTimestamp("2026-09-13 15:00:00"), "2026.09.14 00:00");
  assert.equal(formatHistoryTimestamp("2026-12-31T23:30:00Z"), "2027.01.01 08:30");
  assert.equal(formatHistoryTimestamp("2024-02-29T23:59:59.999Z"), "2024.03.01 08:59");
  assert.equal(formatHistoryTimestamp("2000-02-29 00:00:00"), "2000.02.29 09:00");
  assert.equal(formatHistoryTimestamp("0099-12-31 16:00:00"), "0100.01.01 01:00");
});

test("업무 날짜만 있거나 잘못된 날짜·시각이면 저장 시각을 만들어내지 않는다", () => {
  for (const value of [undefined, null, "", "   ", "2026-09-13", "not-a-date", "2026-02-29 12:00:00", "2026-02-30T12:00:00Z", "1900-02-29 00:00:00", "2026-09-31 00:00:00", "2026-00-13 00:00:00", "2026-13-13 00:00:00", "2026-09-00 00:00:00", "2026-09-13T24:00:00Z", "2026-09-13T12:60:00Z", "2026-09-13T12:00:60Z", "2026-09-13T12:00:00+24:00", "2026-09-13T12:00:00+09:60", "2026-09-13T12:00:00Europe/Paris", "0000-01-01 00:00:00", "9999-12-31T23:59:59Z", "2026-9-13 08:52:25"]) {
    assert.equal(formatHistoryTimestamp(value), "", String(value));
  }
  assert.equal(formatHistoryTimestamp(0), "");
});

test("컴퓨터 시간대가 달라도 SQLite 저장 시각의 한국 표시가 같다", () => {
  const url = new URL("../app/history-timestamps.ts", import.meta.url).href;
  const script = `import { formatHistoryTimestamp } from ${JSON.stringify(url)}; process.stdout.write(formatHistoryTimestamp('2026-09-13 08:52:25'));`;
  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, TZ: tz } });
    assert.equal(output, "2026.09.13 17:52", tz);
  }
});

test("업무일이 과거여도 최근 저장한 이력을 고르되 원래 배열과 객체는 그대로 둔다", () => {
  const recentBusiness = Object.freeze({ id: "recent-business", event_date: "2026-09-20", work_updated_at: "2026-09-12 07:00:00", created_at: "2026-09-12 07:00:00" });
  const recentlySaved = Object.freeze({ id: "recent-save", event_date: "2026-09-01", work_updated_at: "2026-09-13 08:52:25", created_at: "2026-09-01 02:00:00" });
  const events = Object.freeze([recentBusiness, recentlySaved]);
  assert.equal(latestSavedListingEvent(events), recentlySaved);
  assert.deepEqual(events, [recentBusiness, recentlySaved]);
});

test("유효한 업무 저장 시각이 있으면 이벤트 재생성 시각보다 우선한다", () => {
  const regenerated = { id: "regenerated", work_updated_at: "2026-09-01 01:00:00", created_at: "2026-09-20 01:00:00" };
  const edited = { id: "edited", work_updated_at: "2026-09-13 01:00:00", created_at: "2026-09-13 01:00:00" };
  assert.equal(latestSavedListingEvent([regenerated, edited]), edited);
});

test("업무 저장 시각이 없거나 잘못되면 유효한 이벤트 생성 시각으로 비교한다", () => {
  const invalid = { id: "invalid", work_updated_at: "not-a-time", created_at: "2026-09-13T10:00:00+09:00" };
  const missing = { id: "missing", created_at: "2026-09-13 02:00:00" };
  const dateOnly = { id: "date-only", work_updated_at: "2026-09-15", created_at: "2026-09-13 03:00:00" };
  assert.equal(latestSavedListingEvent([invalid, missing]), missing);
  assert.equal(latestSavedListingEvent([invalid, missing, dateOnly]), dateOnly);
});

test("문자열 순서가 아니라 epoch로 비교하고 같은 시각이면 기존 이력 순서를 유지한다", () => {
  const first = { id: "first", work_updated_at: "2026-09-13T17:00:00+09:00" };
  const tied = { id: "same", work_updated_at: "2026-09-13 08:00:00" };
  const later = { id: "later", work_updated_at: "2026-09-13T08:00:00.001Z" };
  assert.equal(latestSavedListingEvent([first, tied]), first);
  assert.equal(latestSavedListingEvent([first, tied, later]), later);
});

test("저장 시각이 전부 없으면 기존 첫 기록을 유지하고 빈 이력은 undefined다", () => {
  const first = { id: "first", event_date: "2026-09-01", work_updated_at: "2026-09-01", created_at: "invalid" };
  const second = { id: "second", event_date: "2026-09-20" };
  assert.equal(latestSavedListingEvent([first, second]), first);
  assert.equal(latestSavedListingEvent([]), undefined);
});
