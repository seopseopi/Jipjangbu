"use client";
/* eslint-disable react/no-unknown-property -- R3F JSX describes Three.js objects, not HTML. */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Shape, Vector3, DoubleSide } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  ROOM_COLORS,
  transformPoint,
  wallSolids,
  wallPoint,
  type Plan,
  type Point,
  type Transform,
} from "./plan";

function Controls({
  reset,
  zoom,
  onFailure,
}: {
  reset: number;
  zoom: number;
  onFailure: () => void;
}) {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    camera.position.set(12 / zoom, 14 / zoom, 12 / zoom);
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 45;
    controls.update();
    const changed = () => invalidate();
    controls.addEventListener("change", changed);
    const lost = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    invalidate();
    return () => {
      controls.removeEventListener("change", changed);
      controls.dispose();
      gl.domElement.removeEventListener("webglcontextlost", lost);
    };
  }, [camera, gl, invalidate, reset, zoom, onFailure]);
  return null;
}
function Scene({
  plan,
  transform,
  selected,
  onSelect,
  labels,
}: {
  plan: Plan;
  transform: Transform;
  selected: string;
  onSelect: (id: string) => void;
  labels: React.RefObject<(HTMLSpanElement | null)[]>;
}) {
  const { camera, size } = useThree();
  const pos = (p: Point): [number, number, number] => {
    const t = transformPoint(p, plan.coordinateSystem.pivot, transform);
    return [
      t[0] - plan.coordinateSystem.pivot[0],
      0,
      -t[1] + plan.coordinateSystem.pivot[1],
    ];
  };
  const shapes = useMemo(
    () =>
      plan.rooms.map((room) => {
        const s = new Shape();
        room.polygon.forEach(([x, y], i) =>
          i ? s.lineTo(x, y) : s.moveTo(x, y),
        );
        s.closePath();
        return s;
      }),
    [plan],
  );
  const vector = useRef(new Vector3());
  useFrame(() => {
    plan.rooms.forEach((room, i) => {
      const el = labels.current[i];
      if (!el) return;
      const p = pos(room.label);
      vector.current.set(p[0], 0.12, p[2]).project(camera);
      el.style.transform = `translate(-50%, -50%) translate(${((vector.current.x + 1) * size.width) / 2}px,${((-vector.current.y + 1) * size.height) / 2}px)`;
      el.style.visibility = vector.current.z > 1 ? "hidden" : "visible";
    });
  });
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[5, 12, 8]} intensity={2} />
      <group
        rotation={[0, (transform.rotation * Math.PI) / 180, 0]}
        scale={[transform.mirror ? -1 : 1, 1, 1]}
      >
        <group
          position={[
            -plan.coordinateSystem.pivot[0],
            0,
            plan.coordinateSystem.pivot[1],
          ]}
        >
          {plan.rooms.map((room, i) => (
            <mesh
              key={room.id}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(room.id);
              }}
            >
              <shapeGeometry args={[shapes[i]]} />
              <meshStandardMaterial
                side={DoubleSide}
                color={
                  selected === room.id
                    ? "#8ab6aa"
                    : ROOM_COLORS[i % ROOM_COLORS.length]
                }
              />
            </mesh>
          ))}
          {plan.walls.flatMap((w) =>
            wallSolids(w, [...plan.doors, ...plan.windows]).map((s, i) => {
              const p = wallPoint(w, (s.from + s.to) / 2);
              return (
                <mesh
                  key={`${w.id}-${i}`}
                  position={[p[0], (s.bottom + s.top) / 2, -p[1]]}
                  rotation={[
                    0,
                    Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]),
                    0,
                  ]}
                >
                  <boxGeometry
                    args={[s.to - s.from, s.top - s.bottom, w.thickness]}
                  />
                  <meshStandardMaterial color="#e8e7e1" roughness={0.85} />
                </mesh>
              );
            }),
          )}
          {plan.windows.map((o) => {
            const w = plan.walls.find((w) => w.id === o.wallId)!,
              p = wallPoint(w, o.offset + o.width / 2);
            return (
              <mesh
                key={o.id}
                position={[p[0], (o.sillHeight ?? 0) + o.height / 2, -p[1]]}
                rotation={[
                  0,
                  Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]),
                  0,
                ]}
              >
                <boxGeometry args={[o.width, o.height, 0.025]} />
                <meshStandardMaterial
                  color="#88c7dd"
                  transparent
                  opacity={0.3}
                />
              </mesh>
            );
          })}
          {plan.doors.map((o) => {
            const w = plan.walls.find((w) => w.id === o.wallId)!,
              p = wallPoint(
                w,
                o.offset + (o.hinge === "end" ? o.width : 0),
                ((o.opensTo === "left" ? 1 : -1) * o.width) / 2,
              );
            return (
              <mesh
                key={o.id}
                position={[p[0], o.height / 2, -p[1]]}
                rotation={[
                  0,
                  Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]) +
                    Math.PI / 2,
                  0,
                ]}
              >
                <boxGeometry args={[o.width, o.height, 0.035]} />
                <meshStandardMaterial color="#c7b797" />
              </mesh>
            );
          })}
        </group>
      </group>
    </>
  );
}
export default function PlanThree(props: {
  plan: Plan;
  transform: Transform;
  selected: string;
  onSelect: (id: string) => void;
  reset: number;
  zoom: number;
  onFailure: () => void;
}) {
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  return (
    <div className="structure-three">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [12, 14, 12], fov: 42 }}
        fallback={<p>3D를 사용할 수 없습니다. 2D 보기를 선택해 주세요.</p>}
      >
        <Controls
          reset={props.reset}
          zoom={props.zoom}
          onFailure={props.onFailure}
        />
        <Scene {...props} labels={labels} />
      </Canvas>
      <div className="structure-labels" aria-hidden="true">
        {props.plan.rooms.map((r, i) => (
          <span
            key={r.id}
            ref={(el) => {
              labels.current[i] = el;
            }}
          >
            {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}
