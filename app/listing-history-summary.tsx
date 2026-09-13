import { Icon } from "./icons";
import { formatHistoryTimestamp, latestSavedListingEvent } from "./history-timestamps";
import "./listing-history-summary.css";

type SummaryEvent = {
  work_log_id?: string | null;
  event_date?: string;
  status?: string | null;
  notes?: string | null;
  work_updated_at?: string | null;
  work_created_at?: string | null;
  created_at?: string | null;
};

/** Latest saved work and the unmodified Excel source are separate information. */
export function ListingHistorySummary({ events, sourceNotes, onOpenWork }: {
  events: SummaryEvent[];
  sourceNotes?: string;
  onOpenWork?: (id: string) => void;
}) {
  const latest = latestSavedListingEvent(events);
  const savedAt = latest
    ? formatHistoryTimestamp(latest.work_updated_at) || formatHistoryTimestamp(latest.created_at)
    : "";
  const hasSource = Boolean(sourceNotes?.trim());
  if (!latest && !hasSource) return null;
  return (
    <div className="listing-saved-summary">
      {latest && (
        <section className="listing-latest-save" aria-label={savedAt ? "최근 저장한 업무 내용" : "최근 업무 내용"}>
          <div className="listing-latest-save-heading">
            <h3>{savedAt ? "최근 저장한 업무 내용" : "최근 업무 내용"}</h3>
            {onOpenWork && latest.work_log_id && (
              <button type="button" className="listing-latest-open" onClick={() => onOpenWork(latest.work_log_id!)}>
                업무 내용 보기 <Icon name="next" size={15} />
              </button>
            )}
          </div>
          <div className="listing-latest-save-meta">
            <span>업무일 · {latest.event_date ? <time dateTime={latest.event_date}>{latest.event_date.replaceAll("-", ".")}</time> : "미기재"}</span>
            {latest.status && <strong>{latest.status}</strong>}
            {savedAt && <span>최근 저장 · {savedAt} (한국시간)</span>}
          </div>
          {!savedAt && <p className="listing-save-time-unknown">저장 시각 정보 없음 · 업무일 기준으로 표시합니다.</p>}
          <p className="listing-latest-save-content">{latest.notes?.trim() ? latest.notes : "기록된 내용 없음"}</p>
        </section>
      )}
      {hasSource && (
        <details className="listing-source-notes">
          <summary><Icon name="next" size={16} /> 엑셀 원본 메모</summary>
          <p>{sourceNotes}</p>
        </details>
      )}
    </div>
  );
}
