import { getD1 } from "../../../../../db";
import { DeletionError, restoreTrash } from "../../../../../db/deletion-store";
import { apiError, ready } from "../../../_shared";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    return Response.json(await restoreTrash(getD1(), (await params).id));
  } catch (error) {
    if (error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "휴지통의 기록을 복구하지 못했습니다.");
  }
}
