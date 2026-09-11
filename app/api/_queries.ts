export const WORK_SUMMARY_SQL = `
  SELECT w.id, w.work_date, w.customer_id, w.work_type, w.content, w.is_demo, w.updated_at,
    c.name AS customer_name,
    p.property_type, p.building_name, p.building_dong, p.unit_number, p.size_type,
    p.sale_price, p.jeonse_price, p.monthly_rent,
    (SELECT COUNT(*) FROM work_log_properties p WHERE p.work_log_id = w.id) AS property_count
  FROM work_logs w
  JOIN customers c ON c.id = w.customer_id
  LEFT JOIN work_log_properties p ON p.rowid = (
    SELECT first_property.rowid FROM work_log_properties first_property
    WHERE first_property.work_log_id = w.id ORDER BY first_property.sequence LIMIT 1
  )
`;
