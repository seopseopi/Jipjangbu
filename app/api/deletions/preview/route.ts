import { getD1 } from "../../../../db";
import { DeletionError, deletionType, getDeletionPreview } from "../../../../db/deletion-store";
import { apiError, ready } from "../../_shared";

export async function GET(request: Request) {
  try {
    await ready();
    const params = new URL(request.url).searchParams;
    return Response.json({ preview: await getDeletionPreview(getD1(), deletionType(params.get("type")), params.get("id") ?? "") });
  } catch (error) {
    if (error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "삭제할 내용을 불러오지 못했습니다.");
  }
}
