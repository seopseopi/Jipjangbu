import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  DEMO_PLAN,
  validatePlan,
  transformPoint,
  wallSolids,
  wallPoint,
  roomColor,
} from "../app/structures/plan.ts";
import { STRUCTURE_SCHEMA, STRUCTURE_TABLES } from "../db/structure-schema.js";
import { REFERENCE_FIXTURES, referenceFinish } from "../app/structures/reference-finishes.ts";
import {
  HILLSTATE_109_REFERENCE,
  HILLSTATE_SOURCE,
  hasReferenceFinishes,
} from "../app/structures/hillstate-reference.ts";

test("입구 안내선은 실제 지정된 출입문 중앙을 지나며 미확인 입구를 허용하지 않는다", () => {
  const p = HILLSTATE_109_REFERENCE,
    d = p.doors.find((d) => d.id === p.entry.doorId),
    w = p.walls.find((w) => w.id === d.wallId);
  const center = wallPoint(w, d.offset + d.width / 2);
  assert.ok(
    Math.hypot(
      center[0] - p.entry.route[1][0],
      center[1] - p.entry.route[1][1],
    ) < 1e-8,
  );
  assert.throws(() =>
    validatePlan({ ...p, entry: { ...p.entry, doorId: "missing" } }),
  );
});
test("원본 설비는 참고 도면에만 적용하고 두 욕실 및 주방 설비를 포함한다", () => {
  assert.equal(hasReferenceFinishes(HILLSTATE_109_REFERENCE), true);
  assert.equal(hasReferenceFinishes(DEMO_PLAN), false);
  assert.equal(hasReferenceFinishes({...HILLSTATE_109_REFERENCE}), false);
  assert.equal(new Set(REFERENCE_FIXTURES.map(f => f.id)).size, REFERENCE_FIXTURES.length);
  for (const roomId of ["bath-master", "bath-common"]) {
    assert.deepEqual(REFERENCE_FIXTURES.filter(f=>f.roomId===roomId).map(f=>f.kind).sort(), ["basin","toilet","tub"]);
  }
  for (const f of REFERENCE_FIXTURES) {
    const room = HILLSTATE_109_REFERENCE.rooms.find(r=>r.id===f.roomId);
    assert.ok(room);
    assert.ok(f.width > 0 && f.depth > 0);
    assert.doesNotThrow(()=>validatePlan({...HILLSTATE_109_REFERENCE, rooms: HILLSTATE_109_REFERENCE.rooms.map(r=>r.id===f.roomId ? {...r,label:f.center} : r)}));
  }
  assert.equal(referenceFinish("bath-master"), "bath");
  assert.equal(referenceFinish("balcony-front"), "balcony");
  assert.equal(referenceFinish("kitchen"), "wood");
});
test("2D와 3D는 같은 설비 목록을 사용하고 벽 높이 조작은 노출하지 않는다", () => {
  const svg = readFileSync(new URL("../app/structures/plan-fixtures-svg.tsx", import.meta.url), "utf8");
  const three = readFileSync(new URL("../app/structures/plan-fixtures.tsx", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../app/structures/plan-viewer.tsx", import.meta.url), "utf8");
  for (const kind of new Set(REFERENCE_FIXTURES.map(f=>f.kind))) {
    assert.ok(svg.includes(`f.kind === "${kind}"`));
    assert.ok(three.includes(`f.kind === "${kind}"`));
  }
  assert.match(svg, /REFERENCE_FIXTURES\.map/);
  assert.match(three, /REFERENCE_FIXTURES\.map/);
  assert.doesNotMatch(viewer, /setLowWalls|벽 낮게|벽 높이 그대로/);
  assert.doesNotMatch(viewer, /structure-entry-guide|현관 찾기|주황색 표시에서 시작/);
  assert.doesNotMatch(viewer, /structure-room-list|structure-selection-status/);
  assert.match(viewer, /lowWalls=\{false\}/);
  assert.match(viewer, /\[show2dLabels, setShow2dLabels\] = useState\(true\)/);
  assert.match(viewer, /mode === "2d" \? show2dLabels : show3dLabels/);
  assert.match(viewer, /setShow2dLabels\(true\)/);
});
test("방의 표시 순서와 무관하게 용도별 색이 일정하고 현관은 구분된다", () => {
  const rooms = HILLSTATE_109_REFERENCE.rooms;
  assert.equal(
    roomColor(rooms.find((r) => r.id === "bed-master")),
    roomColor(rooms.find((r) => r.id === "bed-small")),
  );
  assert.notEqual(
    roomColor(rooms.find((r) => r.id === "entrance")),
    roomColor(rooms.find((r) => r.id === "living")),
  );
});

test("실제 KB 109 기본형은 가상 도면과 구분된 검증 전 타입 참고 자료다", () => {
  const p = validatePlan(HILLSTATE_109_REFERENCE);
  assert.equal(p.isDemo, false);
  assert.equal(p.referenceOnly, true);
  assert.equal(p.rooms.filter((r) => r.id.startsWith("bed-")).length, 3);
  assert.equal(p.rooms.filter((r) => r.id.startsWith("bath-")).length, 2);
  assert.equal(p.rooms.filter((r) => r.id.startsWith("balcony-")).length, 2);
  assert.ok(p.outline.length > 4);
  assert.equal(p.scaleStatus, "proportional");
  assert.equal(new URL(HILLSTATE_SOURCE.page).hostname, "kbland.kr");
});

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
