import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { formatHistoryTimestamp } from "../app/history-timestamps.ts";

const dialogSource = readFileSync(new URL("../app/deletion-dialog.tsx", import.meta.url), "utf8");
const trashSource = readFileSync(new URL("../app/trash-view.tsx", import.meta.url), "utf8");
function compilation(source, omit = []) {
  const ast = ts.createSourceFile("synthetic.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && !omit.includes(node.name.text));
  const code = functions.map((node) => node.getText(ast).replace(/^export /, "")).join("\n");
  const names = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useState") names.push(node.name.elements[0].getText(ast));
    ts.forEachChild(node, visit);
  }
  functions.forEach(visit);
  return { names, compiled: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText };
}
const dialogCode = compilation(dialogSource, ["SafetyDialog"]);
const trashCode = compilation(trashSource);
const pureCode = compilation(dialogSource, ["SafetyDialog", "DeletionDialog"]);
const pure = new Function("React", "Icon", `${pureCode.compiled}; return { deletionEndpoint, deletionTypeLabel, DeletionPreviewContent };`)(React, () => null);
const preview = {
  type: "work", id: "synthetic work/1", title: "합성 고객 · 매물수정", subtitle: "업무일 · 2026.09.01",
  content: "첫 줄 원문\n가격을 다시 확인한 두 번째 줄", revision: "synthetic-revision-1", blockedReason: null,
  affectedListings: Array.from({ length: 10 }, (_, index) => ({ key: `synthetic-key-${index}`, label: `검증단지 ${101 + index}동 ${1001 + index}호` })),
  warnings: ["이 업무에 연결된 모든 매물 이력이 함께 제거됩니다.", "고객과 다른 업무는 삭제하지 않습니다."],
};
const trashItem = { id: "synthetic-trash/1", type: "work", entityId: preview.id, title: preview.title, subtitle: preview.subtitle, deletedAt: "2026-09-14 00:00:00" };
const trashData = { items: [trashItem], total: 1, limit: 50, offset: 0 };
const detail = { item: trashItem, preview };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));
function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants), ...React.Children.toArray(element.props.actions).flatMap(descendants)];
}
function control(tree, text) {
  const found = descendants(tree).find((element) => element.type === "button" && renderToStaticMarkup(element).includes(text));
  assert.ok(found, `production control ${text} exists`);
  return found;
}
function harness(kind = "delete", overrides = {}, props = {}, io = async () => ({ ok: true, trashId: trashItem.id })) {
  const code = kind === "delete" ? dialogCode : trashCode;
  const state = kind === "delete" ? { preview, loading: false, ...overrides } : { data: trashData, loadedKey: JSON.stringify(["", ""]), loading: false, ...overrides };
  const refs = [], effects = [], calls = [], busy = [], completed = [], closed = [];
  let cursor = 0, refCursor = 0;
  // Test-only renderer substitutes native dialog lifecycle; the production DOM is covered by E2E.
  // eslint-disable-next-line react/prop-types
  const SafetyDialog = ({ title, busy, onClose, children, actions }) => React.createElement("dialog", { "aria-label": title, "aria-busy": busy }, children, React.createElement("button", { onClick: onClose, disabled: busy }, "취소"), actions);
  const env = {
    React, Icon: () => null, SafetyDialog, ...pure, formatHistoryTimestamp,
    useState(initial) {
      const key = code.names[cursor++]; assert.ok(key);
      if (!(key in state)) state[key] = typeof initial === "function" ? initial() : initial;
      return [state[key], (next) => { state[key] = typeof next === "function" ? next(state[key]) : next; }];
    },
    useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
    useEffect: (effect) => effects.push(effect), useCallback: (fn) => fn,
    clientJsonFetch: async (...args) => { calls.push(args); return io(...args); },
    window: { setTimeout, clearTimeout },
  };
  const Component = new Function(...Object.keys(env), `${code.compiled}; return ${kind === "delete" ? "DeletionDialog" : "TrashView"};`)(...Object.values(env));
  const defaultProps = kind === "delete" ? { type: "work", id: preview.id, onClose: () => closed.push(true), onDeleted: (result) => completed.push(result), onBusyChange: (value) => busy.push(value) } : { onRestored: (result) => completed.push(result), onBusyChange: (value) => busy.push(value) };
  return { state, refs, effects, calls, busy, completed, closed, render(extra = {}) { cursor = 0; refCursor = 0; effects.length = 0; return Component({ ...defaultProps, ...props, ...extra }); } };
}

test("삭제 확인은 저장된 원문·연결된 열 개 주소·경고를 생략 없이 보여 주고 초안과 구분한다", () => {
  const h = harness("delete", {}, { unsavedDraft: true });
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /합성 고객 · 매물수정/);
  assert.match(html, /첫 줄 원문\n가격을 다시 확인한 두 번째 줄/);
  assert.match(html, /저장하지 않은 수정 내용은 휴지통에 포함되지 않습니다/);
  assert.match(html, /취소하면 작성 중인 내용/);
  for (const listing of preview.affectedListings) assert.ok(html.includes(listing.label));
  assert.doesNotMatch(html, /외 \d+|한국시간/);
  assert.equal(h.calls.length, 0);
});

test("안전한 취소는 쓰기 없이 기존 읽기·수정 화면으로 돌아간다", () => {
  const h = harness();
  h.render().props.onClose();
  assert.equal(h.closed.length, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.completed.length, 0);
});

test("미리보기 대기·오류·삭제 불가에는 휴지통 이동이 막히며 연결 의존성 이유가 보인다", async () => {
  for (const state of [{ preview: null, loading: true }, { preview: null, error: "합성 조회 실패" }, { preview: { ...preview, blockedReason: "연결된 업무 2건을 먼저 정리해 주세요." } }]) {
    const h = harness("delete", state);
    const tree = h.render(), button = control(tree, "휴지통으로 이동");
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    await flush();
    assert.equal(h.calls.length, 0);
    if (state.preview?.blockedReason) assert.match(renderToStaticMarkup(tree), /연결된 업무 2건/);
  }
});

test("대상 종류별 기존 API를 인코딩한 ID와 revision으로 호출하고 중복 입력·처리 중 닫기를 막는다", async () => {
  assert.equal(pure.deletionEndpoint("customer", "synthetic/id"), "/api/customers/synthetic%2Fid");
  assert.equal(pure.deletionEndpoint("followup", "synthetic/id"), "/api/follow-ups/synthetic%2Fid");
  const pending = deferred(), h = harness("delete", {}, {}, () => pending.promise);
  const tree = h.render(), button = control(tree, "휴지통으로 이동");
  button.props.onClick(); button.props.onClick(); tree.props.onClose();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.busy, [true]);
  assert.equal(h.closed.length, 0);
  assert.equal(h.calls[0][0], "/api/work-logs/synthetic%20work%2F1");
  assert.equal(h.calls[0][1].method, "DELETE");
  assert.deepEqual(JSON.parse(h.calls[0][1].body), { revision: preview.revision });
  assert.equal(h.render().props.busy, true);
  pending.resolve({ ok: true, trashId: trashItem.id });
  await flush();
  assert.deepEqual(h.completed, [{ ok: true, trashId: trashItem.id }]);
  assert.deepEqual(h.busy, [true, false]);
});

test("삭제 실패는 내용을 유지하고 다시 시도할 수 있으며 성공으로 안내하지 않는다", async () => {
  let count = 0;
  const h = harness("delete", {}, {}, async () => { if (++count === 1) throw new Error("합성 백업 실패"); return { ok: true, trashId: trashItem.id }; });
  control(h.render(), "휴지통으로 이동").props.onClick(); await flush();
  assert.equal(h.state.preview, preview);
  assert.equal(h.completed.length, 0);
  assert.equal(h.state.busy, false);
  assert.match(renderToStaticMarkup(h.render()), /합성 백업 실패/);
  control(h.render(), "휴지통으로 이동").props.onClick(); await flush();
  assert.equal(h.completed.length, 1);
});

test("네트워크 단절은 성공으로 단정하지 않고 한글 안내와 휴지통 확인 방법을 보여준다", async () => {
  const h = harness("delete", {}, {}, async () => { throw new TypeError("Failed to fetch"); });
  control(h.render(), "휴지통으로 이동").props.onClick(); await flush();
  assert.equal(h.completed.length, 0);
  assert.match(h.state.error, /서버 응답을 받지 못했습니다/);
  assert.match(h.state.error, /이미 처리되었는지는 휴지통/);
});

test("409 수정 경합은 같은 확인값 재시도를 막고 새 원문·새 revision 재확인 후에만 삭제한다", async () => {
  const current = { ...preview, content: "다른 기기에서 저장한 최신 내용", revision: "synthetic-new-revision" };
  let count = 0;
  const h = harness("delete", {}, {}, async (url) => {
    if (url.startsWith("/api/deletions/preview")) return { preview: current };
    if (++count === 1) throw Object.assign(new Error("다른 기기에서 기록을 수정했습니다."), { status: 409 });
    return { ok: true, trashId: trashItem.id };
  });
  control(h.render(), "휴지통으로 이동").props.onClick(); await flush();
  const blocked = h.render();
  assert.equal(control(blocked, "휴지통으로 이동").props.disabled, true);
  control(blocked, "휴지통으로 이동").props.onClick(); await flush();
  assert.equal(h.calls.length, 1);
  control(blocked, "최신 내용 다시 확인").props.onClick(); await flush();
  assert.equal(h.calls[1][1].cache, "no-store");
  assert.equal(h.state.mustRecheck, false);
  assert.match(renderToStaticMarkup(h.render()), /다른 기기에서 저장한 최신 내용/);
  control(h.render(), "휴지통으로 이동").props.onClick(); await flush();
  assert.equal(JSON.parse(h.calls.at(-1)[1].body).revision, current.revision);
  assert.equal(h.completed.length, 1);
});

test("취소·초점 복귀·Tab/Escape 격리는 기존 편집창과 전역 검색을 방해하지 않는 실제 native dialog를 사용한다", () => {
  assert.match(dialogSource, /dialog\?\.showModal\(\)/);
  assert.match(dialogSource, /cancelRef\.current\?\.focus\(\)/);
  assert.match(dialogSource, /previousFocus\?\.isConnected/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /onKeyDownCapture=/, "Escape must be intercepted before the parent's document listener");
  assert.match(dialogSource, /window\.addEventListener\("keydown", isolateKeys, true\)/, "failed requests can leave focus outside the dialog");
  assert.match(dialogSource, /event\.key === "Escape" \|\| event\.key === "Tab"\) event\.stopPropagation\(\)/);
  assert.match(dialogSource, /if \(!mutationLock\.current\) onClose\(\)/);
  const css = readFileSync(new URL("../app/deletion-dialog.css", import.meta.url), "utf8");
  assert.match(css, /100dvh/);
  assert.match(css, /position: sticky; bottom: 0/);
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("휴지통 목록은 삭제 시각·유형과 원문 확인 동작을 표시하고 새 검색에는 과거 결과를 숨긴다", () => {
  const h = harness("trash");
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /삭제 · 2026\.09\.14 09:00/);
  assert.match(html, /내용 확인 · 복구/);
  assert.match(html, /삭제일 최신순/);
  assert.doesNotMatch(html, /한국시간|영구삭제|휴지통 비우기/);
  h.state.query = "새 검색";
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /합성 고객 · 매물수정/);
  assert.equal(h.calls.length, 0);
});

test("영구 삭제는 별도 확인과 동의가 필요하고 중복 요청을 막는다", async () => {
  const pending=deferred();
  const h=harness("trash",{selectedId:trashItem.id,detail},{},(url,options)=>options?.method==="DELETE"?pending.promise:Promise.resolve({...trashData,items:[],total:0}));
  descendants(h.render()).find(e=>e.type==="button" && e.props.children==="영구 삭제").props.onClick();
  assert.equal(h.calls.length,0);
  assert.equal(control(h.render(),"영구 삭제 확정").props.disabled,true);
  control(h.render(),"영구 삭제 확정").props.onClick();
  assert.equal(h.calls.length,0);
  descendants(descendants(h.render()).find(e=>e.props.title==="영구 삭제 확인")).find(e=>e.type==="input"&&e.props.type==="checkbox").props.onChange({target:{checked:true}});
  const button=control(h.render(),"영구 삭제 확정");
  button.props.onClick();button.props.onClick();
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0][1].method,"DELETE");
  assert.equal(JSON.parse(h.calls[0][1].body).revision,preview.revision);
  pending.resolve({ok:true});await flush();
  assert.equal(h.state.selectedId,null);
  assert.match(h.state.notice,/영구 삭제/);
  assert.deepEqual(h.busy,[true,false]);
});

test("휴지통 일괄 삭제는 선택 목록과 동의를 확인하고 중복 요청을 막는다", async () => {
  const pending = deferred();
  const h = harness("trash", { checkedIds: [trashItem.id], bulkDetails: [detail] }, {}, (url, options) => options?.method === "DELETE" ? pending.promise : Promise.resolve({ ...trashData, items: [], total: 0 }));
  const dialog = () => descendants(h.render()).find(e => e.props.title === "선택한 기록 영구 삭제");
  assert.equal(control(h.render(), "1건 영구 삭제 확정").props.disabled, true);
  descendants(dialog()).find(e => e.type === "input").props.onChange({ target: { checked: true } });
  const button = control(h.render(), "1건 영구 삭제 확정");
  button.props.onClick(); button.props.onClick();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(h.calls[0][1].body).entries, [{ id: trashItem.id, revision: preview.revision }]);
  pending.resolve({ deletedCount: 1 }); await flush();
  assert.equal(h.state.bulkDetails, null);
  assert.deepEqual(h.state.checkedIds, []);
  assert.match(h.state.notice, /1건/);
});

test("휴지통 행을 누르면 읽기 요청만 보내고 복구를 명시적으로 눌러야 변경한다", async () => {
  const h = harness("trash", {}, {}, async () => detail);
  control(h.render(), "내용 확인 · 복구").props.onClick(); await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "/api/trash/synthetic-trash%2F1");
  assert.equal(h.calls[0][1].method, undefined);
  assert.deepEqual(h.state.detail, detail);
  assert.equal(h.completed.length, 0);
  assert.match(renderToStaticMarkup(h.render()), /삭제한 기록 확인 · 복구/);
});

test("휴지통 상세 대기 중 닫으면 늦게 도착한 응답으로 다시 열리지 않는다", async () => {
  const pending = deferred(), h = harness("trash", {}, {}, () => pending.promise);
  control(h.render(), "내용 확인 · 복구").props.onClick();
  const dialog = descendants(h.render()).find((item) => item.props.title === "삭제한 기록 확인 · 복구");
  dialog.props.onClose();
  pending.resolve(detail); await flush();
  assert.equal(h.state.selectedId, null);
  assert.equal(h.state.detail, null);
});

test("복구는 중복 클릭을 막고 성공 뒤 목록 조회 실패를 복구 실패로 바꾸지 않는다", async () => {
  const pending = deferred();
  const h = harness("trash", { selectedId: trashItem.id, detail }, {}, (url, options) => options?.method === "POST" ? pending.promise : Promise.reject(new Error("합성 목록 조회 실패")));
  const tree = h.render(), button = control(tree, "이 기록 복구");
  button.props.onClick(); button.props.onClick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "/api/trash/synthetic-trash%2F1/restore");
  assert.deepEqual(h.busy, [true]);
  const dialog = descendants(h.render()).find((item) => item.props.title === "삭제한 기록 확인 · 복구");
  dialog.props.onClose();
  assert.equal(h.state.selectedId, trashItem.id);
  const result = { ok: true, type: "work", entityId: preview.id };
  pending.resolve(result); await flush();
  assert.deepEqual(h.completed, [result]);
  assert.equal(h.state.selectedId, null);
  assert.match(h.state.notice, /복구했습니다/);
  assert.match(h.state.error, /합성 목록 조회 실패/);
  assert.equal(h.state.detailError, "");
});

test("복구 충돌은 성공으로 처리하지 않고 저장된 내용을 그대로 다시 확인할 수 있다", async () => {
  const h = harness("trash", { selectedId: trashItem.id, detail }, {}, async () => { throw Object.assign(new Error("같은 ID가 이미 존재합니다."), { status: 409 }); });
  control(h.render(), "이 기록 복구").props.onClick(); await flush();
  assert.equal(h.state.selectedId, trashItem.id);
  assert.equal(h.state.detail, detail);
  assert.equal(h.completed.length, 0);
  assert.equal(h.state.restoring, false);
  assert.match(renderToStaticMarkup(h.render()), /같은 ID가 이미 존재합니다/);
});

test("휴지통 더 보기는 현재 유형·검색을 유지하고 중복 페이지 요청과 오래된 응답을 막는다", async () => {
  const pending = deferred();
  const h = harness("trash", { type: "work", query: "합성", search: "합성", loadedKey: JSON.stringify(["work", "합성"]), data: { ...trashData, total: 2 } }, {}, () => pending.promise);
  const button = control(h.render(), "이전 삭제 기록 더 보기");
  button.props.onClick(); button.props.onClick();
  assert.equal(h.calls.length, 1);
  const url = new URL(h.calls[0][0], "https://synthetic.invalid");
  assert.equal(url.searchParams.get("q"), "합성");
  assert.equal(url.searchParams.get("type"), "work");
  assert.equal(url.searchParams.get("offset"), "1");
  pending.resolve({ ...trashData, items: [trashItem, { ...trashItem, id: "synthetic-trash/2" }], total: 2, offset: 1 }); await flush();
  assert.equal(h.state.data.items.length, 2);
  assert.equal(h.state.loadingMore, false);
});

test("휴지통 빈 결과는 필터 초기화를 제공하고 목록 오류에는 재시도를 제공한다", () => {
  const h = harness("trash", { type: "customer", loadedKey: JSON.stringify(["customer", ""]), data: { ...trashData, items: [], total: 0 } });
  const tree = h.render();
  assert.match(renderToStaticMarkup(tree), /조건에 맞는 삭제 기록이 없습니다/);
  control(tree, "검색 조건 초기화").props.onClick();
  assert.equal(h.state.type, "");
  const failed = harness("trash", { data: null, error: "합성 서버 오류" });
  assert.match(renderToStaticMarkup(failed.render()), /합성 서버 오류/);
  assert.ok(control(failed.render(), "다시 불러오기"));
});
