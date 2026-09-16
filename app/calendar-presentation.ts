import { getWorkProperties, workPropertyLabel } from "./work-property-summary";

// Preserve the workbook's calendar distinction: listing/contract events lead
// with the home, while calls, visits, schedules, and new categories lead with the customer.
const PROPERTY_FOCUSED_TYPES = new Set([
  "매물등록", "매물수정", "매물취소", "가계약", "계약서작성", "잔금", "중도금",
  "계약취소", "타계약확인", "경매확인",
]);

type CalendarWork = Parameters<typeof getWorkProperties>[0] & {
  customer_id: string;
  customer_name: string;
  work_type: string;
};

export function calendarWorkPresentation(work: CalendarWork) {
  const customer = (work.customer_name || "").trim();
  const customerId = (work.customer_id || "").trim();
  const isBroker = customer.includes("부동산") && customer !== "부동산써브";
  const customerLabel = [isBroker ? customerId : "", customer || "고객 정보 없음"].filter(Boolean).join(" ");
  const properties = getWorkProperties(work).map((property, index) => ({
    ...property,
    key: property.id || `property-${index}`,
    label: workPropertyLabel(property, true),
  }));
  const propertyFocused = PROPERTY_FOCUSED_TYPES.has(work.work_type.trim()) && properties.length > 0;
  const entries = propertyFocused ? properties.map((property) => {
    if ((isBroker || customer === "자체결정") && customerId && customerId !== property.source.trim()) {
      return `${property.label} · 고객 ${customerId}`;
    }
    return property.label;
  }) : [customerLabel];
  return { propertyFocused, entries, customerLabel, properties };
}
