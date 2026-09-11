"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientJsonFetch } from "./client-api";

export type GlobalSearchWorkLog = {
  id: string;
  work_date: string;
  customer_id: string;
  customer_name: string;
  work_type: string;
  content: string;
  property_type?: string;
  building_name?: string;
  building_dong?: string;
  unit_number?: string;
  size_type?: string;
  sale_price?: string;
  jeonse_price?: string;
  monthly_rent?: string;
  property_count: number;
  is_demo: number;
  updated_at?: string;
};

export type GlobalSearchCustomer = {
  id: string;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
  history_count: number;
  last_work_date?: string;
  is_demo: number;
};

export type GlobalSearchListing = {
  id: string;
  identity_key: string;
  registered_at?: string;
  closed_at?: string;
  status: string;
  property_type: string;
  building_name: string;
  building_dong: string;
  unit_number: string;
  size_type: string;
  sale_price: string;
  jeonse_price: string;
  monthly_rent: string;
  notes: string;
  source_notes?: string;
  is_demo: number;
  updated_at?: string;
};

type SearchResponse = {
  workLogs: GlobalSearchWorkLog[];
  customers: GlobalSearchCustomer[];
  listings: GlobalSearchListing[];
};

type SearchStatus = "idle" | "loading" | "success" | "error";

export type GlobalSearchProps = {
  open: boolean;
  onClose: () => void;
  onOpenWork: (id: string) => void;
  onOpenCustomer: (customer: GlobalSearchCustomer) => void;
  onOpenListing: (listing: GlobalSearchListing) => void;
};

const emptyResults = (): SearchResponse => ({ workLogs: [], customers: [], listings: [] });

function displayDate(value?: string): string {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

function listingName(item: Pick<GlobalSearchListing, "building_name" | "building_dong" | "unit_number">): string {
  const detail = [item.building_dong ? `${item.building_dong}동` : "", item.unit_number ? `${item.unit_number}호` : ""]
    .filter(Boolean)
    .join(" ");
  return item.building_name ? `${item.building_name}${detail ? ` ${detail}` : ""}` : "건물명 없음";
}

function workTarget(item: GlobalSearchWorkLog): string {
  if (!item.building_name) return item.customer_name;
  return listingName({
    building_name: item.building_name,
    building_dong: item.building_dong ?? "",
    unit_number: item.unit_number ?? "",
  });
}

async function searchRequest(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const body = await clientJsonFetch<Partial<SearchResponse>>(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  return {
    workLogs: Array.isArray(body.workLogs) ? body.workLogs.slice(0, 8) : [],
    customers: Array.isArray(body.customers) ? body.customers.slice(0, 8) : [],
    listings: Array.isArray(body.listings) ? body.listings.slice(0, 8) : [],
  };
}

export function GlobalSearch({ open, onClose, onOpenWork, onOpenCustomer, onOpenListing }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>(emptyResults);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const onCloseRef = useRef(onClose);
  const trimmedQuery = query.trim();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const close = useCallback(() => {
    requestSequence.current += 1;
    controllerRef.current?.abort();
    setError("");
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [close, open]);

  useEffect(() => {
    if (!open || trimmedQuery.length < 2) return;
    const sequence = ++requestSequence.current;
    let requestController: AbortController | null = null;
    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      requestController = controller;
      controllerRef.current?.abort();
      controllerRef.current = controller;
      try {
        const nextResults = await searchRequest(trimmedQuery, controller.signal);
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setResults(nextResults);
        setStatus("success");
      } catch (searchError) {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setError(searchError instanceof Error ? searchError.message : "검색 결과를 불러오지 못했습니다.");
        setStatus("error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      requestController?.abort();
    };
  }, [open, trimmedQuery]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function changeQuery(value: string) {
    requestSequence.current += 1;
    controllerRef.current?.abort();
    setQuery(value);
    setResults(emptyResults());
    setError("");
    setStatus(value.trim().length >= 2 ? "loading" : "idle");
  }

  function chooseWork(id: string) {
    close();
    onOpenWork(id);
  }

  function chooseCustomer(customer: GlobalSearchCustomer) {
    close();
    onOpenCustomer(customer);
  }

  function chooseListing(listing: GlobalSearchListing) {
    close();
    onOpenListing(listing);
  }

  if (!open) return null;

  const resultCount = results.workLogs.length + results.customers.length + results.listings.length;

  return (
    <div className="global-search-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={dialogRef} className="global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title" tabIndex={-1}>
        <header className="global-search-header">
          <div className="global-search-heading">
            <p className="global-search-kicker">통합검색</p>
            <h2 id="global-search-title">업무·고객·매물을 한 번에 찾기</h2>
          </div>
          <button className="global-search-close" type="button" onClick={close} aria-label="통합검색 닫기">×</button>
        </header>

        <div className="global-search-input-wrap">
          <span className="global-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="global-search-input"
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="이름, 연락처, 건물명, 동·호수, 업무 내용을 입력하세요"
            aria-label="통합검색어"
            aria-describedby="global-search-help"
            autoComplete="off"
          />
          {query && <button className="global-search-clear" type="button" onClick={() => changeQuery("")} aria-label="검색어 지우기">×</button>}
        </div>
        <p className="global-search-help" id="global-search-help">두 글자 이상 입력하면 자동으로 검색합니다.</p>

        <div className="global-search-body" aria-live="polite" aria-busy={status === "loading"}>
          {status === "idle" && <div className="global-search-idle"><span aria-hidden="true">⌕</span><p>찾을 내용을 두 글자 이상 입력해 주세요.</p></div>}
          {status === "loading" && <div className="global-search-loading"><span aria-hidden="true" /><p>관련 기록을 찾고 있습니다.</p></div>}
          {status === "error" && <div className="global-search-error" role="alert"><strong>검색하지 못했습니다.</strong><p>{error}</p></div>}
          {status === "success" && resultCount === 0 && <div className="global-search-empty"><span aria-hidden="true">✓</span><p>일치하는 업무, 고객, 매물이 없습니다.</p></div>}

          {status === "success" && results.workLogs.length > 0 && (
            <section className="global-search-group" aria-labelledby="global-search-work-title">
              <div className="global-search-group-head"><h3 id="global-search-work-title">업무</h3><span>{results.workLogs.length}건</span></div>
              <div className="global-search-list">
                {results.workLogs.map((item) => (
                  <button className="global-search-result global-search-work" type="button" key={item.id} onClick={() => chooseWork(item.id)}>
                    <span className="global-search-result-date">{displayDate(item.work_date)}</span>
                    <span className="global-search-result-copy"><strong>{workTarget(item)}</strong><small>{item.content || item.customer_name}</small></span>
                    <span className="global-search-result-meta">{item.work_type}</span>
                    <span className="global-search-result-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {status === "success" && results.customers.length > 0 && (
            <section className="global-search-group" aria-labelledby="global-search-customer-title">
              <div className="global-search-group-head"><h3 id="global-search-customer-title">고객</h3><span>{results.customers.length}명</span></div>
              <div className="global-search-list">
                {results.customers.map((customer) => (
                  <button className="global-search-result global-search-customer" type="button" key={customer.id} onClick={() => chooseCustomer(customer)}>
                    <span className="global-search-result-copy"><strong>{customer.name}</strong><small>{customer.id}{customer.notes ? ` · ${customer.notes}` : ""}</small></span>
                    <span className="global-search-result-meta">업무 {Number(customer.history_count) || 0}건</span>
                    <span className="global-search-result-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {status === "success" && results.listings.length > 0 && (
            <section className="global-search-group" aria-labelledby="global-search-listing-title">
              <div className="global-search-group-head"><h3 id="global-search-listing-title">매물</h3><span>{results.listings.length}건</span></div>
              <div className="global-search-list">
                {results.listings.map((listing) => (
                  <button className="global-search-result global-search-listing" type="button" key={listing.id} onClick={() => chooseListing(listing)}>
                    <span className="global-search-result-copy"><strong>{listingName(listing)}</strong><small>{listing.property_type}{listing.size_type ? ` · ${listing.size_type}` : ""}</small></span>
                    <span className="global-search-result-meta">{listing.status}</span>
                    <span className="global-search-result-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
