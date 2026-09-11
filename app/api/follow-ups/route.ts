import { getD1 } from "../../../db";
import { apiError, ready } from "../_shared";
import { createFollowUp, FollowUpError, getFollowUps, readFollowUpBody } from "./_store";

export async function GET(request: Request) {
  try {
    await ready();
    return Response.json(await getFollowUps(getD1(), new URL(request.url).searchParams));
  } catch (error) {
    if (error instanceof FollowUpError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "할 일 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const item = await createFollowUp(getD1(), await readFollowUpBody(request));
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof FollowUpError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "할 일을 등록하지 못했습니다.");
  }
}
