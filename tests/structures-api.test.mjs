import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { DEMO_PLAN } from "../app/structures/plan.ts";
import { HILLSTATE_109_REFERENCE } from "../app/structures/hillstate-reference.ts";
const root = new URL("../", import.meta.url),
  symbol = Symbol.for("structure-test-db");
const hook = registerHooks({
  resolve(s, c, next) {
    if (c.parentURL?.startsWith(root.href) && s.startsWith(".")) {
      const u = new URL(s, c.parentURL);
      if (u.href === new URL("db", root).href)
        return {
          url: 'data:text/javascript,export function getD1(){return globalThis[Symbol.for("structure-test-db")]}',
          shortCircuit: true,
        };
      if (u.href === new URL("db/bootstrap", root).href)
        return {
          url: "data:text/javascript,export async function ensureDatabase(){}",
          shortCircuit: true,
        };
      if (existsSync(`${u.pathname}.ts`))
        return { url: `${u.href}.ts`, shortCircuit: true };
    }
    return next(s, c);
  },
  load(u, c, next) {
    if (u.startsWith(root.href) && u.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(u), "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      };
    return next(u, c);
  },
});
const api = await import("../app/api/structures/route.ts");
hook.deregister();
function database(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const dir = new URL("drizzle/", root);
  for (const f of readdirSync(dir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    db.exec(readFileSync(new URL(f, dir), "utf8"));
  globalThis[symbol] = {
    prepare(sql) {
      const q = db.prepare(sql);
      let values = [];
      const execute = () =>
        q.columns().length
          ? { success: true, results: q.all(...values) }
          : { success: true, results: [], meta: q.run(...values) };
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return execute().results[0] ?? null;
        },
        async all() {
          return execute();
        },
        execute,
      };
    },
    async batch(statements) {
      db.exec("SAVEPOINT test");
      try {
        const results = statements.map((s) => s.execute());
        db.exec("RELEASE test");
        return results;
      } catch (e) {
        db.exec("ROLLBACK TO test; RELEASE test");
        throw e;
      }
    },
  };
  t.after(() => {
    db.close();
    delete globalThis[symbol];
  });
  return db;
}
const post = (body) =>
  api.POST(
    new Request("https://test.invalid/api/structures", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
const revisionInput = () => ({
  action: "revision",
  complexName: "합성 테스트 단지",
  address: "합성 주소",
  typeName: "테스트A",
  source: "합성 테스트 근거",
  permissionEvidence: "자동 테스트",
  confirmed: true,
  variant: "base",
  plan: { ...structuredClone(DEMO_PLAN), isDemo: false },
});
test("도면 등록은 근거·동의가 필요하고 데모를 실단지에 연결하지 않는다", async (t) => {
  const db = database(t);
  for (const value of [
    { ...revisionInput(), plan: DEMO_PLAN },
    { ...revisionInput(), plan: HILLSTATE_109_REFERENCE },
    { ...revisionInput(), confirmed: false },
    { ...revisionInput(), permissionEvidence: "" },
  ])
    assert.equal((await post(value)).status, 422);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM structure_complexes").get().n,
    0,
  );
});
test("새 버전을 등록해도 기존 세대는 이전 버전에 고정되며 stale 수정은 거절된다", async (t) => {
  const db = database(t),
    first = await post(revisionInput());
  assert.equal(first.status, 201);
  const a = await first.json();
  const assign = {
    action: "assign",
    revisionId: a.id,
    dong: "테스트동",
    number: "테스트호",
    floor: "",
    mirror: null,
    rotation: null,
    actualCondition: "unknown",
    evidence: "합성 확인",
    confirmed: true,
    expectedVersion: 0,
  };
  const response = await post(assign);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const second = await post({ ...revisionInput(), complexId: a.complexId });
  assert.equal(second.status, 201);
  const b = await second.json();
  assert.equal(
    db
      .prepare("SELECT revision_id FROM structure_assignments WHERE unit_id=?")
      .get(id).revision_id,
    a.id,
  );
  assert.equal((await post({ ...assign, revisionId: b.id })).status, 409);
  assert.equal(
    (await post({ ...assign, revisionId: b.id, expectedVersion: 1 })).status,
    201,
  );
  assert.equal(
    db
      .prepare("SELECT revision_id FROM structure_assignments WHERE unit_id=?")
      .get(id).revision_id,
    b.id,
  );
  assert.equal(
    db.prepare("SELECT floor FROM structure_units WHERE id=?").get(id).floor,
    null,
  );
  const detail = await api.GET(
    new Request(`https://test.invalid/api/structures?revision=${a.id}`),
  );
  assert.equal((await detail.json()).plan.rooms.length, 5);
});
test("방문 기록만 있는 물건도 탐색 가능하며 매물 projection 삭제로 구조 연결이 사라지지 않는다", async (t) => {
  const db = database(t);
  db.exec(
    "INSERT INTO customers(id,name) VALUES('c','합성고객'); INSERT INTO work_logs(id,work_date,customer_id,work_type) VALUES('w','2026-09-17','c','집방문'); INSERT INTO work_log_properties(id,work_log_id,sequence,property_type,building_name,building_dong,unit_number) VALUES('p','w',1,'아파트','합성단지','101','101');",
  );
  const catalog = await (
    await api.GET(new Request("https://test.invalid/api/structures"))
  ).json();
  assert.equal(catalog.properties.length, 1);
  assert.equal(catalog.properties[0].listing_count, 0);
  const a = await (await post(revisionInput())).json();
  const assign = {
    action: "assign",
    revisionId: a.id,
    dong: "101",
    number: "101",
    floor: null,
    mirror: null,
    rotation: null,
    actualCondition: "unknown",
    evidence: "확인",
    confirmed: true,
    expectedVersion: 0,
    identityKey: "아파트|합성단지|101|101",
  };
  assert.equal((await post(assign)).status, 201);
  assert.equal((await post({ ...assign, number: "102" })).status, 409);
  db.exec("DELETE FROM listings");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM structure_listing_links").get().n,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM structure_units").get().n,
    1,
  );
});
