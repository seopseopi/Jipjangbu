"use client";
import {
  transformPoint,
  wallPoint,
  ROOM_COLORS,
  type Plan,
  type Point,
  type Transform,
} from "./plan";

export function PlanSvg({
  plan,
  transform,
  selected,
  onSelect,
  zoom,
}: {
  plan: Plan;
  transform: Transform;
  selected: string;
  onSelect: (id: string) => void;
  zoom: number;
}) {
  const point = (p: Point): Point => {
    const [x, y] = transformPoint(p, plan.coordinateSystem.pivot, transform);
    return [x, -y];
  };
  const corners = plan.outline.map(point),
    xs = corners.map((p) => p[0]),
    ys = corners.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs) + 1.4,
    height = Math.max(...ys) - Math.min(...ys) + 1.4;
  const center = [
    (Math.max(...xs) + Math.min(...xs)) / 2,
    (Math.max(...ys) + Math.min(...ys)) / 2,
  ];
  const line = (a: Point, b: Point) => ({
    x1: point(a)[0],
    y1: point(a)[1],
    x2: point(b)[0],
    y2: point(b)[1],
  });
  return (
    <svg
      className="structure-svg"
      viewBox={`${center[0] - width / zoom / 2} ${center[1] - height / zoom / 2} ${width / zoom} ${height / zoom}`}
      role="img"
      aria-label="집 구조 평면도. 아래 방 목록으로 방을 선택할 수 있습니다."
    >
      {plan.rooms.map((room, i) => (
        <g key={room.id}>
          <polygon
            points={room.polygon.map((p) => point(p).join(",")).join(" ")}
            fill={
              selected === room.id
                ? "#99bcb4"
                : ROOM_COLORS[i % ROOM_COLORS.length]
            }
            stroke={selected === room.id ? "#24564c" : "#fff"}
            strokeWidth={0.035}
            onClick={() => onSelect(room.id)}
          />
        </g>
      ))}
      {plan.walls.map((w) => (
        <line
          key={w.id}
          {...line(w.start, w.end)}
          stroke="#465565"
          strokeWidth={w.thickness}
        />
      ))}
      {plan.windows.map((o) => {
        const w = plan.walls.find((w) => w.id === o.wallId)!;
        return (
          <g key={o.id}>
            <line
              {...line(
                wallPoint(w, o.offset),
                wallPoint(w, o.offset + o.width),
              )}
              stroke="#edf7fb"
              strokeWidth={w.thickness + 0.025}
            />
            <line
              {...line(
                wallPoint(w, o.offset),
                wallPoint(w, o.offset + o.width),
              )}
              stroke="#4b98b3"
              strokeWidth={0.055}
            />
          </g>
        );
      })}
      {plan.doors.map((o) => {
        const w = plan.walls.find((w) => w.id === o.wallId)!;
        const hinge = wallPoint(
          w,
          o.offset + (o.hinge === "end" ? o.width : 0),
        );
        const closed = wallPoint(
          w,
          o.offset + (o.hinge === "end" ? 0 : o.width),
        );
        const open = wallPoint(
          w,
          o.offset + (o.hinge === "end" ? o.width : 0),
          (o.opensTo === "left" ? 1 : -1) * o.width,
        );
        const c = point(closed),
          p = point(open);
        const sweep = Number(
          ((o.hinge === "end") !== (o.opensTo === "right")) !==
            transform.mirror,
        );
        return (
          <g key={o.id}>
            <line
              {...line(
                wallPoint(w, o.offset),
                wallPoint(w, o.offset + o.width),
              )}
              stroke="#fff"
              strokeWidth={w.thickness + 0.045}
            />
            <line {...line(hinge, open)} stroke="#8b6d4c" strokeWidth={0.05} />
            <path
              d={`M ${c} A ${o.width} ${o.width} 0 0 ${sweep} ${p}`}
              fill="none"
              stroke="#8b6d4c"
              strokeWidth={0.025}
              strokeDasharray=".07 .05"
            />
          </g>
        );
      })}
      {plan.rooms.map((room) => {
        const [x, y] = point(room.label);
        return (
          <text
            key={room.id}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={0.27}
            fontWeight={550}
            fill="#263746"
            style={{ pointerEvents: "none" }}
          >
            {room.name}
          </text>
        );
      })}
    </svg>
  );
}
