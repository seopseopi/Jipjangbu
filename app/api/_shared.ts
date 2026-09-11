import { ensureDatabase } from "../../db/bootstrap";

export async function ready() {
  await ensureDatabase();
}

export function apiError(error: unknown, fallback = "요청을 처리하지 못했습니다.") {
  console.error(error);
  return Response.json({ error: fallback }, { status: 500 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}
