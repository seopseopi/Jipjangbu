import { REFERENCE_FIXTURES } from "./reference-finishes";
import type { Plan, Transform } from "./plan";

export function ReferenceFixturesSvg({
  plan,
  transform,
  onSelect,
}: {
  plan: Plan;
  transform: Transform;
  onSelect: (id: string) => void;
}) {
  const [px, py] = plan.coordinateSystem.pivot;
  return (
    <g
      transform={`translate(${px},${-py}) rotate(${-transform.rotation}) scale(${transform.mirror ? -1 : 1},1) translate(${-px},${py})`}
    >
      {REFERENCE_FIXTURES.map((f) => {
        const w = f.width,
          d = f.depth;
        return (
          <g
            key={f.id}
            data-fixture={f.id}
            transform={`translate(${f.center[0]},${-f.center[1]}) rotate(${-f.rotation})`}
            onClick={() => onSelect(f.roomId)}
            stroke="#68777b"
            strokeWidth={0.025}
            fill="#f7f6f1"
          >
            {f.kind === "counter" && (
              <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#ded8cd" />
            )}
            {f.kind === "tub" && (
              <>
                <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={0.06} />
                <rect
                  x={-w / 2 + 0.07}
                  y={-d / 2 + 0.07}
                  width={w - 0.14}
                  height={d - 0.14}
                  rx={0.12}
                  fill="#c6d9dc"
                />
                <circle cx={w / 2 - 0.14} r={0.035} fill="#7d9299" />
              </>
            )}
            {f.kind === "toilet" && (
              <>
                <ellipse cy={d * 0.1} rx={w * 0.47} ry={d * 0.42} />
                <rect
                  x={-w * 0.45}
                  y={-d * 0.46}
                  width={w * 0.9}
                  height={d * 0.23}
                  rx={0.03}
                />
                <ellipse
                  cy={d * 0.1}
                  rx={w * 0.27}
                  ry={d * 0.26}
                  fill="#b6cdd1"
                />
              </>
            )}
            {(f.kind === "basin" || f.kind === "sink") && (
              <>
                <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={0.06} />
                <ellipse rx={w * 0.36} ry={d * 0.32} fill="#adc7ce" />
                <circle r={0.025} fill="#607c85" />
                <path
                  d={`M 0 ${-d * 0.45} v ${d * 0.21}`}
                  strokeWidth={0.045}
                />
              </>
            )}
            {f.kind === "cooktop" && (
              <>
                <rect
                  x={-w / 2}
                  y={-d / 2}
                  width={w}
                  height={d}
                  rx={0.025}
                  fill="#303a3e"
                />
                {[
                  [-0.22, -0.24],
                  [0.22, -0.24],
                  [0, 0.23],
                ].map(([x, y], i) => (
                  <circle
                    key={i}
                    cx={x * w}
                    cy={y * d}
                    r={w * 0.15}
                    fill="none"
                    stroke="#dce5e5"
                    strokeWidth={0.02}
                  />
                ))}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function ReferenceFloorPatterns({ id }: { id: string }) {
  return (
    <>
      <pattern
        id={`${id}-bath`}
        width={1.25}
        height={1.25}
        patternUnits="userSpaceOnUse"
      >
        {["#c2abb0", "#e4d5d6", "#b79ca4", "#d4bec3"].flatMap((_, y) =>
          [0, 1, 2, 3].map((x) => (
            <rect
              key={`${x}-${y}`}
              x={x * 0.3125}
              y={y * 0.3125}
              width={0.3125}
              height={0.3125}
              fill={
                ["#c2abb0", "#e4d5d6", "#b79ca4", "#d4bec3"][(x + y * 3) % 4]
              }
              stroke="#99888d"
              strokeWidth={0.01}
            />
          )),
        )}
      </pattern>
      {(["balcony", "entry"] as const).map((kind) => (
        <pattern
          key={kind}
          id={`${id}-${kind}`}
          width={0.625}
          height={0.625}
          patternUnits="userSpaceOnUse"
        >
          {[0, 1].flatMap((y) =>
            [0, 1].map((x) => (
              <rect
                key={`${x}-${y}`}
                x={x * 0.3125}
                y={y * 0.3125}
                width={0.3125}
                height={0.3125}
                fill={
                  (kind === "balcony"
                    ? ["#c5c5b7", "#cecec1"]
                    : ["#e1ddd3", "#e8e4db"])[(x + y) % 2]
                }
                stroke="#a5a69d"
                strokeWidth={0.01}
              />
            )),
          )}
        </pattern>
      ))}
      <pattern
        id={`${id}-wood`}
        width={1.54}
        height={1.54}
        patternUnits="userSpaceOnUse"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <rect
              y={i * 0.1925}
              width={1.54}
              height={0.1925}
              fill={["#c9a878", "#d1b182", "#d6b789", "#c5a273"][i % 4]}
            />
            <path
              d={`M 0 ${i * 0.1925} h 1.54 M ${i % 2 ? 0.54 : 1.2} ${i * 0.1925} v .1925`}
              stroke="#b59368"
              strokeWidth={0.008}
            />
          </g>
        ))}
      </pattern>
      <pattern
        id={`${id}-bedroom`}
        width={1}
        height={1}
        patternUnits="userSpaceOnUse"
      >
        <rect width={1} height={1} fill="#eee3bd" />
      </pattern>
    </>
  );
}
