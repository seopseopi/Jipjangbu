import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasPropertyDraft, listingPickerQueryUrl, propertyFromListing } from "../app/listing-draft.ts";

const source = {
  id: "existing-listing-id",
  identity_key: "아파트|테스트|101|202",
  property_type: " 아파트 ",
  building_name: " 테스트 ",
  building_dong: 101,
  unit_number: " 202 ",
  size_type: " 33A ",
  sale_price: 0,
  jeonse_price: " 50000 ",
  monthly_rent: " 1000/50 ",
};

test("loading an existing listing copies trimmed property fields, retaining numeric zero", () => {
  assert.deepEqual(propertyFromListing(source), {
    propertyType: "아파트", buildingName: "테스트", buildingDong: "101", unitNumber: "202", sizeType: "33A", salePrice: "0", jeonsePrice: "50000", monthlyRent: "1000/50", source: "",
  });
  assert.equal(source.building_name, " 테스트 ");
});

test("listing memos, customer information, work content and identifiers never leak into the new property draft", () => {
  const draft = propertyFromListing({
    ...source,
    source_notes: "PRIVATE original source memo",
    notes: "PRIVATE listing history",
    customer_id: "PRIVATE customer ID",
    customer_name: "PRIVATE customer name",
    work_type: "PRIVATE previous work type",
    content: "PRIVATE old consultation",
  });
  assert.equal(draft.source, "");
  assert.equal(Object.keys(draft).length, 9);
  assert.doesNotMatch(JSON.stringify(draft), /PRIVATE|existing-listing-id|identity_key|customer|work_type|content/);
});

test("only an actual source value can fill the property source, not source_notes", () => {
  assert.equal(propertyFromListing({ ...source, source: " 직접 받은 업소 ", source_notes: "unrelated" }).source, "직접 받은 업소");
  assert.equal(propertyFromListing({ id: "empty", identity_key: "empty", property_type: null, sale_price: null }).salePrice, "");
  assert.equal(propertyFromListing({ ...source, sale_price: Number.NaN }).salePrice, "");
});

test("any entered property field requires overwrite confirmation, including price/source-only drafts", () => {
  const blank = propertyFromListing({ id: "empty", identity_key: "empty" });
  assert.equal(hasPropertyDraft(blank), false);
  for (const field of Object.keys(blank)) {
    assert.equal(hasPropertyDraft({ ...blank, [field]: "입력값" }), true, field);
  }
  assert.equal(hasPropertyDraft({ source: "메모만 입력됨" }), true);
  assert.equal(hasPropertyDraft({ monthlyRent: 0 }), true);
  assert.equal(hasPropertyDraft({ buildingName: "  ", salePrice: null }), false);
});

test("listing picker uses the existing active/all filters, natural building order, and safely encoded query", () => {
  const active = new URL(listingPickerQueryUrl(" 건물 &/호수 ", false), "https://test.invalid");
  assert.equal(active.pathname, "/api/listings");
  assert.equal(active.searchParams.get("q"), "건물 &/호수");
  assert.equal(active.searchParams.get("state"), "active");
  assert.equal(active.searchParams.get("sort"), "building");
  const all = new URL(listingPickerQueryUrl("", true), active);
  assert.equal(all.searchParams.get("state"), "all");
});

test("inline picker is read-only, limits rendered results, and Enter search cannot submit the work form", async () => {
  const picker = await readFile(new URL("../app/listing-picker.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(picker, /<Modal|<form|method:\s*["'](?:POST|PUT|PATCH|DELETE)|window\.location/);
  for (const button of picker.matchAll(/<button\b[\s\S]*?>/g)) assert.match(button[0], /type="button"/);
  assert.match(picker, /event\.key === "Enter"\) event\.preventDefault\(\)/);
  assert.match(picker, /query\.trim\(\) \? 250 : 0/);
  assert.match(picker, /rows\.slice\(0, visibleCount\)/);
  assert.match(picker, /key=\{url\}/);
  assert.match(picker, /scope\.dispose\(\)/);
  assert.match(picker, /listing\.closed_at != null/);
  assert.doesNotMatch(picker, /listing\.(?:source_notes|notes|customer_id|content)/);
});
