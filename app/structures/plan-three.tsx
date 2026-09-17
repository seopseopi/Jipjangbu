"use client";
/* eslint-disable react/no-unknown-property -- R3F JSX describes Three.js objects, not HTML. */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Shape, Vector3, DoubleSide } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ReferenceFixtures, useFloorTextures } from "./plan-fixtures";
import { referenceFinish } from "./reference-finishes";
import { hasReferenceFinishes } from "./hillstate-reference";
import {
  roomColor,
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
  topView,
}: {
  reset: number;
  zoom: number;
  onFailure: () => void;
  topView: boolean;
}) {
  const { camera, gl, invalidate, size } = useThree();
  const fit = Math.max(1, 1.05 / (size.width / size.height));
  const controlsRef = useRef<OrbitControls | null>(null);
  const previousView = useRef<{
    zoom: number;
    reset: number;
    topView: boolean;
    fit: number;
  } | null>(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controlsRef.current = controls;
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
      controlsRef.current = null;
      previousView.current = null;
      gl.domElement.removeEventListener("webglcontextlost", lost);
    };
  }, [camera, gl, invalidate, onFailure]);
  useEffect(() => {
    const controls = controlsRef.current,
      previous = previousView.current;
    if (!controls) return;
    if (
      !previous ||
      previous.reset !== reset ||
      previous.topView !== topView ||
      previous.fit !== fit
    ) {
      controls.target.set(0, 0, 0);
      camera.position.set(
        topView ? 0 : (7 * fit) / zoom,
        topView ? (23 * fit) / zoom : (20 * fit) / zoom,
        topView ? 0.01 : (12 * fit) / zoom,
      );
    } else if (previous.zoom !== zoom) {
      // Dolly along the current line of sight; do not discard the user's orbit or pan.
      camera.position
        .sub(controls.target)
        .multiplyScalar(previous.zoom / zoom)
        .add(controls.target);
    }
    previousView.current = { zoom, reset, topView, fit };
    controls.update();
    invalidate();
  }, [camera, fit, zoom, reset, topView, invalidate]);
  return null;
}
function Scene({
  plan,
  transform,
  selected,
  onSelect,
  labels,
  lowWalls,
  showRoute,
}: {
  plan: Plan;
  transform: Transform;
  selected: string;
  onSelect: (id: string) => void;
  labels: React.RefObject<(HTMLSpanElement | null)[]>;
  lowWalls: boolean;
  showRoute: boolean;
}) {
  const { camera, size } = useThree();
  const detailed = hasReferenceFinishes(plan);
  const textures = useFloorTextures();
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
    // Demand rendering may stop after this frame; project labels with the current camera.
    camera.updateMatrixWorld();
    plan.rooms.forEach((room, i) => {
      const el = labels.current[i];
      if (!el) return;
      const p = pos(room.label);
      vector.current.set(p[0], detailed ? 1.15 : 0.12, p[2]).project(camera);
      el.style.transform = `translate(-50%, -50%) translate(${((vector.current.x + 1) * size.width) / 2}px,${((-vector.current.y + 1) * size.height) / 2}px)`;
      el.style.visibility = vector.current.z > 1 ? "hidden" : "visible";
    });
    const entryEl = labels.current[plan.rooms.length];
    if (plan.entry && entryEl) {
      const p = pos(plan.entry.route[0]);
      vector.current.set(p[0], 0.25, p[2]).project(camera);
      entryEl.style.setProperty(
        "transform",
        `translate(-50%, -120%) translate(${((vector.current.x + 1) * size.width) / 2}px,${((-vector.current.y + 1) * size.height) / 2}px)`,
      );
    }
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
              <meshBasicMaterial
                side={DoubleSide}
                map={detailed ? textures[referenceFinish(room.id)] : null}
                color={
                  selected === room.id
                    ? "#8ab6aa"
                    : detailed
                      ? "#ffffff"
                      : roomColor(room)
                }
              />
            </mesh>
          ))}
          {detailed && <ReferenceFixtures onSelect={onSelect} />}
          {plan.walls.flatMap((w) =>
            wallSolids(w, [...plan.doors, ...plan.windows]).map((s, i) => {
              const top = lowWalls ? Math.min(s.top, 0.6) : s.top;
              if (s.bottom >= top) return null;
              const p = wallPoint(w, (s.from + s.to) / 2);
              return (
                <mesh
                  key={`${w.id}-${i}`}
                  position={[p[0], (s.bottom + top) / 2, -p[1]]}
                  rotation={[
                    0,
                    Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]),
                    0,
                  ]}
                >
                  <boxGeometry
                    args={[s.to - s.from, top - s.bottom, w.thickness]}
                  />
                  <meshStandardMaterial color="#a5b0ba" roughness={0.85} />
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
                position={[
                  p[0],
                  lowWalls ? 0.62 : (o.sillHeight ?? 0) + o.height / 2,
                  -p[1],
                ]}
                rotation={[
                  0,
                  Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]),
                  0,
                ]}
              >
                <boxGeometry
                  args={[
                    o.width,
                    lowWalls ? 0.045 : o.height,
                    lowWalls ? 0.12 : 0.025,
                  ]}
                />
                <meshStandardMaterial
                  color="#88c7dd"
                  transparent
                  opacity={lowWalls ? 1 : 0.3}
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
                position={[p[0], (lowWalls ? 0.45 : o.height) / 2, -p[1]]}
                rotation={[
                  0,
                  Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]) +
                    Math.PI / 2,
                  0,
                ]}
              >
                <boxGeometry
                  args={[o.width, lowWalls ? 0.45 : o.height, 0.035]}
                />
                <meshBasicMaterial
                  color={plan.entry?.doorId === o.id ? "#b75b0b" : "#aa987a"}
                />
              </mesh>
            );
          })}
          {showRoute &&
            plan.entry?.route.slice(1).map((p, i) => {
              const a = plan.entry!.route[i],
                dx = p[0] - a[0],
                dy = p[1] - a[1];
              return (
                <mesh
                  key={`route-${i}`}
                  position={[(a[0] + p[0]) / 2, 0.045, -(a[1] + p[1]) / 2]}
                  rotation={[0, Math.atan2(dy, dx), 0]}
                >
                  <boxGeometry args={[Math.hypot(dx, dy), 0.025, 0.09]} />
                  <meshBasicMaterial color="#b75b0b" />
                </mesh>
              );
            })}
          {plan.entry && (
            <mesh
              position={[
                plan.entry.route[0][0],
                0.065,
                -plan.entry.route[0][1],
              ]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <ringGeometry args={[0.14, 0.23, 32]} />
              <meshBasicMaterial color="#b75b0b" side={DoubleSide} />
            </mesh>
          )}
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
  lowWalls: boolean;
  topView: boolean;
  showRoute: boolean;
  showLabels: boolean;
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
          topView={props.topView}
        />
        <Scene {...props} labels={labels} />
      </Canvas>
      <div className="structure-labels" aria-hidden="true">
        {props.plan.rooms.map((r, i) => (
          <span
            key={r.id}
            className={`${props.selected === r.id ? "is-selected" : ""} ${r.id === props.plan.entry?.roomId ? "is-entrance" : ""}`}
            hidden={!props.showLabels && props.selected !== r.id}
            ref={(el) => {
              labels.current[i] = el;
            }}
          >
            {r.name}
          </span>
        ))}
        {props.plan.entry && (
          <span
            className="structure-entry-pin"
            ref={(el) => {
              labels.current[props.plan.rooms.length] = el;
            }}
          >
            ① 출입구
          </span>
        )}
      </div>
    </div>
  );
}
