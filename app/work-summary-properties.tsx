import { getWorkProperties, workPropertyLabel } from "./work-property-summary";
import "./work-summary-properties.css";

type PropertyWork = Parameters<typeof getWorkProperties>[0] & { search_property_match?: number };

/** Read-only context shared by search, upcoming work, and inline customer history. */
export function WorkSummaryProperties({ work, showSingle = false, showPrices = false }: {
  work: PropertyWork;
  showSingle?: boolean;
  showPrices?: boolean;
}) {
  const properties = getWorkProperties(work);
  const count = Math.max(work.property_count || 0, properties.length);
  if (!properties.length || (!showSingle && count < 2)) return null;
  return (
    <span className="work-summary-properties" role="group" aria-label="함께 기록한 물건">
      {count > 1 && <span className="work-summary-property-count">함께 기록한 물건 {count}개</span>}
      <span className="work-summary-property-list" role="list">
        {properties.map((property, index) => {
          const matched = work.search_property_match === 1 && ["property_type", "building_name", "building_dong", "unit_number"].every((field) => {
            const key = field as "property_type" | "building_name" | "building_dong" | "unit_number";
            return String(property[key] || "").trim() === String(work[key] || "").trim();
          });
          const prices = [property.sale_price && `매매 ${property.sale_price}`, property.jeonse_price && `전세 ${property.jeonse_price}`, property.monthly_rent && `월세 ${property.monthly_rent}`].filter(Boolean).join(" · ");
          return (
            <span className={`work-summary-property${matched ? " is-search-match" : ""}`} role="listitem" key={property.id || index}>
              {count > 1 && <span className="work-summary-property-number" aria-label={`물건 ${index + 1}`}>{index + 1}</span>}
              <span className="work-summary-property-copy">
                <span className="work-summary-property-label">{workPropertyLabel(property)}</span>
                {matched && <span className="work-summary-property-match">검색 일치 물건</span>}
                {showPrices && (property.property_type || property.size_type) && <span className="work-summary-property-meta">{[property.property_type, property.size_type].filter(Boolean).join(" · ")}</span>}
                {showPrices && prices && <span className="work-summary-property-meta">{prices}</span>}
              </span>
            </span>
          );
        })}
      </span>
      {count > properties.length && <span className="work-summary-property-meta">전체 물건 주소는 업무 내용을 열어 확인해 주세요.</span>}
    </span>
  );
}
