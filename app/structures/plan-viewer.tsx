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
import { roomColor, type Plan, type Transform } from "./plan";
import { hasReferenceFinishes } from "./hillstate-reference";
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
    [lowWalls, setLowWalls] = useState(true),
    [topView, setTopView] = useState(false),
    [showRoute, setShowRoute] = useState(true),
    [showLabels, setShowLabels] = useState(!hasReferenceFinishes(plan)),
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
      showRoute={showRoute}
    />
  );
  return (
    <section className="structure-viewer" aria-label="집 구조 뷰어">
      {plan.entry && (
        <div className="structure-entry-guide">
          <strong>① 출입구 → ② 현관 → ③ 거실</strong>
          <span>
            주황색 표시에서 시작해 보세요. 선은 배치를 설명하기 위한 안내입니다.
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected(plan.entry!.roomId);
              setZoom(1);
              setReset((n) => n + 1);
            }}
          >
            현관 찾기
          </button>
        </div>
      )}
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
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
          >
            확대 +
          </button>
          <button
            type="button"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
          >
            축소 −
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setTopView(false);
              setLowWalls(true);
              setShowRoute(true);
              setSelected("");
              setReset((r) => r + 1);
            }}
          >
            보기 초기화
          </button>
        </div>
      </div>
      <div className="structure-reading-tools">
        {mode === "3d" && (
          <>
            <button
              type="button"
              aria-pressed={showLabels}
              onClick={() => setShowLabels((v) => !v)}
            >
              방 이름 {showLabels ? "켜짐" : "꺼짐"}
            </button>
            <button
              type="button"
              aria-pressed={lowWalls}
              onClick={() => setLowWalls((v) => !v)}
            >
              {lowWalls ? "벽 낮게 ✓" : "벽 높이 그대로"}
            </button>
            <button
              type="button"
              aria-pressed={topView}
              onClick={() => setTopView((v) => !v)}
            >
              {topView ? "위에서 보기 ✓" : "위에서 보기"}
            </button>
          </>
        )}
        {plan.entry && (
          <button
            type="button"
            aria-pressed={showRoute}
            onClick={() => setShowRoute((v) => !v)}
          >
            입구 안내선 {showRoute ? "켜짐" : "꺼짐"}
          </button>
        )}
        {mode === "2d" && <span>침실은 파랑 · 욕실은 청록 · 현관은 주황</span>}
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
                lowWalls={lowWalls}
                topView={topView}
                showRoute={showRoute}
                showLabels={showLabels}
              />
            </Suspense>
          </ThreeBoundary>
        )}
      </div>
      <div className="structure-room-list" aria-label="방 선택">
        {plan.rooms.map((r) => (
          <button
            type="button"
            key={r.id}
            aria-pressed={selected === r.id}
            onClick={() => setSelected(selected === r.id ? "" : r.id)}
          >
            <span style={{ background: roomColor(r) }} />
            {r.name}
          </button>
        ))}
      </div>
      <div
        className="structure-selection-status"
        role="status"
        aria-live="polite"
      >
        {selected ? (
          <>
            <strong>
              {plan.rooms.find((room) => room.id === selected)?.name}
            </strong>
            <span>선택한 공간을 도면에서 강조하고 있습니다.</span>
            <button type="button" onClick={() => setSelected("")}>
              선택 해제
            </button>
          </>
        ) : (
          <span>방 이름이나 도면의 바닥을 누르면 해당 공간이 강조됩니다.</span>
        )}
      </div>
      <p className="structure-help">
        {mode === "3d"
          ? "드래그로 회전 · 휠 또는 두 손가락으로 확대 · "
          : "방을 선택해 배치를 확인하세요 · "}
        {plan.scaleStatus === "verified"
          ? "자료 기준 치수 확인"
          : "배치 참고용 · 실측 아님"}
        {failed ? " · 3D 사용 불가, 2D로 표시 중" : ""}
        {mode === "3d" && lowWalls
          ? " · 내부가 보이도록 벽·문 높이를 낮춰 표시합니다"
          : ""}
      </p>
    </section>
  );
}
