export type Point = [number, number];
export type Wall = {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
};
export type Opening = {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  height: number;
  sillHeight?: number;
  hinge?: "start" | "end";
  opensTo?: "left" | "right";
};
export type Room = { id: string; name: string; polygon: Point[]; label: Point };
export type Plan = {
  schemaVersion: 1;
  isDemo: boolean;
  referenceOnly?: boolean;
  entry?: { doorId: string; roomId: string; route: Point[]; note: string };
  scaleStatus: "proportional" | "verified";
  coordinateSystem: { unit: "m"; pivot: Point };
  dimensionEvidence: { note: string };
  outline: Point[];
  rooms: Room[];
  walls: Wall[];
  doors: Opening[];
  windows: Opening[];
};
export type Transform = { mirror: boolean; rotation: number };
export const ROOM_COLORS = [
  "#dce8e5",
  "#f1e6cf",
  "#e3e5f2",
  "#d4eaf0",
  "#f3ded5",
  "#e3eddb",
];
export function roomColor(room: Room): string {
  if (/현관/.test(room.name)) return "#f5c781";
  if (/욕실/.test(room.name)) return "#a8d9dc";
  if (/발코니/.test(room.name)) return "#e0e6ec";
  if (/침실|안방|작은방/.test(room.name)) return "#b7cde9";
  if (/주방/.test(room.name)) return "#c9ddad";
  if (/드레스/.test(room.name)) return "#d8c9e3";
  return "#efdbb7";
}
function inside(point: Point, polygon: Point[]) {
  let found = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = point,
      [a, b] = polygon[i],
      [c, d] = polygon[j];
    if (
      Math.abs((x - a) * (d - b) - (y - b) * (c - a)) < 1e-8 &&
      x >= Math.min(a, c) - 1e-8 &&
      x <= Math.max(a, c) + 1e-8 &&
      y >= Math.min(b, d) - 1e-8 &&
      y <= Math.max(b, d) + 1e-8
    )
      return true;
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a)
      found = !found;
  }
  return found;
}
function simplePolygon(points: Point[]) {
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
          Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
        Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
          Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
      )
        return false;
    }
  }
  return Math.abs(area) > 1e-6;
}
export function transformPoint(
  [x, y]: Point,
  pivot: Point,
  { mirror, rotation }: Transform,
): Point {
  const dx = (x - pivot[0]) * (mirror ? -1 : 1),
    dy = y - pivot[1],
    r = (rotation * Math.PI) / 180;
  return [
    pivot[0] + dx * Math.cos(r) - dy * Math.sin(r),
    pivot[1] + dx * Math.sin(r) + dy * Math.cos(r),
  ];
}
export function wallPoint(wall: Wall, offset: number, side = 0): Point {
  const dx = wall.end[0] - wall.start[0],
    dy = wall.end[1] - wall.start[1],
    length = Math.hypot(dx, dy);
  return [
    wall.start[0] + (dx / length) * offset - (dy / length) * side,
    wall.start[1] + (dy / length) * offset + (dx / length) * side,
  ];
}
/** Real voids: split each wall into solid rectangular spans outside openings. */
export function wallSolids(wall: Wall, openings: Opening[]) {
  const length = Math.hypot(
    wall.end[0] - wall.start[0],
    wall.end[1] - wall.start[1],
  );
  const slots = openings
    .filter((o) => o.wallId === wall.id)
    .sort((a, b) => a.offset - b.offset);
  const solids: { from: number; to: number; bottom: number; top: number }[] =
    [];
  let cursor = 0;
  for (const o of slots) {
    if (o.offset > cursor)
      solids.push({ from: cursor, to: o.offset, bottom: 0, top: wall.height });
    const sill = o.sillHeight ?? 0;
    if (sill > 0)
      solids.push({
        from: o.offset,
        to: o.offset + o.width,
        bottom: 0,
        top: sill,
      });
    if (sill + o.height < wall.height)
      solids.push({
        from: o.offset,
        to: o.offset + o.width,
        bottom: sill + o.height,
        top: wall.height,
      });
    cursor = o.offset + o.width;
  }
  if (cursor < length)
    solids.push({ from: cursor, to: length, bottom: 0, top: wall.height });
  return solids;
}
export function validatePlan(value: unknown): Plan {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!value || typeof value !== "object")
    return fail("구조 JSON이 필요합니다.");
  const p = value as Plan;
  const point = (v: unknown): v is Point =>
    Array.isArray(v) &&
    v.length === 2 &&
    v.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 200,
    );
  const polygon = (v: unknown) =>
    Array.isArray(v) &&
    v.length >= 3 &&
    v.length <= 100 &&
    v.every(point) &&
    simplePolygon(v);
  if (
    p.schemaVersion !== 1 ||
    typeof p.isDemo !== "boolean" ||
    p.coordinateSystem?.unit !== "m" ||
    !point(p.coordinateSystem.pivot)
  )
    return fail("지원하지 않는 버전 또는 좌표계입니다.");
  if (
    !["proportional", "verified"].includes(p.scaleStatus) ||
    !p.dimensionEvidence?.note?.trim()
  )
    return fail("치수 확인 상태와 근거가 필요합니다.");
  if (
    !polygon(p.outline) ||
    !Array.isArray(p.rooms) ||
    !p.rooms.length ||
    p.rooms.length > 100 ||
    !Array.isArray(p.walls) ||
    !p.walls.length ||
    p.walls.length > 500 ||
    !Array.isArray(p.doors) ||
    !Array.isArray(p.windows) ||
    p.doors.length + p.windows.length > 500
  )
    return fail("영역/벽/개구부 형식 또는 개수 제한을 확인해 주세요.");
  const ids = new Set<string>();
  for (const item of [...p.rooms, ...p.walls, ...p.doors, ...p.windows]) {
    if (typeof item.id !== "string" || !item.id || ids.has(item.id))
      return fail("요소 ID는 비어 있지 않고 고유해야 합니다.");
    ids.add(item.id);
  }
  for (const room of p.rooms)
    if (
      !polygon(room.polygon) ||
      !point(room.label) ||
      !inside(room.label, room.polygon) ||
      !room.polygon.every((pnt) => inside(pnt, p.outline)) ||
      typeof room.name !== "string" ||
      !room.name.trim() ||
      room.name.length > 40
    )
      return fail("방 영역과 이름·라벨 위치를 확인해 주세요.");
  for (const wall of p.walls) {
    if (
      !point(wall.start) ||
      !point(wall.end) ||
      Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) <
        0.01 ||
      !(wall.thickness > 0 && wall.thickness <= 1) ||
      !(wall.height > 0 && wall.height <= 10)
    )
      return fail("벽 좌표/두께/높이를 확인해 주세요.");
    let end = -1;
    for (const o of [...p.doors, ...p.windows]
      .filter((o) => o.wallId === wall.id)
      .sort((a, b) => a.offset - b.offset)) {
      const length = Math.hypot(
        wall.end[0] - wall.start[0],
        wall.end[1] - wall.start[1],
      );
      if (
        ![o.offset, o.width, o.height, o.sillHeight ?? 0].every(
          Number.isFinite,
        ) ||
        o.offset < 0 ||
        o.width <= 0 ||
        o.height <= 0 ||
        (o.sillHeight ?? 0) < 0 ||
        o.offset + o.width > length + 1e-8 ||
        (o.sillHeight ?? 0) + o.height > wall.height ||
        o.offset < end
      )
        return fail("문·창문이 벽을 벗어나거나 서로 겹칩니다.");
      end = o.offset + o.width;
    }
  }
  for (const o of [...p.doors, ...p.windows])
    if (!p.walls.some((w) => w.id === o.wallId))
      return fail("문·창문의 벽 참조가 없습니다.");
  for (const o of p.doors)
    if (
      !["start", "end"].includes(o.hinge ?? "") ||
      !["left", "right"].includes(o.opensTo ?? "") ||
      (o.sillHeight ?? 0) !== 0
    )
      return fail("문의 경첩과 열림 방향을 확인해 주세요.");
  if (
    p.entry &&
    (!p.doors.some((d) => d.id === p.entry!.doorId) ||
      !p.rooms.some((r) => r.id === p.entry!.roomId) ||
      !Array.isArray(p.entry.route) ||
      p.entry.route.length < 2 ||
      p.entry.route.length > 30 ||
      !p.entry.route.every(point) ||
      typeof p.entry.note !== "string")
  )
    return fail("입구와 안내선 정보를 확인해 주세요.");
  return p;
}

/** Deliberately fictional: never assign this plan to CRM properties. */
export const DEMO_PLAN: Plan = {
  schemaVersion: 1,
  isDemo: true,
  scaleStatus: "proportional",
  coordinateSystem: { unit: "m", pivot: [4.5, 3.5] },
  dimensionEvidence: {
    note: "기능 체험용 가상 배치입니다. 실제 단지·세대의 도면이 아닙니다.",
  },
  outline: [
    [0, 0],
    [9, 0],
    [9, 7],
    [0, 7],
  ],
  rooms: [
    {
      id: "living",
      name: "거실",
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      label: [2.5, 2],
    },
    {
      id: "kitchen",
      name: "주방",
      polygon: [
        [5, 0],
        [9, 0],
        [9, 4],
        [5, 4],
      ],
      label: [7, 2],
    },
    {
      id: "bed",
      name: "안방",
      polygon: [
        [0, 4],
        [4, 4],
        [4, 7],
        [0, 7],
      ],
      label: [2, 5.5],
    },
    {
      id: "bath",
      name: "욕실",
      polygon: [
        [4, 4],
        [6, 4],
        [6, 7],
        [4, 7],
      ],
      label: [5, 5.5],
    },
    {
      id: "room",
      name: "작은방",
      polygon: [
        [6, 4],
        [9, 4],
        [9, 7],
        [6, 7],
      ],
      label: [7.5, 5.5],
    },
  ],
  walls: [
    { id: "south", start: [0, 0], end: [9, 0], thickness: 0.16, height: 2.4 },
    { id: "east", start: [9, 0], end: [9, 7], thickness: 0.16, height: 2.4 },
    { id: "north", start: [9, 7], end: [0, 7], thickness: 0.16, height: 2.4 },
    { id: "west", start: [0, 7], end: [0, 0], thickness: 0.16, height: 2.4 },
    { id: "middle", start: [0, 4], end: [9, 4], thickness: 0.12, height: 2.4 },
    {
      id: "bed-side",
      start: [4, 4],
      end: [4, 7],
      thickness: 0.12,
      height: 2.4,
    },
    {
      id: "bath-side",
      start: [6, 4],
      end: [6, 7],
      thickness: 0.12,
      height: 2.4,
    },
  ],
  doors: [
    {
      id: "entry",
      wallId: "south",
      offset: 5.4,
      width: 1,
      height: 2.1,
      hinge: "start",
      opensTo: "left",
    },
    {
      id: "bed-door",
      wallId: "middle",
      offset: 2.6,
      width: 0.9,
      height: 2.1,
      hinge: "start",
      opensTo: "left",
    },
    {
      id: "bath-door",
      wallId: "middle",
      offset: 4.5,
      width: 0.8,
      height: 2.1,
      hinge: "end",
      opensTo: "left",
    },
    {
      id: "room-door",
      wallId: "middle",
      offset: 6.4,
      width: 0.9,
      height: 2.1,
      hinge: "end",
      opensTo: "left",
    },
  ],
  windows: [
    {
      id: "living-window",
      wallId: "south",
      offset: 0.7,
      width: 3,
      height: 1.3,
      sillHeight: 0.7,
    },
    {
      id: "bed-window",
      wallId: "north",
      offset: 5.7,
      width: 2.4,
      height: 1.1,
      sillHeight: 0.9,
    },
    {
      id: "small-window",
      wallId: "east",
      offset: 4.8,
      width: 1.5,
      height: 1.1,
      sillHeight: 0.9,
    },
  ],
};
