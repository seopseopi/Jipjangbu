import { getD1 } from "../../../db";
import { apiError, ready } from "../_shared";

const summarySql = `
  SELECT w.id, w.work_date, w.customer_id, w.work_type, w.content, w.is_demo,
    c.name AS customer_name,
    (SELECT p.property_type FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS property_type,
    (SELECT p.building_name FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS building_name,
    (SELECT p.building_dong FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS building_dong,
    (SELECT p.unit_number FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS unit_number,
    (SELECT p.size_type FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS size_type,
    (SELECT COUNT(*) FROM work_log_properties p WHERE p.work_log_id = w.id) AS property_count
  FROM work_logs w JOIN customers c ON c.id = w.customer_id
`;

export async function GET() {
  try {
    await ready();
    const db = getD1();
    const [metrics, today, recent, demo, upcoming] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM work_logs WHERE work_date = date('now','+9 hours')) AS today_count,
        (SELECT COUNT(*) FROM work_logs WHERE work_date > date('now','+9 hours') AND work_date <= date('now','+9 hours','+7 days') AND (work_type LIKE '%예정' OR work_type LIKE '%예약')) AS upcoming_count,
        (SELECT COUNT(*) FROM listings WHERE closed_at IS NULL) AS active_listing_count,
        (SELECT COUNT(*) FROM customers) AS customer_count
      `).first(),
      db.prepare(`${summarySql} WHERE w.work_date = date('now','+9 hours') ORDER BY w.created_at, w.id`).all(),
      db.prepare(`${summarySql} ORDER BY w.work_date DESC, w.updated_at DESC, w.id DESC LIMIT 8`).all(),
      db.prepare("SELECT COUNT(*) AS real_count FROM work_logs WHERE is_demo = 0").first<{ real_count: number }>(),
      db.prepare(`${summarySql} WHERE w.work_date > date('now','+9 hours') AND w.work_date <= date('now','+9 hours','+7 days') AND (w.work_type LIKE '%예정' OR w.work_type LIKE '%예약') ORDER BY w.work_date, w.id LIMIT 6`).all(),
    ]);
    return Response.json({ metrics, today: today.results, recent: recent.results, upcoming: upcoming.results, demoMode: (demo?.real_count ?? 0) === 0 });
  } catch (error) {
    return apiError(error, "첫 화면 데이터를 불러오지 못했습니다.");
  }
}
