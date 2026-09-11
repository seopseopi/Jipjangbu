import { getD1 } from "../../../../db";
import { apiError, ready } from "../../_shared";
import { deleteFollowUp, FollowUpError, readFollowUpBody, updateFollowUp } from "../_store";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    const item = await updateFollowUp(getD1(), id, await readFollowUpBody(request));
    return Response.json({ item });
  } catch (error) {
    if (error instanceof FollowUpError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "할 일을 수정하지 못했습니다.");
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    await deleteFollowUp(getD1(), id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof FollowUpError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "할 일을 삭제하지 못했습니다.");
  }
}
