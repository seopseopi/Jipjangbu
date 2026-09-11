import assert from "node:assert/strict";
import test from "node:test";
import { fetchWorkWindow } from "../app/work-window.ts";

function mockArchive(total, signal) {
  const calls = [];
  return {
    calls,
    fetchPage: async (params, receivedSignal) => {
      if (signal) assert.equal(receivedSignal, signal);
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      calls.push({ offset, limit, params: params.toString() });
      assert.ok(limit > 0 && limit <= 1000);
      return {
        workLogs: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, index) => offset + index),
        total,
      };
    },
  };
}

test("첫 화면은 최소100건, 펼친200건은 한 번만 읽고 기존 검색 조건을 보존한다", async () => {
  for (const [visibleCount, expected] of [[0, 100], [100, 100], [200, 200], [NaN, 100], [Infinity, 100]]) {
    const params = new URLSearchParams({ q: "예시 고객", workType: "상담", from: "2026-01-01", to: "2026-12-31", offset: "777", limit: "3" });
    const initial = params.toString();
    const archive = mockArchive(5000);
    const result = await fetchWorkWindow(archive.fetchPage, params, visibleCount);
    assert.equal(result.workLogs.length, expected);
    assert.equal(result.total, 5000);
    assert.deepEqual(result.workLogs, Array.from({ length: expected }, (_, index) => index));
    assert.equal(archive.calls.length, 1);
    assert.equal(archive.calls[0].offset, 0);
    assert.equal(archive.calls[0].limit, expected);
    for (const key of ["q", "workType", "from", "to"]) {
      assert.equal(new URLSearchParams(archive.calls[0].params).get(key), params.get(key));
    }
    assert.equal(params.toString(), initial, "caller search params must not change");
  }
});

test("1000건 이상 펼친 목록은 요청당 최대1000건으로 나누고 펼친 범위에서 멈춘다", async () => {
  const archive = mockArchive(5000);
  const result = await fetchWorkWindow(archive.fetchPage, new URLSearchParams(), 2300);
  assert.deepEqual(archive.calls.map(({ offset, limit }) => ({ offset, limit })), [
    { offset: 0, limit: 1000 },
    { offset: 1000, limit: 1000 },
    { offset: 2000, limit: 300 },
  ]);
  assert.deepEqual(result.workLogs, Array.from({ length: 2300 }, (_, index) => index));
  assert.equal(result.total, 5000);
});

test("일부 삭제로 전체 수가 줄면 남은 기록만 읽고 불필요한 다음 페이지를 요청하지 않는다", async () => {
  const archive = mockArchive(1150);
  const result = await fetchWorkWindow(archive.fetchPage, new URLSearchParams(), 1500);
  assert.deepEqual(archive.calls.map(({ offset, limit }) => ({ offset, limit })), [
    { offset: 0, limit: 1000 },
    { offset: 1000, limit: 150 },
  ]);
  assert.equal(result.workLogs.length, 1150);
  assert.equal(result.total, 1150);

  const empty = mockArchive(0);
  assert.deepEqual(await fetchWorkWindow(empty.fetchPage, new URLSearchParams(), 300), { workLogs: [], total: 0 });
  assert.equal(empty.calls.length, 1);
});

test("읽는 도중 전체 수가 줄어도 마지막 전체 수보다 많은 행을 돌려주지 않는다", async () => {
  let calls = 0;
  const result = await fetchWorkWindow(async () => {
    calls++;
    return calls === 1
      ? { workLogs: Array.from({ length: 1000 }, (_, index) => index), total: 1500 }
      : { workLogs: [], total: 999 };
  }, new URLSearchParams(), 1500);
  assert.equal(calls, 2);
  assert.equal(result.total, 999);
  assert.equal(result.workLogs.length, 999);
});

test("짧은 페이지는 실제 받은 행 수부터 이어 읽으며 빈 페이지에서는 멈춘다", async () => {
  const offsets = [];
  const result = await fetchWorkWindow(async (params) => {
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    return { workLogs: offset < 80 ? Array.from({ length: 40 }, (_, index) => offset + index) : [], total: 500 };
  }, new URLSearchParams(), 200);
  assert.deepEqual(offsets, [0, 40, 80]);
  assert.deepEqual(result.workLogs, Array.from({ length: 80 }, (_, index) => index));
  assert.equal(result.total, 500);
});

test("다음 페이지 실패를 숨기거나 부분 성공으로 반환하지 않는다", async () => {
  let calls = 0;
  const failure = new Error("예시 읽기 실패");
  await assert.rejects(fetchWorkWindow(async () => {
    if (++calls === 2) throw failure;
    return { workLogs: Array.from({ length: 1000 }, (_, index) => index), total: 2000 };
  }, new URLSearchParams(), 1800), (error) => error === failure);
  assert.equal(calls, 2);
});

test("시작 전에 취소된 조회는 요청하지 않고 페이지를 받은 뒤 취소되어도 다음 요청을 하지 않는다", async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await assert.rejects(fetchWorkWindow(async () => {
    calls++;
    return { workLogs: [], total: 0 };
  }, new URLSearchParams(), 200, before.signal), { name: "AbortError" });
  assert.equal(calls, 0);

  const during = new AbortController();
  await assert.rejects(fetchWorkWindow(async (_params, signal) => {
    calls++;
    assert.equal(signal, during.signal);
    during.abort();
    return { workLogs: Array.from({ length: 1000 }, (_, index) => index), total: 2000 };
  }, new URLSearchParams(), 1500, during.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("정상 조회는 같은 취소 신호를 모든 페이지에 전달한다", async () => {
  const controller = new AbortController();
  const archive = mockArchive(2200, controller.signal);
  const result = await fetchWorkWindow(archive.fetchPage, new URLSearchParams(), 1500, controller.signal);
  assert.equal(result.workLogs.length, 1500);
  assert.equal(archive.calls.length, 2);
});
