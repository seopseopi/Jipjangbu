import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("업무비서 핵심 화면과 데이터 기능이 연결되어 있다", async () => {
  const [page, manager, schema, hosting, workRoute, customerRoute, listingRoute] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/work-manager.tsx", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("app/api/work-logs/route.ts", root), "utf8"),
    readFile(new URL("app/api/customers/route.ts", root), "utf8"),
    readFile(new URL("app/api/listings/route.ts", root), "utf8"),
  ]);

  assert.match(page, /<WorkManager \/>/);
  for (const label of ["오늘의 업무", "업무일지", "매물 관리", "고객 관리", "업무 달력"]) {
    assert.match(manager, new RegExp(label));
  }
  for (const table of ["customers", "work_logs", "work_log_properties", "listings", "listing_events"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
  }
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.doesNotMatch(manager, /react-loading-skeleton|_sites-preview/);
  for (const feature of ["바로 검색", "최근 7일", "CSV 저장", "100건 더 보기", "← 홈", "업무 등록"]) {
    assert.match(manager, new RegExp(feature));
  }
  assert.match(manager, /history\.pushState/);
  assert.match(workRoute, /COUNT\(\*\) AS total/);
  assert.match(customerRoute, /sort === "history"/);
  assert.match(listingRoute, /sort === "recent"/);
});
