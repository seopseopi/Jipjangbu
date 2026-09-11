// These SQL fragments are fixed application choices. Never accept a column or
// ORDER BY expression directly from a request parameter.
export const CUSTOMER_LAST_WORK_DATE_SQL =
  "MAX(CASE WHEN w.work_date <= date('now','+9 hours') THEN w.work_date END)";

export const CUSTOMER_NAME_ORDER = "c.name COLLATE NOCASE, c.id";
export const CUSTOMER_RECENT_ORDER =
  `COALESCE(${CUSTOMER_LAST_WORK_DATE_SQL}, date(c.created_at,'+9 hours'), '1900-01-01') DESC, ${CUSTOMER_NAME_ORDER}`;
export const CUSTOMER_HISTORY_ORDER = `COUNT(w.id) DESC, ${CUSTOMER_RECENT_ORDER}`;

function naturalNumberOrder(column: "building_dong" | "unit_number") {
  const value = `trim(COALESCE(${column}, ''))`;
  return `${value} = '', CASE WHEN ${value} GLOB '[0-9]*' THEN 0 ELSE 1 END,
    CASE WHEN ${value} GLOB '[0-9]*' THEN CAST(${value} AS INTEGER) END,
    ${value} COLLATE NOCASE`;
}

export const LISTING_LOCATION_ORDER = `building_name COLLATE NOCASE,
  ${naturalNumberOrder("building_dong")}, ${naturalNumberOrder("unit_number")}, id`;
export const LISTING_ACTIVE_ORDER = "CASE WHEN closed_at IS NULL THEN 0 ELSE 1 END";
export const LISTING_LAST_UPDATED_SQL = "COALESCE(NULLIF(updated_at, ''), NULLIF(registered_at, ''), '1900-01-01')";
export const LISTING_BUILDING_ORDER = `${LISTING_ACTIVE_ORDER}, ${LISTING_LOCATION_ORDER}`;
export const LISTING_RECENT_ORDER = `${LISTING_ACTIVE_ORDER}, registered_at DESC, ${LISTING_LOCATION_ORDER}`;
export const LISTING_UPDATED_ORDER = `${LISTING_ACTIVE_ORDER}, ${LISTING_LAST_UPDATED_SQL} DESC, ${LISTING_LOCATION_ORDER}`;
export const LISTING_OLDEST_ORDER = `${LISTING_ACTIVE_ORDER}, ${LISTING_LAST_UPDATED_SQL}, ${LISTING_LOCATION_ORDER}`;

export const HOME_TODAY_ORDER = "w.updated_at DESC, w.id DESC";
export const HOME_RECENT_WHERE = "w.work_date <= date('now','+9 hours')";
export const WORK_RECENT_ORDER = "w.work_date DESC, w.updated_at DESC, w.id DESC";
export const HOME_UPCOMING_ORDER = "w.work_date, w.created_at, w.id";

export function escapedLike(value: string, prefixOnly = false): string {
  const literal = value.replace(/[\\%_]/g, "\\$&");
  return prefixOnly ? `${literal}%` : `%${literal}%`;
}

export const CUSTOMER_SEARCH_RANK = `CASE
  WHEN c.id = ? COLLATE NOCASE OR c.name = ? COLLATE NOCASE THEN 0
  WHEN c.id LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' THEN 1
  ELSE 2 END`;

export const LISTING_COMBINED_NAME = "trim(building_name || ' ' || unit_number)";
export const LISTING_DISPLAY_NAME = `trim(building_name
  || CASE WHEN building_dong <> '' THEN ' ' || building_dong || '동' ELSE '' END
  || CASE WHEN unit_number <> '' THEN ' ' || unit_number || '호' ELSE '' END)`;
export const LISTING_SEARCH_RANK = `CASE
  WHEN building_name = ? COLLATE NOCASE OR unit_number = ? COLLATE NOCASE
    OR ${LISTING_COMBINED_NAME} = ? COLLATE NOCASE OR ${LISTING_DISPLAY_NAME} = ? COLLATE NOCASE THEN 0
  WHEN building_name LIKE ? ESCAPE '\\' OR unit_number LIKE ? ESCAPE '\\'
    OR ${LISTING_COMBINED_NAME} LIKE ? ESCAPE '\\' THEN 1
  WHEN ${LISTING_DISPLAY_NAME} LIKE ? ESCAPE '\\' THEN 2
  ELSE 3 END`;
