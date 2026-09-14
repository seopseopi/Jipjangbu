import { apiError, ready } from "../../_shared";
import { getWorkLog, InputError, removeWorkLog, saveWorkLog, WorkLogPayload } from "../data";
import { DeletionError, readDeletionRevision } from "../../../../db/deletion-store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    const workLog = await getWorkLog(id);
    if (!workLog) return Response.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ workLog });
  } catch (error) {
    return apiError(error, "업무를 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    const workLog = await saveWorkLog(await request.json() as WorkLogPayload, id);
    return Response.json({ workLog });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "업무를 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    return Response.json(await removeWorkLog(id, await readDeletionRevision(request)));
  } catch (error) {
    if (error instanceof InputError || error instanceof DeletionError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "업무를 삭제하지 못했습니다.");
  }
}
