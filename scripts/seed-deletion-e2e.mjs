// Local-only synthetic fixtures for the browser deletion acceptance flow.
// Run against an isolated Wrangler --local DB/R2, never a production hostname.
import assert from "node:assert/strict";

const base = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:4173");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "E2E fixtures require a loopback host");
assert.equal(base.protocol, "http:", "Use the isolated local Worker");
assert.equal(process.env.E2E_LOCAL_CONFIRM, "1", "Set E2E_LOCAL_CONFIRM=1 only for an isolated local test DB");
const login = await fetch(new URL("/api/auth/login", base), {
  method: "POST", headers: { "Content-Type": "application/json", Origin: base.origin },
  body: JSON.stringify({ username: "e2e-admin", password: "local-e2e-only-2026" }),
});
assert.equal(login.status, 200, "A dedicated e2e-admin test account is required");
const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
async function request(path, body) {
  const response = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET", headers: { Cookie: cookie, Origin: base.origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `Synthetic fixture request failed: ${response.status} ${path}`);
  return response.json();
}
const before = await request("/api/bootstrap");
assert.equal(before.demoMode, true, "Refuse to seed a DB containing non-demo work");
const { customers } = await request("/api/customers");
assert.ok(customers.every((customer) => Number(customer.is_demo) === 1), "Refuse to seed a DB containing non-demo customers");

const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const earlier = new Date(Date.parse(`${today}T00:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
const mainCustomer = { id: "E2E-DELETE-MAIN", name: "삭제 검증 고객", notes: "실제 고객이 아닌 자동 검증 자료" };
const emptyCustomer = { id: "E2E-DELETE-EMPTY", name: "삭제 가능한 검증 고객", notes: "삭제 후 복구할 합성 고객" };
await request("/api/customers", mainCustomer);
await request("/api/customers", emptyCustomer);
const details = [
  { propertyType: "아파트", buildingName: "삭제검증단지", buildingDong: "901", unitNumber: "101", sizeType: "33", salePrice: "3억", source: "합성 자료" },
  { propertyType: "아파트", buildingName: "복구검증단지", buildingDong: "902", unitNumber: "202", sizeType: "40", salePrice: "4억", source: "합성 자료" },
];
const baseWork = (await request("/api/work-logs", {
  workDate: earlier, customerId: mainCustomer.id, workType: "매물등록", content: "보존할 이전 매물등록 메모", details,
})).workLog;
const wrongWork = (await request("/api/work-logs", {
  workDate: today, customerId: mainCustomer.id, workType: "매물수정",
  content: "잘못 입력한 업무 삭제 E2E\n두 매물의 가격을 잘못 입력했습니다.\n취소·휴지통·복구 검증용입니다.",
  details: details.map((detail) => ({ ...detail, salePrice: "9억" })),
})).workLog;
const followup = (await request("/api/follow-ups", {
  title: "삭제 복구 확인할 일 E2E", notes: "합성 할 일 메모", dueDate: today, customerId: mainCustomer.id,
})).item;
console.log(JSON.stringify({
  localOnly: true, baseUrl: base.origin, today, earlier,
  customerId: mainCustomer.id, emptyCustomerId: emptyCustomer.id,
  baseWorkId: baseWork.id, wrongWorkId: wrongWork.id, followupId: followup.id,
  listingKeys: details.map((detail) => [detail.propertyType, detail.buildingName, detail.buildingDong, detail.unitNumber].join("|")),
}));
