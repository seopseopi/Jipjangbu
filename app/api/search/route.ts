import { getD1 } from "../../../db";
import { WORK_SUMMARY_SQL } from "../_queries";
import { apiError, ready } from "../_shared";
import {
  CUSTOMER_LAST_WORK_DATE_SQL, CUSTOMER_RECENT_ORDER, CUSTOMER_SEARCH_RANK,
  escapedLike, LISTING_ACTIVE_ORDER, LISTING_COMBINED_NAME, LISTING_DISPLAY_NAME,
  LISTING_LAST_UPDATED_SQL, LISTING_LOCATION_ORDER, LISTING_SEARCH_RANK, WORK_RECENT_ORDER,
} from "../_ordering";

export async function GET(request: Request) {
  try {
    await ready();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!q) return Response.json({ workLogs: [], customers: [], listings: [] });

    const like = escapedLike(q);
    const prefix = escapedLike(q, true);
    const db = getD1();
    const [workLogs, customers, listings] = await Promise.all([
      db.prepare(`${WORK_SUMMARY_SQL}
        WHERE w.content LIKE ? ESCAPE '\\' OR w.work_type LIKE ? ESCAPE '\\'
          OR c.id LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM work_log_properties p
          WHERE p.work_log_id = w.id AND (
            p.property_type LIKE ? ESCAPE '\\' OR p.building_name LIKE ? ESCAPE '\\'
            OR p.building_dong LIKE ? ESCAPE '\\' OR p.unit_number LIKE ? ESCAPE '\\'
            OR p.source LIKE ? ESCAPE '\\'
          )
        )
        ORDER BY ${WORK_RECENT_ORDER}
        LIMIT 8
      `).bind(like, like, like, like, like, like, like, like, like).all(),
      db.prepare(`
        SELECT c.id, c.name, c.notes, c.created_at, c.updated_at, c.is_demo,
          COUNT(w.id) AS history_count, ${CUSTOMER_LAST_WORK_DATE_SQL} AS last_work_date
        FROM customers c
        LEFT JOIN work_logs w ON w.customer_id = c.id
        WHERE c.id LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\'
        GROUP BY c.id
        ORDER BY ${CUSTOMER_SEARCH_RANK}, ${CUSTOMER_RECENT_ORDER}
        LIMIT 8
      `).bind(like, like, like, q, q, prefix, prefix).all(),
      db.prepare(`
        SELECT * FROM listings
        WHERE property_type LIKE ? ESCAPE '\\' OR building_name LIKE ? ESCAPE '\\'
          OR building_dong LIKE ? ESCAPE '\\' OR unit_number LIKE ? ESCAPE '\\'
          OR status LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR source_notes LIKE ? ESCAPE '\\'
          OR ${LISTING_COMBINED_NAME} LIKE ? ESCAPE '\\' OR ${LISTING_DISPLAY_NAME} LIKE ? ESCAPE '\\'
        ORDER BY ${LISTING_SEARCH_RANK}, ${LISTING_ACTIVE_ORDER}, ${LISTING_LAST_UPDATED_SQL} DESC, ${LISTING_LOCATION_ORDER}
        LIMIT 8
      `).bind(like, like, like, like, like, like, like, like, like,
        q, q, q, q, prefix, prefix, prefix, prefix).all(),
    ]);

    return Response.json({
      workLogs: workLogs.results,
      customers: customers.results,
      listings: listings.results,
    });
  } catch (error) {
    return apiError(error, "통합검색 결과를 불러오지 못했습니다.");
  }
}
