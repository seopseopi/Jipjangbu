import { getD1 } from "../../../db";
import { apiError, ready } from "../_shared";
import { LISTING_BUILDING_ORDER, LISTING_OLDEST_ORDER, LISTING_RECENT_ORDER, LISTING_UPDATED_ORDER } from "../_ordering";

export async function GET(request: Request) {
  try {
    await ready();
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";
    const state = params.get("state") ?? "active";
    const type = params.get("type")?.trim() ?? "";
    const sort = params.get("sort") ?? "building";
    const orderBy = sort === "recent" ? LISTING_RECENT_ORDER
      : sort === "updated" ? LISTING_UPDATED_ORDER
      : sort === "oldest" ? LISTING_OLDEST_ORDER : LISTING_BUILDING_ORDER;
    const where = ["(? = '' OR property_type = ?)"];
    const binds: unknown[] = [type, type];
    if (state === "active") where.push("closed_at IS NULL");
    if (state === "closed") where.push("closed_at IS NOT NULL");
    if (state === "stale") where.push("closed_at IS NULL AND date(COALESCE(NULLIF(updated_at, ''), registered_at, '1900-01-01')) <= date('now','+9 hours','-90 days')");
    if (q) {
      where.push("(building_name LIKE ? OR building_dong LIKE ? OR unit_number LIKE ? OR notes LIKE ?)");
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }
    const rows = await getD1().prepare(`
      SELECT * FROM listings WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy} LIMIT 1000
    `).bind(...binds).all();
    return Response.json({ listings: rows.results });
  } catch (error) {
    return apiError(error, "매물 목록을 불러오지 못했습니다.");
  }
}
