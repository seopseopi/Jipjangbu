"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientJsonFetch } from "./client-api";
import type { DeletionEntityType, RestoreResult, TrashDetailResponse, TrashListResponse } from "./deletion-types";
import { deletionTypeLabel, DeletionPreviewContent, SafetyDialog } from "./deletion-dialog";
import { formatHistoryTimestamp } from "./history-timestamps";
import { Icon } from "./icons";
import "./trash-view.css";

function trashError(error: unknown) {
  return error instanceof Error ? error.message : "휴지통을 확인하지 못했습니다. 다시 시도해 주세요.";
}

export function TrashView({ refreshKey = 0, onRestored, onBusyChange }: {
  refreshKey?: number;
  onRestored: (result: RestoreResult) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [type, setType] = useState<DeletionEntityType | "">("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<TrashListResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrashDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const pageLock = useRef(false);
  const restoreLock = useRef(false);
  const busyCallback = useRef(onBusyChange);
  const queryKey = JSON.stringify([type, query.trim()]);
  const settledKey = JSON.stringify([type, search]);
  const showingCurrent = loadedKey === queryKey;
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => () => { listRequest.current?.abort(); detailRequest.current?.abort(); busyCallback.current?.(false); }, []);
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);

  const load = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    pageLock.current = false;
    setLoadingMore(false);
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (type) params.set("type", type);
      if (search) params.set("q", search);
      const response = await clientJsonFetch<TrashListResponse>(`/api/trash?${params}`, { signal: controller.signal, cache: "no-store" });
      if (!controller.signal.aborted) { setData(response); setLoadedKey(settledKey); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(trashError(failure));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [type, search, settledKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); listRequest.current?.abort(); };
  }, [load, refreshKey]);

  async function loadMore() {
    if (pageLock.current || loading || !showingCurrent || !data || data.items.length >= data.total) return;
    pageLock.current = true;
    setLoadingMore(true);
    setError("");
    const controller = listRequest.current;
    try {
      const params = new URLSearchParams({ limit: "50", offset: String(data.items.length) });
      if (type) params.set("type", type);
      if (search) params.set("q", search);
      const response = await clientJsonFetch<TrashListResponse>(`/api/trash?${params}`, { signal: controller?.signal, cache: "no-store" });
      if (!controller?.signal.aborted && listRequest.current === controller) setData((current) => current ? { ...response, items: [...current.items, ...response.items.filter((item) => !current.items.some((existing) => existing.id === item.id))] } : response);
    } catch (failure) {
      if (!controller?.signal.aborted) setError(trashError(failure));
    } finally {
      if (listRequest.current === controller) { pageLock.current = false; setLoadingMore(false); }
    }
  }

  async function openDetail(id: string) {
    if (restoreLock.current) return;
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      const response = await clientJsonFetch<TrashDetailResponse>(`/api/trash/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" });
      if (!controller.signal.aborted) setDetail(response);
    } catch (failure) {
      if (!controller.signal.aborted) setDetailError(trashError(failure));
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }

  function closeDetail() {
    if (restoreLock.current) return;
    detailRequest.current?.abort();
    setSelectedId(null);
    setDetail(null);
  }

  async function restore() {
    if (restoreLock.current || !detail || detailLoading) return;
    restoreLock.current = true;
    setRestoring(true);
    busyCallback.current?.(true);
    setDetailError("");
    let result: RestoreResult;
    try {
      result = await clientJsonFetch<RestoreResult>(`/api/trash/${encodeURIComponent(detail.item.id)}/restore`, { method: "POST" });
    } catch (failure) {
      setDetailError(trashError(failure));
      return;
    } finally {
      restoreLock.current = false;
      setRestoring(false);
      busyCallback.current?.(false);
    }
    closeDetail();
    setNotice(`${deletionTypeLabel(result.type)} 기록을 복구했습니다. 원래 목록에서 확인할 수 있습니다.`);
    onRestored(result);
    // This reload owns its error state; restoration has already succeeded.
    void load();
  }

  return <section className="trash-view" aria-label="휴지통">
    <p className="trash-help">휴지통은 자동으로 비워지지 않습니다.</p>
    <div className="trash-controls">
      <label className="trash-search"><Icon name="search" size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="삭제한 기록 검색" aria-label="휴지통 검색" />{query && <button type="button" aria-label="휴지통 검색 지우기" onClick={() => setQuery("")}><Icon name="close" size={17} /></button>}</label>
      <label className="trash-type"><span>기록 종류</span><select value={type} onChange={(event) => setType(event.target.value as DeletionEntityType | "")}><option value="">모든 기록</option><option value="work">업무</option><option value="customer">고객</option><option value="followup">할 일</option></select></label>
      <button type="button" className="secondary-button" disabled={loading || loadingMore} onClick={() => void load()}><Icon name="refresh" size={17} />새로고침</button>
    </div>
    {notice && <p className="trash-notice" role="status">{notice}</p>}
    {error && <div className="deletion-error" role="alert"><p>휴지통 목록을 불러오지 못했습니다. {error}</p><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>다시 불러오기</button></div>}
    {loading || (!showingCurrent && !error) ? <p className="trash-empty" role="status">휴지통을 불러오고 있습니다…</p> : showingCurrent && data ? <>
      <div className="trash-list-heading"><h2>삭제한 기록 <span>{data.total.toLocaleString("ko-KR")}건</span></h2><p>삭제일 최신순 · 기록을 눌러 내용 확인 후 복구</p></div>
      {data.items.length === 0 ? <div className="trash-empty"><Icon name={query || type ? "search" : "empty"} size={28} /><strong>{query || type ? "조건에 맞는 삭제 기록이 없습니다." : "휴지통이 비어 있습니다."}</strong>{(query || type) && <button type="button" className="secondary-button" onClick={() => { setQuery(""); setSearch(""); setType(""); }}>검색 조건 초기화</button>}</div>
        : <ol className="trash-list">{data.items.map((item) => <li key={item.id}><button type="button" className="trash-record" onClick={() => void openDetail(item.id)}>
          <span className="trash-kind">{deletionTypeLabel(item.type)}</span><span className="trash-record-main"><strong>{item.title}</strong><span>{item.subtitle}</span></span>
          <span className="trash-record-action"><time dateTime={item.deletedAt}>삭제 · {formatHistoryTimestamp(item.deletedAt)}</time><span>내용 확인 · 복구</span></span>
        </button></li>)}</ol>}
      {data.items.length < data.total && <button type="button" className="secondary-button trash-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "불러오는 중…" : `이전 삭제 기록 더 보기 (${data.items.length.toLocaleString("ko-KR")} / ${data.total.toLocaleString("ko-KR")})`}</button>}
    </> : null}
    {selectedId && <SafetyDialog title="삭제한 기록 확인 · 복구" busy={restoring} onClose={closeDetail} actions={<button type="button" className="primary-button" disabled={restoring || detailLoading || !detail} onClick={() => void restore()}><Icon name={restoring ? "clock" : "restore"} size={18} />{restoring ? "복구 중…" : "이 기록 복구"}</button>}>
      <p className="deletion-explanation">내용을 확인하고 복구해 주세요. 업무는 원래 업무일로 돌아가며, 다른 업무나 현재 고객 정보를 덮어쓰지 않습니다.</p>
      {detailLoading && <p role="status">삭제한 내용을 불러오고 있습니다…</p>}
      {detail && <><p className="trash-deleted-time">삭제 · {formatHistoryTimestamp(detail.item.deletedAt)}</p><DeletionPreviewContent preview={detail.preview} restoring /></>}
      {detailError && <div className="deletion-error" role="alert"><p>{detailError}</p><button type="button" className="secondary-button" disabled={restoring || detailLoading} onClick={() => void openDetail(selectedId)}>내용 다시 확인</button></div>}
    </SafetyDialog>}
  </section>;
}
