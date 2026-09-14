import { getD1 } from "../../../db";
import { searchedWorkSummary } from "../_queries";
import { propertySearch, textSearch, workSearch } from "../_search.js";
import { apiError, ready } from "../_shared";
import {
  CUSTOMER_LAST_WORK_DATE_SQL, CUSTOMER_RECENT_ORDER, CUSTOMER_SEARCH_RANK,
  escapedLike, LISTING_ACTIVE_ORDER,
  LISTING_LAST_UPDATED_SQL, LISTING_LOCATION_ORDER, LISTING_SEARCH_RANK, WORK_RECENT_ORDER,
} from "../_ordering";

export async function GET(request: Request) {
  try {
    await ready();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!q) return Response.json({ workLogs: [], customers: [], listings: [] });

    const prefix = escapedLike(q, true);
    const work = workSearch(q);
    const summary = searchedWorkSummary(propertySearch(q, "sp", "work"));
    const customer = textSearch(["c.id", "c.name", "c.notes"], q, ["c.id"]);
    const listing = propertySearch(q);
    const db = getD1();
    const [workLogs, customers, listings] = await db.batch<Record<string, unknown>>([
      db.prepare(`${summary.sql}
        WHERE ${work.sql}
        ORDER BY ${WORK_RECENT_ORDER}
        LIMIT 8
      `).bind(...summary.bindings, ...work.bindings),
      db.prepare(`
        SELECT c.id, c.name, c.notes, c.created_at, c.updated_at, c.is_demo,
          COUNT(w.id) AS history_count, ${CUSTOMER_LAST_WORK_DATE_SQL} AS last_work_date
        FROM customers c
        LEFT JOIN work_logs w ON w.customer_id = c.id
        WHERE ${customer.sql}
        GROUP BY c.id
        ORDER BY ${CUSTOMER_SEARCH_RANK}, ${CUSTOMER_RECENT_ORDER}
        LIMIT 8
      `).bind(...customer.bindings, q, q, prefix, prefix),
      db.prepare(`
        SELECT * FROM listings
        WHERE ${listing.sql}
        ORDER BY ${LISTING_SEARCH_RANK}, ${LISTING_ACTIVE_ORDER}, ${LISTING_LAST_UPDATED_SQL} DESC, ${LISTING_LOCATION_ORDER}
        LIMIT 8
      `).bind(...listing.bindings,
        q, q, q, q, prefix, prefix, prefix, prefix),
    ]);

    return Response.json({
      workLogs: workLogs.results,
      customers: customers.results,
      listings: listings.results,
    });
  } catch (error) {
    return apiError(error, "통합검색 결과를 불러오지 못했습니다.");
  }
}
