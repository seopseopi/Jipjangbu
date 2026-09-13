import { getD1 } from "../../../../db";
import { apiError, ready } from "../../_shared";

export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    await ready();
    const { key } = await params;
    const listingKey = decodeURIComponent(key);
    const db = getD1();
    // Read the current value and its history in one snapshot, including when a
    // second signed-in device saves another event while this dialog is opening.
    const [listings, events] = await db.batch([
      db.prepare("SELECT * FROM listings WHERE identity_key = ?").bind(listingKey),
      db.prepare(`
        SELECT e.*, c.id AS customer_id, c.name AS customer_name
        FROM listing_events e JOIN work_logs w ON w.id = e.work_log_id JOIN customers c ON c.id = w.customer_id
        WHERE e.listing_key = ?
        ORDER BY e.event_date DESC, e.event_order DESC, e.created_at DESC, e.id DESC
      `).bind(listingKey),
    ]);
    const listing = listings.results[0];
    if (!listing) return Response.json({ error: "매물을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ listing, events: events.results });
  } catch (error) {
    return apiError(error, "매물 이력을 불러오지 못했습니다.");
  }
}
