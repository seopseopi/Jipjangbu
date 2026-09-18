import { getD1 } from "../../../db";
import { DeletionError, getTrash, permanentlyDeleteTrashBatch } from "../../../db/deletion-store";
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

export async function DELETE(request: Request) {
  try {
    await ready();
    let body;
    try { body = await request.json(); } catch { throw new DeletionError("삭제 요청을 확인해 주세요."); }
    return Response.json(await permanentlyDeleteTrashBatch(getD1(), (body as { entries?: unknown } | null)?.entries));
  } catch (error) {
    if (error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "영구 삭제하지 못했습니다. 휴지통을 다시 확인해 주세요.");
  }
}
