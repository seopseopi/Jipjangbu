import { getD1 } from "../../../db";
import { apiError, badRequest, ready } from "../_shared";

export async function GET() {
  try {
    await ready();
    const db = getD1();
    const [types, buildings] = await db.batch<Record<string, unknown>>([
      db.prepare("SELECT name FROM work_types ORDER BY sort_order, name"),
      db.prepare("SELECT id, property_type, building_name FROM property_buildings ORDER BY property_type, sort_order, building_name"),
    ]);
    return Response.json({
      workTypes: types.results.map((row) => String(row.name)),
      propertyTypes: [...new Set(buildings.results.map((row) => String(row.property_type)))],
      buildings: buildings.results,
    });
  } catch (error) {
    return apiError(error, "분류 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const body = await request.json() as { kind?: string; name?: string; propertyType?: string };
    const name = body.name?.trim();
    if (!name) return badRequest("추가할 이름을 입력해 주세요.");
    const db = getD1();
    let result;
    if (body.kind === "workType") {
      result = await db.prepare("INSERT OR IGNORE INTO work_types (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM work_types))").bind(name).run();
    } else if (body.kind === "building" && body.propertyType?.trim()) {
      result = await db.prepare("INSERT OR IGNORE INTO property_buildings (id, property_type, building_name, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM property_buildings WHERE property_type = ?))")
        .bind(crypto.randomUUID(), body.propertyType.trim(), name, body.propertyType.trim()).run();
    } else {
      return badRequest("분류 종류를 확인해 주세요.");
    }
    if (!result.meta.changes) {
      return Response.json({ error: "이미 등록된 분류입니다." }, { status: 409 });
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error, "분류를 추가하지 못했습니다.");
  }
}
