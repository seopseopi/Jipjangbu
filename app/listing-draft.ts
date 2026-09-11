type ListingValue = string | number | null;

export type ListingDraftSource = {
  id: string;
  identity_key: string;
  property_type?: ListingValue;
  building_name?: ListingValue;
  building_dong?: ListingValue;
  unit_number?: ListingValue;
  size_type?: ListingValue;
  sale_price?: ListingValue;
  jeonse_price?: ListingValue;
  monthly_rent?: ListingValue;
  source?: ListingValue;
  status?: string | null;
  closed_at?: string | null;
};

export type ListingPropertyDraft = {
  propertyType: string;
  buildingName: string;
  buildingDong: string;
  unitNumber: string;
  sizeType: string;
  salePrice: string;
  jeonsePrice: string;
  monthlyRent: string;
  source: string;
};

const propertyFields = [
  "propertyType",
  "buildingName",
  "buildingDong",
  "unitNumber",
  "sizeType",
  "salePrice",
  "jeonsePrice",
  "monthlyRent",
  "source",
] as const;

function clean(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Copy property facts only, never a customer, work ID, content or listing memo. */
export function propertyFromListing(source: ListingDraftSource): ListingPropertyDraft {
  return {
    propertyType: clean(source.property_type),
    buildingName: clean(source.building_name),
    buildingDong: clean(source.building_dong),
    unitNumber: clean(source.unit_number),
    sizeType: clean(source.size_type),
    salePrice: clean(source.sale_price),
    jeonsePrice: clean(source.jeonse_price),
    monthlyRent: clean(source.monthly_rent),
    // The current listings table has no source field. source_notes is a memo,
    // not a property source, and must never be substituted for it.
    source: clean(source.source),
  };
}

export function hasPropertyDraft(
  detail: Partial<Record<keyof ListingPropertyDraft, unknown>>,
): boolean {
  return propertyFields.some((field) => clean(detail[field]) !== "");
}

export function listingPickerQueryUrl(query: string, includeClosed: boolean): string {
  const params = new URLSearchParams({
    q: query.trim(),
    state: includeClosed ? "all" : "active",
    sort: "building",
  });
  return `/api/listings?${params}`;
}
