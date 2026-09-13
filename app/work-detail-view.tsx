"use client";

import { createPropertyHistoryTarget } from "./history-query";
import { Icon, workTypeIcon } from "./icons";
import { workPropertyLabel } from "./work-property-summary";
import "./work-detail-view.css";

export type WorkDetailReadItem = {
  id: string;
  work_date: string;
  work_type: string;
  customer_id: string;
  customer_name: string;
  content: string;
  details: Array<Record<string, string | number>>;
};

function detailText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Read stored work facts only; editing and related history are explicit actions. */
export function WorkDetailView({
  item,
  onEdit,
  onCustomerHistory,
  onListingHistory,
}: {
  item: WorkDetailReadItem;
  onEdit: () => void;
  onCustomerHistory: () => void;
  onListingHistory: (key: string) => void;
}) {
  const customerId = detailText(item.customer_id);
  return (
    <div className="work-read-view">
      <div className="work-read-toolbar">
        <p>내용을 확인한 뒤 필요한 경우에만 수정하세요.</p>
        <button type="button" className="secondary-button" onClick={onEdit}>
          <Icon name="edit" size={17} /> 업무 수정
        </button>
      </div>

      <dl className="work-read-overview">
        <div>
          <dt><Icon name="calendar" size={17} /> 일자</dt>
          <dd><time dateTime={item.work_date}>{item.work_date.replaceAll("-", ".") || "일자 미입력"}</time></dd>
        </div>
        <div>
          <dt><Icon name={workTypeIcon(item.work_type)} size={17} /> 업무구분</dt>
          <dd>{detailText(item.work_type) || "업무구분 미입력"}</dd>
        </div>
        <div className="work-read-customer">
          <dt><Icon name="customers" size={17} /> 고객</dt>
          <dd>
            <strong>{detailText(item.customer_name) || "고객 정보 없음"}</strong>
            {customerId && <span className="work-read-customer-id">고객 ID · {customerId}</span>}
            <button
              type="button"
              className="tiny-button"
              onClick={onCustomerHistory}
              disabled={!customerId}
            >
              <Icon name="clock" size={15} /> 고객 이력
            </button>
          </dd>
        </div>
      </dl>

      <section className="work-read-content" aria-label="업무 내용">
        <h3><Icon name="journal" size={18} /> 업무 내용</h3>
        {detailText(item.content)
          ? <p className="work-read-note">{item.content}</p>
          : <p className="work-read-empty">기록된 내용이 없습니다.</p>}
      </section>

      <section className="work-read-properties" aria-label="관련 물건 전체">
        <div className="work-read-section-heading">
          <h3><Icon name="listings" size={18} /> 관련 물건 <span>{item.details.length}개</span></h3>
          {item.details.length > 1 && <p>등록한 순서대로 모든 물건을 펼쳐 보여드립니다.</p>}
        </div>
        {item.details.length === 0 ? (
          <p className="work-read-empty">이 업무에 연결된 물건이 없습니다.</p>
        ) : (
          <ol className={`work-read-property-grid${item.details.length === 1 ? " single" : ""}`}>
            {item.details.map((detail, index) => {
              const property = {
                property_type: detailText(detail.property_type),
                building_name: detailText(detail.building_name),
                building_dong: detailText(detail.building_dong),
                unit_number: detailText(detail.unit_number),
                size_type: detailText(detail.size_type),
              };
              const address = workPropertyLabel(property);
              const history = createPropertyHistoryTarget({
                propertyType: property.property_type,
                buildingName: property.building_name,
                buildingDong: property.building_dong,
                unitNumber: property.unit_number,
              });
              const prices = [
                ["매매", detailText(detail.sale_price)],
                ["전세", detailText(detail.jeonse_price)],
                ["월세", detailText(detail.monthly_rent)],
              ].filter(([, value]) => value !== "");
              const source = detailText(detail.source);
              return (
                <li key={`${detailText(detail.id)}-${index}`}>
                  <article className="work-read-property" aria-label={`물건 ${index + 1} · ${address}`}>
                    <div className="work-read-property-title">
                      <span className="work-read-number" aria-label={`물건 ${index + 1}`}>{index + 1}</span>
                      <h4>{address}</h4>
                    </div>
                    <div className="work-read-property-tags">
                      <span>{property.property_type || "물건구분 미입력"}</span>
                      {property.size_type && <span>타입 {property.size_type}</span>}
                    </div>
                    {prices.length > 0 ? (
                      <dl className="work-read-prices">
                        {prices.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                      </dl>
                    ) : <p className="work-read-empty">기록된 가격이 없습니다.</p>}
                    {source && <dl className="work-read-source"><div><dt>물건지·업소</dt><dd>{source}</dd></div></dl>}
                    <div className="work-read-property-actions">
                      <button
                        type="button"
                        className="tiny-button"
                        disabled={!history}
                        onClick={() => { if (history?.kind === "listing") onListingHistory(history.key); }}
                      >
                        <Icon name="clock" size={15} /> 매물 이력
                      </button>
                      {!history && <span>물건구분·건물명·호수가 있어야 이력을 찾을 수 있습니다.</span>}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
