import assert from "node:assert/strict";
import test from "node:test";
import { calendarWorkPresentation } from "./helpers/calendar-presentation.mjs";
import { getWorkProperties, workPropertyLabel } from "../app/work-property-summary.ts";

const property = (overrides = {}) => ({
  id: "synthetic-property", sequence: 1, property_type: "아파트", building_name: "검증단지",
  building_dong: "106", unit_number: "1503", size_type: "33", sale_price: "35000",
  jeonse_price: "", monthly_rent: "", source: "협력업소", ...overrides,
});
const work = (overrides = {}) => ({
  customer_id: "고객ID-검증", customer_name: "일반 고객", work_type: "매물등록",
  properties_json: JSON.stringify([property()]), property_count: 1, ...overrides,
});
const address = "검증단지 106동 1503호";

test("매물 관련 5종은 주소를 우선 표시하고 실제 물건지를 괄호로 함께 표시한다", () => {
  for (const work_type of ["매물등록", "매물수정", "매물취소", "타계약확인", "경매확인"]) {
    const result = calendarWorkPresentation(work({ work_type }));
    assert.equal(result.propertyFocused, true, work_type);
    assert.deepEqual(result.entries, [`${address} (협력업소)`], work_type);
  }
});

test("엑셀의 계약·금전 5종은 일반 고객일 때 각 물건의 물건지·업소를 표시한다", () => {
  for (const work_type of ["가계약", "계약서작성", "잔금", "중도금", "계약취소"]) {
    assert.deepEqual(calendarWorkPresentation(work({ work_type })).entries, [`${address} (협력업소)`], work_type);
    for (const source of ["", "  ", "마전현대", " 마전현대 "]) {
      assert.deepEqual(calendarWorkPresentation(work({ work_type, properties_json: JSON.stringify([property({ source })]) })).entries, [source.trim() ? `${address} (${source.trim()})` : address]);
    }
  }
});

test("부동산 고객과 자체결정도 물건지를 표시하고 고객ID는 별도 문구로 구분한다", () => {
  for (const customer_name of ["검증부동산", "부동산", "자체결정"]) {
    for (const work_type of ["매물등록", "매물수정", "매물취소", "가계약", "계약서작성", "잔금", "중도금", "계약취소", "타계약확인", "경매확인"]) {
      assert.deepEqual(calendarWorkPresentation(work({ customer_name, work_type })).entries, [`${address} (협력업소) · 고객 고객ID-검증`]);
    }
  }
});

test("부동산써브는 원본과 동일하게 부동산 고객ID 표시 예외로 처리한다", () => {
  assert.deepEqual(calendarWorkPresentation(work({ customer_name: "부동산써브" })).entries, [`${address} (협력업소)`]);
  assert.deepEqual(calendarWorkPresentation(work({ customer_name: "부동산써브", work_type: "가계약" })).entries, [`${address} (협력업소)`]);
  assert.deepEqual(calendarWorkPresentation(work({ customer_name: "부동산써브", work_type: "전화" })).entries, ["부동산써브"]);
});

test("전화·방문·예정·계약파기·신규 업무는 연결 물건이 있어도 고객을 먼저 표시한다", () => {
  for (const work_type of ["전화", "집방문", "잔금예정", "계약예정", "계약파기", "새 업무종별"]) {
    const result = calendarWorkPresentation(work({ work_type }));
    assert.equal(result.propertyFocused, false, work_type);
    assert.deepEqual(result.entries, ["일반 고객"], work_type);
    assert.deepEqual(result.properties.map((item) => item.label), [`${address} (협력업소)`]);
    assert.deepEqual(calendarWorkPresentation(work({ work_type, customer_name: "검증부동산" })).entries, ["고객ID-검증 검증부동산"]);
  }
});

test("동 없는 물건과 이미 접미사가 있는 주소는 읽을 수 있게 표시하고 저장값을 바꾸지 않는다", () => {
  const input = property({ building_dong: "106동", unit_number: "1503호" });
  assert.equal(workPropertyLabel(input), address);
  assert.equal(input.building_dong, "106동");
  assert.equal(workPropertyLabel(property({ building_dong: "" })), "검증단지 1503호");
  assert.equal(workPropertyLabel({}), "물건 정보 없음");
});

test("다중 물건은 모두 원래 순서로 표시하고 계약업무의 물건지·업소도 각각 적용한다", () => {
  const properties = [property({ id: "a", sequence: 1, source: "" }), property({ id: "b", sequence: 2, building_name: "두번째단지", source: "다른업소" }), property({ id: "c", sequence: 3, building_name: "세번째단지", source: "마전현대" })];
  const result = calendarWorkPresentation(work({ work_type: "잔금", properties_json: JSON.stringify(properties), property_count: 3 }));
  assert.deepEqual(result.entries, [address, "두번째단지 106동 1503호 (다른업소)", "세번째단지 106동 1503호 (마전현대)"]);
  assert.deepEqual(result.properties.map((item) => item.id), ["a", "b", "c"]);
});

test("물건지 없는 주소는 빈 괄호가 없고 고객ID와 물건지가 같아도 같은 이름을 중복하지 않는다", () => {
  const input = property({ source: " 뉴현대 " });
  assert.equal(workPropertyLabel(input), address, "identity and plain-address consumers stay source-free");
  assert.equal(workPropertyLabel(input, true), `${address} (뉴현대)`);
  assert.equal(input.source, " 뉴현대 ");
  for (const source of [undefined, "", " \n "]) assert.equal(workPropertyLabel({ ...input, source }, true), address);
  const result = calendarWorkPresentation(work({ customer_name: "합성부동산", customer_id: "뉴현대", properties_json: JSON.stringify([input]) }));
  assert.deepEqual(result.entries, [`${address} (뉴현대)`]);
});

test("이전 요약 응답·잘못된 JSON은 대표 물건으로 호환하고 물건이 없으면 고객을 유지한다", () => {
  for (const properties_json of [undefined, "not json", "{}", "[null]", '[["bad"]]']) {
    assert.deepEqual(getWorkProperties({ ...property(), properties_json }).map((item) => item.building_name), ["검증단지"]);
  }
  assert.deepEqual(getWorkProperties({ properties_json: "[]", ...property() }), []);
  assert.deepEqual(getWorkProperties({}), []);
  const result = calendarWorkPresentation(work({ properties_json: "[]", property_count: 0 }));
  assert.equal(result.propertyFocused, false);
  assert.deepEqual(result.entries, ["일반 고객"]);
});

test("전체 물건 JSON의 줄바꿈·따옴표·한글 및 숫자 필드는 손실 없이 읽는다", () => {
  const input = property({ source: '검증 "업소"\n연락 메모', sale_price: 35000, building_dong: 106 });
  const [result] = getWorkProperties({ properties_json: JSON.stringify([input]) });
  assert.equal(result.source, input.source);
  assert.equal(result.sale_price, "35000");
  assert.equal(result.building_dong, "106");
});
