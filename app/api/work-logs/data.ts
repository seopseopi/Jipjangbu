import { getD1 } from "../../../db";
import { clean, isPropertyComplete, listingKey, LISTING_WORK_TYPES, listingRebuildStatements, type PropertyInput } from "../../../db/listing-sync";
import { normalizeDate } from "../_shared";

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
  const [headers, details] = await db.batch([
    db.prepare(`
      SELECT w.*, c.name AS customer_name FROM work_logs w JOIN customers c ON c.id = w.customer_id WHERE w.id = ?
    `).bind(id),
    db.prepare(`SELECT ${detailColumns} FROM work_log_properties WHERE work_log_id = ? ORDER BY sequence`).bind(id),
  ]);
  const workLog = headers.results[0];
  if (!workLog) return null;
  return { ...workLog, details: details.results };
}

export async function saveWorkLog(payload: WorkLogPayload, existingId?: string) {
  const db = getD1();
  const workDate = normalizeDate(clean(payload.workDate));
  const customerId = clean(payload.customerId);
  const workType = clean(payload.workType);
  const content = clean(payload.content);
  const details = (Array.isArray(payload.details) ? payload.details : []).slice(0, 10).map((detail) => ({
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

  if (!workDate || !customerId || !workType) {
    throw new InputError("일자, 고객, 업무구분은 필수입니다.");
  }
  const [customer, validWorkType] = await Promise.all([
    db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first(),
    db.prepare("SELECT name FROM work_types WHERE name = ?").bind(workType).first(),
  ]);
  if (!customer) throw new InputError("먼저 고객을 등록해 주세요.");
  if (!validWorkType) throw new InputError("등록된 업무구분을 선택해 주세요.");
  if (LISTING_WORK_TYPES.has(workType) && (details.length === 0 || details.some((detail) => !isPropertyComplete(detail)))) {
    throw new InputError("매물 상태를 바꾸는 업무는 물건구분, 건물명, 호수를 입력해 주세요.");
  }

  const id = existingId ?? crypto.randomUUID();
  const affectedKeys = new Set<string>();
  const existingOrderBySequence = new Map<number, number>();
  let legacyId: number | null = null;

  if (existingId) {
    const [existingWork, existingEvents] = await Promise.all([
      db.prepare("SELECT legacy_id FROM work_logs WHERE id = ?").bind(existingId).first<{ legacy_id: number | null }>(),
      db.prepare(`
        SELECT e.listing_key, e.event_order, p.sequence
        FROM listing_events e
        LEFT JOIN work_log_properties p ON p.id = e.detail_id
        WHERE e.work_log_id = ?
      `).bind(existingId).all<{ listing_key: string; event_order: number; sequence: number | null }>(),
    ]);
    if (!existingWork) throw new InputError("수정할 업무를 찾을 수 없습니다.", 404);
    legacyId = existingWork.legacy_id;
    existingEvents.results.forEach((row) => {
      affectedKeys.add(row.listing_key);
      if (row.sequence != null) existingOrderBySequence.set(row.sequence, Number(row.event_order));
    });
  }

  const headerStatement = existingId
    ? db.prepare(`UPDATE work_logs SET work_date = ?, customer_id = ?, work_type = ?, content = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(workDate, customerId, workType, content, existingId)
    : db.prepare("INSERT INTO work_logs (id, work_date, customer_id, work_type, content, is_demo) VALUES (?, ?, ?, ?, ?, 0)")
      .bind(id, workDate, customerId, workType, content);
  const statements = [headerStatement];
  if (existingId) {
    statements.push(
      db.prepare("DELETE FROM listing_events WHERE work_log_id = ?").bind(existingId),
      db.prepare("DELETE FROM work_log_properties WHERE work_log_id = ?").bind(existingId),
    );
  }

  const generatedOrderBase = legacyId == null ? Date.now() * 100 : legacyId * 100;
  details.forEach((detail, index) => {
    const sequence = index + 1;
    const detailId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT INTO work_log_properties (
        id, work_log_id, sequence, property_type, building_name, building_dong, unit_number,
        size_type, sale_price, jeonse_price, monthly_rent, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      detailId, id, sequence, detail.propertyType, detail.buildingName, detail.buildingDong,
      detail.unitNumber, detail.sizeType, detail.salePrice, detail.jeonsePrice, detail.monthlyRent, detail.source,
    ));

    if (LISTING_WORK_TYPES.has(workType) && isPropertyComplete(detail)) {
      const key = listingKey(detail);
      affectedKeys.add(key);
      statements.push(db.prepare(`
        INSERT INTO listing_events (
          id, listing_key, work_log_id, detail_id, event_date, event_order, status, property_type, building_name,
          building_dong, unit_number, size_type, sale_price, jeonse_price, monthly_rent, source, notes, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(
        crypto.randomUUID(), key, id, detailId, workDate,
        existingOrderBySequence.get(sequence) ?? generatedOrderBase + sequence,
        workType, detail.propertyType, detail.buildingName,
        detail.buildingDong, detail.unitNumber, detail.sizeType, detail.salePrice, detail.jeonsePrice,
        detail.monthlyRent, detail.source, content,
      ));
    }
  });
  await db.batch([...statements, ...listingRebuildStatements(affectedKeys)]);
  return getWorkLog(id);
}

export async function removeWorkLog(id: string) {
  const db = getD1();
  const [workLog, existing] = await Promise.all([
    db.prepare("SELECT id FROM work_logs WHERE id = ?").bind(id).first(),
    db.prepare("SELECT listing_key FROM listing_events WHERE work_log_id = ?").bind(id).all<{ listing_key: string }>(),
  ]);
  if (!workLog) throw new InputError("삭제할 업무를 찾을 수 없습니다.", 404);
  const affectedKeys = new Set(existing.results.map((row) => row.listing_key));
  await db.batch([
    db.prepare("DELETE FROM listing_events WHERE work_log_id = ?").bind(id),
    db.prepare("DELETE FROM work_log_properties WHERE work_log_id = ?").bind(id),
    db.prepare("DELETE FROM work_logs WHERE id = ?").bind(id),
    ...listingRebuildStatements(affectedKeys),
  ]);
}

export class InputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
