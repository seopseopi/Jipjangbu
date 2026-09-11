import { getD1 } from "../../../db";
import { apiError, ready } from "../_shared";

export async function GET(request: Request) {
  try {
    await ready();
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    const state = params.get("state") ?? "active";
    const type = params.get("type")?.trim() ?? "";
    const where = ["(? = '' OR property_type = ?)"];
    const binds: unknown[] = [type, type];
    if (state === "active") where.push("closed_at IS NULL");
    if (state === "closed") where.push("closed_at IS NOT NULL");
    if (q) {
      where.push("(building_name LIKE ? OR building_dong LIKE ? OR unit_number LIKE ? OR notes LIKE ?)");
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }
    const rows = await getD1().prepare(`
      SELECT * FROM listings WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN closed_at IS NULL THEN 0 ELSE 1 END, building_name, building_dong, unit_number LIMIT 1000
    `).bind(...binds).all();
    return Response.json({ listings: rows.results });
  } catch (error) {
    return apiError(error, "매물 목록을 불러오지 못했습니다.");
  }
}
