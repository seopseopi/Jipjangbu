import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getFollowUps } from "../app/api/follow-ups/_store.ts";

// Run the real route handlers and their bound SQL against SQLite. Only the
// Cloudflare binding and bootstrap boundary are replaced for these local tests.
const dbKey = "jipjangbu-ordering-test-db";
const apiRoot = new URL("../app/api/", import.meta.url).href;
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(apiRoot)) {
      if (specifier === "../../../db") return {
        url: moduleUrl(`export function getD1() { return globalThis[Symbol.for(${JSON.stringify(dbKey)})]; }`),
        shortCircuit: true,
      };
      if (specifier === "../_shared") return {
        url: moduleUrl("export async function ready() {} export function apiError(error) { throw error; } export function badRequest(error) { return Response.json({ error }, { status: 400 }); }"),
        shortCircuit: true,
      };
      if (["../_ordering", "../_queries"].includes(specifier)) return {
        url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const [customersRoute, listingsRoute, bootstrapRoute, searchRoute, insightsRoute] = await Promise.all([
  import("../app/api/customers/route.ts"), import("../app/api/listings/route.ts"),
  import("../app/api/bootstrap/route.ts"), import("../app/api/search/route.ts"),
  import("../app/api/insights/route.ts"),
]);
hook.deregister();

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  const db = {
    prepare(sql) {
      const query = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...bindings) { values = bindings; return this; },
        async first() { return query.get(...values) ?? null; },
        async all() { return { results: query.all(...values) }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
  };
  globalThis[Symbol.for(dbKey)] = db;
  t.after(() => { sqlite.close(); delete globalThis[Symbol.for(dbKey)]; });
  const date = (offset = 0) => sqlite.prepare("SELECT date('now','+9 hours', ?) AS value").get(`${offset} days`).value;
  const customer = (id, name, created = date(-100), updated = date()) =>
    sqlite.prepare("INSERT INTO customers (id,name,created_at,updated_at) VALUES (?,?,?,?)").run(id, name, created, updated);
  const work = (id, customerId, workDate, updated = workDate, created = updated, type = "전화") =>
    sqlite.prepare("INSERT INTO work_logs (id,customer_id,work_date,work_type,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, customerId, workDate, type, created, updated);
  const listing = (id, { building = "단지", dong = "2", unit = "2", closed = null, registered = date(-100), updated = date(-50), notes = "" } = {}) =>
    sqlite.prepare(`INSERT INTO listings (id,identity_key,status,property_type,building_name,building_dong,
      unit_number,closed_at,registered_at,updated_at,notes) VALUES (?,?,'매물등록','아파트',?,?,?,?,?,?,?)`)
      .run(id, id, building, dong, unit, closed, registered, updated, notes);
  return { sqlite, db, date, customer, work, listing };
}

const request = (path, params = {}) => new Request(`https://test.invalid/api/${path}?${new URLSearchParams(params)}`);
const ids = (items) => items.map((item) => item.id);

test("고객 최근 업무순은 미래 예약·일괄 수정일을 제외하고 동률은 이름과 ID로 고정한다", async (t) => {
  const { date, customer, work } = database(t);
  customer("tie-z", "가람"); customer("tie-a", "가람"); customer("new", "나래", date());
  customer("yesterday", "다인"); customer("old-future", "라온", date(-200), date(100));
  customer("future-only", "마루", date(-90), date(100));
  work("today-z", "tie-z", date()); work("today-a", "tie-a", date());
  work("yesterday", "yesterday", date(-1));
  work("old", "old-future", date(-30)); work("future", "old-future", date(30));
  work("only-future", "future-only", date(60));
  const recent = (await (await customersRoute.GET(request("customers"))).json()).customers;
  assert.deepEqual(ids(recent), ["tie-a", "tie-z", "new", "yesterday", "old-future", "future-only"]);
  assert.equal(recent.find((item) => item.id === "old-future").last_work_date, date(-30));
  assert.equal(recent.find((item) => item.id === "future-only").last_work_date, null);
  assert.equal(recent.find((item) => item.id === "old-future").history_count, 2);
  const history = (await (await customersRoute.GET(request("customers", { sort: "history" }))).json()).customers;
  assert.deepEqual(ids(history), ["old-future", "tie-a", "tie-z", "yesterday", "future-only", "new"]);
  const name = (await (await customersRoute.GET(request("customers", { sort: "name" }))).json()).customers;
  assert.deepEqual(ids(name), ["tie-a", "tie-z", "new", "yesterday", "old-future", "future-only"]);
  const unknown = (await (await customersRoute.GET(request("customers", { sort: "id; DROP TABLE customers" }))).json()).customers;
  assert.deepEqual(ids(unknown), ids(recent));
});

test("매물 단지순은 진행중 우선·동과 호의 숫자순·빈 값 마지막·ID 동률 기준을 적용한다", async (t) => {
  const { date, listing } = database(t);
  listing("dong-10", { dong: "10" }); listing("unit-10", { unit: "10" });
  listing("tie-z"); listing("tie-a"); listing("no-unit", { unit: "" });
  listing("no-dong", { dong: "" }); listing("closed", { building: "가", closed: date() });
  listing("suffix-10", { dong: "10동" }); listing("suffix-2", { dong: "2동" });
  const result = (await (await listingsRoute.GET(request("listings", { state: "all" }))).json()).listings;
  assert.deepEqual(ids(result), ["tie-a", "tie-z", "unit-10", "no-unit", "suffix-2", "dong-10", "suffix-10", "no-dong", "closed"]);
  const again = (await (await listingsRoute.GET(request("listings", { state: "all" }))).json()).listings;
  assert.deepEqual(ids(again), ids(result));
  const active = (await (await listingsRoute.GET(request("listings"))).json()).listings;
  assert.equal(active.some((item) => item.id === "closed"), false);
});

test("매물 등록순·변경순·오래 미갱신순은 서로 구분되고 필터와 함께 동작한다", async (t) => {
  const { date, listing } = database(t);
  listing("new-registration", { registered: date(-1), updated: date(-60) });
  listing("new-update", { registered: date(-10), updated: date() });
  listing("oldest", { registered: date(-200), updated: date(-100) });
  listing("fallback", { registered: date(-150), updated: "" });
  listing("closed", { closed: date(), registered: date(), updated: date() });
  const load = async (sort, state = "all") => ids((await (await listingsRoute.GET(request("listings", { sort, state }))).json()).listings);
  assert.deepEqual(await load("recent"), ["new-registration", "new-update", "fallback", "oldest", "closed"]);
  assert.deepEqual(await load("updated"), ["new-update", "new-registration", "oldest", "fallback", "closed"]);
  assert.deepEqual(await load("oldest"), ["fallback", "oldest", "new-registration", "new-update", "closed"]);
  assert.deepEqual(await load("oldest", "stale"), ["fallback", "oldest"]);
  assert.deepEqual(await load("recent", "closed"), ["closed"]);
  assert.equal((await load("updated", "active")).length, 4);
});

test("홈은 오늘 최근 수정순·미래를 뺀 최근 업무·가까운 예정순을 각각 표시한다", async (t) => {
  const { date, customer, work } = database(t);
  customer("customer", "고객");
  work("today-old", "customer", date(), `${date()} 01:00:00`);
  work("today-a", "customer", date(), `${date()} 02:00:00`);
  work("today-z", "customer", date(), `${date()} 02:00:00`);
  work("past", "customer", date(-1), `${date()} 10:00:00`);
  work("later", "customer", date(5), date(), date(-2), "방문예정");
  work("next-z", "customer", date(1), date(), date(-3), "방문예약");
  work("next-a", "customer", date(1), date(), date(-3), "방문예약");
  work("next-new", "customer", date(1), date(), date(-1), "방문예정");
  work("not-schedule", "customer", date(1));
  const result = await (await bootstrapRoute.GET()).json();
  assert.deepEqual(ids(result.today), ["today-z", "today-a", "today-old"]);
  assert.deepEqual(ids(result.recent), ["today-z", "today-a", "today-old", "past"]);
  assert.deepEqual(ids(result.upcoming), ["next-a", "next-z", "next-new", "later"]);
  assert.equal(result.metrics.today_count, 3);
  assert.equal(result.metrics.upcoming_count, 4);
});

test("업무 현황의 예정 일정과 미갱신 매물은 홈·매물 관리와 같은 순서를 유지한다", async (t) => {
  const { date, customer, work, listing } = database(t);
  customer("customer", "고객");
  work("next-new", "customer", date(1), date(-4), date(-1), "방문예정");
  work("next-old-z", "customer", date(1), date(-1), date(-3), "방문예약");
  work("next-old-a", "customer", date(1), date(), date(-3), "방문예약");
  work("later", "customer", date(5), date(-5), date(-5), "방문예정");
  listing("later-in-day", { dong: "1", updated: `${date(-100)} 13:00:00` });
  listing("unit-10", { unit: "10", updated: `${date(-100)} 12:00:00` });
  listing("unit-2-z", { updated: `${date(-100)} 12:00:00` });
  listing("unit-2-a", { updated: `${date(-100)} 12:00:00` });
  listing("oldest", { updated: date(-200) });
  listing("fresh", { updated: date() });
  listing("closed", { closed: date(), updated: date(-300) });

  const insights = await (await insightsRoute.GET()).json();
  const home = await (await bootstrapRoute.GET()).json();
  const stale = (await (await listingsRoute.GET(request("listings", { state: "stale", sort: "oldest" }))).json()).listings;
  assert.deepEqual(ids(insights.upcoming), ["next-old-a", "next-old-z", "next-new", "later"]);
  assert.deepEqual(ids(insights.upcoming), ids(home.upcoming));
  assert.deepEqual(ids(insights.staleListings), ["oldest", "unit-2-a", "unit-2-z", "unit-10", "later-in-day"]);
  assert.deepEqual(ids(insights.staleListings), ids(stale));
});

test("통합 고객 검색은 정확한 이름·ID, 접두 일치, 포함 순이며 미래 예약에 밀리지 않는다", async (t) => {
  const { date, customer, work } = database(t);
  customer("exact", "민수"); customer("민수", "김고객"); customer("prefix", "민수네");
  customer("contains", "김민수"); customer("note", "최근고객");
  work("exact-old", "exact", date(-20)); work("exact-future", "exact", date(30));
  work("id-old", "민수", date(-10)); work("prefix-old", "prefix", date(-40));
  work("contains-today", "contains", date());
  const result = await (await searchRoute.GET(request("search", { q: "민수" }))).json();
  assert.deepEqual(ids(result.customers), ["민수", "exact", "prefix", "contains"]);
  assert.equal(result.customers.find((item) => item.id === "exact").last_work_date, date(-20));
});

test("통합 매물 검색은 정확한 주소와 호수 우선·같은 일치 수준에서는 진행중 우선이다", async (t) => {
  const { date, listing } = database(t);
  listing("contains", { building: "테스트", unit: "A2", updated: date() });
  listing("prefix", { building: "테스트", unit: "20", updated: date(-1) });
  listing("exact", { building: "테스트", unit: "2", updated: date(-10) });
  listing("closed", { building: "테스트", unit: "2", closed: date(), updated: date() });
  const load = async (q) => (await (await searchRoute.GET(request("search", { q }))).json()).listings;
  assert.deepEqual(ids(await load("2")), ["exact", "closed", "prefix", "contains"]);
  assert.deepEqual(ids(await load("테스트 2")), ["exact", "closed", "prefix", "contains"]);
  assert.deepEqual(ids(await load("테스트 2동 2호")), ["exact", "closed"]);
});

test("통합검색의 퍼센트·밑줄·따옴표는 검색 문자로 처리하고 각 결과는 8개로 제한한다", async (t) => {
  const { customer, listing } = database(t);
  customer("literal", "100%_확인"); customer("wildcard", "100AB확인");
  listing("literal", { building: "100%_확인" }); listing("wildcard", { building: "100AB확인" });
  let result = await (await searchRoute.GET(request("search", { q: "%_" }))).json();
  assert.deepEqual(ids(result.customers), ["literal"]);
  assert.deepEqual(ids(result.listings), ["literal"]);
  result = await (await searchRoute.GET(request("search", { q: "' OR 1=1 --" }))).json();
  assert.deepEqual(result, { workLogs: [], customers: [], listings: [] });
  for (let index = 0; index < 12; index++) {
    customer(`limit-${index}`, `조회고객${index}`); listing(`limit-${index}`, { building: `조회단지${index}` });
  }
  result = await (await searchRoute.GET(request("search", { q: "조회" }))).json();
  assert.equal(result.customers.length, 8);
  assert.equal(result.listings.length, 8);
  assert.deepEqual(await (await searchRoute.GET(request("search"))).json(), { workLogs: [], customers: [], listings: [] });
});

test("같은 기한의 할 일은 먼저 등록한 순서, 완료한 일은 최근 완료순과 ID로 안정적이다", async (t) => {
  const { sqlite, db, date } = database(t);
  const add = (id, due, created, completed = null) => sqlite.prepare(
    "INSERT INTO follow_ups (id,title,due_date,created_at,completed_at) VALUES (?,?,?,?,?)",
  ).run(id, id, due, created, completed);
  add("new", date(), date(-1)); add("old-z", date(), date(-3)); add("old-a", date(), date(-3));
  add("overdue", date(-1), date()); add("undated", null, date(-100));
  add("complete-old", date(-100), date(-100), date(-2));
  add("complete-z", date(100), date(-1), date(-1)); add("complete-a", date(90), date(-2), date(-1));
  const result = await getFollowUps(db, new URLSearchParams("status=all"));
  assert.deepEqual(ids(result.items), ["overdue", "old-a", "old-z", "new", "undated", "complete-a", "complete-z", "complete-old"]);
  assert.deepEqual(ids((await getFollowUps(db, new URLSearchParams("status=completed"))).items), ["complete-a", "complete-z", "complete-old"]);
});
