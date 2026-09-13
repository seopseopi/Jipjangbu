export type WorkPropertySummary = {
  id: string;
  sequence: number;
  property_type: string;
  building_name: string;
  building_dong: string;
  unit_number: string;
  size_type: string;
  sale_price: string;
  jeonse_price: string;
  monthly_rent: string;
  source: string;
};

type WorkWithProperties = Partial<Omit<WorkPropertySummary, "id" | "sequence">> & {
  properties_json?: string;
  property_count?: number;
};

const textFields = [
  "property_type", "building_name", "building_dong", "unit_number", "size_type",
  "sale_price", "jeonse_price", "monthly_rent", "source",
] as const;

function propertySummary(value: Record<string, unknown>, index: number): WorkPropertySummary {
  const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
  return {
    id: text(value.id),
    sequence: Number.isFinite(Number(value.sequence)) ? Number(value.sequence) : index + 1,
    ...Object.fromEntries(textFields.map((field) => [field, text(value[field])])),
  } as WorkPropertySummary;
}

/** The server supplies every property in its original sequence, independently of the search match. */
export function getWorkProperties(work: WorkWithProperties): WorkPropertySummary[] {
  if (work.properties_json) {
    try {
      const parsed: unknown = JSON.parse(work.properties_json);
      if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        return parsed.map((item, index) => propertySummary(item, index));
      }
    } catch {
      // An older cached response can still display its representative property.
    }
  }
  if (textFields.some((field) => String(work[field] ?? "").trim())) {
    return [propertySummary(work, 0)];
  }
  return [];
}

export function workPropertyLabel(property: Partial<WorkPropertySummary>): string {
  const building = String(property.building_name || "").trim();
  const dong = String(property.building_dong || "").trim();
  const unit = String(property.unit_number || "").trim();
  return [building, dong ? `${dong.replace(/동$/, "")}동` : "", unit ? `${unit.replace(/호$/, "")}호` : ""]
    .filter(Boolean).join(" ") || "물건 정보 없음";
}
