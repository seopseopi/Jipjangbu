const WORK_COLUMNS_SQL = `
  SELECT w.id, w.work_date, w.customer_id, w.work_type, w.content, w.is_demo, w.updated_at,
    c.name AS customer_name,
    p.property_type, p.building_name, p.building_dong, p.unit_number, p.size_type,
    p.sale_price, p.jeonse_price, p.monthly_rent,
    (SELECT COUNT(*) FROM work_log_properties p WHERE p.work_log_id = w.id) AS property_count`;
const FIRST_PROPERTY_SQL = `
    SELECT first_property.rowid FROM work_log_properties first_property
    WHERE first_property.work_log_id = w.id ORDER BY first_property.sequence LIMIT 1
`;
export const WORK_SUMMARY_SQL = `${WORK_COLUMNS_SQL}
  FROM work_logs w JOIN customers c ON c.id = w.customer_id
  LEFT JOIN work_log_properties p ON p.rowid = (${FIRST_PROPERTY_SQL})
`;

// Searching may match the second or later home in a work record. Show that
// same home and keep the count of all connected homes; never change stored order.
export function searchedWorkSummary(property: { sql: string; bindings: string[] }) {
  return {
    sql: `${WORK_COLUMNS_SQL}, (matching_property.rowid IS NOT NULL) AS search_property_match
      FROM work_logs w JOIN customers c ON c.id = w.customer_id
      LEFT JOIN work_log_properties matching_property ON matching_property.rowid = (
        SELECT sp.rowid FROM work_log_properties sp
        WHERE sp.work_log_id = w.id AND ${property.sql}
        ORDER BY sp.sequence, sp.rowid LIMIT 1
      )
      LEFT JOIN work_log_properties p ON p.rowid = COALESCE(matching_property.rowid, (${FIRST_PROPERTY_SQL}))`,
    bindings: property.bindings,
  };
}
