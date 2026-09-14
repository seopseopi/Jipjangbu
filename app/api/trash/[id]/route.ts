import { getD1 } from "../../../../db";
import { DeletionError, getTrashDetail } from "../../../../db/deletion-store";
import { apiError, ready } from "../../_shared";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    return Response.json(await getTrashDetail(getD1(), (await params).id));
  } catch (error) {
    if (error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "복구할 내용을 불러오지 못했습니다.");
  }
}
