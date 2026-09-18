import { getD1 } from "../../../../db";
import { DeletionError, getTrashDetail, permanentlyDeleteTrash, readDeletionRevision } from "../../../../db/deletion-store";
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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    return Response.json(await permanentlyDeleteTrash(getD1(), (await params).id, await readDeletionRevision(request)));
  } catch (error) {
    if (error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "영구 삭제하지 못했습니다. 휴지통에서 처리 여부를 다시 확인해 주세요.");
  }
}
