"use client";

export async function clientJsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json() as T & { error?: string }
    : ({ error: response.ok ? undefined : "서버 연결이 잠시 불안정합니다. 다시 시도해 주세요." } as T & { error?: string });

  if (response.status === 401 && typeof window !== "undefined") {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
