"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { clientJsonFetch } from "./client-api";
import { Icon } from "./icons";
import { WorkSummaryProperties } from "./work-summary-properties";
import { ListingHistorySummary } from "./listing-history-summary";
import { formatHistoryTimestamp } from "./history-timestamps";
import {
  createHistoryRequestScope,
  HISTORY_PAGE_SIZE,
  historyQueryUrl,
  historyTargetKey,
  mergeHistoryRecords,
  retryInterruptedHistoryRead,
  type RelatedHistoryTarget,
} from "./history-query";

type SavedProperty = {
  id?: string;
  property_type?: string;
  building_name?: string;
  building_dong?: string;
  unit_number?: string;
  size_type?: string;
  sale_price?: string;
  jeonse_price?: string;
  monthly_rent?: string;
  source?: string;
};

type SavedWork = SavedProperty & {
  id: string;
  work_date: string;
  work_type: string;
  customer_name: string;
  content: string;
  property_count?: number;
  properties_json?: string;
  updated_at?: string;
  created_at?: string;
  details: SavedProperty[];
};

type ListingEvent = SavedProperty & {
  id: string;
  work_log_id: string;
  event_date: string;
  status: string;
  customer_name: string;
  notes: string;
  work_updated_at?: string;
  work_created_at?: string;
  created_at?: string;
};

type HistoryRecord = {
  id: string;
  workId: string;
  date: string;
  workType: string;
  customerName: string;
  content: string;
  property: SavedProperty & { properties_json?: string };
  propertyCount: number;
  savedAt?: string;
};

type HistoryData = {
  records: HistoryRecord[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
  sourceNotes: string;
  listingEvents: ListingEvent[];
};

type RequestScope = ReturnType<typeof createHistoryRequestScope>;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "이력을 불러오지 못했습니다. 다시 시도해 주세요.";
}

function propertyLabel(property: SavedProperty) {
  return [
    property.property_type,
    property.building_name,
    property.building_dong && `${property.building_dong}동`,
    property.unit_number && `${property.unit_number}호`,
    property.size_type,
  ]
    .filter(Boolean)
    .join(" ");
}

function priceLabel(property: SavedProperty) {
  return [
    property.sale_price && `매매 ${property.sale_price}`,
    property.jeonse_price && `전세 ${property.jeonse_price}`,
    property.monthly_rent && `월세 ${property.monthly_rent}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function RelatedHistory({
  target,
  currentWorkId,
  onClose,
}: {
  target: RelatedHistoryTarget;
  currentWorkId?: string;
  onClose: () => void;
}) {
  // A new identity must not show even one frame of the previous customer's data.
  return (
    <HistoryPanel
      key={historyTargetKey(target)}
      target={target}
      currentWorkId={currentWorkId}
      onClose={onClose}
    />
  );
}

function HistoryPanel({
  target,
  currentWorkId,
  onClose,
}: {
  target: RelatedHistoryTarget;
  currentWorkId?: string;
  onClose: () => void;
}) {
  const headingId = useId();
  const scopeRef = useRef<RequestScope | null>(null);
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const baseUrl = historyQueryUrl(target);
  const isListing = target.kind === "listing";

  const load = useCallback(
    async (scope: RequestScope, offset: number) => {
      if (scope.busy) return;
      const outcome = await scope.run((signal) =>
        retryInterruptedHistoryRead(async (readSignal): Promise<HistoryData> => {
          if (isListing) {
            let response: {
              listing: { source_notes?: string };
              events: ListingEvent[];
            };
            try {
              response = await clientJsonFetch(baseUrl, { signal: readSignal });
            } catch (failure) {
              // This is the existing API's specific 404; network/server errors
              // must remain visible and retryable, not look like an empty history.
              if (errorMessage(failure) !== "매물을 찾을 수 없습니다.") {
                throw failure;
              }
              return {
                records: [],
                total: 0,
                nextOffset: 0,
                hasMore: false,
                sourceNotes: "",
                listingEvents: [],
              };
            }
            return {
              records: response.events.map((event) => ({
                id: event.id,
                workId: event.work_log_id,
                date: event.event_date,
                workType: event.status,
                customerName: event.customer_name,
                content: event.notes,
                property: event,
                propertyCount: 1,
                savedAt: formatHistoryTimestamp(event.work_updated_at) || formatHistoryTimestamp(event.created_at),
              })),
              total: response.events.length,
              nextOffset: response.events.length,
              hasMore: false,
              sourceNotes: response.listing.source_notes ?? "",
              listingEvents: response.events,
            };
          }
          const url = new URL(baseUrl, "https://history.invalid");
          url.searchParams.set("offset", String(offset));
          const response = await clientJsonFetch<{
            workLogs: SavedWork[];
            total: number;
          }>(`${url.pathname}${url.search}`, { signal: readSignal });
          const nextOffset = offset + response.workLogs.length;
          return {
            records: response.workLogs.map((work) => ({
              id: work.id,
              workId: work.id,
              date: work.work_date,
              workType: work.work_type,
              customerName: work.customer_name,
              content: work.content,
              property: work,
              propertyCount: work.property_count ?? 0,
              savedAt: formatHistoryTimestamp(work.updated_at) || formatHistoryTimestamp(work.created_at),
            })),
            total: response.total,
            nextOffset,
            hasMore: response.workLogs.length > 0 && nextOffset < response.total,
            sourceNotes: "",
            listingEvents: [],
          };
        }, signal),
      );
      if (outcome.status === "ignored") return;
      if (outcome.status === "success") {
        setData((previous) => ({
          ...outcome.value,
          records:
            offset && previous
              ? mergeHistoryRecords(previous.records, outcome.value.records)
              : outcome.value.records,
        }));
      } else {
        setError(errorMessage(outcome.error));
      }
      setLoading(false);
    },
    [baseUrl, isListing],
  );

  useEffect(() => {
    const scope = createHistoryRequestScope();
    scopeRef.current = scope;
    // Defer the initial read so a Strict Mode cleanup can dispose its scope
    // before starting a duplicate request.
    queueMicrotask(() => void load(scope, 0));
    return () => {
      scope.dispose();
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [load]);

  const visibleRecords = isListing
    ? (data?.records ?? []).slice(0, visibleCount)
    : (data?.records ?? []);
  const canShowMore = isListing
    ? visibleRecords.length < (data?.records.length ?? 0)
    : Boolean(data?.hasMore);

  function requestMore() {
    if (loading || !scopeRef.current) return;
    if (isListing) {
      setVisibleCount((count) => count + HISTORY_PAGE_SIZE);
    } else {
      setLoading(true);
      setError("");
      void load(scopeRef.current, data?.nextOffset ?? 0);
    }
  }

  const recordList = <>
    {visibleRecords.length > 0 && (
      <div className="related-history-list">
        {visibleRecords.map((record) => (
          <HistoryRecordRow
            key={record.id}
            record={record}
            current={Boolean(currentWorkId && record.workId === currentWorkId)}
          />
        ))}
      </div>
    )}
    {canShowMore && !error && (
      <button type="button" className="secondary-button" onClick={requestMore} disabled={loading}>
        <Icon name="plus" size={18} />
        {loading ? "불러오는 중…" : `${HISTORY_PAGE_SIZE}건 더 보기`}
        {data && ` (${visibleRecords.length}/${data.total})`}
      </button>
    )}
  </>;

  return (
    <section className="related-history" aria-labelledby={headingId} onKeyDownCapture={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
      <div className="related-history-header">
        <div className="related-history-heading">
          <Icon name={isListing ? "listings" : "customers"} size={20} />
          <div>
            <h3 id={headingId}>
              {isListing ? "매물 변경 이력" : "고객 업무 이력"}
            </h3>
            <p>{target.name}</p>
          </div>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onClose}
          aria-label={`${isListing ? "매물" : "고객"} 이력 닫기`}
        >
          <Icon name="close" size={18} /> 닫기
        </button>
      </div>
      {data && !isListing && (
        <p className="related-history-summary">
          총 {data.total.toLocaleString("ko-KR")}건 · 업무일 최신순
        </p>
      )}
      {isListing && data && <ListingHistorySummary events={data.listingEvents} sourceNotes={data.sourceNotes} />}
      {loading && !data && (
        <p className="related-history-status" role="status">
          저장된 이력을 불러오는 중입니다…
        </p>
      )}
      {error && (
        <div className="related-history-status" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => {
              if (scopeRef.current) {
                setLoading(true);
                setError("");
                void load(scopeRef.current, data?.nextOffset ?? 0);
              }
            }}
          >
            <Icon name="refresh" size={18} /> 다시 불러오기
          </button>
        </div>
      )}
      {data && !data.records.length && !error && (
        <p className="related-history-status">
          {isListing
            ? data.sourceNotes.trim() ? "연결된 개별 업무 기록은 없습니다." : "이 물건에 저장된 매물 변경 이력이 없습니다."
            : "이 고객에게 저장된 업무 이력이 없습니다."}
        </p>
      )}
      {isListing && visibleRecords.length > 0 ? (
        <details className="listing-individual-records">
          <summary><Icon name="next" size={16} /> 개별 업무 보기 · {data?.total.toLocaleString("ko-KR")}건</summary>
          {recordList}
        </details>
      ) : recordList}
      <p className="related-history-footer">
        조회만 하며 작성 중 내용은 바뀌지 않습니다.
      </p>
    </section>
  );
}

function HistoryRecordRow({
  record,
  current,
}: {
  record: HistoryRecord;
  current: boolean;
}) {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`history-record${current ? " is-current" : ""}`}>
      <div className="history-record-meta">
        <time dateTime={record.date}>업무일 · {record.date.replaceAll("-", ".")}</time>
        <strong>{record.workType}</strong>
        <span>{record.customerName}</span>
        {current && (
          <span className="history-record-current">현재 수정 중 · 저장된 내용</span>
        )}
      </div>
      {record.savedAt && <span className="history-record-saved-at">최근 저장 · {record.savedAt}</span>}
      <p className="history-record-content">
        {record.content || "기록된 내용 없음"}
      </p>
      <WorkSummaryProperties work={{ ...record.property, property_count: record.propertyCount }} showSingle showPrices />
      {record.workId ? (
        <button
          type="button"
          className="history-record-toggle secondary-button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name="next" size={18} />
          {expanded ? "저장된 업무 접기" : "저장된 업무 전체 보기"}
        </button>
      ) : (
        <p className="related-history-status">연결된 업무 기록이 없습니다.</p>
      )}
      {expanded && (
        <div id={detailsId}>
          <SavedWorkDetails workId={record.workId} />
        </div>
      )}
    </article>
  );
}

function SavedWorkDetails({ workId }: { workId: string }) {
  const [work, setWork] = useState<SavedWork | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const scope = createHistoryRequestScope();
    void scope
      .run((signal) =>
        retryInterruptedHistoryRead(
          (readSignal) =>
            clientJsonFetch<{ workLog: SavedWork }>(
              `/api/work-logs/${encodeURIComponent(workId)}`,
              { signal: readSignal },
            ),
          signal,
        ),
      )
      .then((outcome) => {
        if (outcome.status === "success") setWork(outcome.value.workLog);
        if (outcome.status === "error") setError(errorMessage(outcome.error));
      });
    return () => scope.dispose();
  }, [workId, attempt]);

  if (error) {
    return (
      <div className="history-record-detail" role="alert">
        <p>{error}</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        >
          <Icon name="refresh" size={18} /> 다시 불러오기
        </button>
      </div>
    );
  }
  if (!work) {
    return (
      <p className="history-record-detail" role="status">
        저장된 업무를 불러오는 중입니다…
      </p>
    );
  }
  return (
    <div className="history-record-detail">
      <dl className="history-record-facts">
        <div><dt>업무일</dt><dd>{work.work_date}</dd></div>
        <div><dt>업무구분</dt><dd>{work.work_type}</dd></div>
        <div><dt>고객</dt><dd>{work.customer_name}</dd></div>
        {(formatHistoryTimestamp(work.updated_at) || formatHistoryTimestamp(work.created_at)) && <div><dt>최근 저장</dt><dd>{formatHistoryTimestamp(work.updated_at) || formatHistoryTimestamp(work.created_at)}</dd></div>}
      </dl>
      <p className="history-record-content">{work.content || "기록된 내용 없음"}</p>
      <div className="history-record-properties">
        {work.details.length ? (
          work.details.map((property, index) => (
            <div className="history-record-property" key={property.id ?? index}>
              <strong>물건 {index + 1} · {propertyLabel(property) || "주소 미기재"}</strong>
              <p>{priceLabel(property) || "가격 미기재"}</p>
              <p className="history-record-content">출처: {property.source || "미기재"}</p>
            </div>
          ))
        ) : (
          <p>연결된 물건이 없습니다.</p>
        )}
      </div>
    </div>
  );
}
