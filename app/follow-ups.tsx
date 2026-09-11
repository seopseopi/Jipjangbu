"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { clientJsonFetch } from "./client-api";
import { Icon } from "./icons";
import "./follow-ups.css";

export type FollowUpItem = {
  id: string;
  title: string;
  notes: string;
  due_date: string | null;
  customer_id: string | null;
  listing_key: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  listing_label: string | null;
};

export type FollowUpsViewProps = {
  compact?: boolean;
  refreshKey?: number;
  onChange?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenCustomer?: (id: string, name: string) => void;
  onOpenListing?: (key: string) => void;
  initialDraft?: { title?: string; customerId?: string; listingKey?: string };
  onDraftConsumed?: () => void;
  onShowAll?: () => void;
};

type FollowUpsResponse = {
  items: FollowUpItem[];
  summary: { open: number; overdue: number; today: number; completed: number };
};
type Filter = "all" | "today" | "overdue" | "upcoming" | "completed";
type Draft = { title: string; notes: string; dueDate: string; customerId: string; listingKey: string };
type ReloadTarget = { filter: Filter; search: string };

function todayDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nextDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function emptyDraft(): Draft {
  return { title: "", notes: "", dueDate: todayDate(), customerId: "", listingKey: "" };
}

function differentDraft(a: Draft, b: Draft) {
  return a.title !== b.title || a.notes !== b.notes || a.dueDate !== b.dueDate || a.customerId !== b.customerId || a.listingKey !== b.listingKey;
}

function dueText(item: FollowUpItem, today: string) {
  if (item.completed_at) return "완료";
  if (!item.due_date) return "날짜 미정";
  if (item.due_date === today) return "오늘";
  if (item.due_date === nextDay(today)) return "내일";
  const [year, month, day] = item.due_date.split("-");
  const label = `${year === today.slice(0, 4) ? "" : `${year}년 `}${Number(month)}월 ${Number(day)}일`;
  return item.due_date < today ? `${label} · 기한 지남` : label;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "처리하지 못했습니다. 다시 시도해 주세요.";
}

export function FollowUpsView({ compact = false, refreshKey = 0, onChange, onDirtyChange, onOpenCustomer, onOpenListing, initialDraft, onDraftConsumed, onShowAll }: FollowUpsViewProps) {
  const formId = useId();
  const [data, setData] = useState<FollowUpsResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(compact);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftBaseline, setDraftBaseline] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [editBaseline, setEditBaseline] = useState<Draft>(emptyDraft);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const request = useRef<AbortController | null>(null);
  const consumedCallback = useRef(onDraftConsumed);
  const dirtyCallback = useRef(onDirtyChange);
  const titleInput = useRef<HTMLInputElement>(null);
  const dirtyState = useRef({ newDraft: false, editing: false, busy: false });
  const draftKey = initialDraft ? JSON.stringify(initialDraft) : "";
  const today = todayDate();
  const draftDirty = showForm && differentDraft(draft, draftBaseline);
  const editDirty = !!editingId && differentDraft(editDraft, editBaseline);
  const hasUnsavedChanges = draftDirty || editDirty;

  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { dirtyCallback.current?.(hasUnsavedChanges); }, [hasUnsavedChanges]);
  useEffect(() => () => { dirtyCallback.current?.(false); }, []);

  useEffect(() => { dirtyState.current = { newDraft: draftDirty, editing: editDirty, busy: !!busyId }; }, [draftDirty, editDirty, busyId]);

  useEffect(() => {
    if (!draftDirty && !editDirty && !busyId) return;
    const protectUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protectUnload);
    return () => window.removeEventListener("beforeunload", protectUnload);
  }, [draftDirty, editDirty, busyId]);

  useEffect(() => { consumedCallback.current = onDraftConsumed; }, [onDraftConsumed]);

  useEffect(() => {
    if (!draftKey) return;
    const timer = window.setTimeout(() => {
      if (dirtyState.current.busy || ((dirtyState.current.newDraft || dirtyState.current.editing) && !window.confirm("저장하지 않은 내용이 있습니다. 작성을 취소하고 새 할 일을 열까요?"))) {
        consumedCallback.current?.();
        return;
      }
      const incoming = JSON.parse(draftKey) as NonNullable<FollowUpsViewProps["initialDraft"]>;
      const base = emptyDraft();
      setDraftBaseline(base);
      setDraft({ ...base, ...incoming });
      setEditingId(null);
      setShowForm(true);
      setNotice("");
      consumedCallback.current?.();
      window.requestAnimationFrame(() => titleInput.current?.focus());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const reload = useCallback(async (target?: ReloadTarget) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    const nextFilter = target?.filter ?? filter;
    const nextSearch = target?.search ?? search;
    const params = new URLSearchParams({
      status: !compact && nextFilter === "completed" ? "completed" : "open",
      due: compact || nextFilter === "completed" ? "all" : nextFilter,
    });
    if (!compact && nextSearch) params.set("q", nextSearch);
    try {
      const response = await clientJsonFetch<FollowUpsResponse>(`/api/follow-ups?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted) setData(response);
    } catch (loadError) {
      if (!controller.signal.aborted) setError(errorText(loadError));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [compact, filter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    const onFocus = () => { void reload(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reload, refreshKey]);

  async function mutate(id: string, method: "POST" | "PATCH" | "DELETE", body: unknown, message: string, afterSave?: () => void) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await clientJsonFetch(method === "POST" ? "/api/follow-ups" : `/api/follow-ups/${encodeURIComponent(id)}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      afterSave?.();
      setNotice(message);
      if (method === "POST") {
        setFilter("all");
        setQuery("");
        setSearch("");
        await reload({ filter: "all", search: "" });
      } else await reload();
      onChange?.();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      mutationLock.current = false;
      setBusyId(null);
    }
  }

  function saveDraft(event: React.FormEvent<HTMLFormElement>, value: Draft, id?: string) {
    event.preventDefault();
    if (!id && editingId) return;
    const title = value.title.trim();
    if (!title) return;
    void mutate(id ?? "new", id ? "PATCH" : "POST", {
      title,
      notes: value.notes.trim(),
      dueDate: value.dueDate || null,
      customerId: value.customerId || null,
      listingKey: value.listingKey || null,
    }, id ? "할 일을 수정했습니다." : "할 일을 추가했습니다.", () => {
      if (id) setEditingId(null);
      else {
        const next = emptyDraft();
        setDraft(next);
        setDraftBaseline(next);
        setShowForm(compact);
      }
    });
  }

  function startEdit(item: FollowUpItem) {
    if (editDirty && !window.confirm("저장하지 않은 수정 내용이 있습니다. 취소하고 다른 할 일을 수정할까요?")) return;
    const next = { title: item.title, notes: item.notes ?? "", dueDate: item.due_date ?? "", customerId: item.customer_id ?? "", listingKey: item.listing_key ?? "" };
    setEditingId(item.id);
    setEditDraft(next);
    setEditBaseline(next);
    setNotice("");
  }

  function cancelForm(editing?: string) {
    if ((editing ? editDirty : draftDirty) && !window.confirm("저장하지 않은 내용이 있습니다. 작성을 취소할까요?")) return;
    if (editing) setEditingId(null);
    else {
      const next = emptyDraft();
      setDraft(next);
      setDraftBaseline(next);
      setShowForm(compact);
    }
  }

  function openNewForm() {
    if (editDirty && !window.confirm("저장하지 않은 수정 내용이 있습니다. 취소하고 새 할 일을 열까요?")) return;
    setEditingId(null);
    if (!draftDirty) {
      const next = emptyDraft();
      setDraft(next);
      setDraftBaseline(next);
    }
    setShowForm(true);
    window.requestAnimationFrame(() => titleInput.current?.focus());
  }

  function showAll() {
    if ((draftDirty || editDirty) && !window.confirm("저장하지 않은 내용이 있습니다. 작성을 취소하고 전체 할 일을 볼까요?")) return;
    onShowAll?.();
  }

  function renderForm(value: Draft, update: (next: Draft) => void, editing?: string) {
    const id = `${formId}-${editing ?? "new"}`;
    const saved = editing ? data?.items.find((item) => item.id === editing) : undefined;
    return <form className={`followup-form${compact && !editing ? " followup-form-compact" : ""}`} onSubmit={(event) => saveDraft(event, value, editing)} onFocus={() => {
      if (busyId || editing || differentDraft(value, draftBaseline) || value.dueDate === todayDate()) return;
      const next = emptyDraft();
      setDraft(next);
      setDraftBaseline(next);
    }}>
      <div className="followup-form-main">
        <label className="followup-field followup-title-field" htmlFor={`${id}-title`}>
          <span>{editing ? "할 일 수정" : "무엇을 해야 하나요?"}</span>
          <input ref={editing ? undefined : titleInput} id={`${id}-title`} value={value.title} onChange={(event) => update({ ...value, title: event.target.value })} placeholder="예: 고객에게 상담 일정 확인하기" maxLength={200} required disabled={!!busyId} autoComplete="off" />
        </label>
        <label className="followup-field followup-date-field" htmlFor={`${id}-date`}>
          <span>예정일 <small>선택</small></span>
          <input id={`${id}-date`} type="date" min="0001-01-01" max="9999-12-31" value={value.dueDate} onChange={(event) => update({ ...value, dueDate: event.target.value })} disabled={!!busyId} />
        </label>
      </div>
      {(!compact || editing || value.notes || value.customerId || value.listingKey) && <label className="followup-field" htmlFor={`${id}-notes`}>
        <span>메모 <small>선택</small></span>
        <textarea id={`${id}-notes`} rows={2} value={value.notes} onChange={(event) => update({ ...value, notes: event.target.value })} maxLength={4000} placeholder="다음 연락 때 확인할 내용을 남겨두세요." disabled={!!busyId} />
      </label>}
      {(value.customerId || value.listingKey) && <div className="followup-linked-records" aria-label="연결된 기록">
        {value.customerId && <div className="followup-linked-record"><span>고객 · {saved ? saved.customer_name ?? "기록을 찾을 수 없음" : "선택한 고객"}</span><button type="button" disabled={!!busyId} onClick={() => update({ ...value, customerId: "" })}><Icon name="unlink" size={16} />고객 연결 해제</button></div>}
        {value.listingKey && <div className="followup-linked-record"><span>매물 · {saved ? saved.listing_label ?? "기록을 찾을 수 없음" : "선택한 매물"}</span><button type="button" disabled={!!busyId} onClick={() => update({ ...value, listingKey: "" })}><Icon name="unlink" size={16} />매물 연결 해제</button></div>}
        {saved && ((value.customerId && !saved.customer_name) || (value.listingKey && !saved.listing_label)) && <p className="followup-link-warning">연결된 기록을 확인할 수 없습니다. 필요하면 연결을 해제해 주세요.</p>}
      </div>}
      {!editing && editingId && <p className="followup-link-note">수정 중인 할 일을 저장하거나 취소한 뒤 새 할 일을 추가할 수 있습니다.</p>}
      <div className="followup-form-actions">
        {!compact || editing || draftDirty ? <button className="followup-button" type="button" disabled={!!busyId} onClick={() => cancelForm(editing)}>취소</button> : null}
        <button className="followup-button followup-button-primary" type="submit" disabled={!!busyId || !value.title.trim() || (!editing && !!editingId)}><Icon name={editing ? "save" : "plus"} size={18} />{busyId === (editing ?? "new") ? "저장 중…" : editing ? "수정 저장" : "할 일 추가"}</button>
      </div>
    </form>;
  }

  const summary = data?.summary;
  const items = data?.items ?? [];
  const visibleItems = compact ? items.slice(0, 5) : items;
  const filters: Array<{ id: Filter; label: string; count?: number }> = [
    { id: "all", label: "전체 진행", count: summary?.open },
    { id: "today", label: "오늘", count: summary?.today },
    { id: "overdue", label: "기한 지남", count: summary?.overdue },
    { id: "upcoming", label: "앞으로 7일" },
    { id: "completed", label: "완료", count: summary?.completed },
  ];

  return <section className={`followup-view${compact ? " followup-compact" : ""}`} aria-label={compact ? "챙겨야 할 일" : "할 일 관리"}>
    <div className="followup-heading">
      <div><h2>{compact ? "챙겨야 할 일" : "다음 연락과 약속, 놓치지 않게"}</h2><p>{compact ? (summary?.overdue ? `기한이 지난 ${summary.overdue}건부터 확인해 보세요.` : "고객 연락과 매물 확인을 미리 기록해 두세요.") : "고객 연락, 매물 확인, 약속 준비를 한곳에서 챙기세요."}</p></div>
      {compact ? onShowAll && <button className="followup-button followup-button-link" disabled={!!busyId} onClick={showAll}>전체 보기 <Icon name="next" size={18} /></button> : !showForm && <button className="followup-button followup-button-primary" disabled={!!busyId} onClick={openNewForm}><Icon name="plus" size={18} />할 일 추가</button>}
    </div>

    {compact && summary && <div className="followup-urgency" aria-label="챙겨야 할 일 요약">
      <div className={`followup-urgency-count${summary.overdue ? " is-overdue" : ""}`}><Icon name="warning" size={18} /><span>기한 지남</span><strong>{summary.overdue.toLocaleString()}<small>건</small></strong></div>
      <div className={`followup-urgency-count${summary.today ? " is-today" : ""}`}><Icon name="calendar" size={18} /><span>오늘</span><strong>{summary.today.toLocaleString()}<small>건</small></strong></div>
    </div>}

    {!compact && <>
      <div className="followup-filters" aria-label="할 일 필터">
        {filters.map((item) => <button key={item.id} className={`followup-filter${filter === item.id ? " is-active" : ""}${item.id === "overdue" ? " is-overdue" : ""}`} aria-pressed={filter === item.id} onClick={() => { if (editDirty && !window.confirm("저장하지 않은 수정 내용이 있습니다. 취소하고 목록을 바꿀까요?")) return; setFilter(item.id); setEditingId(null); }} disabled={!!busyId}><Icon name={item.id === "overdue" ? "warning" : item.id === "completed" ? "check" : item.id === "all" ? "tasks" : "calendar"} size={18} />{item.label}{item.count !== undefined && <span>{item.count.toLocaleString()}</span>}</button>)}
      </div>
      <label className="followup-search" htmlFor={`${formId}-search`}><span><Icon name="search" size={18} />할 일 검색</span><input id={`${formId}-search`} type="search" maxLength={200} value={query} disabled={!!busyId || !!editingId} title={editingId ? "수정을 저장하거나 취소한 뒤 검색할 수 있습니다." : undefined} onChange={(event) => setQuery(event.target.value)} placeholder="할 일, 메모, 고객명으로 검색" /></label>
    </>}

    {!compact && showForm && renderForm(draft, setDraft)}
    {error && <div className="followup-message followup-error" role="alert"><span><Icon name="warning" size={18} />{error}</span><button className="followup-button" disabled={loading || !!busyId} onClick={() => { void reload(); }}><Icon name="refresh" size={18} />다시 불러오기</button></div>}
    {notice && <div className="followup-message followup-notice" role="status"><span><Icon name="check" size={18} />{notice}</span><button className="followup-dismiss" aria-label="안내 닫기" onClick={() => setNotice("")}><Icon name="close" size={20} /></button></div>}

    {data && items.length > 0 && <p className="followup-sort-note">{!compact && filter === "completed" ? "최근 완료한 순" : compact ? "기한 지난 일 먼저 · 예정일순" : "기한 지난 일 → 예정일순 → 날짜 미정"}</p>}
    {loading && !data ? <div className="followup-empty" role="status"><span className="followup-loading-dot" aria-hidden="true" /><p>할 일을 불러오고 있습니다.</p></div> : <div className="followup-list" aria-busy={loading}>
      {loading && <p className="followup-refresh" role="status">목록을 새로 불러오는 중…</p>}
      {!visibleItems.length && !error ? <div className="followup-empty"><span className="followup-empty-symbol" aria-hidden="true"><Icon name={search && !compact ? "search" : "tasks"} size={24} /></span><strong>{search && !compact ? "검색된 할 일이 없습니다" : filter === "completed" && !compact ? "완료한 할 일이 없습니다" : filter !== "all" && !compact ? "해당하는 할 일이 없습니다" : "지금 챙길 할 일이 없습니다"}</strong><p>{search && !compact ? "다른 검색어나 필터로 찾아보세요." : "다음에 연락하거나 확인할 일을 남겨두세요."}</p></div> : null}
      {visibleItems.map((item) => <article key={item.id} className={`followup-item${item.completed_at ? " is-completed" : ""}${!item.completed_at && item.due_date && item.due_date < today ? " is-overdue" : ""}`}>
        {editingId === item.id ? renderForm(editDraft, setEditDraft, item.id) : <>
          <button className="followup-check" title={item.completed_at ? "다시 진행하기" : "완료하기"} aria-label={`${item.title}: ${item.completed_at ? "다시 진행하기" : "완료하기"}`} aria-pressed={!!item.completed_at} disabled={!!busyId} onClick={() => { void mutate(item.id, "PATCH", { completed: !item.completed_at }, item.completed_at ? "할 일을 다시 열었습니다." : "할 일을 완료했습니다."); }}><span aria-hidden="true">{busyId === item.id ? <Icon name="clock" size={16} /> : item.completed_at ? <Icon name="check" size={18} /> : null}</span></button>
          <div className="followup-item-body">
            <div className="followup-item-top"><h3>{item.title}</h3><span className={`followup-due${!item.completed_at && item.due_date === today ? " is-today" : ""}`}><Icon name={item.completed_at ? "check" : item.due_date && item.due_date < today ? "warning" : "calendar"} size={16} /><time dateTime={item.completed_at?.slice(0, 10) ?? item.due_date ?? undefined}>{dueText(item, today)}</time></span></div>
            {item.notes && <p className="followup-notes">{item.notes}</p>}
            {(item.customer_id || item.listing_key) && <div className="followup-links">
              {item.customer_id && (onOpenCustomer && item.customer_name ? <button disabled={!!busyId} onClick={() => onOpenCustomer(item.customer_id!, item.customer_name!)}><Icon name="customers" size={16} />고객 · {item.customer_name} <Icon name="upRight" size={16} /></button> : <span><Icon name="customers" size={16} />고객 · {item.customer_name ?? "연결된 기록 확인 불가"}</span>)}
              {item.listing_key && (onOpenListing && item.listing_label ? <button disabled={!!busyId} onClick={() => onOpenListing(item.listing_key!)}><Icon name="listings" size={16} />매물 · {item.listing_label} <Icon name="upRight" size={16} /></button> : <span><Icon name="listings" size={16} />매물 · {item.listing_label ?? "연결된 기록 확인 불가"}</span>)}
            </div>}
            <div className="followup-item-actions">
              <button disabled={!!busyId} onClick={() => startEdit(item)}><Icon name="edit" size={16} />수정</button>
              {!item.completed_at && <button disabled={!!busyId || item.due_date === "9999-12-31"} onClick={() => { const base = item.due_date && item.due_date > today ? item.due_date : today; void mutate(item.id, "PATCH", { dueDate: nextDay(base) }, "예정일을 하루 미뤘습니다."); }}><Icon name="calendarPlus" size={16} />{!item.due_date || item.due_date <= today ? "내일로 미루기" : "하루 미루기"}</button>}
              <button className="followup-delete" disabled={!!busyId} onClick={() => { if (window.confirm(`“${item.title}” 할 일을 삭제할까요?`)) void mutate(item.id, "DELETE", undefined, "할 일을 삭제했습니다."); }}><Icon name="delete" size={16} />삭제</button>
            </div>
          </div>
        </>}
      </article>)}
    </div>}
    {compact && renderForm(draft, setDraft)}
    {compact && items.length > visibleItems.length && onShowAll && <button className="followup-show-more" disabled={!!busyId} onClick={showAll}>나머지 {items.length - visibleItems.length}건 더 보기 <Icon name="next" size={18} /></button>}
  </section>;
}
