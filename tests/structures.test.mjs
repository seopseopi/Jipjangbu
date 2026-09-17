import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  DEMO_PLAN,
  validatePlan,
  transformPoint,
  wallSolids,
} from "../app/structures/plan.ts";
import { STRUCTURE_SCHEMA, STRUCTURE_TABLES } from "../db/structure-schema.js";

test("가상 구조는 명시적으로 분리되고 정상적인 구조 계약을 따른다", () => {
  assert.equal(validatePlan(DEMO_PLAN).isDemo, true);
  assert.equal(DEMO_PLAN.scaleStatus, "proportional");
  assert.equal(DEMO_PLAN.rooms.length, 5);
});
test("반전과 회전은 같은 pivot에 대해 일관되게 변환된다", () => {
  for (const mirror of [false, true])
    for (const rotation of [0, 90, 180, 270]) {
      const transformed = transformPoint([2, 3], [1, 1], { mirror, rotation });
      assert.ok(
        Math.abs(
          Math.hypot(transformed[0] - 1, transformed[1] - 1) - Math.sqrt(5),
        ) < 1e-8,
      );
    }
  assert.deepEqual(
    transformPoint([2, 3], [1, 1], { mirror: true, rotation: 0 }),
    [0, 3],
  );
});
test("문과 창문 영역에는 실제 벽 geometry가 없고 인방·창 아래 벽은 남는다", () => {
  const wall = {
    id: "wall",
    start: [0, 0],
    end: [8, 0],
    thickness: 0.1,
    height: 3,
  };
  const solids = wallSolids(wall, [
    { wallId: "wall", offset: 1, width: 1, height: 2 },
    { wallId: "wall", offset: 4, width: 2, height: 1, sillHeight: 1 },
  ]);
  const solidAt = (x, z) =>
    solids.some((s) => x > s.from && x < s.to && z > s.bottom && z < s.top);
  assert.equal(solidAt(1.5, 1), false);
  assert.equal(solidAt(1.5, 2.5), true);
  assert.equal(solidAt(5, 1.5), false);
  assert.equal(solidAt(5, 0.5), true);
  assert.equal(solidAt(5, 2.5), true);
});
test("손상된 JSON, 중복 ID, 벽 밖/겹친 개구부는 거절한다", () => {
  for (const mutate of [
    (p) => (p.schemaVersion = 2),
    (p) => (p.rooms[0].label = [NaN, 0]),
    (p) => (p.walls[0].end = p.walls[0].start),
    (p) => (p.doors[0].offset = 900),
    (p) => p.doors.push({ ...p.doors[0], id: "duplicate-opening" }),
    (p) => (p.rooms[0].id = p.walls[0].id),
    (p) => (p.doors[0].wallId = "missing"),
  ]) {
    const p = structuredClone(DEMO_PLAN);
    mutate(p);
    assert.throws(() => validatePlan(p));
  }
});
test("신규 구조 스키마는 반복 초기화 가능하고 매물과 별도로 보존된다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    for (let i = 0; i < 2; i++)
      for (const sql of STRUCTURE_SCHEMA) db.exec(sql);
    for (const table of STRUCTURE_TABLES)
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    db.exec(
      "INSERT INTO structure_complexes VALUES('c','합성 단지','합성 주소','검증근거','2026-01-01'); INSERT INTO structure_buildings VALUES('b','c','가동'); INSERT INTO structure_units VALUES('u','b','예시호',NULL,'확인근거'); INSERT INTO structure_listing_links(identity_key,unit_id,evidence) VALUES('synthetic-key','u','확인');",
    );
    assert.throws(() =>
      db.exec(
        "INSERT INTO structure_listing_links(identity_key,unit_id,evidence) VALUES('synthetic-key','u','중복');",
      ),
    );
    assert.throws(() => db.exec("DELETE FROM structure_units WHERE id='u'"));
    assert.equal(
      db.prepare("SELECT floor FROM structure_units").get().floor,
      null,
    );
  } finally {
    db.close();
  }
});
test("생성된 마이그레이션과 런타임 초기화의 구조 열은 일치한다", () => {
  const migrated = new DatabaseSync(":memory:"),
    runtime = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../drizzle/", import.meta.url);
    for (const name of readdirSync(dir)
      .filter((n) => /^\d+_.*\.sql$/.test(n))
      .sort())
      migrated.exec(readFileSync(new URL(name, dir), "utf8"));
    for (const sql of STRUCTURE_SCHEMA) runtime.exec(sql);
    for (const table of STRUCTURE_TABLES)
      assert.deepEqual(
        migrated.prepare(`PRAGMA table_info(${table})`).all(),
        runtime.prepare(`PRAGMA table_info(${table})`).all(),
      );
  } finally {
    migrated.close();
    runtime.close();
  }
});
