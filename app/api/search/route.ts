import { getD1 } from "../../../db";
import { WORK_SUMMARY_SQL } from "../_queries";
import { apiError, ready } from "../_shared";

export async function GET(request: Request) {
  try {
    await ready();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!q) return Response.json({ workLogs: [], customers: [], listings: [] });

    const like = `%${q}%`;
    const db = getD1();
    const [workLogs, customers, listings] = await Promise.all([
      db.prepare(`${WORK_SUMMARY_SQL}
        WHERE w.content LIKE ? OR w.work_type LIKE ? OR c.id LIKE ? OR c.name LIKE ? OR EXISTS (
          SELECT 1 FROM work_log_properties p
          WHERE p.work_log_id = w.id AND (
            p.property_type LIKE ? OR p.building_name LIKE ? OR p.building_dong LIKE ?
            OR p.unit_number LIKE ? OR p.source LIKE ?
          )
        )
        ORDER BY w.work_date DESC, w.updated_at DESC, w.id DESC
        LIMIT 8
      `).bind(like, like, like, like, like, like, like, like, like).all(),
      db.prepare(`
        SELECT c.id, c.name, c.notes, c.created_at, c.updated_at, c.is_demo,
          COUNT(w.id) AS history_count, MAX(w.work_date) AS last_work_date
        FROM customers c
        LEFT JOIN work_logs w ON w.customer_id = c.id
        WHERE c.id LIKE ? OR c.name LIKE ? OR c.notes LIKE ?
        GROUP BY c.id
        ORDER BY COALESCE(MAX(w.work_date), c.updated_at) DESC, c.name
        LIMIT 8
      `).bind(like, like, like).all(),
      db.prepare(`
        SELECT * FROM listings
        WHERE property_type LIKE ? OR building_name LIKE ? OR building_dong LIKE ?
          OR unit_number LIKE ? OR status LIKE ? OR notes LIKE ? OR source_notes LIKE ?
        ORDER BY CASE WHEN closed_at IS NULL THEN 0 ELSE 1 END, updated_at DESC, building_name
        LIMIT 8
      `).bind(like, like, like, like, like, like, like).all(),
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
