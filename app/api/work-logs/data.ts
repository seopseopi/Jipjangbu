import { getD1 } from "../../../db";
import { clean, isPropertyComplete, listingKey, LISTING_WORK_TYPES, PropertyInput, rebuildListings } from "../../../db/listing-sync";

export type WorkLogPayload = {
  workDate?: string;
  customerId?: string;
  workType?: string;
  content?: string;
  details?: PropertyInput[];
};

const detailColumns = `id, work_log_id, sequence, property_type, building_name, building_dong, unit_number,
  size_type, sale_price, jeonse_price, monthly_rent, source`;

export async function getWorkLog(id: string) {
  const db = getD1();
  const workLog = await db.prepare(`
    SELECT w.*, c.name AS customer_name FROM work_logs w JOIN customers c ON c.id = w.customer_id WHERE w.id = ?
  `).bind(id).first();
  if (!workLog) return null;
  const details = await db.prepare(`SELECT ${detailColumns} FROM work_log_properties WHERE work_log_id = ? ORDER BY sequence`)
    .bind(id).all();
  return { ...workLog, details: details.results };
}

export async function saveWorkLog(payload: WorkLogPayload, existingId?: string) {
  const db = getD1();
  const workDate = clean(payload.workDate);
  const customerId = clean(payload.customerId);
  const workType = clean(payload.workType);
  const content = clean(payload.content);
  const details = (payload.details ?? []).slice(0, 10).map((detail) => ({
    propertyType: clean(detail.propertyType),
    buildingName: clean(detail.buildingName),
    buildingDong: clean(detail.buildingDong),
    unitNumber: clean(detail.unitNumber),
    sizeType: clean(detail.sizeType),
    salePrice: clean(detail.salePrice),
    jeonsePrice: clean(detail.jeonsePrice),
    monthlyRent: clean(detail.monthlyRent),
    source: clean(detail.source),
  })).filter((detail) => Object.values(detail).some(Boolean));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !customerId || !workType) {
    throw new InputError("일자, 고객, 업무구분은 필수입니다.");
  }
  const customer = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
  if (!customer) throw new InputError("먼저 고객을 등록해 주세요.");
  if (LISTING_WORK_TYPES.has(workType) && details.some((detail) => !isPropertyComplete(detail))) {
    throw new InputError("매물 상태를 바꾸는 업무는 물건구분, 건물명, 호수를 입력해 주세요.");
  }

  const id = existingId ?? crypto.randomUUID();
  const affectedKeys = new Set<string>();

  if (existingId) {
    const existing = await db.prepare("SELECT listing_key FROM listing_events WHERE work_log_id = ?").bind(existingId).all<{ listing_key: string }>();
    existing.results.forEach((row) => affectedKeys.add(row.listing_key));
    const result = await db.prepare(`UPDATE work_logs SET work_date = ?, customer_id = ?, work_type = ?, content = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(workDate, customerId, workType, content, existingId).run();
    if (!result.meta.changes) throw new InputError("수정할 업무를 찾을 수 없습니다.", 404);
    await db.batch([
      db.prepare("DELETE FROM listing_events WHERE work_log_id = ?").bind(existingId),
      db.prepare("DELETE FROM work_log_properties WHERE work_log_id = ?").bind(existingId),
    ]);
  } else {
    await db.prepare("INSERT INTO work_logs (id, work_date, customer_id, work_type, content, is_demo) VALUES (?, ?, ?, ?, ?, 0)")
      .bind(id, workDate, customerId, workType, content).run();
  }

  const statements: D1PreparedStatement[] = [];
  details.forEach((detail, index) => {
    const detailId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT INTO work_log_properties (
        id, work_log_id, sequence, property_type, building_name, building_dong, unit_number,
        size_type, sale_price, jeonse_price, monthly_rent, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      detailId, id, index + 1, detail.propertyType, detail.buildingName, detail.buildingDong,
      detail.unitNumber, detail.sizeType, detail.salePrice, detail.jeonsePrice, detail.monthlyRent, detail.source,
    ));

    if (LISTING_WORK_TYPES.has(workType) && isPropertyComplete(detail)) {
      const key = listingKey(detail);
      affectedKeys.add(key);
      statements.push(db.prepare(`
        INSERT INTO listing_events (
          id, listing_key, work_log_id, detail_id, event_date, status, property_type, building_name,
          building_dong, unit_number, size_type, sale_price, jeonse_price, monthly_rent, source, notes, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(
        crypto.randomUUID(), key, id, detailId, workDate, workType, detail.propertyType, detail.buildingName,
        detail.buildingDong, detail.unitNumber, detail.sizeType, detail.salePrice, detail.jeonsePrice,
        detail.monthlyRent, detail.source, content,
      ));
    }
  });
  if (statements.length) await db.batch(statements);
  await rebuildListings(affectedKeys);
  return getWorkLog(id);
}

export async function removeWorkLog(id: string) {
  const db = getD1();
  const existing = await db.prepare("SELECT listing_key FROM listing_events WHERE work_log_id = ?").bind(id).all<{ listing_key: string }>();
  const affectedKeys = new Set(existing.results.map((row) => row.listing_key));
  const result = await db.prepare("DELETE FROM work_logs WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new InputError("삭제할 업무를 찾을 수 없습니다.", 404);
  await db.batch([
    db.prepare("DELETE FROM listing_events WHERE work_log_id = ?").bind(id),
    db.prepare("DELETE FROM work_log_properties WHERE work_log_id = ?").bind(id),
  ]);
  await rebuildListings(affectedKeys);
}

export class InputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
