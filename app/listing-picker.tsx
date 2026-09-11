"use client";

import { useEffect, useId, useRef, useState } from "react";
import { clientJsonFetch } from "./client-api";
import { createHistoryRequestScope, retryInterruptedHistoryRead } from "./history-query";
import { Icon } from "./icons";
import {
  listingPickerQueryUrl,
  propertyFromListing,
  type ListingDraftSource,
} from "./listing-draft";

const DISPLAY_PAGE_SIZE = 10;
const API_RESULT_LIMIT = 1000;

export function ListingPicker({
  onSelect,
  onClose,
}: {
  onSelect: (listing: ListingDraftSource) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query.trim()), query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);
  const searching = query.trim() !== settledQuery;
  const url = listingPickerQueryUrl(settledQuery, includeClosed);

  return (
    <section className="listing-picker" aria-labelledby={headingId} onKeyDownCapture={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
      <div className="listing-picker-header">
        <div>
          <h3 id={headingId}><Icon name="listings" size={20} /> 기존 매물 불러오기</h3>
          <p>주소와 가격을 현재 물건 칸에 채웁니다.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose} aria-label="기존 매물 선택 닫기">
          <Icon name="close" size={18} /> 닫기
        </button>
      </div>
      <div className="listing-picker-controls">
        <label htmlFor={searchId}>매물 찾기</label>
        <div className="listing-picker-search">
          <Icon name="search" size={19} />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // This search is inside the work form: Enter must not save it.
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="건물명, 동, 호수, 매물 메모"
            autoComplete="off"
          />
          {query && <button type="button" className="listing-picker-clear" onClick={() => setQuery("")} aria-label="매물 검색어 지우기"><Icon name="close" size={18} /></button>}
        </div>
        <label className="listing-picker-closed-filter">
          <input type="checkbox" checked={includeClosed} onChange={(event) => setIncludeClosed(event.target.checked)} />
          종료된 매물도 포함
        </label>
      </div>
      {searching ? (
        <p className="listing-picker-message" role="status">검색어를 반영하고 있습니다…</p>
      ) : (
        <ListingPickerResults key={url} url={url} onSelect={onSelect} />
      )}
      <p className="listing-picker-footer">고객·업무구분·내용은 그대로 유지됩니다. 업무를 저장하기 전에는 원래 매물이 바뀌지 않습니다.</p>
    </section>
  );
}

function ListingPickerResults({
  url,
  onSelect,
}: {
  url: string;
  onSelect: (listing: ListingDraftSource) => void;
}) {
  const [rows, setRows] = useState<ListingDraftSource[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [visibleCount, setVisibleCount] = useState(DISPLAY_PAGE_SIZE);
  useEffect(() => {
    const scope = createHistoryRequestScope();
    void scope.run((signal) =>
      retryInterruptedHistoryRead(
        (readSignal) => clientJsonFetch<{ listings: ListingDraftSource[] }>(url, { signal: readSignal }),
        signal,
      ),
    ).then((outcome) => {
      if (outcome.status === "success") setRows(outcome.value.listings);
      if (outcome.status === "error") {
        setError(outcome.error instanceof Error ? outcome.error.message : "매물을 불러오지 못했습니다. 다시 시도해 주세요.");
      }
    });
    return () => scope.dispose();
  }, [url, attempt]);

  if (error) {
    return (
      <div className="listing-picker-message" role="alert">
        <p>{error}</p>
        <button type="button" className="secondary-button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>
          <Icon name="refresh" size={18} /> 다시 불러오기
        </button>
      </div>
    );
  }
  if (!rows) return <p className="listing-picker-message" role="status">저장된 매물을 불러오는 중입니다…</p>;
  if (!rows.length) return <p className="listing-picker-message">조건에 맞는 매물이 없습니다. 검색어를 줄이거나 ‘종료된 매물도 포함’을 선택해 보세요.</p>;

  const visibleRows = rows.slice(0, visibleCount);
  return (
    <>
      <p className="listing-picker-summary">검색된 매물 {rows.length.toLocaleString("ko-KR")}건 · 건물명 → 동 → 호수순 · 진행 중 우선</p>
      {rows.length >= API_RESULT_LIMIT && <p className="listing-picker-message">검색 결과는 최대 1,000건까지 조회됩니다. 원하는 매물이 없으면 건물명이나 호수로 검색 범위를 좁혀 주세요.</p>}
      <div className="listing-picker-results">
        {visibleRows.map((listing) => {
          const property = propertyFromListing(listing);
          const address = [property.buildingName, property.buildingDong && `${property.buildingDong}동`, property.unitNumber && `${property.unitNumber}호`].filter(Boolean).join(" ") || "주소 미기재";
          const prices = [property.salePrice && `매매 ${property.salePrice}`, property.jeonsePrice && `전세 ${property.jeonsePrice}`, property.monthlyRent && `월세 ${property.monthlyRent}`].filter(Boolean).join(" · ");
          const closed = listing.closed_at != null;
          return (
            <article className="listing-picker-row" key={listing.id}>
              <div className="listing-picker-row-copy">
                <div className="listing-picker-row-meta">
                  <span className={`listing-picker-status${closed ? " is-closed" : ""}`}>{closed ? "종료" : "진행 중"}{listing.status && ` · ${listing.status}`}</span>
                  <span>{[property.propertyType, property.sizeType && `타입 ${property.sizeType}`].filter(Boolean).join(" · ")}</span>
                </div>
                <strong>{address}</strong>
                <p>{prices || "가격 미기재"}</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => onSelect(listing)} aria-label={`${address}${closed ? " 종료된" : ""} 매물 불러오기`}>
                <Icon name="check" size={18} /> 불러오기
              </button>
            </article>
          );
        })}
      </div>
      {visibleRows.length < rows.length && <button type="button" className="secondary-button listing-picker-more" onClick={() => setVisibleCount((value) => value + DISPLAY_PAGE_SIZE)}><Icon name="plus" size={18} /> 10건 더 보기 ({visibleRows.length}/{rows.length})</button>}
    </>
  );
}
