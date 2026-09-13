import { getD1 } from "../../../db";
import { apiError, badRequest, ready } from "../_shared";
import { CUSTOMER_HISTORY_ORDER, CUSTOMER_LAST_WORK_DATE_SQL, CUSTOMER_NAME_ORDER, CUSTOMER_RECENT_ORDER } from "../_ordering";
import { textSearch } from "../_search.js";

export async function GET(request: Request) {
  try {
    await ready();
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    const sort = params.get("sort") ?? "recent";
    const orderBy = sort === "name" ? CUSTOMER_NAME_ORDER : sort === "history" ? CUSTOMER_HISTORY_ORDER : CUSTOMER_RECENT_ORDER;
    const search = q ? textSearch(["c.id", "c.name", "c.notes"], q, ["c.id"]) : { sql: "1", bindings: [] };
    const rows = await getD1().prepare(`
      SELECT c.id, c.name, c.notes, c.created_at, c.updated_at, c.is_demo,
        COUNT(w.id) AS history_count, ${CUSTOMER_LAST_WORK_DATE_SQL} AS last_work_date
      FROM customers c LEFT JOIN work_logs w ON w.customer_id = c.id
      WHERE ${search.sql}
      GROUP BY c.id ORDER BY ${orderBy} LIMIT 1000
    `).bind(...search.bindings).all();
    return Response.json({ customers: rows.results });
  } catch (error) {
    return apiError(error, "고객 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const body = await request.json() as { id?: string; name?: string; notes?: string };
    const id = body.id?.trim();
    const name = body.name?.trim();
    if (!id || !name) return badRequest("고객 ID와 고객명을 입력해 주세요.");
    const db = getD1();
    const exists = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(id).first();
    if (exists) return Response.json({ error: "이미 등록된 고객 ID입니다." }, { status: 409 });
    await db.prepare("INSERT INTO customers (id, name, notes, is_demo) VALUES (?, ?, ?, 0)").bind(id, name, body.notes?.trim() ?? "").run();
    return Response.json({ customer: { id, name, notes: body.notes?.trim() ?? "" } }, { status: 201 });
  } catch (error) {
    return apiError(error, "고객을 등록하지 못했습니다.");
  }
}
