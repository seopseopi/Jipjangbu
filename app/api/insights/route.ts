import { getD1 } from "../../../db";
import { WORK_SUMMARY_SQL } from "../_queries";
import { apiError, ready } from "../_shared";
import { HOME_UPCOMING_ORDER, LISTING_OLDEST_ORDER } from "../_ordering";

type SummaryRow = {
  month_work_count: number;
  month_customer_count: number;
  active_listing_count: number;
  stale_listing_count: number;
};

export async function GET() {
  try {
    await ready();
    const db = getD1();
    const [
      summaryRow,
      monthlyRows,
      workTypeRows,
      upcomingRows,
      staleListingRows,
    ] = await Promise.all([
      db
        .prepare(
          `
        SELECT
          (SELECT COUNT(*) FROM work_logs
            WHERE work_date >= date('now', '+9 hours', 'start of month')
              AND work_date < date('now', '+9 hours', 'start of month', '+1 month')) AS month_work_count,
          (SELECT COUNT(DISTINCT customer_id) FROM work_logs
            WHERE work_date >= date('now', '+9 hours', 'start of month')
              AND work_date < date('now', '+9 hours', 'start of month', '+1 month')) AS month_customer_count,
          (SELECT COUNT(*) FROM listings WHERE closed_at IS NULL) AS active_listing_count,
          (SELECT COUNT(*) FROM listings
            WHERE closed_at IS NULL
              AND date(COALESCE(NULLIF(updated_at, ''), registered_at, '1900-01-01'))
                <= date('now', '+9 hours', '-90 days')) AS stale_listing_count
      `,
        )
        .first<SummaryRow>(),
      db
        .prepare(
          `
        WITH RECURSIVE month_range(month, step) AS (
          SELECT strftime('%Y-%m', 'now', '+9 hours', 'start of month', '-5 months'), 0
          UNION ALL
          SELECT strftime('%Y-%m', month || '-01', '+1 month'), step + 1
          FROM month_range WHERE step < 5
        )
        SELECT month_range.month AS month, COUNT(work_logs.id) AS count
        FROM month_range
        LEFT JOIN work_logs ON work_logs.work_date >= month_range.month || '-01'
          AND work_logs.work_date < date(month_range.month || '-01', '+1 month')
        GROUP BY month_range.month, month_range.step
        ORDER BY month_range.step
      `,
        )
        .all<{ month: string; count: number }>(),
      db
        .prepare(
          `
        SELECT work_type AS name, COUNT(*) AS count
        FROM work_logs
        WHERE work_date >= date('now', '+9 hours', 'start of month')
          AND work_date < date('now', '+9 hours', 'start of month', '+1 month')
        GROUP BY work_type
        ORDER BY count DESC, name
      `,
        )
        .all<{ name: string; count: number }>(),
      db
        .prepare(
          `${WORK_SUMMARY_SQL}
        WHERE w.work_date > date('now', '+9 hours')
          AND w.work_date <= date('now', '+9 hours', '+30 days')
          AND (w.work_type LIKE '%예정' OR w.work_type LIKE '%예약')
        ORDER BY ${HOME_UPCOMING_ORDER}
        LIMIT 12
      `,
        )
        .all(),
      db
        .prepare(
          `
        SELECT * FROM listings
        WHERE closed_at IS NULL
          AND date(COALESCE(NULLIF(updated_at, ''), registered_at, '1900-01-01'))
            <= date('now', '+9 hours', '-90 days')
        ORDER BY ${LISTING_OLDEST_ORDER}
        LIMIT 12
      `,
        )
        .all(),
    ]);

    return Response.json({
      summary: {
        monthWorkCount: Number(summaryRow?.month_work_count ?? 0),
        monthCustomerCount: Number(summaryRow?.month_customer_count ?? 0),
        activeListingCount: Number(summaryRow?.active_listing_count ?? 0),
        staleListingCount: Number(summaryRow?.stale_listing_count ?? 0),
      },
      monthly: monthlyRows.results.map((row) => ({
        month: row.month,
        count: Number(row.count),
      })),
      workTypes: workTypeRows.results.map((row) => ({
        name: row.name,
        count: Number(row.count),
      })),
      upcoming: upcomingRows.results,
      staleListings: staleListingRows.results,
    });
  } catch (error) {
    return apiError(error, "현황 분석을 불러오지 못했습니다.");
  }
}
