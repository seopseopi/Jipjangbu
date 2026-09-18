import type { DeletionEntityType, DeletionPreview, DeletionResult, RestoreResult, TrashDetailResponse, TrashItem, TrashListResponse } from "../app/deletion-types";
import { listingKey, listingRebuildStatements } from "./listing-sync";

type Row = Record<string, string | number | null>;
type Snapshot = { work?: Row; customer?: Row | null; followup?: Row; details?: Row[]; events?: Row[]; listings?: Row[]; relatedEvents?: Row[]; dependencies?: number };
type StoredTrash = { id: string; entity_type: DeletionEntityType; entity_id: string; title: string; subtitle: string; search_text: string; snapshot: string; deleted_at: string };

const columns = {
  work_logs: "id legacy_id work_date customer_id work_type content is_demo created_at updated_at".split(" "),
  customers: "id name notes is_demo created_at updated_at".split(" "),
  work_log_properties: "id work_log_id sequence property_type building_name building_dong unit_number size_type sale_price jeonse_price monthly_rent source".split(" "),
  listing_events: "id listing_key work_log_id detail_id event_date event_order status property_type building_name building_dong unit_number size_type sale_price jeonse_price monthly_rent source notes is_demo created_at".split(" "),
  listings: "id identity_key registered_at closed_at status property_type building_name building_dong unit_number size_type sale_price jeonse_price monthly_rent notes source_notes is_demo updated_at".split(" "),
  follow_ups: "id title notes due_date customer_id listing_key completed_at created_at updated_at".split(" "),
} as const;
type Table = keyof typeof columns;
const objectSql = (table: Table, alias: string) => `json_object(${columns[table].map((column) => `'${column}', ${alias}.${column}`).join(",")})`;
const rowsSql = (table: Table, alias: string, condition: string, order = `${alias}.id`) =>
  `json((SELECT json_group_array(json(value)) FROM (SELECT ${objectSql(table, alias)} AS value FROM ${table} ${alias} WHERE ${condition} ORDER BY ${order})))`;
const affectedKeys = "SELECT listing_key FROM listing_events WHERE work_log_id = w.id";
const snapshots = {
  work: `SELECT json_object('work', ${objectSql("work_logs", "w")},
    'customer', (SELECT ${objectSql("customers", "c")} FROM customers c WHERE c.id = w.customer_id),
    'details', ${rowsSql("work_log_properties", "p", "p.work_log_id = w.id", "p.sequence, p.id")},
    'events', ${rowsSql("listing_events", "e", "e.work_log_id = w.id")},
    'listings', ${rowsSql("listings", "l", `l.identity_key IN (${affectedKeys})`)},
    'relatedEvents', ${rowsSql("listing_events", "r", `r.listing_key IN (${affectedKeys})`)}) AS snapshot
    FROM work_logs w WHERE w.id = ?`,
  customer: `SELECT json_object('customer', ${objectSql("customers", "c")}, 'dependencies',
    (SELECT COUNT(*) FROM work_logs WHERE customer_id = c.id)
    + (SELECT COUNT(*) FROM follow_ups WHERE customer_id = c.id)
    + (SELECT COUNT(*) FROM trash_records WHERE
      (entity_type = 'work' AND json_extract(snapshot, '$.work.customer_id') = c.id)
      OR (entity_type = 'followup' AND json_extract(snapshot, '$.followup.customer_id') = c.id))) AS snapshot
    FROM customers c WHERE c.id = ?`,
  followup: `SELECT json_object('followup', ${objectSql("follow_ups", "f")},
    'customer', (SELECT ${objectSql("customers", "c")} FROM customers c WHERE c.id = f.customer_id),
    'listings', ${rowsSql("listings", "l", "l.identity_key = f.listing_key")}) AS snapshot
    FROM follow_ups f WHERE f.id = ?`,
};

export class DeletionError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "DeletionError"; }
}

export function deletionType(value: unknown): DeletionEntityType {
  if (value !== "work" && value !== "customer" && value !== "followup") throw new DeletionError("삭제할 항목의 종류를 확인해 주세요.");
  return value;
}

async function readSnapshot(db: D1Database, type: DeletionEntityType, id: string) {
  if (!id || id.length > 1000) throw new DeletionError("삭제할 항목을 확인해 주세요.");
  const result = await db.prepare(snapshots[type]).bind(id).first<{ snapshot: string }>();
  if (!result) throw new DeletionError("이미 삭제되었거나 찾을 수 없는 항목입니다.", 404);
  return { raw: result.snapshot, value: JSON.parse(result.snapshot) as Snapshot };
}

async function fingerprint(raw: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const text = (value: unknown) => value == null ? "" : String(value);
const address = (row: Row) => [row.building_name, row.building_dong && `${row.building_dong}동`, row.unit_number && `${row.unit_number}호`].filter(Boolean).join(" ");
function previewFor(type: DeletionEntityType, id: string, snapshot: Snapshot, revision: string): DeletionPreview {
  const row = snapshot.work ?? snapshot.followup ?? snapshot.customer!;
  const affected = type === "work" ? (snapshot.details ?? []).filter((detail) => detail.building_name).map((detail) => ({
    key: listingKey({ propertyType: text(detail.property_type), buildingName: text(detail.building_name), buildingDong: text(detail.building_dong), unitNumber: text(detail.unit_number) }), label: address(detail),
  })) : (snapshot.listings ?? []).map((listing) => ({ key: text(listing.identity_key), label: address(listing) }));
  const affectedListings = [...new Map(affected.map((listing) => [listing.key, listing])).values()];
  const warnings = ["휴지통에 보관되며, 필요하면 다시 복구할 수 있습니다."];
  if (type === "work") {
    warnings.push("고객 자체와 다른 업무는 삭제하지 않습니다.");
    if (affectedListings.length) warnings.push("이 업무에 연결된 모든 매물 이력이 함께 제거됩니다. 일부 물건만 빼려면 업무 수정에서 ‘이 물건 빼기’를 사용해 주세요.");
    if ((snapshot.events ?? []).some((event) => !(snapshot.relatedEvents ?? []).some((other) => other.listing_key === event.listing_key && other.work_log_id !== id))) warnings.push("마지막 업무 이력이 없어지는 매물은 매물 목록에서도 사라집니다.");
  }
  const blockedReason = type === "customer" && snapshot.dependencies
    ? "연결된 업무·할 일 또는 휴지통의 복구 대기 기록이 있어 고객을 삭제할 수 없습니다. 연결된 기록을 먼저 확인해 주세요." : null;
  return {
    type, id, title: type === "work" ? `${text(snapshot.customer?.name) || "고객"} · ${text(row.work_type)}` : text(row.title ?? row.name),
    subtitle: type === "work" ? text(row.work_date) : type === "followup" ? `${row.due_date ? `기한 ${row.due_date}` : "기한 없음"}${row.completed_at ? " · 완료" : " · 진행 중"}` : "고객 정보",
    content: text(row.content ?? row.notes), affectedListings, warnings, blockedReason, revision,
  };
}

export async function getDeletionPreview(db: D1Database, type: DeletionEntityType, id: string): Promise<DeletionPreview> {
  const snapshot = await readSnapshot(db, type, id);
  return previewFor(type, id, snapshot.value, await fingerprint(snapshot.raw));
}

/** Remove only dated source entries attributable to deleted events. Preserve every unrelated byte. */
function pruneSource(source: string, removed: Row[], surviving: Row[]): string {
  const compact = (value: unknown) => text(value).replace(/\s+/gu, "");
  let cursor = 0;
  let output = "";
  for (const match of source.matchAll(/\(([^()\r\n]+)\)\s*\((\d{4}-\d{2}-\d{2})\)/g)) {
    const end = match.index + match[0].length;
    const segment = source.slice(cursor, end);
    const content = compact(source.slice(cursor, match.index));
    const matches = (event: Row) => event.event_date === match[2] && compact(event.status) === compact(match[1]);
    const deleted = removed.filter(matches), active = surviving.filter(matches);
    const covered = (event: Row) => !content || compact(event.notes).includes(content);
    const remove = deleted.some(covered) && !active.some(covered);
    if (!remove) {
      // A source-only note may precede the work memo. Match a whole line suffix
      // rather than discarding an unrelated prefix on date/status alone.
      const body = source.slice(cursor, match.index);
      let keptPrefix: string | null = null;
      for (const boundary of body.matchAll(/\r?\n/g)) {
        const start = boundary.index + boundary[0].length;
        const suffix = compact(body.slice(start));
        if (suffix && deleted.some((event) => compact(event.notes).includes(suffix))
          && !active.some((event) => compact(event.notes).includes(suffix))) {
          keptPrefix = body.slice(0, start);
          break;
        }
      }
      output += keptPrefix ?? segment;
    }
    cursor = end;
  }
  return output + source.slice(cursor);
}

const conflictMessage = "확인한 뒤 기록이 변경되었습니다. 창을 닫고 최신 내용을 다시 확인해 주세요.";
function constraintError(error: unknown) { return /constraint|NOT NULL|UNIQUE|FOREIGN KEY/i.test(String(error)); }

export async function moveToTrash(db: D1Database, type: DeletionEntityType, id: string, revision: unknown): Promise<DeletionResult> {
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new DeletionError("삭제할 내용을 먼저 확인해 주세요.");
  const { raw, value } = await readSnapshot(db, type, id);
  if (await fingerprint(raw) !== revision) throw new DeletionError(conflictMessage, 409);
  const preview = previewFor(type, id, value, revision);
  if (preview.blockedReason) throw new DeletionError(preview.blockedReason, 409);
  const trashId = crypto.randomUUID();
  // The NOT NULL constraint makes a stale snapshot abort the entire batch, not
  // just skip a row. This closes the read→write race, including same-second edits.
  const statements = [db.prepare(`INSERT INTO trash_records (id, entity_type, entity_id, title, subtitle, search_text, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, CASE WHEN (${snapshots[type]}) = ? THEN ? ELSE NULL END)`)
    .bind(trashId, type, id, preview.title, preview.subtitle, `${preview.title}\n${preview.subtitle}\n${preview.content}\n${preview.affectedListings.map((listing) => listing.label).join("\n")}`, id, raw, raw)];
  if (type === "work") {
    statements.push(db.prepare("DELETE FROM listing_events WHERE work_log_id = ?").bind(id),
      db.prepare("DELETE FROM work_log_properties WHERE work_log_id = ?").bind(id), db.prepare("DELETE FROM work_logs WHERE id = ?").bind(id));
    for (const listing of value.listings ?? []) {
      const key = text(listing.identity_key);
      const source = pruneSource(text(listing.source_notes), (value.events ?? []).filter((event) => event.listing_key === key), (value.relatedEvents ?? []).filter((event) => event.listing_key === key && event.work_log_id !== id));
      statements.push(db.prepare("UPDATE listings SET source_notes = ? WHERE identity_key = ?").bind(source, key));
    }
    statements.push(...listingRebuildStatements((value.events ?? []).map((event) => text(event.listing_key)), db));
  } else statements.push(db.prepare(`DELETE FROM ${type === "customer" ? "customers" : "follow_ups"} WHERE id = ?`).bind(id));
  try { await db.batch(statements); }
  catch (error) { if (constraintError(error)) throw new DeletionError(conflictMessage, 409); throw error; }
  return { ok: true, trashId };
}

export async function readDeletionRevision(request: Request): Promise<unknown> {
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body");
    return (body as { revision?: unknown }).revision;
  } catch { throw new DeletionError("삭제할 내용을 먼저 확인해 주세요."); }
}

const trashItem = (row: StoredTrash): TrashItem => ({ id: row.id, type: row.entity_type, entityId: row.entity_id, title: row.title, subtitle: row.subtitle, deletedAt: row.deleted_at });

export async function getTrash(db: D1Database, params: URLSearchParams): Promise<TrashListResponse> {
  const allowed = new Set(["type", "q", "limit", "offset"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length > 1) throw new DeletionError("휴지통 검색 조건을 확인해 주세요.");
  const type = params.has("type") ? deletionType(params.get("type")) : null;
  const q = params.get("q")?.trim() ?? "";
  if (q.length > 200) throw new DeletionError("검색어는 200자 이내로 입력해 주세요.");
  const number = (key: string, fallback: number, max: number, min: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw new DeletionError("휴지통 조회 범위를 확인해 주세요.");
    return Number(raw);
  };
  const limit = number("limit", 50, 100, 1), offset = number("offset", 0, Number.MAX_SAFE_INTEGER, 0);
  const conditions: string[] = [], bindings: string[] = [];
  if (type) { conditions.push("entity_type = ?"); bindings.push(type); }
  if (q) { conditions.push("search_text LIKE ? ESCAPE '\\'"); bindings.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [records, count] = await db.batch([
    db.prepare(`SELECT id, entity_type, entity_id, title, subtitle, deleted_at FROM trash_records ${where} ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM trash_records ${where}`).bind(...bindings),
  ]);
  return { items: (records.results as StoredTrash[]).map(trashItem), total: Number((count.results[0] as { total?: number } | undefined)?.total ?? 0), limit, offset };
}

async function trashRecord(db: D1Database, id: string) {
  const record = await db.prepare("SELECT * FROM trash_records WHERE id = ?").bind(id).first<StoredTrash>();
  if (!record) throw new DeletionError("이미 복구되었거나 찾을 수 없는 항목입니다.", 404);
  return record;
}

export async function getTrashDetail(db: D1Database, id: string): Promise<TrashDetailResponse> {
  const record = await trashRecord(db, id);
  const preview = previewFor(record.entity_type, record.entity_id, JSON.parse(record.snapshot), await fingerprint(JSON.stringify(record)));
  preview.warnings = ["삭제 전 업무일·내용·연결 관계로 복구합니다. 다른 기록은 덮어쓰지 않습니다."];
  preview.blockedReason = null;
  return { item: trashItem(record), preview };
}

/** Permanently remove only the archived entry. Live entities are never touched. */
export async function permanentlyDeleteTrash(db: D1Database, id: string, revision: unknown) {
  const record = await trashRecord(db, id);
  if (typeof revision !== "string" || revision !== await fingerprint(JSON.stringify(record))) {
    throw new DeletionError("삭제할 기록을 다시 확인해 주세요. 확인 후 내용이 변경되었을 수 있습니다.", 409);
  }
  const result = await db.prepare("DELETE FROM trash_records WHERE id = ? AND snapshot = ? AND deleted_at = ?")
    .bind(id, record.snapshot, record.deleted_at).run();
  if (result.meta.changes !== 1) throw new DeletionError("이미 복구 또는 삭제된 기록입니다. 휴지통을 다시 확인해 주세요.", 409);
  return { ok: true, trashId: id };
}

function insertRow(db: D1Database, table: Table, row: Row, guard?: { sql: string; bindings: (string | number | null)[] }) {
  const names = columns[table];
  const guardedColumn = table === "work_logs" ? "content" : table === "customers" ? "name" : "title";
  const bindings: (string | number | null)[] = [];
  const values = names.map((column) => {
    if (guard && column === guardedColumn) { bindings.push(...guard.bindings, row[column]); return `CASE WHEN ${guard.sql} THEN ? ELSE NULL END`; }
    bindings.push(row[column]); return "?";
  });
  return db.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${values.join(",")})`).bind(...bindings);
}

export async function restoreTrash(db: D1Database, id: string): Promise<RestoreResult> {
  const record = await trashRecord(db, id);
  const snapshot = JSON.parse(record.snapshot) as Snapshot;
  const type = record.entity_type, table: Table = type === "work" ? "work_logs" : type === "customer" ? "customers" : "follow_ups";
  const row = snapshot.work ?? snapshot.followup ?? snapshot.customer!;
  const customerId = text(row.customer_id);
  const keys = [...new Set((snapshot.events ?? []).map((event) => text(event.listing_key)))];
  // Only affected listings' pending events are needed. Keep unrelated archived
  // snapshots out of this context as the long-lived trash grows.
  const pendingCondition = keys.length ? `entity_type = 'work' AND EXISTS (
    SELECT 1 FROM json_each(trash_records.snapshot, '$.events') archived_event
    WHERE json_extract(archived_event.value, '$.listing_key') IN (${keys.map(() => "?").join(",")})
  )` : "0";
  const contextSql = `SELECT json_object('trash', (SELECT snapshot FROM trash_records WHERE id = ?),
    'occupied', (SELECT COUNT(*) FROM ${table} WHERE id = ?),
    'customer', (SELECT ${objectSql("customers", "c")} FROM customers c WHERE c.id = ?),
    'listings', ${rowsSql("listings", "l", keys.length ? `l.identity_key IN (${keys.map(() => "?").join(",")})` : "0")},
    'events', ${rowsSql("listing_events", "e", keys.length ? `e.listing_key IN (${keys.map(() => "?").join(",")})` : "0")},
    'pending', json((SELECT json_group_array(json_object('id', id, 'events', json_extract(snapshot, '$.events'))) FROM (SELECT id, snapshot FROM trash_records WHERE ${pendingCondition} ORDER BY id)))) AS state`;
  const contextBindings = [id, record.entity_id, customerId, ...keys, ...keys, ...keys];
  const context = await db.prepare(contextSql).bind(...contextBindings).first<{ state: string }>();
  const state = JSON.parse(context!.state) as { trash: string | null; occupied: number; customer: Row | null; listings: Row[]; events: Row[]; pending: { id: string; events: Row[] }[] };
  if (state.trash !== record.snapshot) throw new DeletionError("이미 복구되었거나 변경된 항목입니다. 휴지통을 다시 확인해 주세요.", 409);
  if (state.occupied) throw new DeletionError("같은 ID의 자료가 이미 있어 복구하지 않았습니다. 현재 기록을 확인해 주세요.", 409);
  if (customerId && !state.customer) throw new DeletionError("연결된 고객이 없어 복구할 수 없습니다. 고객 정보를 먼저 확인해 주세요.", 409);
  const guard = { sql: `(${contextSql}) = ?`, bindings: [...contextBindings, context!.state] };
  const statements = [insertRow(db, table, row, guard)];
  if (type === "work") {
    for (const detail of snapshot.details ?? []) statements.push(insertRow(db, "work_log_properties", detail));
    for (const event of snapshot.events ?? []) statements.push(insertRow(db, "listing_events", event));
    for (const original of snapshot.listings ?? []) {
      const key = text(original.identity_key), current = state.listings.find((listing) => listing.identity_key === key);
      const stillDeleted = state.pending.filter((pending) => pending.id !== id).flatMap((pending) => pending.events ?? []).filter((event) => event.listing_key === key);
      const activeEvents = [...state.events.filter((event) => event.listing_key === key), ...(snapshot.events ?? []).filter((event) => event.listing_key === key)];
      const restoredSource = pruneSource(text(original.source_notes), stillDeleted, activeEvents);
      const currentSource = text(current?.source_notes);
      // Retain newer source-only notes. Merge only missing dated entries/text,
      // never replace an existing listing's source with the older full snapshot.
      let source = current ? currentSource : restoredSource;
      if (current && restoredSource.trim()) {
        let cursor = 0;
        for (const match of restoredSource.matchAll(/\([^()\r\n]+\)\s*\(\d{4}-\d{2}-\d{2}\)/g)) {
          const end = match.index + match[0].length, segment = restoredSource.slice(cursor, end);
          if (segment.trim() && !source.includes(segment.trim())) source += `${source.trim() ? "\n" : ""}${segment.trim()}`;
          cursor = end;
        }
        const tail = restoredSource.slice(cursor);
        if (tail.trim() && !source.includes(tail.trim())) source += `${source.trim() ? "\n" : ""}${tail.trim()}`;
      }
      if (current) statements.push(db.prepare("UPDATE listings SET source_notes = ? WHERE identity_key = ?").bind(source, key));
      else statements.push(insertRow(db, "listings", { ...original, source_notes: source }));
    }
    statements.push(...listingRebuildStatements(keys, db));
  }
  statements.push(db.prepare("DELETE FROM trash_records WHERE id = ?").bind(id));
  try { await db.batch(statements); }
  catch (error) { if (constraintError(error)) throw new DeletionError("다른 기기에서 자료가 변경되었거나 연결이 충돌하여 복구하지 않았습니다. 휴지통을 다시 확인해 주세요.", 409); throw error; }
  return { ok: true, type, entityId: record.entity_id };
}
