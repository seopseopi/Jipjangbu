import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { indexCustomers, matchCustomers } from "../app/customer-matches.ts";

// Exercise real route handlers and bound SQL. Only the Cloudflare binding,
// bootstrap, and unused work-write boundary are replaced; all data is synthetic.
const dbKey = "jipjangbu-property-search-test-db";
const apiRoot = new URL("../app/api/", import.meta.url).href;
const appRoot = new URL("../app/", import.meta.url).href;
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(apiRoot)) {
      if (specifier === "../../../db") return {
        url: moduleUrl(`export function getD1() { return globalThis[Symbol.for(${JSON.stringify(dbKey)})]; }`),
        shortCircuit: true,
      };
      if (specifier === "../../db/bootstrap") return {
        url: moduleUrl("export async function ensureDatabase() {}"),
        shortCircuit: true,
      };
      if (specifier === "./data") return {
        url: moduleUrl("export class InputError extends Error {} export function saveWorkLog() { throw new Error('Search tests never write'); }"),
        shortCircuit: true,
      };
    }
    if (context.parentURL?.startsWith(appRoot) && specifier.startsWith(".")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const [workRoute, searchRoute, listingsRoute, customersRoute, followUpsRoute] = await Promise.all([
  import("../app/api/work-logs/route.ts"),
  import("../app/api/search/route.ts"),
  import("../app/api/listings/route.ts"),
  import("../app/api/customers/route.ts"),
  import("../app/api/follow-ups/route.ts"),
]);
hook.deregister();

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  const calls = { writes: 0, reads: 0 };
  let changesBeforeReads;
  const changes = () => sqlite.prepare("SELECT total_changes() AS count").get().count;
  const db = {
    prepare(sql) {
      changesBeforeReads ??= changes();
      if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
        calls.writes++;
        throw new Error("Search attempted to change its database");
      }
      const query = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...bindings) { values = bindings; return this; },
        async first() { calls.reads++; return query.get(...values) ?? null; },
        async all() { calls.reads++; return { results: query.all(...values) }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
  };
  globalThis[Symbol.for(dbKey)] = db;
  t.after(() => {
    try {
      assert.equal(calls.writes, 0, "GET 검색 중 쓰기 SQL이 없어야 한다");
      if (changesBeforeReads !== undefined) assert.equal(changes(), changesBeforeReads, "검색 전후 데이터는 같아야 한다");
    } finally {
      sqlite.close();
      delete globalThis[Symbol.for(dbKey)];
    }
  });
  const customer = (id = "customer", name = "연결고객", notes = "") =>
    sqlite.prepare("INSERT INTO customers (id,name,notes) VALUES (?,?,?)").run(id, name, notes);
  const work = (id, {
    customerId = "customer", date = "2026-09-12", type = "상담",
    content = "", updated = "2026-09-12 10:00:00",
  } = {}) => sqlite.prepare("INSERT INTO work_logs (id,customer_id,work_date,work_type,content,updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, customerId, date, type, content, updated);
  const property = (id, workId, {
    sequence = 1, building = "검증단지", dong = "106", unit = "1503",
    type = "아파트", size = "33", sale = "50000", jeonse = "30000", monthly = "100", source = "",
  } = {}) => sqlite.prepare(`INSERT INTO work_log_properties
    (id,work_log_id,sequence,property_type,building_name,building_dong,unit_number,size_type,sale_price,jeonse_price,monthly_rent,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, workId, sequence, type, building, dong, unit, size, sale, jeonse, monthly, source);
  const listing = (id, { building = "검증단지", dong = "106", unit = "1503", notes = "" } = {}) =>
    sqlite.prepare(`INSERT INTO listings (id,identity_key,status,property_type,building_name,building_dong,unit_number,notes)
      VALUES (?,?,'매물등록','아파트',?,?,?,?)`).run(id, id, building, dong, unit, notes);
  const followUp = (id, { listingKey = null, customerId = "customer", title = "물건 확인", notes = "" } = {}) =>
    sqlite.prepare("INSERT INTO follow_ups (id,title,notes,listing_key,customer_id) VALUES (?,?,?,?,?)")
      .run(id, title, notes, listingKey, customerId);
  const address = (id, values = {}) => {
    work(id, values);
    property(`property-${id}`, id, values);
    listing(id, values);
    followUp(id, { listingKey: id, customerId: values.customerId ?? "customer" });
  };
  return { customer, work, property, listing, followUp, address, calls };
}

const ids = (items) => items.map((item) => item.id).sort();
const request = (path, params = {}) => new Request(`https://test.invalid/api/${path}?${new URLSearchParams(params)}`);
async function response(route, path, params) {
  const result = await route.GET(request(path, params));
  const body = await result.json();
  assert.equal(result.status, 200, `${path}: ${JSON.stringify(body)}`);
  return body;
}
const journal = (params = {}) => response(workRoute, "work-logs", params);

test("고객 이력의 업무구분은 고객ID·물건지 연결 모두에 적용하고 중복 없이 전체 건수와 다음 페이지를 반환한다", async (t) => {
  const data = database(t);
  data.customer("customer", "합성 고객");
  data.customer("other", "다른 합성 고객");
  for (let index = 0; index < 13; index++) {
    data.work(`call-${index}`, { customerId: index % 2 ? "other" : "customer", type: "전화" });
    data.property(`p-${index}`, `call-${index}`, { source: "customer" });
    data.property(`duplicate-${index}`, `call-${index}`, { sequence: 2, source: "customer" });
  }
  data.work("visit", { type: "집방문" });
  data.work("source-visit", { customerId: "other", type: "집방문" });
  data.property("source-visit-p", "source-visit", { source: "customer" });
  data.work("unrelated", { customerId: "other", type: "전화" });
  const params = { customerId: "customer", includeSource: "1", workType: "전화", limit: "10" };
  const first = await journal(params), second = await journal({ ...params, offset: "10" });
  assert.equal(first.total, 13);
  assert.equal(second.total, 13);
  assert.equal(first.workLogs.length, 10);
  assert.equal(second.workLogs.length, 3);
  assert.equal(new Set([...first.workLogs, ...second.workLogs].map((work) => work.id)).size, 13);
  assert([...first.workLogs, ...second.workLogs].every((work) => work.work_type === "전화"));
  assert.equal((await journal({ ...params, workType: "집방문" })).total, 2);
  assert.equal((await journal({ ...params, workType: "전화예약" })).total, 0);
  assert.equal((await journal({ ...params, workType: "" })).total, 15);
});
async function allSurfaces(q) {
  const [work, global, listings, tasks] = await Promise.all([
    journal({ q }), response(searchRoute, "search", { q }),
    response(listingsRoute, "listings", { q, state: "all" }),
    response(followUpsRoute, "follow-ups", { q, status: "all" }),
  ]);
  return {
    journal: work.workLogs, globalWork: global.workLogs, listings: listings.listings,
    globalListings: global.listings, tasks: tasks.items, total: work.total,
  };
}
function assertSurfaces(result, expected, q) {
  for (const surface of ["journal", "globalWork", "listings", "globalListings", "tasks"]) {
    assert.deepEqual(ids(result[surface]), [...expected].sort(), `${surface}: ${JSON.stringify(q)}`);
  }
  assert.equal(result.total, expected.length, `전체 업무 건수: ${JSON.stringify(q)}`);
}

const addressForms = [
  "106동 1503호", "106동1503호", "106 1503", "106-1503",
  "검증단지 106동 1503호", "검증단지106동1503호", "검증단지 106-1503",
  "106동", "1503호",
];

test("동·호와 건물 조합 주소 9가지 표기를 업무일지·통합검색·매물·할 일이 똑같이 찾는다", async (t) => {
  const { customer, address } = database(t);
  customer(); address("target");
  for (const q of addressForms) assertSurfaces(await allSurfaces(q), ["target"], q);
});

test("주소 검색은 연속 공백·탭·줄바꿈·앞뒤 공백에도 같은 물건을 찾는다", async (t) => {
  const { customer, address } = database(t);
  customer(); address("target");
  for (const q of [" 106동   1503호 ", "106동\t1503호", "검증단지\n106동 1503호"]) {
    assertSurfaces(await allSurfaces(q), ["target"], q);
  }
});

test("명시한 동·호는 숫자 일부가 같은 1106동·15030호와 혼동하지 않는다", async (t) => {
  const { customer, address } = database(t);
  customer(); address("exact");
  address("extra-dong", { dong: "1106" }); address("extra-unit", { unit: "15030" });
  address("extra-both", { dong: "1106", unit: "15030" });
  for (const q of addressForms.slice(0, 7)) assertSurfaces(await allSurfaces(q), ["exact"], q);
  assertSurfaces(await allSurfaces("106동"), ["exact", "extra-unit"], "106동");
  assertSurfaces(await allSurfaces("1503호"), ["exact", "extra-dong"], "1503호");
});

test("동·호 조건은 같은 물건 행에서 일치해야 하며 여러 물건을 합쳐서 찾지 않는다", async (t) => {
  const { customer, work, property } = database(t);
  customer(); work("crossed"); work("same-property");
  property("cross-dong", "crossed", { dong: "106", unit: "999" });
  property("cross-unit", "crossed", { sequence: 2, dong: "1106", unit: "1503" });
  property("real-first", "same-property", { building: "다른단지", dong: "1", unit: "2" });
  property("real-second", "same-property", { sequence: 2 });
  for (const q of addressForms.slice(0, 7)) {
    const work = await journal({ q });
    const global = await response(searchRoute, "search", { q });
    assert.deepEqual(ids(work.workLogs), ["same-property"], q);
    assert.equal(work.total, 1, q);
    assert.deepEqual(ids(global.workLogs), ["same-property"], q);
  }
});

test("두 번째 물건이 검색에 맞으면 그 물건의 주소·가격을 표시하고 전체 물건 수는 유지한다", async (t) => {
  const { customer, work, property } = database(t);
  customer(); work("many");
  property("first", "many", { building: "다른단지", dong: "1", unit: "2", type: "상가", sale: "999" });
  property("second", "many", { sequence: 2, size: "42", sale: "55000", jeonse: "32000", monthly: "120" });
  const result = await allSurfaces("106동 1503호");
  for (const surface of ["journal", "globalWork"]) {
    assert.equal(result[surface].length, 1, surface);
    const row = result[surface][0];
    assert.equal(row.property_count, 2, surface);
    assert.equal(row.search_property_match, 1, surface);
    for (const [key, value] of Object.entries({
      property_type: "아파트", building_name: "검증단지", building_dong: "106", unit_number: "1503",
      size_type: "42", sale_price: "55000", jeonse_price: "32000", monthly_rent: "120",
    })) assert.equal(row[key], value, `${surface}.${key}`);
  }
});

test("검색어가 없거나 고객·내용으로 찾았을 때는 기존 첫 물건을 보존한다", async (t) => {
  const { customer, work, property } = database(t);
  customer(); work("many", { content: "특별상담 확인" });
  property("first", "many", { building: "첫단지", dong: "1", unit: "2" });
  property("second", "many", { sequence: 2 });
  for (const q of ["", "연결고객", "특별상담"]) {
    const sources = [(await journal({ q })).workLogs];
    if (q) sources.push((await response(searchRoute, "search", { q })).workLogs);
    for (const rows of sources) {
      assert.deepEqual(ids(rows), ["many"], q);
      assert.equal(rows[0].building_name, "첫단지", q);
      assert.equal(rows[0].property_count, 2, q);
      assert.equal(Number(rows[0].search_property_match ?? 0), 0, q);
    }
  }
});

test("기존 데이터에 동·호 접미사가 저장되어 있어도 동일한 주소 표기로 검색한다", async (t) => {
  const { customer, address } = database(t);
  customer(); address("suffix", { dong: "106동", unit: "1503호" });
  for (const q of addressForms) assertSurfaces(await allSurfaces(q), ["suffix"], q);
});

test("퍼센트·밑줄·역슬래시·SQL처럼 보이는 따옴표는 모든 검색에서 입력 문자로만 취급한다", async (t) => {
  const { customer, address } = database(t);
  customer(); address("unrelated");
  const literals = ["%", "_", "\\", "' OR 1=1 --"];
  literals.forEach((literal, index) => {
    const id = `literal-${index}`;
    customer(id, `문자${literal}고객`);
    address(id, { customerId: id, building: `문자${literal}단지` });
  });
  for (const [index, q] of literals.entries()) {
    const id = `literal-${index}`;
    assertSurfaces(await allSurfaces(q), [id], q);
    assert.deepEqual(ids((await response(customersRoute, "customers", { q })).customers), [id], q);
    assert.deepEqual(ids((await response(searchRoute, "search", { q })).customers), [id], q);
  }
});

test("연락처는 하이픈·공백 유무와 무관하게 고객관리·선택기·업무·통합검색·할 일에서 찾는다", async (t) => {
  const { customer, work, followUp } = database(t);
  const id = "010-0000-9999";
  customer(id, "연락처 검증고객"); customer("other", "다른 고객");
  work("target", { customerId: id }); work("unrelated", { customerId: "other" });
  followUp("target", { customerId: id }); followUp("unrelated", { customerId: "other" });
  const directory = indexCustomers([{ id, name: "연락처 검증고객" }, { id: "other", name: "다른 고객" }]);
  for (const q of ["01000009999", "010-0000-9999", "010 0000 9999"]) {
    const result = await allSurfaces(q);
    for (const surface of ["journal", "globalWork", "tasks"]) assert.deepEqual(ids(result[surface]), ["target"], `${surface}: ${q}`);
    assert.equal(result.total, 1, q);
    assert.deepEqual(ids((await response(customersRoute, "customers", { q })).customers), [id], q);
    assert.deepEqual(ids((await response(searchRoute, "search", { q })).customers), [id], q);
    assert.deepEqual(ids(matchCustomers(directory, q)), [id], q);
  }
});

test("주소 검색과 월·기간·고객·업무구분 필터를 함께 써도 전체 건수·페이지·동률 순서가 일치한다", async (t) => {
  const { customer, work, property } = database(t);
  customer(); customer("other", "다른 고객");
  const add = (id, values = {}, propertyValues = {}) => { work(id, values); property(`p-${id}`, id, propertyValues); };
  add("tie-a", { date: "2026-09-10", type: "전화" });
  add("tie-z", { date: "2026-09-10", type: "전화" });
  add("earlier", { date: "2026-09-09", type: "전화" });
  add("wrong-month", { date: "2026-08-10", type: "전화" });
  add("wrong-type", { date: "2026-09-10", type: "방문" });
  add("wrong-customer", { date: "2026-09-10", type: "전화", customerId: "other" });
  add("wrong-property", { date: "2026-09-10", type: "전화" }, { dong: "1106" });
  const params = { q: "106동 1503호", month: "2026-09", from: "2026-09-01", to: "2026-09-10", customerId: "customer", workType: "전화" };
  const full = await journal(params);
  assert.equal(full.total, 3);
  assert.deepEqual(full.workLogs.map((row) => row.id), ["tie-z", "tie-a", "earlier"]);
  for (let offset = 0; offset <= 3; offset++) {
    const page = await journal({ ...params, limit: "1", offset: String(offset) });
    assert.equal(page.total, full.total);
    assert.deepEqual(page.workLogs.map((row) => row.id), full.workLogs.slice(offset, offset + 1).map((row) => row.id));
  }
});

test("서로 다른 주소를 동시에 반복 검색해도 바인딩·대표 물건·결과 ID가 섞이지 않는다", async (t) => {
  const { customer, address } = database(t);
  customer(); address("first"); address("second", { dong: "205", unit: "802" });
  const cases = [["106동 1503호", "first"], ["205동 802호", "second"]];
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const [q, expected] = cases[index % cases.length];
    assertSurfaces(await allSurfaces(q), [expected], q);
  }));
});

test("동으로 끝나는 일반 건물명·지역명과 한글 가동을 잘못 분리하지 않는다", async (t) => {
  const { customer, address } = database(t);
  customer();
  address("district", { building: "역삼동", dong: "", unit: "101" });
  address("short-district", { building: "명동", dong: "", unit: "101" });
  address("letter-dong", { building: "행복마을", dong: "가", unit: "101" });
  address("false-split", { building: "역", dong: "삼", unit: "101" });
  // Unlabelled text retains partial matching of compact display addresses;
  // the important invariant is that the ordinary building name is not lost.
  const nameOnly = await allSurfaces("역삼동");
  for (const surface of ["journal", "globalWork", "listings", "globalListings", "tasks"]) {
    assert.ok(ids(nameOnly[surface]).includes("district"), surface);
  }
  const cases = [
    ["역삼동 101호", "district"], ["역삼동101호", "district"],
    ["명동 101호", "short-district"], ["행복마을 가동 101호", "letter-dong"],
  ];
  for (const [q, id] of cases) assertSurfaces(await allSurfaces(q), [id], q);
});

test("매물 메모·물건 출처에 저장된 전체 연락처를 동·호로 해석하여 검색에서 누락하지 않는다", async (t) => {
  const { customer, address } = database(t);
  customer();
  const phones = ["010-0000-9999", "010 0000 9999", "02-0000-9999"];
  phones.forEach((phone, index) => address(`phone-${index}`, {
    source: `확인 연락처 ${phone}`, notes: `확인 연락처 ${phone}`,
  }));
  for (const [index, q] of phones.entries()) assertSurfaces(await allSurfaces(q), [`phone-${index}`], q);
});

test("숫자로 끝나는 건물명과 호수 검색은 건물 끝 숫자를 동으로 바꾸거나 다른 호수와 합치지 않는다", async (t) => {
  const { customer, address } = database(t);
  customer();
  address("number-name", { building: "제일3", dong: "1", unit: "1503" });
  address("shifted-digits", { building: "제일31", dong: "1", unit: "503" });
  address("false-dong", { building: "제일", dong: "3", unit: "1503" });
  assertSurfaces(await allSurfaces("제일3 1503"), ["number-name"], "제일3 1503");
  assertSurfaces(await allSurfaces("제일 3동 1503호"), ["false-dong"], "제일 3동 1503호");
});
