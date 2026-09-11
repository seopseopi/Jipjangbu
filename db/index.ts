import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1(): D1Database {
  if (!env.DB) throw new Error("데이터베이스 연결을 확인할 수 없습니다.");
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
