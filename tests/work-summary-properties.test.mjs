import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { WORK_SUMMARY_SQL, searchedWorkSummary } from "../app/api/_queries.ts";

function database(t) {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  t.after(() => db.close());
  db.exec("INSERT INTO customers (id,name) VALUES ('customer','합성 고객'); INSERT INTO work_logs (id,customer_id,work_date,work_type) VALUES ('work','customer','2026-09-13','가계약'), ('empty','customer','2026-09-13','전화')");
  const property = (id, sequence, unit, source = "합성 업소") => db.prepare("INSERT INTO work_log_properties (id,work_log_id,sequence,property_type,building_name,building_dong,unit_number,size_type,sale_price,source) VALUES (?,'work',?,'아파트','합성단지','106',?,'33','35000',?)").run(id, sequence, unit, source);
  return { db, property };
}

test("실제 SQL은 입력 순서와 무관하게 전체 물건과 source를 업무순번·rowid 순서로 한 응답에 전달한다", (t) => {
  const { db, property } = database(t);
  property("third", 3, "303");
  property("second", 2, "1503", '합성 "협력" 업소\n메모');
  property("first", 1, "101", "");
  property("second-tie", 2, "202", "마전현대");
  const row = db.prepare(`${WORK_SUMMARY_SQL} WHERE w.id = 'work'`).get();
  assert.equal(row.property_count, 4);
  assert.equal(row.unit_number, "101");
  assert.equal(row.source, "");
  const properties = JSON.parse(row.properties_json);
  assert.deepEqual(properties.map((item) => item.id), ["first", "second", "second-tie", "third"]);
  assert.equal(properties[1].source, '합성 "협력" 업소\n메모');
  assert.equal(properties[1].size_type, "33");
  assert.equal(properties[1].sale_price, "35000");
});

test("두번째 물건 검색 시 대표 검색 일치는 유지하고 전체 물건 목록은 재정렬하거나 누락하지 않는다", (t) => {
  const { db, property } = database(t);
  property("first", 1, "101");
  property("second", 2, "1503");
  const summary = searchedWorkSummary({ sql: "sp.unit_number = ?", bindings: ["1503"] });
  const row = db.prepare(`${summary.sql} WHERE w.id = 'work'`).get(...summary.bindings);
  assert.equal(row.unit_number, "1503");
  assert.equal(row.search_property_match, 1);
  assert.equal(row.property_count, 2);
  assert.deepEqual(JSON.parse(row.properties_json).map((item) => item.id), ["first", "second"]);
});

test("물건이 없는 업무도 유지하며 JSON은 null이나 가짜 물건이 아닌 빈 배열이다", (t) => {
  const { db } = database(t);
  const row = db.prepare(`${WORK_SUMMARY_SQL} WHERE w.id = 'empty'`).get();
  assert.equal(row.property_count, 0);
  assert.equal(row.unit_number, null);
  assert.deepEqual(JSON.parse(row.properties_json), []);
});

test("전체 물건 집계는 기존 업무별 물건 인덱스를 이용하고 별도 정렬을 만들지 않는다", (t) => {
  const { db, property } = database(t);
  property("first", 1, "101");
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${WORK_SUMMARY_SQL} WHERE w.id = 'work'`).all().map((row) => row.detail).join("\n");
  assert.match(plan, /SEARCH all_properties USING INDEX idx_work_log_properties_log/);
  assert.doesNotMatch(plan, /TEMP B-TREE FOR ORDER BY/);
});
