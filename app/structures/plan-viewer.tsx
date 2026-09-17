"use client";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { PlanSvg } from "./plan-svg";
import { ROOM_COLORS, type Plan, type Transform } from "./plan";
const PlanThree = lazy(() => import("./plan-three"));
class ThreeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function PlanViewer({
  plan,
  transform = { mirror: false, rotation: 0 },
}: {
  plan: Plan;
  transform?: Transform;
}) {
  const [mode, setMode] = useState("2d"),
    [selected, setSelected] = useState(""),
    [zoom, setZoom] = useState(1),
    [reset, setReset] = useState(0),
    [failed, setFailed] = useState(false);
  const failure = useCallback(() => {
    setFailed(true);
    setMode("2d");
  }, []);
  const svg = (
    <PlanSvg
      plan={plan}
      transform={transform}
      selected={selected}
      onSelect={setSelected}
      zoom={zoom}
    />
  );
  return (
    <section className="structure-viewer" aria-label="집 구조 뷰어">
      <div className="structure-viewer-bar">
        <div className="structure-segment">
          <button
            type="button"
            aria-pressed={mode === "2d"}
            onClick={() => setMode("2d")}
          >
            2D 평면도
          </button>
          <button
            type="button"
            aria-pressed={mode === "3d"}
            disabled={failed}
            onClick={() => setMode("3d")}
          >
            3D 구조
          </button>
        </div>
        <div className="structure-tools">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
          >
            확대 +
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
          >
            축소 −
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setReset((r) => r + 1);
            }}
          >
            초기화
          </button>
        </div>
      </div>
      <div className="structure-canvas">
        {mode === "2d" ? (
          svg
        ) : (
          <ThreeBoundary
            fallback={
              <>
                <p role="status">3D 실행이 어려워 평면도로 표시합니다.</p>
                {svg}
              </>
            }
          >
            <Suspense
              fallback={
                <p className="structure-empty" role="status">
                  3D 구조를 준비하고 있습니다…
                </p>
              }
            >
              <PlanThree
                plan={plan}
                transform={transform}
                selected={selected}
                onSelect={setSelected}
                reset={reset}
                zoom={zoom}
                onFailure={failure}
              />
            </Suspense>
          </ThreeBoundary>
        )}
      </div>
      <div className="structure-room-list" aria-label="방 선택">
        {plan.rooms.map((r, i) => (
          <button
            type="button"
            key={r.id}
            aria-pressed={selected === r.id}
            onClick={() => setSelected(selected === r.id ? "" : r.id)}
          >
            <span style={{ background: ROOM_COLORS[i % ROOM_COLORS.length] }} />
            {r.name}
          </button>
        ))}
      </div>
      <p className="structure-help">
        {mode === "3d"
          ? "드래그로 회전 · 휠 또는 두 손가락으로 확대 · "
          : "방을 선택해 배치를 확인하세요 · "}
        {plan.scaleStatus === "verified"
          ? "자료 기준 치수 확인"
          : "배치 참고용 · 실측 아님"}
        {failed ? " · 3D 사용 불가, 2D로 표시 중" : ""}
      </p>
    </section>
  );
}
