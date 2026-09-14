import { getD1 } from "../../../db";
import { DeletionError, getTrash } from "../../../db/deletion-store";
import { apiError, ready } from "../_shared";

export async function GET(request: Request) {
  try {
    await ready();
    return Response.json(await getTrash(getD1(), new URL(request.url).searchParams));
  } catch (error) {
    if (error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "휴지통을 불러오지 못했습니다.");
  }
}
