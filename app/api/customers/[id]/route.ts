import { getD1 } from "../../../../db";
import { apiError, badRequest, ready } from "../../_shared";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    const body = await request.json() as { name?: string; notes?: string };
    const name = body.name?.trim();
    if (!name) return badRequest("고객명을 입력해 주세요.");
    const result = await getD1().prepare("UPDATE customers SET name = ?, notes = ?, is_demo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name, body.notes?.trim() ?? "", decodeURIComponent(id)).run();
    if (!result.meta.changes) return Response.json({ error: "고객을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "고객 정보를 수정하지 못했습니다.");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    const customerId = decodeURIComponent(id);
    const db = getD1();
    const history = await db.prepare("SELECT COUNT(*) AS count FROM work_logs WHERE customer_id = ?").bind(customerId).first<{ count: number }>();
    if ((history?.count ?? 0) > 0) return Response.json({ error: "업무 이력이 있는 고객은 삭제할 수 없습니다." }, { status: 409 });
    await db.prepare("DELETE FROM customers WHERE id = ?").bind(customerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "고객을 삭제하지 못했습니다.");
  }
}
