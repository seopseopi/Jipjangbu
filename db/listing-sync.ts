import { getD1 } from ".";

export type PropertyInput = {
  propertyType?: string;
  buildingName?: string;
  buildingDong?: string;
  unitNumber?: string;
  sizeType?: string;
  salePrice?: string;
  jeonsePrice?: string;
  monthlyRent?: string;
  source?: string;
};

export const LISTING_WORK_TYPES = new Set([
  "매물등록", "매물수정", "타계약확인", "매물취소", "가계약", "계약서작성",
  "중도금", "잔금", "계약파기", "계약취소", "경매확인",
]);

const ACTIVE_WORK_TYPES = new Set(["매물등록", "매물수정"]);

export function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function listingKey(detail: PropertyInput): string {
  return [detail.propertyType, detail.buildingName, detail.buildingDong, detail.unitNumber]
    .map((value) => clean(value).toLocaleLowerCase("ko-KR"))
    .join("|");
}

export function isPropertyComplete(detail: PropertyInput): boolean {
  return Boolean(clean(detail.propertyType) && clean(detail.buildingName) && clean(detail.unitNumber));
}

export async function rebuildListings(keys: Iterable<string>) {
  const db = getD1();
  for (const key of new Set([...keys].filter(Boolean))) {
    const latest = await db.prepare(`
      SELECT * FROM listing_events
      WHERE listing_key = ?
      ORDER BY event_date DESC, event_order DESC, created_at DESC, id DESC
      LIMIT 1
    `).bind(key).first<Record<string, string | number | null>>();

    if (!latest) {
      await db.prepare("DELETE FROM listings WHERE identity_key = ?").bind(key).run();
      continue;
    }

    const [firstRegistration, history, existingListing] = await Promise.all([
      db.prepare(`
        SELECT MIN(event_date) AS registered_at
        FROM listing_events
        WHERE listing_key = ? AND status = '매물등록'
      `).bind(key).first<{ registered_at: string | null }>(),
      db.prepare(`
        SELECT event_date, event_order, status, notes FROM listing_events
        WHERE listing_key = ?
        ORDER BY event_date DESC, event_order DESC, created_at DESC, id DESC
      `).bind(key).all<{ event_date: string; event_order: number; status: string; notes: string }>(),
      db.prepare("SELECT source_notes FROM listings WHERE identity_key = ?")
        .bind(key).first<{ source_notes: string }>(),
    ]);

    const registeredAt = firstRegistration?.registered_at ?? latest.event_date;
    const closedAt = ACTIVE_WORK_TYPES.has(String(latest.status)) ? null : latest.event_date;
    const eventNotes = history.results
      .map((event) => `${event.notes || ""} (${event.status}) (${event.event_date})`.trim())
      .join("\n");
    const sourceNotes = existingListing?.source_notes ?? "";
    const notes = [sourceNotes, eventNotes].filter(Boolean).join("\n");

    await db.prepare(`
      INSERT INTO listings (
        id, identity_key, registered_at, closed_at, status, property_type, building_name,
        building_dong, unit_number, size_type, sale_price, jeonse_price, monthly_rent,
        notes, source_notes, is_demo, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(identity_key) DO UPDATE SET
        registered_at = excluded.registered_at,
        closed_at = excluded.closed_at,
        status = excluded.status,
        property_type = excluded.property_type,
        building_name = excluded.building_name,
        building_dong = excluded.building_dong,
        unit_number = excluded.unit_number,
        size_type = excluded.size_type,
        sale_price = excluded.sale_price,
        jeonse_price = excluded.jeonse_price,
        monthly_rent = excluded.monthly_rent,
        notes = excluded.notes,
        source_notes = excluded.source_notes,
        is_demo = excluded.is_demo,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      crypto.randomUUID(), key, registeredAt, closedAt, latest.status, latest.property_type,
      latest.building_name, latest.building_dong, latest.unit_number, latest.size_type,
      latest.sale_price, latest.jeonse_price, latest.monthly_rent, notes, sourceNotes, latest.is_demo,
    ).run();
  }
}
