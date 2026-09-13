const WORK_COLUMNS_SQL = `
  SELECT w.id, w.work_date, w.customer_id, w.work_type, w.content, w.is_demo, w.updated_at,
    c.name AS customer_name,
    p.property_type, p.building_name, p.building_dong, p.unit_number, p.size_type,
    p.sale_price, p.jeonse_price, p.monthly_rent, p.source,
    (SELECT COUNT(*) FROM work_log_properties p WHERE p.work_log_id = w.id) AS property_count,
    (SELECT json_group_array(json_object(
      'id', property_rows.id, 'sequence', property_rows.sequence,
      'property_type', property_rows.property_type, 'building_name', property_rows.building_name,
      'building_dong', property_rows.building_dong, 'unit_number', property_rows.unit_number,
      'size_type', property_rows.size_type, 'sale_price', property_rows.sale_price,
      'jeonse_price', property_rows.jeonse_price, 'monthly_rent', property_rows.monthly_rent,
      'source', property_rows.source
    )) FROM (
      SELECT all_properties.* FROM work_log_properties all_properties
      WHERE all_properties.work_log_id = w.id
      ORDER BY all_properties.sequence, all_properties.rowid
    ) property_rows) AS properties_json`;
const FIRST_PROPERTY_SQL = `
    SELECT first_property.rowid FROM work_log_properties first_property
    WHERE first_property.work_log_id = w.id ORDER BY first_property.sequence, first_property.rowid LIMIT 1
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
