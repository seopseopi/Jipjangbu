import { getD1 } from "../../../db";
import { apiError, integerQueryParam, ready } from "../_shared";
import { InputError, saveWorkLog, WorkLogPayload } from "./data";

const summarySql = `
  SELECT w.id, w.work_date, w.customer_id, w.work_type, w.content, w.is_demo, w.updated_at,
    c.name AS customer_name,
    (SELECT p.property_type FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS property_type,
    (SELECT p.building_name FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS building_name,
    (SELECT p.building_dong FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS building_dong,
    (SELECT p.unit_number FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS unit_number,
    (SELECT p.size_type FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS size_type,
    (SELECT p.sale_price FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS sale_price,
    (SELECT p.jeonse_price FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS jeonse_price,
    (SELECT p.monthly_rent FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS monthly_rent,
    (SELECT COUNT(*) FROM work_log_properties p WHERE p.work_log_id = w.id) AS property_count
  FROM work_logs w JOIN customers c ON c.id = w.customer_id
`;

export async function GET(request: Request) {
  try {
    await ready();
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    const month = params.get("month")?.trim() ?? "";
    const workType = params.get("workType")?.trim() ?? "";
    const customerId = params.get("customerId")?.trim() ?? "";
    const from = params.get("from")?.trim() ?? "";
    const to = params.get("to")?.trim() ?? "";
    const limit = integerQueryParam(params.get("limit"), 100, 1, 1000);
    const offset = integerQueryParam(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const where = ["(? = '' OR w.work_type = ?)", "(? = '' OR w.customer_id = ?)", "(? = '' OR substr(w.work_date,1,7) = ?)", "(? = '' OR w.work_date >= ?)", "(? = '' OR w.work_date <= ?)"];
    const binds: unknown[] = [workType, workType, customerId, customerId, month, month, from, from, to, to];
    if (q) {
      where.push(`(w.content LIKE ? OR c.id LIKE ? OR c.name LIKE ? OR EXISTS (
        SELECT 1 FROM work_log_properties p WHERE p.work_log_id = w.id AND
        (p.building_name LIKE ? OR p.building_dong LIKE ? OR p.unit_number LIKE ? OR p.source LIKE ?)
      ))`);
      const like = `%${q}%`;
      binds.push(like, like, like, like, like, like, like);
    }
    const db = getD1();
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM work_logs w JOIN customers c ON c.id = w.customer_id WHERE ${where.join(" AND ")}`)
      .bind(...binds).first<{ total: number }>();
    const rows = await db.prepare(`${summarySql} WHERE ${where.join(" AND ")} ORDER BY w.work_date DESC, w.updated_at DESC, w.id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset).all();
    return Response.json({ workLogs: rows.results, total: Number(count?.total || 0) });
  } catch (error) {
    return apiError(error, "업무일지를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const workLog = await saveWorkLog(await request.json() as WorkLogPayload);
    return Response.json({ workLog }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "업무를 저장하지 못했습니다.");
  }
}
