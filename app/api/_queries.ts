export const WORK_SUMMARY_SQL = `
  SELECT w.id, w.work_date, w.customer_id, w.work_type, w.content, w.is_demo, w.updated_at,
    c.name AS customer_name,
    (SELECT p.property_type FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS property_type,
    (SELECT p.building_name FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS building_name,
    (SELECT p.building_dong FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS building_dong,
    (SELECT p.unit_number FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS unit_number,
    (SELECT p.size_type FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS size_type,
    (SELECT p.sale_price FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS sale_price,
    (SELECT p.jeonse_price FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS jeonse_price,
    (SELECT p.monthly_rent FROM work_log_properties p WHERE p.work_log_id = w.id ORDER BY p.sequence LIMIT 1) AS monthly_rent,
    (SELECT COUNT(*) FROM work_log_properties p WHERE p.work_log_id = w.id) AS property_count
  FROM work_logs w
  JOIN customers c ON c.id = w.customer_id
`;
