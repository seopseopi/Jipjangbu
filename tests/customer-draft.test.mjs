import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canCloseCustomerDraft, customerDraftChanged } from "../app/customer-draft.ts";

test("고객 등록·수정은 ID, 이름, 메모 각각의 변경과 원상 복구를 감지한다", () => {
  for (const initial of [
    { id: "", name: "", notes: "" },
    { id: "고객-예시", name: "예시 고객", notes: "이전 상담\n확인할 내용" },
  ]) {
    assert.equal(customerDraftChanged(initial, { ...initial }), false);
    for (const field of ["id", "name", "notes"]) {
      const current = { ...initial, [field]: `${initial[field]} 변경` };
      assert.equal(customerDraftChanged(initial, current), true, field);
      current[field] = initial[field];
      assert.equal(customerDraftChanged(initial, current), false, field);
    }
  }
});

test("변경하지 않은 고객 창은 확인 없이 닫고, 입력 중이면 사용자 선택을 따른다", () => {
  const initial = { id: "예시-ID", name: "예시 고객", notes: "" };
  const edited = { ...initial, notes: "아직 저장하지 않은 메모" };
  let prompts = 0;
  const decline = () => { prompts++; return false; };
  assert.equal(canCloseCustomerDraft(initial, { ...initial }, false, decline), true);
  assert.equal(prompts, 0);
  assert.equal(canCloseCustomerDraft(initial, edited, false, decline), false);
  assert.equal(prompts, 1);
  assert.equal(canCloseCustomerDraft(initial, edited, false, () => true), true);
  assert.equal(edited.notes, "아직 저장하지 않은 메모");
  assert.equal(initial.notes, "");
});

test("고객 저장 중에는 입력 변경 여부와 관계없이 닫기나 버리기 확인을 실행하지 않는다", () => {
  const initial = { id: "예시-ID", name: "예시 고객", notes: "" };
  for (const current of [initial, { ...initial, name: "수정한 예시 고객" }]) {
    assert.equal(canCloseCustomerDraft(initial, current, true, () => {
      assert.fail("저장 중에는 버리기 확인을 띄우면 안 됩니다.");
    }), false);
  }
});

test("고객 창 닫기와 취소는 동일 보호 경로를 쓰고 새로고침 경고를 해제한다", () => {
  const source = readFileSync(new URL("../app/work-manager.tsx", import.meta.url), "utf8");
  const customerModal = source.slice(source.indexOf("function CustomerModal("), source.indexOf("function HistoryModal("));
  assert.match(customerModal, /onClose=\{requestClose\}/);
  assert.match(customerModal, /onClick=\{requestClose\}/);
  assert.match(customerModal, /if \(!dirty && !saving\) return;/);
  assert.match(customerModal, /window\.addEventListener\("beforeunload", warn\)/);
  assert.match(customerModal, /window\.removeEventListener\("beforeunload", warn\)/);
  assert.match(customerModal, /locked=\{saving\}/);
});
