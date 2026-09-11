import assert from "node:assert/strict";
import test from "node:test";
import { indexCustomers, matchCustomers } from "../app/customer-matches.ts";

function previousMatches(customers, query) {
  const normalize = (value) => value.toLocaleLowerCase("ko-KR").replace(/[\s()-]/g, "");
  const term = normalize(query);
  const rank = (customer) => {
    const values = [normalize(customer.name), normalize(customer.id)];
    if (!term || values.includes(term)) return 0;
    return values.some((value) => value.startsWith(term)) ? 1 : 2;
  };
  return customers.filter((customer) => !term || normalize(`${customer.name} ${customer.id}`).includes(term))
    .sort((a, b) => rank(a) - rank(b)).slice(0, 12);
}

test("고객 검색은 선형 순회로 정확·접두·포함 순과 기존 결과를 보존한다", () => {
  const customers = Array.from({ length: 2000 }, (_, i) => ({
    id: `010-1234-${String(i).padStart(4, "0")}`,
    name: i % 10 === 0 ? "민수" : i % 3 === 0 ? "김민수" : `민수 ${i}`,
  }));
  customers.push({ id: "AB(12)", name: "Agency" });
  const original = [...customers];
  const index = indexCustomers(customers);
  for (const query of ["", "민수", "김민", "010 1234", "010-1234-0009", "민수010", "GENCY", "ab-12", "없는 고객"]) {
    assert.deepEqual(matchCustomers(index, query), previousMatches(customers, query), query);
  }
  assert.deepEqual(customers, original);
});

test("고객명부 전처리는 한번만 하고 검색 중에는 원본 문자열을 다시 읽지 않는다", () => {
  let reads = 0;
  const customers = Array.from({ length: 616 }, (_, i) => ({
    get id() { reads++; return `고객-${i}`; },
    get name() { reads++; return `이름${i}`; },
  }));
  const index = indexCustomers(customers);
  assert.equal(reads, 1232);
  for (const query of ["이", "이름", "이름2", "고객6"]) assert.ok(matchCustomers(index, query).length > 0);
  assert.equal(reads, 1232);
  assert.deepEqual(matchCustomers(index, "이름", 0), []);
  assert.equal(matchCustomers(index, "", 5).length, 5);
});
