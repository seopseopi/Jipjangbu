import { getD1 } from "../../../db";
import { apiError, badRequest, ready } from "../_shared";

export async function GET(request: Request) {
  try {
    await ready();
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    const sort = params.get("sort") ?? "recent";
    const orderBy = sort === "name" ? "c.name COLLATE NOCASE, c.id" : sort === "history" ? "COUNT(w.id) DESC, COALESCE(MAX(w.work_date), c.updated_at) DESC" : "COALESCE(MAX(w.work_date), c.updated_at) DESC, c.name";
    const like = `%${q}%`;
    const rows = await getD1().prepare(`
      SELECT c.id, c.name, c.notes, c.created_at, c.updated_at, c.is_demo,
        COUNT(w.id) AS history_count, MAX(w.work_date) AS last_work_date
      FROM customers c LEFT JOIN work_logs w ON w.customer_id = c.id
      WHERE (? = '' OR c.id LIKE ? OR c.name LIKE ? OR c.notes LIKE ?)
      GROUP BY c.id ORDER BY ${orderBy} LIMIT 1000
    `).bind(q, like, like, like).all();
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
