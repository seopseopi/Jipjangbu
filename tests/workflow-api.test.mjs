import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fetchCustomerDirectory } from "../app/customer-directory.ts";

// Actual GET handlers + migrations + bound SQLite SQL. Only the runtime database
// binding and initialization/write boundary are replaced, using synthetic rows.
const dbKey = "jipjangbu-workflow-api-test-db";
const apiRoot = new URL("../app/api/", import.meta.url).href;
const appRoot = new URL("../app/", import.meta.url).href;
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(apiRoot)) {
      if (specifier === "../../../db") return { url: moduleUrl(`export function getD1() { return globalThis[Symbol.for(${JSON.stringify(dbKey)})]; }`), shortCircuit: true };
      if (specifier === "../../db/bootstrap") return { url: moduleUrl("export async function ensureDatabase() {}"), shortCircuit: true };
      if (specifier === "./data") return { url: moduleUrl("export class InputError extends Error {} export function saveWorkLog() { throw new Error('Workflow GET tests never write'); }"), shortCircuit: true };
    }
    if (context.parentURL?.startsWith(appRoot) && specifier.startsWith(".")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const [workRoute, customersRoute] = await Promise.all([import("../app/api/work-logs/route.ts"), import("../app/api/customers/route.ts")]);
hook.deregister();

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  const changes = () => sqlite.prepare("SELECT total_changes() AS count").get().count;
  let beforeReads;
  globalThis[Symbol.for(dbKey)] = {
    prepare(sql) {
      assert.match(sql, /^\s*(SELECT|WITH)\b/i, "workflow GET must not write");
      beforeReads ??= changes();
      const query = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...bindings) { values = bindings; return this; },
        async all() { return { results: query.all(...values) }; },
        async first() { return query.get(...values) ?? null; },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
  };
  t.after(() => {
    try { if (beforeReads !== undefined) assert.equal(changes(), beforeReads); }
    finally { sqlite.close(); delete globalThis[Symbol.for(dbKey)]; }
  });
  return {
    customer(id = "synthetic-customer", name = "예시 고객") { sqlite.prepare("INSERT INTO customers (id,name) VALUES (?,?)").run(id, name); },
    work(id, date, type = "계약예정", customer = "synthetic-customer", updated = "2026-09-13 01:00:00") {
      sqlite.prepare("INSERT INTO work_logs (id,customer_id,work_date,work_type,content,updated_at,created_at) VALUES (?,?,?,?,?,?,?)").run(id, customer, date, type, "합성 업무 메모", updated, updated);
    },
    property(id, workId, dong, unit) {
      sqlite.prepare("INSERT INTO work_log_properties (id,work_log_id,sequence,property_type,building_name,building_dong,unit_number) VALUES (?,?,1,'아파트','합성단지',?,?)").run(id, workId, dong, unit);
    },
  };
}
async function get(route, path, params = {}) {
  const response = await route.GET(new Request(`https://test.invalid${path}?${new URLSearchParams(params)}`));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

test("전체 일정 API는 월경계 양끝과 모든 페이지에서 집방문 예약 우선·그 안에서는 날짜순을 유지한다", async (t) => {
  const db = database(t);
  db.customer();
  const dates = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  // Insert in descending date order to ensure sorting comes from the GET query.
  const expected = [];
  for (const [index, date] of [...dates].reverse().entries()) {
    for (const suffix of ["a", "b", "c"]) {
      const id = `schedule-${index}-${suffix}`;
      db.work(id, date, suffix === "b" ? "집방문예약" : "계약예정");
      expected.push({ id, date, priority: suffix === "b" ? 0 : 1 });
    }
  }
  db.work("before-window", "2026-09-28"); db.work("after-window", "2026-10-06");
  db.work("completed", "2026-10-01", "계약작성");
  db.work("cancelled", "2026-10-01", "계약예정취소");
  db.work("ordinary-call", "2026-10-01", "전화");
  expected.sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const pages = [];
  for (const offset of [0, 8, 16, 24]) {
    const page = await get(workRoute, "/api/work-logs", { schedule: "1", from: dates[0], to: dates.at(-1), limit: "8", offset: String(offset) });
    assert.equal(page.total, 21);
    assert.ok(page.workLogs.length <= 8);
    pages.push(...page.workLogs);
  }
  assert.deepEqual(pages.map((row) => row.id), expected.map((row) => row.id));
  assert.equal(new Set(pages.map((row) => row.id)).size, 21);
  assert.ok(pages.slice(0, 7).every((row) => row.work_type === "집방문예약"));
  assert.equal(pages[0].work_date, dates[0]);
  assert.equal(pages.at(-1).work_date, dates.at(-1));
  const journal = await get(workRoute, "/api/work-logs", { from: dates[0], to: dates.at(-1) });
  assert.equal(journal.total, 24);
  assert.equal(journal.workLogs[0].work_date, dates.at(-1), "ordinary journal keeps newest-first order");
});

test("일정 전체보기도 주소·고객·업무구분 조건과 전체 건수를 일치시킨다", async (t) => {
  const db = database(t);
  db.customer(); db.customer("other-customer", "다른 예시 고객");
  for (const [id, customer, type, dong, unit] of [
    ["target", "synthetic-customer", "계약예정", "106", "1503"],
    ["other-customer", "other-customer", "계약예정", "106", "1503"],
    ["other-type", "synthetic-customer", "집방문예약", "106", "1503"],
    ["other-address", "synthetic-customer", "계약예정", "106", "15030"],
    ["not-schedule", "synthetic-customer", "계약작성", "106", "1503"],
  ]) {
    db.work(id, "2026-10-01", type, customer);
    db.property(`property-${id}`, id, dong, unit);
  }
  const response = await get(workRoute, "/api/work-logs", { schedule: "1", from: "2026-09-29", to: "2026-10-05", workType: "계약예정", customerId: "synthetic-customer", q: "106동 1503호", limit: "1" });
  assert.equal(response.total, 1);
  assert.deepEqual(response.workLogs.map((row) => row.id), ["target"]);
  assert.equal(response.workLogs[0].search_property_match, 1);
});

test("실제 고객 API와 명부 로더는 1,001명 전부를 읽으며 각 페이지가 겹치지 않는다", async (t) => {
  const db = database(t);
  for (let index = 0; index < 1001; index++) db.customer(`customer-${String(index).padStart(4, "0")}`, `예시 고객 ${String(index).padStart(4, "0")}`);
  const pages = [];
  const customers = await fetchCustomerDirectory(async (url) => {
    const parsed = new URL(url, "https://test.invalid");
    const page = await get(customersRoute, parsed.pathname, Object.fromEntries(parsed.searchParams));
    pages.push(page.customers);
    return page;
  });
  assert.deepEqual(pages.map((rows) => rows.length), [1000, 1]);
  assert.equal(customers.length, 1001);
  assert.equal(new Set(customers.map((customer) => customer.id)).size, 1001);
  assert.equal(customers.at(-1).id, "customer-1000");
  const beyond = await get(customersRoute, "/api/customers", { offset: "1001" });
  assert.deepEqual(beyond.customers, []);
});
