import type { WorkPropertySummary } from "./work-property-summary";

export function getPropertyDisplayGroups(properties: WorkPropertySummary[]): Array<{
  key: string;
  building: string;
  items: Array<{ property: WorkPropertySummary; index: number; shortLabel: string }>;
}> {
  const groups: Array<{
    key: string;
    building: string;
    items: Array<{ property: WorkPropertySummary; index: number; shortLabel: string }>;
  }> = [];
  properties.forEach((property, index) => {
    const building = property.building_name.trim();
    const type = property.property_type.trim();
    const dong = property.building_dong.trim();
    const unit = property.unit_number.trim();
    const shortLabel = [dong ? `${dong.replace(/동$/, "")}동` : "", unit ? `${unit.replace(/호$/, "")}호` : ""].filter(Boolean).join(" ")
      || building || type || "물건 정보 없음";
    const previous = groups[groups.length - 1];
    // A later revisit to the same building is a separate group: the stored
    // order must remain the visible and assistive-technology reading order.
    if (building && previous?.building === building && previous.items[0].property.property_type.trim() === type) {
      previous.items.push({ property, index, shortLabel });
    } else {
      groups.push({ key: `${index}|${type}|${building}`, building, items: [{ property, index, shortLabel }] });
    }
  });
  return groups;
}
