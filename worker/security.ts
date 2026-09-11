const COOKIE_NAME = "jipjangbu_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 60 * 15;
const BACKUP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BACKUP_FORMAT = "jipjangbu-backup-v1";
const BACKUP_MAGIC = new Uint8Array([0x4a, 0x4a, 0x42, 0x31]);
const encoder = new TextEncoder();

const BACKUP_TABLES = [
  "customers",
  "work_logs",
  "work_log_properties",
  "listings",
  "listing_events",
  "work_types",
  "property_buildings",
] as const;

export interface SecurityEnv {
  DB: D1Database;
  BACKUPS: R2Bucket;
  APP_ADMIN_USERNAME?: string;
  APP_ADMIN_PASSWORD_HASH?: string;
  APP_SESSION_SECRET?: string;
  BACKUP_ENCRYPTION_KEY?: string;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface SessionPayload {
  u: string;
  exp: number;
}

type BackupKind = "daily" | "changes" | "manual";

interface BackupSummary {
  key: string;
  kind: BackupKind;
  createdAt: string;
  size: number;
  reason: string;
}

export async function handleSecurityRequest(
  request: Request,
  env: SecurityEnv,
  ctx: WorkerContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (isPublicAsset(pathname, request.method)) return null;

  if (pathname === "/api/auth/login" && request.method === "POST") {
    return handleLogin(request, env);
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return clearSessionResponse(request);
  }

  const session = await readSession(request, env);
  if (pathname === "/login") {
    if (session) return redirectResponse("/", request);
    return null;
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return jsonResponse({ error: "로그인이 필요합니다." }, 401);
    }
    const returnTo = safeReturnTo(`${pathname}${url.search}${url.hash}`);
    return redirectResponse(`/login?returnTo=${encodeURIComponent(returnTo)}`, request);
  }

  if (pathname === "/api/backups" && request.method === "GET") {
    return handleBackupList(env);
  }
  if (pathname === "/api/backups" && request.method === "POST") {
    return handleManualBackup(env);
  }
  if (pathname === "/api/backups/download" && request.method === "GET") {
    return handleBackupDownload(url, env);
  }

  if (pathname === "/api/bootstrap" && request.method === "GET") {
    ctx.waitUntil(ensureDailyBackup(env).catch((error) => console.error("Daily backup failed", error)));
  }

  if (isBusinessMutation(pathname, request.method)) {
    try {
      await createBackup(env, "changes", `${request.method.toLowerCase()}-${mutationArea(pathname)}`);
    } catch (error) {
      console.error("Pre-change backup failed", error);
      return jsonResponse({ error: "안전 백업을 만들지 못해 변경을 중단했습니다. 잠시 뒤 다시 시도해 주세요." }, 503);
    }
  }

  return null;
}

export function isPublicAsset(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return pathname.startsWith("/_next/")
    || pathname.startsWith("/_vinext/")
    || pathname === "/favicon.ico"
    || pathname === "/jipjangbu-logo.png"
    || pathname === "/jipjangbu-icon.png"
    || pathname === "/jipjangbu-icon-bright.png";
}

export function addSecurityHeaders(response: Response, noStore = true): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleLogin(request: Request, env: SecurityEnv): Promise<Response> {
  if (!authConfigurationReady(env)) {
    return jsonResponse({ error: "로그인 설정을 확인하고 있습니다. 잠시 뒤 다시 시도해 주세요." }, 503);
  }

  await ensureAuthTable(env.DB);
  const attemptKey = await loginAttemptKey(request, env.APP_SESSION_SECRET!);
  const now = Math.floor(Date.now() / 1000);
  const previous = await env.DB.prepare(
    "SELECT attempts, blocked_until, updated_at FROM auth_attempts WHERE key = ?",
  ).bind(attemptKey).first<{ attempts: number; blocked_until: number; updated_at: number }>();

  if ((previous?.blocked_until ?? 0) > now) {
    const retryAfter = Math.max((previous?.blocked_until ?? now) - now, 1);
    return jsonResponse(
      { error: "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요." },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json() as { username?: unknown; password?: unknown };
  } catch {
    return jsonResponse({ error: "아이디와 비밀번호를 입력해 주세요." }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const usernameMatches = constantTimeEqual(encoder.encode(username), encoder.encode(env.APP_ADMIN_USERNAME!));
  let passwordMatches = false;
  try {
    passwordMatches = password.length > 0 && await verifyPassword(password, env.APP_ADMIN_PASSWORD_HASH!);
  } catch (error) {
    console.error("Password verification failed", error);
    return jsonResponse({ error: "로그인 설정을 확인하고 있습니다. 잠시 뒤 다시 시도해 주세요." }, 503);
  }

  if (!usernameMatches || !passwordMatches) {
    const inWindow = (previous?.updated_at ?? 0) >= now - LOGIN_WINDOW_SECONDS;
    const attempts = (inWindow ? previous?.attempts ?? 0 : 0) + 1;
    const blockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_WINDOW_SECONDS : 0;
    await env.DB.prepare(`
      INSERT INTO auth_attempts (key, attempts, blocked_until, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts,
        blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
    `).bind(attemptKey, attempts, blockedUntil, now).run();
    return jsonResponse(
      { error: blockedUntil ? "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요." : "아이디 또는 비밀번호가 올바르지 않습니다." },
      blockedUntil ? 429 : 401,
    );
  }

  await env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(attemptKey).run();
  const token = await createSessionToken(env.APP_ADMIN_USERNAME!, env.APP_SESSION_SECRET!);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_SECONDS}` },
  );
}

function clearSessionResponse(request: Request): Response {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0` },
  );
}

async function readSession(request: Request, env: SecurityEnv): Promise<SessionPayload | null> {
  if (!env.APP_SESSION_SECRET || !env.APP_ADMIN_USERNAME) return null;
  const cookie = request.headers.get("Cookie") ?? "";
  const token = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token) return null;

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;
  try {
    const key = await importHmacKey(env.APP_SESSION_SECRET);
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!verified) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionPayload;
    if (payload.u !== env.APP_ADMIN_USERNAME || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload: SessionPayload = { u: username, exp: Date.now() + SESSION_SECONDS * 1000 };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsText, saltHex, expectedHex, extra] = stored.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2_sha256" || extra || !Number.isInteger(iterations) || iterations < 100_000) return false;
  const salt = hexToBytes(saltHex);
  const expected = hexToBytes(expectedHex);
  if (!salt.length || !expected.length) return false;
  const sourceKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    sourceKey,
    expected.length * 8,
  );
  return constantTimeEqual(new Uint8Array(derived), expected);
}

async function ensureAuthTable(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS auth_attempts (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
    blocked_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  )`).run();
}

async function loginAttemptKey(request: Request, secret: string): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = await importHmacKey(secret);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`login:${ip}`));
  return `ip:${bytesToHex(new Uint8Array(digest)).slice(0, 32)}`;
}

function authConfigurationReady(env: SecurityEnv): boolean {
  return Boolean(env.APP_ADMIN_USERNAME && env.APP_ADMIN_PASSWORD_HASH && env.APP_SESSION_SECRET);
}

async function handleBackupList(env: SecurityEnv): Promise<Response> {
  try {
    requireBackupConfiguration(env);
    const listed = await env.BACKUPS.list({ limit: 100, include: ["customMetadata"] });
    const backups: BackupSummary[] = listed.objects.map((object) => ({
      key: object.key,
      kind: backupKindFromKey(object.key),
      createdAt: object.customMetadata?.createdAt ?? object.uploaded.toISOString(),
      size: object.size,
      reason: object.customMetadata?.reason ?? backupKindFromKey(object.key),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jsonResponse({ backups });
  } catch (error) {
    console.error("Backup list failed", error);
    return jsonResponse({ error: "백업 목록을 불러오지 못했습니다." }, 500);
  }
}

async function handleManualBackup(env: SecurityEnv): Promise<Response> {
  try {
    const backup = await createBackup(env, "manual", "manual");
    return jsonResponse({ backup }, 201);
  } catch (error) {
    console.error("Manual backup failed", error);
    return jsonResponse({ error: "수동 백업을 만들지 못했습니다." }, 500);
  }
}

async function handleBackupDownload(url: URL, env: SecurityEnv): Promise<Response> {
  try {
    requireBackupConfiguration(env);
    const key = url.searchParams.get("key") ?? "";
    if (!/^(daily|changes|manual)\/[A-Za-z0-9._/-]+\.json\.enc$/.test(key) || key.includes("..")) {
      return jsonResponse({ error: "백업 파일을 확인할 수 없습니다." }, 400);
    }
    const object = await env.BACKUPS.get(key);
    if (!object) return jsonResponse({ error: "백업 파일을 찾을 수 없습니다." }, 404);
    const decrypted = await decryptBackup(await object.arrayBuffer(), env.BACKUP_ENCRYPTION_KEY!);
    const createdAt = object.customMetadata?.createdAt ?? new Date().toISOString();
    const filename = `jipjangbu-backup-${createdAt.slice(0, 10)}-${backupKindFromKey(key)}.json`;
    return addSecurityHeaders(new Response(decrypted, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    }));
  } catch (error) {
    console.error("Backup download failed", error);
    return jsonResponse({ error: "백업 파일을 내려받지 못했습니다." }, 500);
  }
}

async function ensureDailyBackup(env: SecurityEnv): Promise<void> {
  requireBackupConfiguration(env);
  const key = `daily/${seoulDay()}.json.enc`;
  if (await env.BACKUPS.head(key)) return;
  await createBackup(env, "daily", "daily", key);
  await removeExpiredBackups(env.BACKUPS);
}

async function createBackup(
  env: SecurityEnv,
  kind: BackupKind,
  reason: string,
  fixedKey?: string,
): Promise<BackupSummary> {
  requireBackupConfiguration(env);
  const createdAt = new Date().toISOString();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      tables[table] = result.results;
      counts[table] = result.results.length;
    } catch (error) {
      if (!String(error).toLowerCase().includes("no such table")) throw error;
      tables[table] = [];
      counts[table] = 0;
    }
  }

  const payload = encoder.encode(JSON.stringify({ format: BACKUP_FORMAT, createdAt, reason, counts, tables }));
  const encrypted = await encryptBackup(payload, env.BACKUP_ENCRYPTION_KEY!);
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const key = fixedKey ?? `${kind}/${seoulDay()}/${timestamp}-${crypto.randomUUID()}.json.enc`;
  await env.BACKUPS.put(key, encrypted, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { format: BACKUP_FORMAT, createdAt, kind, reason },
  });
  return { key, kind, createdAt, size: encrypted.byteLength, reason };
}

async function encryptBackup(payload: Uint8Array, secret: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(secret);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
  const output = new Uint8Array(BACKUP_MAGIC.length + iv.length + encrypted.length);
  output.set(BACKUP_MAGIC, 0);
  output.set(iv, BACKUP_MAGIC.length);
  output.set(encrypted, BACKUP_MAGIC.length + iv.length);
  return output;
}

async function decryptBackup(value: ArrayBuffer, secret: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(value);
  if (bytes.length < 29 || !constantTimeEqual(bytes.slice(0, 4), BACKUP_MAGIC)) throw new Error("Invalid backup format");
  const iv = bytes.slice(4, 16);
  const encrypted = bytes.slice(16);
  const key = await importAesKey(secret);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
}

async function removeExpiredBackups(bucket: R2Bucket): Promise<void> {
  const threshold = Date.now() - BACKUP_RETENTION_MS;
  let cursor: string | undefined;
  do {
    const result = await bucket.list({ limit: 1000, cursor });
    const expired = result.objects.filter((object) => object.uploaded.getTime() < threshold).map((object) => object.key);
    if (expired.length) await bucket.delete(expired);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}

function requireBackupConfiguration(env: SecurityEnv): void {
  if (!env.BACKUPS || !env.BACKUP_ENCRYPTION_KEY) throw new Error("Backup configuration is incomplete");
  if (hexToBytes(env.BACKUP_ENCRYPTION_KEY).length !== 32) throw new Error("Backup key must be 32 bytes");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const bytes = hexToBytes(secret);
  if (bytes.length < 32) throw new Error("Session key must be at least 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", hexToBytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function isBusinessMutation(pathname: string, method: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  return /^\/api\/(work-logs|customers|lookups)(\/|$)/.test(pathname);
}

function mutationArea(pathname: string): string {
  return pathname.split("/")[2]?.replace(/[^a-z-]/g, "") || "data";
}

function backupKindFromKey(key: string): BackupKind {
  if (key.startsWith("daily/")) return "daily";
  if (key.startsWith("manual/")) return "manual";
  return "changes";
}

function seoulDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function safeReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/login") || value.startsWith("/api/auth")) return "/";
  return value;
}

function redirectResponse(path: string, request: Request): Response {
  return addSecurityHeaders(Response.redirect(new URL(path, request.url), 302));
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return addSecurityHeaders(new Response(JSON.stringify(body), { status, headers }));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % Math.max(left.length, 1)] ?? 0) ^ (right[index % Math.max(right.length, 1)] ?? 0);
  }
  return difference === 0;
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
