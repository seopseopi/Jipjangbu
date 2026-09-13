import { Icon } from "./icons";
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

/** Read every event as one chronological memo without changing the API order. */
export function ListingHistorySummary({ events, sourceNotes }: {
  events: SummaryEvent[];
  sourceNotes?: string;
}) {
  const hasSource = Boolean(sourceNotes?.trim());
  if (!events.length && !hasSource) return null;
  const memo = events.length ? events.map((event) => {
    const content = event.notes?.trim() ? event.notes : "";
    const context = [event.status && `(${event.status})`, event.event_date && `(${event.event_date})`].filter(Boolean).join(" ");
    return [content, context].filter(Boolean).join("\n") || "기록된 내용 없음";
  }).join("\n\n") : sourceNotes;
  return (
    <div className="listing-saved-summary">
      <section className="listing-all-history" aria-label="전체 매물 이력">
        <div className="listing-all-history-heading">
          <h3>전체 매물 이력</h3>
          <span>{events.length ? `업무일 최신순 · ${events.length.toLocaleString("ko-KR")}건` : "엑셀 원본 메모"}</span>
        </div>
        <p className="listing-history-memo">{memo}</p>
      </section>
      {events.length > 0 && hasSource && (
        <details className="listing-source-notes">
          <summary><Icon name="next" size={16} /> 엑셀 원본 메모</summary>
          <p>{sourceNotes}</p>
        </details>
      )}
    </div>
  );
}
