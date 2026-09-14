"use client";

import {
  FormEvent,
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GlobalSearchCustomer as SearchCustomer,
  GlobalSearchListing as SearchListing,
} from "./global-search";
import { FollowUpsView } from "./follow-ups";
import { DeletionDialog } from "./deletion-dialog";
import type { DeletionEntityType } from "./deletion-types";
import "./calendar.css";
import "./journal-search-feedback.css";
import "./workflow-feedback.css";
import "./workflow-history-backup.css";
import "./work-form-feedback.css";
import "./work-reading-list.css";
import { LISTING_WORK_TYPES, findWorkDraftIssue } from "./work-form-rules";
import { CustomerPicker } from "./customer-picker";
import { fetchCustomerDirectory } from "./customer-directory";
import { calendarWorkPresentation } from "./calendar-presentation";
import { CalendarSubjects } from "./calendar-subjects";
import { getWorkProperties, workPropertyLabel } from "./work-property-summary";
import { getPropertyDisplayGroups } from "./property-display";
import { WorkSummaryProperties } from "./work-summary-properties";
import { ListingHistorySummary } from "./listing-history-summary";
import { formatHistoryTimestamp } from "./history-timestamps";
import type { RelatedHistoryTarget } from "./history-query";
import { canCloseCustomerDraft, customerDraftChanged } from "./customer-draft";
import { Icon, workTypeIcon } from "./icons";
import { canAppendPage } from "./client-paging";
import { createPropertyHistoryTarget } from "./history-query";
import { fetchWorkWindow } from "./work-window";
import { hasPropertyDraft, propertyFromListing, type ListingDraftSource } from "./listing-draft";
import {
  clientJsonFetch as jsonFetch,
  clearClientReadCache,
  invalidateCompletedClientReads,
} from "./client-api";

const GlobalSearch = lazy(() =>
  import("./global-search").then((module) => ({
    default: module.GlobalSearch,
  })),
);
const InsightsView = lazy(() =>
  import("./insights-view").then((module) => ({
    default: module.InsightsView,
  })),
);
const RelatedHistory = lazy(() =>
  import("./related-history").then((module) => ({ default: module.RelatedHistory })),
);
const ListingPicker = lazy(() =>
  import("./listing-picker").then((module) => ({ default: module.ListingPicker })),
);
const WorkDetailView = lazy(() =>
  import("./work-detail-view").then((module) => ({ default: module.WorkDetailView })),
);
const TrashView = lazy(() =>
  import("./trash-view").then((module) => ({ default: module.TrashView })),
);

function isAborted(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function useSearchDelay(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), value ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [value]);
  return settled;
}

type View =
  | "today"
  | "tasks"
  | "insights"
  | "journal"
  | "listings"
  | "customers"
  | "calendar"
  | "trash"
  | "settings";
type WorkSummary = {
  id: string;
  work_date: string;
  updated_at?: string;
  customer_id: string;
  customer_name: string;
  work_type: string;
  content: string;
  property_type?: string;
  building_name?: string;
  building_dong?: string;
  unit_number?: string;
  size_type?: string;
  sale_price?: string;
  jeonse_price?: string;
  monthly_rent?: string;
  source?: string;
  properties_json?: string;
  property_count: number;
  search_property_match?: number;
  is_demo: number;
};
type PropertyDetail = {
  id?: string;
  propertyType: string;
  buildingName: string;
  buildingDong: string;
  unitNumber: string;
  sizeType: string;
  salePrice: string;
  jeonsePrice: string;
  monthlyRent: string;
  source: string;
};
type WorkDetail = WorkSummary & {
  details: Array<Record<string, string | number>>;
};
type Customer = {
  id: string;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
  history_count: number;
  last_work_date?: string;
  is_demo: number;
};
type Listing = {
  id: string;
  identity_key: string;
  registered_at?: string;
  closed_at?: string;
  status: string;
  property_type: string;
  building_name: string;
  building_dong: string;
  unit_number: string;
  size_type: string;
  sale_price: string;
  jeonse_price: string;
  monthly_rent: string;
  notes: string;
  is_demo: number;
  source_notes?: string;
};
type ListingEvent = {
  id: string;
  work_log_id: string;
  event_date: string;
  status: string;
  notes: string;
  customer_id: string;
  customer_name: string;
  work_updated_at?: string;
  work_created_at?: string;
  created_at?: string;
};
type Lookups = {
  workTypes: string[];
  propertyTypes: string[];
  buildings: Array<{
    id: string;
    property_type: string;
    building_name: string;
  }>;
};
type Dashboard = {
  metrics: {
    today_count: number;
    upcoming_count: number;
    active_listing_count: number;
    customer_count: number;
  };
  today: WorkSummary[];
  upcoming?: WorkSummary[];
  recent: WorkSummary[];
  demoMode: boolean;
};
type BackupSummary = {
  key: string;
  kind: "daily" | "changes" | "manual";
  createdAt: string;
  size: number;
  reason: string;
};
type SearchView = "journal" | "listings" | "customers";
type JournalSearchError = { queryKey: string; message: string } | null;
type JournalSearchStatus = "loading" | "refreshing" | "error" | "ready";
type WorkModalState = {
  mode: "new" | "edit" | "copy";
  item?: WorkDetail;
  initialCustomerId?: string;
  initialWorkType?: string;
  initialListing?: Listing;
};
type WorkOpeningState = {
  id?: string;
  initialCustomerId?: string;
  initialWorkType?: string;
  initialListing?: Listing;
  error?: string;
};
type FollowUpDraft = {
  title?: string;
  customerId?: string;
  listingKey?: string;
  customerName?: string;
  listingLabel?: string;
  replaceConfirmed?: boolean;
};
type HistoryData = {
  title: string;
  subtitle: string;
  items: WorkSummary[] | ListingEvent[];
  customer?: Pick<Customer, "id" | "name">;
  listing?: Listing;
  listingKey?: string;
  date?: string;
  workType?: string;
  scheduleDays?: number;
  from?: string;
  to?: string;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
};
type WorkHistoryActions = {
  onCustomerHistory: (customer: Pick<Customer, "id" | "name">) => void;
  onListingHistory: (work: WorkSummary) => void;
};

const navItems: Array<[View, string]> = [
  ["today", "홈"],
  ["insights", "업무 현황"],
  ["journal", "업무일지"],
  ["listings", "매물 관리"],
  ["customers", "고객 관리"],
  ["calendar", "업무 달력"],
  ["trash", "휴지통"],
  ["settings", "설정"],
];
let nextModalId = 0;
const openModalIds: number[] = [];
let modalBodyOverflow = "";
const blankProperty = (): PropertyDetail => ({
  propertyType: "",
  buildingName: "",
  buildingDong: "",
  unitNumber: "",
  sizeType: "",
  salePrice: "",
  jeonsePrice: "",
  monthlyRent: "",
  source: "",
});
const seoulDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function journalSearchStatus(
  loadedQuery: string | null,
  currentQuery: string,
  firstPageLoading: boolean,
  searchPending: boolean,
  error: JournalSearchError,
): JournalSearchStatus {
  if (searchPending) return "loading";
  if (firstPageLoading) return loadedQuery === currentQuery ? "refreshing" : "loading";
  if (error?.queryKey === currentQuery) return "error";
  return loadedQuery === currentQuery ? "ready" : "loading";
}

async function fetchAllWorkLogs(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<WorkSummary[]> {
  const rows: WorkSummary[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (rows.length < total) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", "1000");
    pageParams.set("offset", String(offset));
    const page = await jsonFetch<{ workLogs: WorkSummary[]; total: number }>(
      `/api/work-logs?${pageParams}`,
      { signal },
    );
    rows.push(...page.workLogs);
    total = Number(page.total || 0);
    if (!page.workLogs.length) break;
    offset += page.workLogs.length;
  }
  return rows;
}
function displayDate(value?: string) {
  if (!value) return "-";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${y}.${m}.${d}`;
}
function targetText(row: Partial<WorkSummary | Listing>) {
  const building = "building_name" in row ? row.building_name : "";
  const dong = "building_dong" in row ? row.building_dong : "";
  const unit = "unit_number" in row ? row.unit_number : "";
  if (!building) return "물건 없음";
  const address = [dong ? `${dong}동` : "", unit ? `${unit}호` : ""]
    .filter(Boolean)
    .join(" ");
  return `${building}${address ? ` ${address}` : ""}`;
}
function statusTone(status: string) {
  if (/취소|파기|타계약/.test(status)) return "red";
  if (/등록|수정/.test(status)) return "green";
  if (/예정|예약/.test(status)) return "orange";
  if (/잔금|계약|중도금/.test(status)) return "violet";
  return "blue";
}
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function periodBounds(period: string) {
  const today = seoulDate();
  if (period === "today") return [today, today];
  if (period === "7d") return [shiftDate(today, -6), today];
  if (period === "month") {
    const [year, month] = today.split("-").map(Number);
    return [
      `${year}-${String(month).padStart(2, "0")}-01`,
      new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    ];
  }
  return ["", ""];
}
function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | undefined>>,
) {
  const safe = (value: string | number | undefined) => {
    const text = String(value ?? "");
    return /^[=+@]/.test(text) || /^-\D/.test(text) ? `'${text}` : text;
  };
  const escape = (value: string | number | undefined) =>
    `"${safe(value).replaceAll('"', '""')}"`;
  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function WorkManager() {
  const [view, setView] = useState<View>("today");
  const currentView = useRef<View>("today");
  const followUpDirty = useRef(false);
  const followUpBusy = useRef(false);
  const setFollowUpBusy = useCallback((busy: boolean) => { followUpBusy.current = busy; }, []);
  const workBusy = useRef(false);
  const customerBusy = useRef(false);
  const setWorkBusy = useCallback((busy: boolean) => { workBusy.current = busy; }, []);
  const setCustomerBusy = useCallback((busy: boolean) => { customerBusy.current = busy; }, []);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [lookups, setLookups] = useState<Lookups>({
    workTypes: [],
    propertyTypes: [],
    buildings: [],
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const customerDirectoryRequested = useRef(false);
  const appliedReferenceVersion = useRef(0);
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkSummary[]>([]);
  const [workTotal, setWorkTotal] = useState(0);
  const [calendarLogs, setCalendarLogs] = useState<WorkSummary[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [workFirstPageLoading, setWorkFirstPageLoading] = useState(false);
  const [workSearchError, setWorkSearchError] = useState<JournalSearchError>(null);
  const [managedReads, setManagedReads] = useState<Record<"listings" | "customers" | "calendar", { loadedQuery: string | null; loading: boolean; error: JournalSearchError }>>({
    listings: { loadedQuery: null, loading: false, error: null },
    customers: { loadedQuery: null, loading: false, error: null },
    calendar: { loadedQuery: null, loading: false, error: null },
  });
  const [exportingWork, setExportingWork] = useState(false);
  const workExportPending = useRef(false);
  const [loadedWorkQuery, setLoadedWorkQuery] = useState<string | null>(null);
  const loadedWorkQueryRef = useRef<string | null>(null);
  const workFirstRequest = useRef<number | null>(null);
  const workMorePending = useRef(false);
  const [notice, setNotice] = useState("");
  const [deletionTarget, setDeletionTarget] = useState<{ type: DeletionEntityType; id: string; unsavedDraft?: boolean } | null>(null);
  const [queries, setQueries] = useState<Record<SearchView, string>>({
    journal: "",
    listings: "",
    customers: "",
  });
  const [workTypeFilter, setWorkTypeFilter] = useState("");
  const [workPeriod, setWorkPeriod] = useState("");
  const [calendarWorkType, setCalendarWorkType] = useState("");
  const [listingState, setListingState] = useState("active");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState("");
  const [listingSort, setListingSort] = useState("building");
  const [customerSort, setCustomerSort] = useState("recent");
  const [calendarMonth, setCalendarMonth] = useState(seoulDate().slice(0, 7));
  const [workModal, setWorkModal] = useState<WorkModalState | null>(null);
  const [workOpening, setWorkOpening] = useState<WorkOpeningState | null>(null);
  const [workReader, setWorkReader] = useState<{ id: string; item?: WorkDetail; loading: boolean; error?: string } | null>(null);
  const workReadVersion = useRef(0);
  const [readerReference, setReaderReference] = useState<RelatedHistoryTarget | null>(null);
  const readerReferenceTrigger = useRef<HTMLElement | null>(null);
  const workOpenVersion = useRef(0);
  const historyOpenVersion = useRef(0);
  const [customerModal, setCustomerModal] = useState<{
    mode: "new" | "edit";
    item?: Customer;
  } | null>(null);
  const [historyModal, setHistoryModal] = useState<HistoryData | null>(null);
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft>();
  const [followUpRefreshKey, setFollowUpRefreshKey] = useState(0);
  const [readable, setReadable] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchLoaded, setGlobalSearchLoaded] = useState(false);
  const [insightsRefreshKey, setInsightsRefreshKey] = useState(0);
  const lastFocusRefresh = useRef(0);
  const focusRefreshInFlight = useRef(false);
  const requestVersion = useRef({
    dashboard: 0,
    references: 0,
    work: 0,
    calendar: 0,
    listings: 0,
    customers: 0,
  });
  const journalSearch = useSearchDelay(queries.journal);
  const listingsSearch = useSearchDelay(queries.listings);
  const customersSearch = useSearchDelay(queries.customers);
  const workQueryKey = JSON.stringify([
    queries.journal,
    workTypeFilter,
    ...periodBounds(workPeriod),
  ]);
  const journalStatus = journalSearchStatus(
    loadedWorkQuery,
    workQueryKey,
    workFirstPageLoading,
    queries.journal !== journalSearch,
    workSearchError,
  );
  const listingQueryKey = JSON.stringify([queries.listings, listingState, propertyTypeFilter, listingSort]);
  const customerQueryKey = JSON.stringify([queries.customers, customerSort]);
  const calendarQueryKey = JSON.stringify([calendarMonth, calendarWorkType]);
  const listingStatus = journalSearchStatus(managedReads.listings.loadedQuery, listingQueryKey, managedReads.listings.loading, queries.listings !== listingsSearch, managedReads.listings.error);
  const customerStatus = journalSearchStatus(managedReads.customers.loadedQuery, customerQueryKey, managedReads.customers.loading, queries.customers !== customersSearch, managedReads.customers.error);
  const calendarStatus = journalSearchStatus(managedReads.calendar.loadedQuery, calendarQueryKey, managedReads.calendar.loading, false, managedReads.calendar.error);
  const showGlobalSearch = useCallback(() => {
    setGlobalSearchLoaded(true);
    setGlobalSearchOpen(true);
  }, []);
  const showLoadError = useCallback((error: unknown) => {
    if (!isAborted(error)) setNotice((error as Error).message);
  }, []);

  const loadReferenceData = useCallback(async (includeCustomers = true) => {
    // The full customer directory belongs to the work form, not the home page.
    // Once a form has needed it, keep the existing focus/write refresh behavior.
    if (includeCustomers) customerDirectoryRequested.current = true;
    const version = ++requestVersion.current.references;
    const [lookupData, customerData] = await Promise.all([
      jsonFetch<Lookups>("/api/lookups"),
      customerDirectoryRequested.current
        ? fetchCustomerDirectory<Customer>((url) => jsonFetch(url))
        : null,
    ]);
    // A newer *pending* focus refresh must not discard the valid data an opening
    // form is waiting for. Only an already-applied newer success wins the race.
    if (version < appliedReferenceVersion.current) return;
    appliedReferenceVersion.current = version;
    setLookups(lookupData);
    if (customerData) setCustomers(customerData);
  }, []);
  const refreshDashboard = useCallback(async () => {
    const version = ++requestVersion.current.dashboard;
    try {
      const dash = await jsonFetch<Dashboard>("/api/bootstrap");
      if (version === requestVersion.current.dashboard) { setDashboard(dash); setDashboardError(""); }
    } catch (error) {
      if (version === requestVersion.current.dashboard) setDashboardError(isAborted(error) ? "홈 정보 조회를 완료하지 못했습니다. 다시 불러와 주세요." : (error as Error).message);
      throw error;
    } finally {
      if (version === requestVersion.current.dashboard) setLoading(false);
    }
  }, []);
  const refreshBase = useCallback(async () => {
    await Promise.all([refreshDashboard(), loadReferenceData(false)]);
  }, [refreshDashboard, loadReferenceData]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setReadable(localStorage.getItem("jipjangbu-readable") === "true");
      } catch {
        /* UI preference is optional. */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function toggleReadable() {
    const next = !readable;
    setReadable(next);
    try {
      localStorage.setItem("jipjangbu-readable", String(next));
    } catch {
      /* Keep the setting for this session. */
    }
  }
  function addFollowUp(draft: FollowUpDraft = {}) {
    if (followUpBusy.current) { setNotice("할 일을 처리 중입니다. 잠시 기다려 주세요."); return; }
    if (
      view === "tasks" &&
      followUpDirty.current &&
      !window.confirm("작성 중인 할 일을 버리고 새 할 일을 작성할까요?")
    )
      return;
    if (!navigate("tasks")) return;
    setFollowUpDraft({ ...draft, replaceConfirmed: view === "tasks" });
    historyOpenVersion.current += 1;
    setHistoryModal(null);
  }
  const loadWorkLogs = useCallback(
    async (signal?: AbortSignal, visibleCount = 100) => {
      const version = ++requestVersion.current.work;
      workFirstRequest.current = version;
      setWorkFirstPageLoading(true);
      setWorkSearchError(null);
      const params = new URLSearchParams({ limit: "100" });
      if (journalSearch) params.set("q", journalSearch);
      if (workTypeFilter) params.set("workType", workTypeFilter);
      const [from, to] = periodBounds(workPeriod);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const queryKey = JSON.stringify([
        journalSearch,
        workTypeFilter,
        from,
        to,
      ]);
      try {
        const data = await fetchWorkWindow<WorkSummary>(
          (pageParams, pageSignal) => jsonFetch(`/api/work-logs?${pageParams}`, { signal: pageSignal }),
          params,
          visibleCount,
          signal,
        );
        if (version !== requestVersion.current.work) return;
        loadedWorkQueryRef.current = queryKey;
        setLoadedWorkQuery(queryKey);
        setWorkLogs(data.workLogs);
        setWorkTotal(data.total);
      } catch (error) {
        if (version !== requestVersion.current.work) return;
        if (!signal?.aborted) {
          setWorkSearchError({
            queryKey,
            message: isAborted(error) ? "다른 작업으로 조회가 중단되었습니다. 다시 시도해 주세요." : error instanceof Error ? error.message : "업무 기록을 불러오지 못했습니다.",
          });
        }
        throw error;
      } finally {
        if (workFirstRequest.current === version) {
          workFirstRequest.current = null;
          setWorkFirstPageLoading(false);
        }
      }
    },
    [journalSearch, workTypeFilter, workPeriod],
  );
  const loadCalendar = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current.calendar;
      const queryKey = JSON.stringify([calendarMonth, calendarWorkType]);
      setManagedReads((current) => ({ ...current, calendar: { ...current.calendar, loading: true, error: null } }));
      const params = new URLSearchParams({ month: calendarMonth });
      if (calendarWorkType) params.set("workType", calendarWorkType);
      try {
        const rows = await fetchAllWorkLogs(params, signal);
        if (version !== requestVersion.current.calendar) return;
        setCalendarLogs(
          rows.filter((item) => item.work_date.startsWith(calendarMonth)),
        );
        setManagedReads((current) => ({ ...current, calendar: { loadedQuery: queryKey, loading: false, error: null } }));
      } catch (error) {
        if (version === requestVersion.current.calendar && !signal?.aborted) setManagedReads((current) => ({ ...current, calendar: { ...current.calendar, loading: false, error: { queryKey, message: isAborted(error) ? "다른 작업으로 조회가 중단되었습니다. 다시 불러와 주세요." : (error as Error).message } } }));
        throw error;
      }
    },
    [calendarMonth, calendarWorkType],
  );
  const loadListings = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current.listings;
      const queryKey = JSON.stringify([listingsSearch, listingState, propertyTypeFilter, listingSort]);
      setManagedReads((current) => ({ ...current, listings: { ...current.listings, loading: true, error: null } }));
      const params = new URLSearchParams({
        state: listingState,
        sort: listingSort,
      });
      if (listingsSearch) params.set("q", listingsSearch);
      if (propertyTypeFilter) params.set("type", propertyTypeFilter);
      try {
        const data = await jsonFetch<{ listings: Listing[] }>(
        `/api/listings?${params}`,
        { signal },
      );
        if (version !== requestVersion.current.listings) return;
        setListings(data.listings);
        setManagedReads((current) => ({ ...current, listings: { loadedQuery: queryKey, loading: false, error: null } }));
      } catch (error) {
        if (version === requestVersion.current.listings && !signal?.aborted) setManagedReads((current) => ({ ...current, listings: { ...current.listings, loading: false, error: { queryKey, message: isAborted(error) ? "다른 작업으로 조회가 중단되었습니다. 다시 불러와 주세요." : (error as Error).message } } }));
        throw error;
      }
    },
    [listingState, propertyTypeFilter, listingSort, listingsSearch],
  );
  const loadCustomers = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current.customers;
      const queryKey = JSON.stringify([customersSearch, customerSort]);
      setManagedReads((current) => ({ ...current, customers: { ...current.customers, loading: true, error: null } }));
      const params = new URLSearchParams({ sort: customerSort });
      if (customersSearch) params.set("q", customersSearch);
      try {
        const data = await jsonFetch<{ customers: Customer[] }>(
        `/api/customers?${params}`,
        { signal },
      );
        if (version !== requestVersion.current.customers) return;
        setCustomerResults(data.customers);
        setManagedReads((current) => ({ ...current, customers: { loadedQuery: queryKey, loading: false, error: null } }));
      } catch (error) {
        if (version === requestVersion.current.customers && !signal?.aborted) setManagedReads((current) => ({ ...current, customers: { ...current.customers, loading: false, error: { queryKey, message: isAborted(error) ? "다른 작업으로 조회가 중단되었습니다. 다시 불러와 주세요." : (error as Error).message } } }));
        throw error;
      }
    },
    [customerSort, customersSearch],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshBase().catch(showLoadError);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshBase, showLoadError]);
  useEffect(() => {
    const refreshVisibleData = () => {
      if (
        document.visibilityState !== "visible" ||
        focusRefreshInFlight.current ||
        Date.now() - lastFocusRefresh.current < 1000
      )
        return;
      lastFocusRefresh.current = Date.now();
      focusRefreshInFlight.current = true;
      const sharedPendingRead = invalidateCompletedClientReads();
      // These child views abort their own previous request on refreshKey changes,
      // so their first refresh is already fresh. Do not restart it a second time.
      setInsightsRefreshKey((value) => value + 1);
      setFollowUpRefreshKey((value) => value + 1);
      const active = currentView.current;
      const refresh = () => Promise.all([
        refreshBase(),
        active === "journal" ? loadWorkLogs(undefined, workLogs.length) : undefined,
        active === "calendar" ? loadCalendar() : undefined,
        active === "listings" ? loadListings() : undefined,
        active === "customers" ? loadCustomers() : undefined,
      ]);
      void refresh().then(async () => {
        // Preserve a slow first response so the screen/form can finish opening,
        // then revalidate once: another device may have changed data in flight.
        if (sharedPendingRead && document.visibilityState === "visible") {
          invalidateCompletedClientReads();
          if (currentView.current === active) await refresh();
          else await refreshBase();
        }
      }).catch(showLoadError).finally(() => { focusRefreshInFlight.current = false; });
    };
    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshVisibleData);
    return () => {
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, [
    refreshBase,
    loadWorkLogs,
    loadCalendar,
    loadListings,
    loadCustomers,
    showLoadError,
    workLogs.length,
  ]);
  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        target?.matches("input, textarea, select") ||
        document.querySelector('[aria-modal="true"]')
      )
        return;
      event.preventDefault();
      showGlobalSearch();
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [showGlobalSearch]);
  useEffect(() => {
    const syncView = () => {
      const key = window.location.hash.slice(1) as View;
      const next = key === "tasks" || navItems.some(([viewKey]) => viewKey === key)
        ? key
        : "today";
      if (next !== currentView.current && (followUpBusy.current || workBusy.current || customerBusy.current)) {
        setNotice("저장 중입니다. 완료될 때까지 잠시 기다려 주세요.");
        window.history.pushState(null, "", currentView.current === "today" ? window.location.pathname : `#${currentView.current}`);
        return;
      }
      if (
        next !== currentView.current &&
        followUpDirty.current &&
        !window.confirm("작성 중인 할 일이 있습니다. 저장하지 않고 이동할까요?")
      ) {
        window.history.pushState(
          null,
          "",
          currentView.current === "today"
            ? window.location.pathname
            : `#${currentView.current}`,
        );
        return;
      }
      if (next !== currentView.current) {
        workOpenVersion.current += 1;
        setWorkOpening(null);
        workReadVersion.current += 1;
        setWorkReader(null);
        setReaderReference(null);
      }
      currentView.current = next;
      setView(next);
    };
    syncView();
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const versions = requestVersion.current;
    // Only typing waits for a pause. Navigating, dates, filters and sorting are immediate.
    const timer = window.setTimeout(() => {
      if (view === "journal" && queries.journal === journalSearch)
        void loadWorkLogs(controller.signal).catch(showLoadError);
      if (view === "calendar")
        void loadCalendar(controller.signal).catch(showLoadError);
      if (view === "listings" && queries.listings === listingsSearch)
        void loadListings(controller.signal).catch(showLoadError);
      if (view === "customers" && queries.customers === customersSearch)
        void loadCustomers(controller.signal).catch(showLoadError);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      versions.work += 1;
      versions.calendar += 1;
      versions.listings += 1;
      versions.customers += 1;
    };
  }, [
    view,
    loadWorkLogs,
    loadCalendar,
    loadListings,
    loadCustomers,
    queries,
    journalSearch,
    listingsSearch,
    customersSearch,
    showLoadError,
  ]);

  function navigate(next: View) {
    if (next !== view && (followUpBusy.current || workBusy.current || customerBusy.current)) { setNotice("저장 중입니다. 완료될 때까지 잠시 기다려 주세요."); return false; }
    if (next === view) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (next === "today") void refreshBase().catch(showLoadError);
      return true;
    }
    if (
      followUpDirty.current &&
      !window.confirm("작성 중인 할 일이 있습니다. 저장하지 않고 이동할까요?")
    )
      return false;
    const hash = next === "today" ? "" : `#${next}`;
    workOpenVersion.current += 1;
    setWorkOpening(null);
    workReadVersion.current += 1;
    setWorkReader(null);
    setReaderReference(null);
    window.history.pushState(
      { view: next },
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
    setView(next);
    currentView.current = next;
    if (next === "today") void refreshBase().catch(showLoadError);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }
  async function openWork(
    id?: string,
    initialCustomerId?: string,
    initialWorkType?: string,
    initialListing?: Listing,
  ) {
    const version = ++workOpenVersion.current;
    const request = { id, initialCustomerId, initialWorkType, initialListing };
    // A slow directory/detail request must not make the button look unresponsive.
    // Keep the existing reader and any draft mounted until the new form is ready.
    setWorkOpening(request);
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Home can render before reference data; never open a form with an empty name picker.
      const [, data] = await Promise.all([
        loadReferenceData(),
        id
          ? jsonFetch<{ workLog: WorkDetail }>(`/api/work-logs/${encodeURIComponent(id)}`)
          : undefined,
      ]);
      if (version !== workOpenVersion.current) return;
      setWorkOpening(null);
      setWorkModal(
        data
          ? { mode: "edit", item: data.workLog }
          : { mode: "new", initialCustomerId, initialWorkType, initialListing },
      );
      return;
    } catch (error) {
      if (version !== workOpenVersion.current) return;
      if (isAborted(error) && attempt === 0) continue;
      setWorkOpening({ ...request, error: isAborted(error) ? "업무 열기가 중단되었습니다. 다시 불러와 주세요." : error instanceof Error ? error.message : "업무 입력에 필요한 정보를 불러오지 못했습니다." });
      return;
    }
    }
  }
  function closeWorkOpening() {
    workOpenVersion.current += 1;
    setWorkOpening(null);
  }
  async function readWork(id?: string) {
    if (!id) { await openWork(); return; }
    workOpenVersion.current += 1;
    setWorkOpening(null);
    const version = ++workReadVersion.current;
    setGlobalSearchOpen(false);
    setReaderReference(null);
    setWorkReader({ id, loading: true });
    try {
      const data = await jsonFetch<{ workLog: WorkDetail }>(`/api/work-logs/${encodeURIComponent(id)}`);
      if (version === workReadVersion.current) setWorkReader({ id, item: data.workLog, loading: false });
    } catch (error) {
      if (version === workReadVersion.current) setWorkReader({ id, loading: false, error: isAborted(error) ? "업무 내용 조회가 중단되었습니다. 다시 불러와 주세요." : (error as Error).message });
    }
  }
  function closeWorkReader() {
    workReadVersion.current += 1;
    workOpenVersion.current += 1;
    setWorkOpening(null);
    setWorkReader(null);
    setReaderReference(null);
  }
  function openReaderReference(target: RelatedHistoryTarget) {
    readerReferenceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReaderReference(target);
  }
  function closeReaderReference() {
    setReaderReference(null);
    const trigger = readerReferenceTrigger.current;
    window.requestAnimationFrame(() => { if (trigger?.isConnected) { trigger.focus(); trigger.scrollIntoView({ block: "nearest" }); } });
  }
  async function afterMutation(message: string) {
    setNotice(message);
    setInsightsRefreshKey((value) => value + 1);
    setFollowUpRefreshKey((value) => value + 1);
    try {
      await Promise.all([
        refreshBase(),
        view === "journal" ? loadWorkLogs(undefined, workLogs.length) : undefined,
        view === "calendar" ? loadCalendar() : undefined,
        view === "listings" ? loadListings() : undefined,
        view === "customers" ? loadCustomers() : undefined,
      ]);
    } catch (error) {
      if (isAborted(error)) return;
      setNotice(
        `${message} 화면 갱신이 늦어지고 있습니다. 새로고침해 주세요. (${(error as Error).message})`,
      );
    }
  }
  async function afterDeletion() {
    const target = deletionTarget;
    if (!target) return;
    setDeletionTarget(null);
    if (target.type === "work") {
      workOpenVersion.current += 1;
      setWorkModal(null);
      closeWorkReader();
    } else if (target.type === "customer") {
      setCustomerModal(null);
      if (historyModal?.customer?.id === target.id) {
        historyOpenVersion.current += 1;
        setHistoryModal(null);
      }
    }
    await Promise.all([
      afterMutation(`${target.type === "work" ? "업무" : "고객"} 기록을 휴지통으로 옮겼습니다. 휴지통에서 복구할 수 있습니다.`),
      target.type === "work" ? refreshHistory(historyModal) : undefined,
    ]);
  }
  async function loadMoreWorkLogs() {
    if (
      !canAppendPage(
        loadedWorkQueryRef.current,
        workQueryKey,
        workFirstRequest.current !== null,
        workMorePending.current,
      ) ||
      workLogs.length >= workTotal ||
      journalStatus !== "ready" ||
      queries.journal !== journalSearch
    )
      return;
    const version = ++requestVersion.current.work;
    workMorePending.current = true;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: "100",
        offset: String(workLogs.length),
      });
      if (queries.journal) params.set("q", queries.journal);
      if (workTypeFilter) params.set("workType", workTypeFilter);
      const [from, to] = periodBounds(workPeriod);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const data = await jsonFetch<{ workLogs: WorkSummary[]; total: number }>(
        `/api/work-logs?${params}`,
      );
      if (version === requestVersion.current.work) {
        setWorkLogs((current) => [...current, ...data.workLogs]);
        setWorkTotal(data.total);
      }
    } catch (error) {
      showLoadError(error);
    } finally {
      workMorePending.current = false;
      setLoadingMore(false);
    }
  }
  async function exportWorkLogs() {
    if (
      journalStatus !== "ready" ||
      !workTotal ||
      workExportPending.current ||
      !canAppendPage(
        loadedWorkQueryRef.current,
        workQueryKey,
        workFirstRequest.current !== null,
        workMorePending.current,
      ) ||
      queries.journal !== journalSearch
    ) return;
    workExportPending.current = true;
    setExportingWork(true);
    try {
      setNotice("현재 조건에 맞는 전체 업무 기록을 준비하고 있습니다.");
      const params = new URLSearchParams();
      if (queries.journal) params.set("q", queries.journal);
      if (workTypeFilter) params.set("workType", workTypeFilter);
      const [from, to] = periodBounds(workPeriod);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const items = await fetchAllWorkLogs(params);
      downloadCsv(
        `업무일지-${seoulDate()}.csv`,
        ["일자", "업무구분", "고객명", "고객ID", "대표 물건(업무당 1건)", "내용"],
        items.map((item) => [
          item.work_date,
          item.work_type,
          item.customer_name,
          item.customer_id,
          targetText(item),
          item.content,
        ]),
      );
      setNotice(
        `현재 조건에 맞는 업무 ${items.length.toLocaleString("ko-KR")}건을 저장했습니다. 물건은 업무당 대표 1건입니다.`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      workExportPending.current = false;
      setExportingWork(false);
    }
  }
  async function copyCustomerId(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("고객 ID를 복사했습니다.");
    } catch {
      setNotice("복사하지 못했습니다. 고객 ID를 길게 눌러 복사해 주세요.");
    }
  }
  async function showCustomerHistory(
    customer: Pick<Customer, "id" | "name"> | SearchCustomer,
    preserve = false,
  ) {
    const version = ++historyOpenVersion.current;
    setGlobalSearchOpen(false);
    setHistoryModal((current) => ({
      title: `${customer.name} 업무 이력`, subtitle: customer.id, customer,
      items: preserve && current?.customer?.id === customer.id ? current.items : [],
      loading: true,
    }));
    try {
      const items = await fetchAllWorkLogs(
        new URLSearchParams({ customerId: customer.id }),
      );
      if (version !== historyOpenVersion.current) return;
      setHistoryModal({
        title: `${customer.name} 업무 이력`,
        subtitle: customer.id,
        items,
        customer,
      });
    } catch (error) {
      if (version === historyOpenVersion.current) setHistoryModal((current) => current ? { ...current, loading: false, error: (error as Error).message } : null);
    }
  }
  async function showListingHistory(
    listing:
      | Pick<
          Listing,
          | "identity_key"
          | "property_type"
          | "building_name"
          | "building_dong"
          | "unit_number"
        >
      | SearchListing,
  ) {
    await showListingByKey(listing.identity_key);
  }
  async function showListingByKey(key: string, preserve = false) {
    const version = ++historyOpenVersion.current;
    setGlobalSearchOpen(false);
    setHistoryModal((current) => ({
      title: preserve && current?.listing?.identity_key === key ? current.title : "매물 이력",
      subtitle: "저장된 매물 변경 이력을 확인합니다",
      items: preserve && current?.listing?.identity_key === key ? current.items : [],
      listing: preserve ? current?.listing : undefined,
      listingKey: key,
      loading: true,
    }));
    try {
      const data = await jsonFetch<{
        listing: Listing;
        events: ListingEvent[];
      }>(`/api/listings/${encodeURIComponent(key)}`);
      if (version !== historyOpenVersion.current) return;
      setHistoryModal({
        title: `${targetText(data.listing)} 이력`,
        subtitle: data.listing.property_type,
        items: data.events,
        listing: data.listing,
        listingKey: key,
      });
    } catch (error) {
      if (version !== historyOpenVersion.current) return;
      const missing = (error as Error).message === "매물을 찾을 수 없습니다.";
      setHistoryModal((current) => current ? {
        ...current,
        ...(missing ? { items: [], listing: undefined } : {}),
        loading: false,
        emptyMessage: missing && preserve ? "이 주소에 남아 있는 매물 이력이 없습니다. 삭제한 업무는 휴지통에서 복구할 수 있습니다." : undefined,
        error: missing && preserve ? undefined : missing
          ? "이 주소로 저장된 매물 이력이 없습니다. 업무에 적힌 물건구분·건물명·동·호수를 확인해 주세요."
          : (error as Error).message,
      } : null);
    }
  }
  async function refreshHistory(history: HistoryData | null) {
    if (!history) return;
    if (history.customer) return showCustomerHistory(history.customer, true);
    if (history.listing) return showListingByKey(history.listing.identity_key, true);
    if (history.listingKey) return showListingByKey(history.listingKey, true);
    if (history.scheduleDays) return showScheduleHistory(history, true);
    if (!history.date) return;
    const version = ++historyOpenVersion.current;
    setHistoryModal({ ...history, loading: true, error: undefined });
    try {
      const params = new URLSearchParams({ from: history.date, to: history.date });
      if (history.workType) params.set("workType", history.workType);
      const items = await fetchAllWorkLogs(params);
      if (version === historyOpenVersion.current) setHistoryModal({ ...history, items, subtitle: `${items.length}건`, loading: false, error: undefined });
    } catch (error) {
      if (version === historyOpenVersion.current) setHistoryModal({ ...history, loading: false, error: (error as Error).message });
    }
  }
  async function showScheduleHistory(history: HistoryData, preserve = false) {
    const version = ++historyOpenVersion.current;
    setHistoryModal({ ...history, items: preserve ? history.items : [], loading: true, error: undefined });
    try {
      const items = await fetchAllWorkLogs(new URLSearchParams({ from: history.from!, to: history.to!, schedule: "1" }));
      if (version === historyOpenVersion.current) setHistoryModal({ ...history, items, subtitle: `${displayDate(history.from)} ~ ${displayDate(history.to)} · ${items.length}건 · 가까운 일정순`, loading: false, error: undefined });
    } catch (error) {
      if (version === historyOpenVersion.current) setHistoryModal({ ...history, loading: false, error: (error as Error).message });
    }
  }
  function openSchedule(days: number) {
    const from = shiftDate(seoulDate(), 1), to = shiftDate(seoulDate(), days);
    void showScheduleHistory({ title: `앞으로 ${days}일 전체 일정`, subtitle: `${displayDate(from)} ~ ${displayDate(to)} · 예약·예정 업무`, items: [], scheduleDays: days, from, to });
  }
  function navigateFromDashboard(next: View) {
    if (!navigate(next)) return;
    if (next === "listings") {
      setQueries((current) => ({ ...current, listings: "" }));
      setListingState("active"); setPropertyTypeFilter(""); setListingSort("building");
    } else if (next === "customers") {
      setQueries((current) => ({ ...current, customers: "" })); setCustomerSort("recent");
    } else if (next === "journal") {
      setQueries((current) => ({ ...current, journal: "" })); setWorkTypeFilter(""); setWorkPeriod("");
    } else if (next === "calendar") {
      setCalendarMonth(seoulDate().slice(0, 7)); setCalendarWorkType("");
    }
  }
  function showWorkListingHistory(work: WorkSummary) {
    const target = createPropertyHistoryTarget({
      propertyType: work.property_type ?? "",
      buildingName: work.building_name ?? "",
      buildingDong: work.building_dong ?? "",
      unitNumber: work.unit_number ?? "",
    });
    if (target?.kind === "listing") void showListingByKey(target.key);
  }
  async function signOut() {
    if (followUpBusy.current || workBusy.current || customerBusy.current) { setNotice("저장 중입니다. 완료될 때까지 잠시 기다려 주세요."); return; }
    if (
      followUpDirty.current &&
      !window.confirm(
        "작성 중인 할 일이 있습니다. 저장하지 않고 로그아웃할까요?",
      )
    )
      return;
    clearClientReadCache();
    try {
      await jsonFetch("/api/auth/logout", { method: "POST" });
      window.location.assign("/login");
    } catch (error) {
      showLoadError(error);
    }
  }

  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const titles: Record<View, [string, string]> = {
    today: ["오늘의 업무", dateLabel],
    tasks: ["챙겨야 할 일", "따로 적어 둔 확인 사항을 관리합니다"],
    insights: ["업무 현황", "쌓인 기록에서 지금 확인할 흐름을 정리합니다"],
    journal: ["업무일지", "모든 업무 기록을 검색하고 관리합니다"],
    listings: ["매물 관리", "업무 기록에서 자동으로 갱신된 현재 상태입니다"],
    customers: ["고객 관리", "고객 정보와 상담 이력을 함께 관리합니다"],
    calendar: ["업무 달력", "월별 일정과 업무를 한눈에 확인합니다"],
    trash: ["휴지통", "삭제한 기록을 확인하고 필요할 때 다시 복구합니다"],
    settings: ["설정", "업무 분류, 백업, 로그인 정보를 확인합니다"],
  };
  const searchView = (["journal", "listings", "customers"] as View[]).includes(
    view,
  )
    ? (view as SearchView)
    : null;
  const query = searchView ? queries[searchView] : "";
  function setQuery(value: string) {
    if (!searchView) return;
    setQueries((current) => ({ ...current, [searchView]: value }));
  }

  return (
    <main className="app-shell" data-readable={readable}>
      <aside className="sidebar">
        <button
          className="brand brand-button"
          onClick={() => navigate("today")}
          type="button"
          aria-label="집장부 홈으로 이동"
        >
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong>집장부</strong>
            <small>부동산 업무를 한곳에</small>
          </span>
        </button>
        <p className="nav-caption">나의 업무 공간</p>
        <nav aria-label="주요 메뉴">
          {navItems.map(([key, label]) => (
            <button
              className={`nav-item ${view === key ? "active" : ""}`}
              key={key}
              onClick={() => navigate(key)}
              type="button"
              aria-current={view === key ? "page" : undefined}
            >
              <Icon
                name={key === "today" ? "home" : key}
                className="nav-icon"
                size={21}
              />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="sidebar-note">
            기록은 차곡차곡,
            <br />
            오늘의 일은 가볍게.
          </p>
          <button className="logout-link" onClick={signOut} type="button">
            <Icon name="logout" size={18} />
            로그아웃
          </button>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="title-stack">
            {view !== "today" && (
              <button
                className="home-button"
                onClick={() => navigate("today")}
                type="button"
              >
                <Icon name="back" size={17} /> 홈
              </button>
            )}
            <p className="eyebrow">{titles[view][1]}</p>
            <h1>{titles[view][0]}</h1>
            <p className="view-purpose">{titles[view][1]}</p>
          </div>
          <div className="topbar-actions">
            <button
              className="font-size-toggle"
              type="button"
              aria-pressed={readable}
              onClick={toggleReadable}
            >
              <Icon name="text" size={18} />
              {readable ? "기본 글씨" : "큰 글씨"}
            </button>
            <button
              className="global-search-trigger"
              onClick={showGlobalSearch}
              type="button"
              aria-keyshortcuts="/"
            >
              <Icon name="search" /> 통합검색 <kbd>/</kbd>
            </button>
            <button
              className="primary-button"
              onClick={() => openWork()}
              type="button"
            >
              <Icon name="plus" /> 새 업무 등록
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            {notice.includes("휴지통") && view !== "trash" && <button type="button" className="notice-action" onClick={() => navigate("trash")}>휴지통 보기</button>}
            <button onClick={() => setNotice("")} aria-label="알림 닫기">
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {dashboard?.demoMode && (
          <div className="demo-banner">
            <strong>예시 데이터로 보는 화면입니다.</strong>
            <span>실제 엑셀 자료는 배포 DB 이관 단계에서 채웁니다.</span>
          </div>
        )}
        <div className="view-content" key={view}>
          {loading ? (
            <Loading />
          ) : (
            <>
              {view === "today" && dashboardError && (
                <ListReadFeedback status="error" error={`${dashboard ? "이전 홈 정보를 표시 중입니다. " : ""}${dashboardError}`} onRetry={() => void refreshDashboard().catch(showLoadError)} label="홈 정보" />
              )}
              {view === "today" && dashboard && (
                <DashboardView
                  dashboard={dashboard}
                  onOpen={readWork}
                  onCustomerHistory={showCustomerHistory}
                  onListingHistory={showWorkListingHistory}
                  onNavigate={navigateFromDashboard}
                  onOpenSchedule={() => openSchedule(7)}
                  onQuickWork={(workType) =>
                    void openWork(undefined, undefined, workType)
                  }
                  followUps={
                    <FollowUpsView
                      compact
                      onBusyChange={setFollowUpBusy}
                      onDirtyChange={(dirty) => {
                        followUpDirty.current = dirty;
                      }}
                      refreshKey={followUpRefreshKey}
                      onChange={() =>
                        setInsightsRefreshKey((value) => value + 1)
                      }
                      onOpenCustomer={(id, name) =>
                        void showCustomerHistory({ id, name })
                      }
                      onOpenListing={(key) => void showListingByKey(key)}
                      onShowAll={() => navigate("tasks")}
                      onOpenTrash={() => navigate("trash")}
                    />
                  }
                />
              )}
              {view === "tasks" && (
                <FollowUpsView
                  onOpenTrash={() => navigate("trash")}
                  onBusyChange={setFollowUpBusy}
                  onDirtyChange={(dirty) => {
                    followUpDirty.current = dirty;
                  }}
                  refreshKey={followUpRefreshKey}
                  onChange={() => setInsightsRefreshKey((value) => value + 1)}
                  initialDraft={followUpDraft}
                  onDraftConsumed={() => setFollowUpDraft(undefined)}
                  onOpenCustomer={(id, name) =>
                    void showCustomerHistory({ id, name })
                  }
                  onOpenListing={(key) => void showListingByKey(key)}
                />
              )}
              {view === "insights" && (
                <Suspense fallback={<Loading />}>
                  <InsightsView
                    refreshKey={insightsRefreshKey}
                    onOpenSchedule={() => openSchedule(30)}
                    onReviewStale={() => {
                      setQueries((current) => ({ ...current, listings: "" }));
                      setListingState("stale");
                      setListingSort("oldest");
                      setPropertyTypeFilter("");
                      navigate("listings");
                    }}
                    onOpenWork={(id) => {
                      void readWork(id);
                    }}
                    onOpenListing={(item) => {
                      void showListingHistory(item);
                    }}
                  />
                </Suspense>
              )}
              {view === "journal" && (
                <JournalView
                  items={workLogs}
                  total={workTotal}
                  lookups={lookups}
                  query={query}
                  setQuery={setQuery}
                  workType={workTypeFilter}
                  setWorkType={setWorkTypeFilter}
                  period={workPeriod}
                  setPeriod={setWorkPeriod}
                  onReset={() => {
                    setQuery("");
                    setWorkTypeFilter("");
                    setWorkPeriod("");
                  }}
                  onLoadMore={loadMoreWorkLogs}
                  loadingMore={loadingMore}
                  status={journalStatus}
                  error={workSearchError?.queryKey === workQueryKey ? workSearchError.message : ""}
                  onRetry={() => loadWorkLogs().catch(showLoadError)}
                  exporting={exportingWork}
                  canLoadMore={
                    canAppendPage(
                      loadedWorkQuery,
                      workQueryKey,
                      workFirstPageLoading,
                      loadingMore,
                    ) && queries.journal === journalSearch && journalStatus === "ready"
                  }
                  onExport={exportWorkLogs}
                  onOpen={readWork}
                  onCustomerHistory={showCustomerHistory}
                  onListingHistory={showWorkListingHistory}
                />
              )}
              {view === "listings" && (
                <ListingsView
                  items={listings}
                  status={listingStatus}
                  error={managedReads.listings.error?.queryKey === listingQueryKey ? managedReads.listings.error.message : ""}
                  onRetry={() => void loadListings().catch(showLoadError)}
                  lookups={lookups}
                  query={query}
                  setQuery={setQuery}
                  state={listingState}
                  setState={setListingState}
                  propertyType={propertyTypeFilter}
                  setPropertyType={setPropertyTypeFilter}
                  sort={listingSort}
                  setSort={setListingSort}
                  onReset={() => {
                    setQuery("");
                    setListingState("active");
                    setPropertyTypeFilter("");
                    setListingSort("building");
                  }}
                  onHistory={showListingHistory}
                />
              )}
              {view === "customers" && (
                <CustomersView
                  items={customerResults}
                  status={customerStatus}
                  error={managedReads.customers.error?.queryKey === customerQueryKey ? managedReads.customers.error.message : ""}
                  onRetry={() => void loadCustomers().catch(showLoadError)}
                  query={query}
                  setQuery={setQuery}
                  sort={customerSort}
                  setSort={setCustomerSort}
                  onReset={() => {
                    setQuery("");
                    setCustomerSort("recent");
                  }}
                  onEdit={(item) => setCustomerModal({ mode: "edit", item })}
                  onNew={() => setCustomerModal({ mode: "new" })}
                  onNewWork={(item) => {
                    void openWork(undefined, item.id);
                  }}
                  onCopy={copyCustomerId}
                  onHistory={(customer) => void showCustomerHistory(customer)}
                />
              )}
              {view === "calendar" && (
                <CalendarView
                  status={calendarStatus}
                  error={managedReads.calendar.error?.queryKey === calendarQueryKey ? managedReads.calendar.error.message : ""}
                  onRetry={() => void loadCalendar().catch(showLoadError)}
                  month={calendarMonth}
                  setMonth={setCalendarMonth}
                  workType={calendarWorkType}
                  setWorkType={setCalendarWorkType}
                  items={calendarLogs}
                  lookups={lookups}
                  onOpen={readWork}
                  onShowDay={(date, items) => {
                    historyOpenVersion.current += 1;
                    setHistoryModal({
                      title: `${displayDate(date)} 업무`,
                      subtitle: `${items.length}건`,
                      items,
                      date,
                      workType: calendarWorkType,
                    });
                  }}
                />
              )}
              {view === "settings" && (
                <SettingsView
                  lookups={lookups}
                  onLogout={signOut}
                  onSaved={async () => {
                    setInsightsRefreshKey((value) => value + 1);
                    const data = await jsonFetch<Lookups>("/api/lookups");
                    setLookups(data);
                    setNotice("분류가 추가되었습니다.");
                  }}
                />
              )}
              {view === "trash" && <Suspense fallback={<p role="status">휴지통을 준비하고 있습니다…</p>}><TrashView refreshKey={insightsRefreshKey} onBusyChange={setWorkBusy} onRestored={() => { void afterMutation("기록을 복구했습니다. 원래 목록과 이력에 다시 반영했습니다."); }} /></Suspense>}
            </>
          )}
        </div>
      </section>
      {globalSearchLoaded && (
        <Suspense
          fallback={
            globalSearchOpen ? (
              <Modal
                title="통합검색"
                subtitle="고객·매물·업무를 한 번에 검색"
                onClose={() => setGlobalSearchOpen(false)}
              >
                <p role="status">검색을 준비하고 있습니다.</p>
              </Modal>
            ) : null
          }
        >
          <GlobalSearch
            open={globalSearchOpen}
            refreshKey={insightsRefreshKey}
            onClose={() => setGlobalSearchOpen(false)}
            onOpenWork={(id) => {
              void readWork(id);
            }}
            onOpenCustomer={(item) => {
              void showCustomerHistory(item);
            }}
            onOpenListing={(item) => {
              void showListingHistory(item);
            }}
          />
        </Suspense>
      )}
      {historyModal && !workReader && (
        <HistoryModal
          data={historyModal}
          onClose={() => { historyOpenVersion.current += 1; workOpenVersion.current += 1; setHistoryModal(null); }}
          onRefresh={() => void refreshHistory(historyModal)}
          onOpenWork={(id) => {
            void readWork(id);
          }}
          onNewWork={(id) => void openWork(undefined, id)}
          onNewListingWork={(listing) => void openWork(undefined, undefined, undefined, listing)}
          onModifyListing={(listing, customerId) => void openWork(undefined, customerId, "매물수정", listing)}
          onFollowUp={addFollowUp}
          onCopy={copyCustomerId}
        />
      )}
      {workReader && !workModal && (
        <Modal title="업무 내용" onClose={closeWorkReader} reading>
          {workReader.loading && <p className="form-help" role="status">업무 내용과 연결된 물건을 불러오고 있습니다…</p>}
          {workReader.error && <div className="form-error" role="alert"><p>{workReader.error}</p><button type="button" className="secondary-button" onClick={() => void readWork(workReader.id)}><Icon name="refresh" size={16} /> 다시 불러오기</button></div>}
          {workReader.item && <Suspense fallback={<p role="status">읽기 화면을 준비하고 있습니다…</p>}>
            <WorkDetailView item={workReader.item} onEdit={() => void openWork(workReader.id)}
              onDelete={() => setDeletionTarget({ type: "work", id: workReader.id })}
              onCustomerHistory={() => openReaderReference({ kind: "customer", id: workReader.item!.customer_id, name: workReader.item!.customer_name })}
              onListingHistory={(key) => { const [, building_name, building_dong, unit_number] = key.split("|"); openReaderReference({ kind: "listing", key, name: workPropertyLabel({ building_name, building_dong, unit_number }) }); }} />
          </Suspense>}
          {readerReference && <ReaderReferencePanel target={readerReference} onClose={closeReaderReference} />}
        </Modal>
      )}
      {workModal && (
        <WorkModal
          onBusyChange={setWorkBusy}
          key={`${workModal.mode}-${workModal.item?.id || "new"}`}
          modal={workModal}
          customers={customers}
          lookups={lookups}
          onNewCustomer={() => setCustomerModal({ mode: "new" })}
          onClose={() => { workOpenVersion.current += 1; setWorkModal(null); }}
          onCopy={(item) => { workOpenVersion.current += 1; setWorkModal({ mode: "copy", item }); }}
          onDelete={(id, unsavedDraft) => setDeletionTarget({ type: "work", id, unsavedDraft })}
          onSaved={async (message) => {
            workOpenVersion.current += 1;
            setWorkModal(null);
            await Promise.all([afterMutation(message), refreshHistory(historyModal), workReader ? readWork(workReader.id) : undefined]);
          }}
        />
      )}
      {customerModal && (
        <CustomerModal
          onBusyChange={setCustomerBusy}
          modal={customerModal}
          onClose={() => setCustomerModal(null)}
          onDelete={(id, unsavedDraft) => setDeletionTarget({ type: "customer", id, unsavedDraft })}
          onSaved={async (message, customerId, savedCustomer) => {
            setCustomerModal(null);
            if (savedCustomer) setCustomers((current) => [savedCustomer, ...current.filter((item) => item.id !== savedCustomer.id)]);
            if (customerId)
              setWorkModal((current) =>
                current
                  ? { ...current, initialCustomerId: customerId }
                  : current,
              );
            await afterMutation(message);
          }}
        />
      )}
      {workOpening && (
        <Modal title={workOpening.id ? "업무 수정" : "새 업무 등록"} onClose={closeWorkOpening}>
          {workOpening.error ? (
            <div className="form-error" role="alert">
              <p>{workOpening.error}</p>
              <button type="button" className="secondary-button" onClick={() => void openWork(workOpening.id, workOpening.initialCustomerId, workOpening.initialWorkType, workOpening.initialListing)}>
                <Icon name="refresh" size={16} /> 다시 불러오기
              </button>
            </div>
          ) : (
            <p className="form-help" role="status">고객 명부와 업무 입력 정보를 불러오고 있습니다…</p>
          )}
          <button type="button" className="secondary-button" onClick={closeWorkOpening}>취소하고 돌아가기</button>
        </Modal>
      )}
      {deletionTarget && <DeletionDialog key={`${deletionTarget.type}-${deletionTarget.id}`} {...deletionTarget} onBusyChange={setWorkBusy} onClose={() => setDeletionTarget(null)} onDeleted={() => { void afterDeletion(); }} />}
    </main>
  );
}

function Loading() {
  return (
    <div className="loading-grid">
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}
function DashboardView({
  dashboard,
  onOpen,
  onCustomerHistory,
  onListingHistory,
  onNavigate,
  onOpenSchedule,
  onQuickWork,
  followUps,
}: {
  dashboard: Dashboard;
  onOpen: (id?: string) => void;
  onNavigate: (view: View) => void;
  onOpenSchedule: () => void;
  onQuickWork: (workType: string) => void;
  followUps: ReactNode;
} & WorkHistoryActions) {
  const metrics = dashboard.metrics;
  return (
    <>
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-date">
            <Icon name="calendar" size={16} />
            {displayDate(seoulDate())}
          </p>
          <h2>오늘 업무와 다가오는 일정을 한눈에.</h2>
          <p>오늘 기록과 앞으로 7일 일정을 확인하고, 새 업무를 바로 기록하세요.</p>
        </div>
        <div className="home-hero-actions">
          <span className="home-section-label">자주 하는 업무 바로 등록</span>
          <div className="home-quick-actions">
            <button type="button" onClick={() => onQuickWork("전화")}>
              <Icon name="phone" size={19} />
              전화 상담
            </button>
            <button type="button" onClick={() => onQuickWork("집방문예약")}>
              <Icon name="calendarPlus" size={19} />
              방문 예약
            </button>
            <button type="button" onClick={() => onQuickWork("매물등록")}>
              <Icon name="housePlus" size={19} />
              매물 등록
            </button>
          </div>
        </div>
      </section>
      <div className="metric-grid">
        <article className="metric-card featured">
          <p className="metric-label">
            <Icon name="journal" size={19} />
            오늘 업무
          </p>
          <strong>
            {metrics.today_count}
            <small>건</small>
          </strong>
          <span>업무일이 오늘인 기록</span>
        </article>
        <article className="metric-card">
          <p className="metric-label">
            <Icon name="listings" size={19} />
            진행 중 매물
          </p>
          <strong>
            {metrics.active_listing_count}
            <small>건</small>
          </strong>
          <button onClick={() => onNavigate("listings")}>
            매물 목록 보기 <Icon name="next" size={16} />
          </button>
        </article>
        <article className="metric-card">
          <p className="metric-label">
            <Icon name="customers" size={19} />
            전체 고객
          </p>
          <strong>
            {metrics.customer_count}
            <small>명</small>
          </strong>
          <button onClick={() => onNavigate("customers")}>
            고객 목록 보기 <Icon name="next" size={16} />
          </button>
        </article>
        <article className="metric-card">
          <p className="metric-label">
            <Icon name="upcoming" size={19} />
            다가오는 일정
          </p>
          <strong>
            {metrics.upcoming_count}
            <small>건</small>
          </strong>
          <button className="attention" onClick={onOpenSchedule}>
            7일 일정 확인 <Icon name="next" size={16} />
          </button>
        </article>
      </div>
      <div className="home-body-grid">
        <section className="panel schedule-panel dashboard-schedule">
          <div className="panel-head">
            <h2 className="heading-icon">
              <Icon name="journal" />
              오늘 업무
            </h2>
            <button
              className="text-button"
              onClick={() => onNavigate("calendar")}
            >
              달력 보기
            </button>
          </div>
          <WorkRows
            items={dashboard.today}
            onOpen={onOpen}
            empty="오늘 등록된 업무가 없습니다."
          />
          <div className="panel-head">
            <h2 className="heading-icon">
              <Icon name="upcoming" />
              앞으로 7일
            </h2>
            <button
              className="text-button"
              onClick={onOpenSchedule}
            >
              전체 {metrics.upcoming_count}건 보기
            </button>
          </div>
          {metrics.upcoming_count > (dashboard.upcoming?.length ?? 0) && <p className="schedule-preview-note">가까운 일정 {dashboard.upcoming?.length ?? 0}건 미리보기 · 전체 보기에서 다음 달 일정도 확인할 수 있습니다.</p>}
          <WorkRows
            items={dashboard.upcoming ?? []}
            onOpen={onOpen}
            showDate
            empty="앞으로 7일간 등록된 일정이 없습니다."
          />
        </section>
        {followUps}
      </div>
      <section className="panel recent-panel">
        <div className="panel-head">
          <div>
            <h2 className="heading-icon">
              <Icon name="journal" />
              최근 업무
            </h2>
            <p className="sort-summary">
              <Icon name="sort" size={16} />
              오늘까지의 기록 · 업무일 최신순
            </p>
          </div>
          <button className="text-button" onClick={() => onNavigate("journal")}>
            전체 보기
          </button>
        </div>
        <WorkTable items={dashboard.recent} onOpen={onOpen} onCustomerHistory={onCustomerHistory} onListingHistory={onListingHistory} />
      </section>
    </>
  );
}
function WorkRows({
  items,
  onOpen,
  empty,
  showDate = false,
}: {
  items: WorkSummary[];
  onOpen: (id?: string) => void;
  empty: string;
  showDate?: boolean;
}) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <div className="schedule-list">
      {items.map((item) => (
        <button
          className="schedule-row"
          onClick={() => onOpen(item.id)}
          key={item.id}
        >
          <span className={`schedule-icon ${statusTone(item.work_type)}`}>
            <Icon name={workTypeIcon(item.work_type)} size={18} />
          </span>
          <span className="schedule-copy">
            <strong>
              {item.customer_name}
            </strong>
            <WorkSummaryProperties work={item} showSingle />
            <small>
              {showDate && `${displayDate(item.work_date)} · `}
              {item.content || item.customer_name}
            </small>
          </span>
          <span className={`tag ${statusTone(item.work_type)}`}>
            {item.work_type}
          </span>
          <Icon name="next" className="row-arrow" size={18} />
        </button>
      ))}
    </div>
  );
}
function Toolbar({
  query,
  setQuery,
  placeholder,
  children,
}: {
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="toolbar">
      <div className="search-box">
        <Icon name="search" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {query && (
          <button
            className="search-clear"
            onClick={() => setQuery("")}
            type="button"
            aria-label="검색어 지우기"
          >
            <Icon name="close" size={17} />
          </button>
        )}
        <span className="search-live">바로 검색</span>
      </div>
      {children}
    </div>
  );
}
function JournalView({
  items,
  total,
  lookups,
  query,
  setQuery,
  workType,
  setWorkType,
  period,
  setPeriod,
  onReset,
  onLoadMore,
  loadingMore,
  status,
  error,
  onRetry,
  exporting,
  canLoadMore,
  onExport,
  onOpen,
  onCustomerHistory,
  onListingHistory,
}: {
  items: WorkSummary[];
  total: number;
  lookups: Lookups;
  query: string;
  setQuery: (v: string) => void;
  workType: string;
  setWorkType: (v: string) => void;
  period: string;
  setPeriod: (v: string) => void;
  onReset: () => void;
  onLoadMore: () => void | Promise<void>;
  loadingMore: boolean;
  status: JournalSearchStatus;
  error: string;
  onRetry: () => void | Promise<void>;
  exporting: boolean;
  canLoadMore: boolean;
  onExport: () => void | Promise<void>;
  onOpen: (id?: string) => void;
} & WorkHistoryActions) {
  const filtered = Boolean(query || workType || period);
  const resultsVisible = status === "ready" || status === "refreshing";
  return (
    <>
      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="고객명, 연락처, 건물명, 동·호수, 내용 검색"
      >
        <select
          aria-label="업무구분 필터"
          value={workType}
          onChange={(event) => setWorkType(event.target.value)}
        >
          <option value="">모든 업무구분</option>
          {lookups.workTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <select
          aria-label="업무 기간 필터"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        >
          <option value="">전체 기간</option>
          <option value="today">오늘</option>
          <option value="7d">최근 7일</option>
          <option value="month">이번 달</option>
        </select>
        {filtered && (
          <button className="filter-reset" onClick={onReset} type="button">
            초기화
          </button>
        )}
        <button
          className="export-button"
          onClick={() => {
            void onExport();
          }}
          disabled={status !== "ready" || !total || loadingMore || exporting}
          type="button"
          title="현재 조건에 맞는 전체 업무를 저장합니다. 물건은 업무당 대표 1건이며, 물건 검색 시 첫 일치 물건입니다."
        >
          <Icon name={exporting ? "refresh" : "download"} size={18} /> {exporting ? "CSV 준비 중…" : "CSV 저장"}
        </button>
      </Toolbar>
      {filtered && (
        <div className="active-filter-row">
          <strong>{status === "loading" ? "검색 중" : status === "refreshing" ? "갱신 중" : status === "error" ? "다시 확인 필요" : "적용 중"}</strong>
          {query && <span>검색: {query}</span>}
          {workType && <span>{workType}</span>}
          {period && (
            <span>
              {period === "today"
                ? "오늘"
                : period === "7d"
                  ? "최근 7일"
                  : "이번 달"}
            </span>
          )}
        </div>
      )}
      <section className="panel data-panel" aria-busy={status === "loading" || status === "refreshing"}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">WORK RECORDS</p>
            <h2>
              업무 기록{" "}
              <span className="count-badge">
                {resultsVisible ? `${items.length} / ${total}` : status === "loading" ? "검색 중…" : "조회 실패"}
              </span>
            </h2>
            <p className="sort-summary">
              <Icon name="sort" size={16} />
              업무일 최신순 · 같은 날은 최근 수정순
            </p>
          </div>
          <span className="helper-text">
            주소는 매물 이력 · 내용 보기는 업무 상세
          </span>
        </div>
        {status === "refreshing" && (
          <p className="journal-refresh-notice" role="status">업무 기록을 갱신하고 있습니다. 같은 조건의 기존 결과를 표시 중입니다.</p>
        )}
        {status === "loading" ? (
          <div className="journal-search-feedback" role="status">
            <Icon name="search" size={24} />
            <strong>조건에 맞는 업무를 찾고 있습니다.</strong>
            <p>검색이 끝나면 결과와 건수를 표시합니다.</p>
          </div>
        ) : status === "error" ? (
          <div className="journal-search-feedback journal-search-error" role="alert">
            <strong>업무 기록을 불러오지 못했습니다.</strong>
            <p>{error || "연결 상태를 확인한 뒤 다시 시도해 주세요."}</p>
            <p>조회에 실패한 상태이며, 검색 결과가 0건이라는 뜻은 아닙니다.</p>
            <button type="button" className="secondary-button" onClick={() => { void onRetry(); }}>
              <Icon name="refresh" size={18} /> 다시 시도
            </button>
          </div>
        ) : <WorkTable items={items} onOpen={onOpen} onCustomerHistory={onCustomerHistory} onListingHistory={onListingHistory} />}
        {resultsVisible && items.length < total && (
          <div className="load-more">
            <button
              type="button"
              onClick={() => {
                void onLoadMore();
              }}
              disabled={!canLoadMore}
            >
              <Icon name={loadingMore ? "refresh" : "plus"} size={18} />
              {loadingMore ? "불러오는 중…" : "100건 더 보기"}{" "}
              <small>
                남은 {(total - items.length).toLocaleString("ko-KR")}건
              </small>
            </button>
          </div>
        )}
        {resultsVisible && total > 0 && (
          <p className="journal-export-note">CSV는 현재 조건에 맞는 전체 업무를 저장합니다. 물건은 업무당 대표 1건이며, 물건 검색 시 첫 일치 물건입니다.</p>
        )}
      </section>
    </>
  );
}
function WorkTable({
  items,
  onOpen,
  onCustomerHistory,
  onListingHistory,
}: {
  items: WorkSummary[];
  onOpen: (id?: string) => void;
} & WorkHistoryActions) {
  if (!items.length) return <EmptyState title="조건에 맞는 업무가 없습니다." />;
  return (
    <div className="responsive-table work-table work-reading-list">
      {items.map((item) => {
        const properties = getWorkProperties(item);
        const groups = getPropertyDisplayGroups(properties);
        return <article className="table-row work-record-row" key={item.id}>
          <div className="work-record-meta">
            <span data-label="일자"><button type="button" className="work-record-date" onClick={() => onOpen(item.id)} aria-label={`${displayDate(item.work_date)} ${item.customer_name} 업무 내용 보기`}><time dateTime={item.work_date}>{displayDate(item.work_date)}</time></button></span>
            <span data-label="업무구분"><i className={`tag ${statusTone(item.work_type)}`}>{item.work_type}</i></span>
            <span data-label="고객" className="work-record-customer"><button type="button" className="work-record-customer-link" onClick={() => onCustomerHistory({ id: item.customer_id, name: item.customer_name })} aria-label={`${item.customer_name} 고객 이력 보기`}><b>{item.customer_name}</b><span className="work-customer-id">{item.customer_id}</span><Icon name="clock" size={14} /></button></span>
            <button type="button" className="work-record-open" onClick={() => onOpen(item.id)} aria-label={Number(item.property_count) > 1 ? "전체 업무 내용 보기" : `${item.customer_name} 업무 내용 보기`}>내용 보기 <Icon name="next" size={15} /></button>
          </div>
          <div className={`work-record-body${properties.length ? " has-properties" : ""}`}>
            <span data-label="내용" className="work-record-content"><button type="button" className="work-cell-button work-record-note" onClick={() => onOpen(item.id)} aria-label={`${item.customer_name} 업무 내용 보기`}><span className="work-record-note-text">{item.content || "기록된 내용이 없습니다."}</span></button></span>
            <span data-label="물건" className="work-record-properties">
              {properties.length > 0 ? <>
                <span className="work-record-property-heading"><Icon name="listings" size={15} /><strong className="work-property-group-label" aria-label={`함께 기록한 물건 ${item.property_count}개`}>연결 매물 <span>{item.property_count}</span></strong></span>
                <span className="work-property-groups">
                  {groups.map((group) => <span className="work-property-building-group" key={group.key}>
                    <strong className="work-property-building">{group.building || group.items[0].property.property_type || "물건 정보 미입력"}</strong>
                    <ol className="work-property-list">
                      {group.items.map(({ property, index, shortLabel }) => {
                        const matched = Number(item.search_property_match) === 1 && property.property_type === item.property_type && property.building_name === item.building_name && property.building_dong === item.building_dong && property.unit_number === item.unit_number;
                        const label = workPropertyLabel(property);
                        return <li key={property.id || index} className={matched ? "is-search-match" : undefined}>
                          {property.property_type.trim() && property.building_name.trim() && property.unit_number.trim() ? <button type="button" className="work-cell-button history-link" onClick={() => onListingHistory({ ...item, ...property, id: item.id })} aria-label={`${label} 매물 이력 보기`}>
                            <span className="work-property-address">{shortLabel}</span>{matched && <span className="work-property-match" aria-label="검색 일치 물건" title="검색 일치 물건"><Icon name="search" size={12} /> 일치</span>}<Icon name="next" size={13} />
                          </button> : <span className="work-property-incomplete" aria-label={label}>{shortLabel}{matched && <span className="work-property-match" aria-label="검색 일치 물건">일치</span>}</span>}
                        </li>;
                      })}
                    </ol>
                  </span>)}
                </span>
                {Number(item.property_count) > properties.length && <span className="work-record-legacy-note">전체 물건 정보는 내용 보기에서 확인하세요.</span>}
              </> : <span className="work-record-no-property">물건 없음</span>}
            </span>
          </div>
        </article>;
      })}
    </div>
  );
}
function ListReadFeedback({ status, error = "", onRetry, label = "목록" }: {
  status: JournalSearchStatus; error?: string; onRetry?: () => void; label?: string;
}) {
  if (status === "ready") return null;
  if (status === "refreshing") return <p className="workflow-refresh" role="status">{label}을 갱신하고 있습니다. 같은 조건의 이전 결과입니다.</p>;
  return <div className={`workflow-feedback${status === "error" ? " is-error" : ""}`} role={status === "error" ? "alert" : "status"}>
    <Icon name={status === "error" ? "warning" : "search"} size={24} />
    <strong>{status === "error" ? `${label}을 불러오지 못했습니다.` : `${label}을 불러오고 있습니다.`}</strong>
    <p>{status === "error" ? error || "연결 상태를 확인하고 다시 시도해 주세요." : "조회가 끝나면 현재 조건에 맞는 결과와 건수를 표시합니다."}</p>
    {status === "error" && <><small>조회 실패이며, 기록이 없다는 뜻은 아닙니다.</small><button className="secondary-button" type="button" onClick={onRetry}><Icon name="refresh" size={17} /> 다시 불러오기</button></>}
  </div>;
}
function ListingsView({
  items,
  lookups,
  query,
  setQuery,
  state,
  setState,
  propertyType,
  setPropertyType,
  sort,
  setSort,
  onReset,
  onHistory,
  status = "ready", error = "", onRetry,
}: {
  items: Listing[];
  lookups: Lookups;
  query: string;
  setQuery: (v: string) => void;
  state: string;
  setState: (v: string) => void;
  propertyType: string;
  setPropertyType: (v: string) => void;
  sort: string;
  setSort: (v: string) => void;
  onReset: () => void;
  onHistory: (item: Listing) => void;
  status?: JournalSearchStatus; error?: string; onRetry?: () => void;
}) {
  const resultsVisible = status === "ready" || status === "refreshing";
  const filtered = Boolean(
    query || state !== "active" || propertyType || sort !== "building",
  );
  return (
    <>
      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="건물명, 동·호수, 메모 검색"
      >
        <select
          aria-label="매물 상태 필터"
          value={state}
          onChange={(event) => {
            const next = event.target.value;
            setState(next);
            if (next === "stale") setSort("oldest");
            else if (state === "stale" && sort === "oldest")
              setSort("building");
          }}
        >
          <option value="active">진행 중</option>
          <option value="stale">90일 이상 확인 필요</option>
          <option value="closed">종료</option>
          <option value="all">전체</option>
        </select>
        <select
          aria-label="물건구분 필터"
          value={propertyType}
          onChange={(event) => setPropertyType(event.target.value)}
        >
          <option value="">모든 물건구분</option>
          {lookups.propertyTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <select
          aria-label="매물 정렬"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="building">건물·동·호수순</option>
          <option value="recent">최근 등록순</option>
          <option value="updated">최근 변경순</option>
          <option value="oldest">오래 미갱신순</option>
        </select>
        {filtered && (
          <button className="filter-reset" onClick={onReset} type="button">
            초기화
          </button>
        )}
        <button
          className="export-button"
          onClick={() =>
            downloadCsv(
              `매물목록-${seoulDate()}.csv`,
              [
                "상태",
                "물건구분",
                "건물명",
                "동",
                "호수",
                "타입",
                "매매가",
                "전세가",
                "월세가",
                "등록일",
                "말소일",
              ],
              items.map((item) => [
                item.status,
                item.property_type,
                item.building_name,
                item.building_dong,
                item.unit_number,
                item.size_type,
                item.sale_price,
                item.jeonse_price,
                item.monthly_rent,
                item.registered_at,
                item.closed_at,
              ]),
            )
          }
          disabled={status !== "ready" || !items.length}
          type="button"
        >
          <Icon name="download" size={18} /> CSV 저장
        </button>
      </Toolbar>
      <div className="active-filter-row" aria-label="현재 매물 조회 조건"><strong>{status === "loading" ? "조회 중" : "조회 조건"}</strong><span>{({ active: "진행 중", closed: "종료", stale: "90일 이상 확인 필요", all: "전체 상태" } as Record<string, string>)[state]}</span>{propertyType && <span>{propertyType}</span>}{query && <span>검색: {query}</span>}</div>
      <section className="panel data-panel" aria-busy={status === "loading" || status === "refreshing"}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">CURRENT LISTINGS</p>
            <h2>
              매물 목록 <span className="count-badge">{resultsVisible ? `${items.length}건` : status === "error" ? "조회 실패" : "조회 중…"}</span>
            </h2>
            <p className="sort-summary">
              <Icon name="sort" size={16} />
              {sort === "recent"
                ? "최근 등록순"
                : sort === "updated"
                  ? "최근 변경순"
                  : sort === "oldest"
                    ? "마지막 갱신이 오래된 순"
                    : "건물명 → 동 → 호수순"}
              {state === "all" ? " · 진행 중 우선" : ""}
              {sort === "building" ? " · 동·호수는 숫자순" : ""}
            </p>
          </div>
          <span className="helper-text">
            {state === "stale"
              ? "진행 중 매물 중 마지막 갱신이 90일 이상 지난 매물입니다. 이력에서 확인할 일을 추가하세요."
              : "매물을 누르면 전체 이력을 읽고 ‘매물 수정 이력 추가’로 변경 사항을 기록할 수 있습니다"}
          </span>
        </div>
        <ListReadFeedback status={status} error={error} onRetry={onRetry} label="매물 목록" />
        {resultsVisible && (!items.length ? (
          <EmptyState title="조건에 맞는 매물이 없습니다." />
        ) : (
          <div className="responsive-table listing-table">
            <div className="table-head">
              <span>상태</span>
              <span>물건</span>
              <span>구분·타입</span>
              <span>가격</span>
              <span>등록·말소</span>
            </div>
            {items.map((item) => (
              <button
                className="table-row"
                key={item.id}
                onClick={() => onHistory(item)}
              >
                <span data-label="상태">
                  <i className={`tag ${statusTone(item.status)}`}>
                    {item.status}
                  </i>
                </span>
                <span data-label="물건">
                  <b>{targetText(item)}</b>
                </span>
                <span data-label="구분·타입">
                  {item.property_type} · {item.size_type || "-"}
                </span>
                <span data-label="가격">
                  <Price item={item} />
                </span>
                <span data-label="등록·말소">
                  {displayDate(item.registered_at)}
                  <small>
                    {item.closed_at
                      ? `말소 ${displayDate(item.closed_at)}`
                      : "진행 중"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ))}
        {resultsVisible && items.length >= 1000 && <p className="workflow-limit-note">최대 1,000건을 표시 중입니다. 건물명·동·호수나 상태로 범위를 좁혀 주세요. CSV는 현재 표시된 목록을 저장합니다.</p>}
      </section>
    </>
  );
}
function Price({
  item,
}: {
  item: Pick<Listing, "sale_price" | "jeonse_price" | "monthly_rent">;
}) {
  const parts = [
    item.sale_price && `매매 ${item.sale_price}`,
    item.jeonse_price && `전세 ${item.jeonse_price}`,
    item.monthly_rent && `월세 ${item.monthly_rent}`,
  ].filter(Boolean);
  return (
    <>
      {parts.length
        ? parts.map((part) => (
            <small className="price-line" key={part as string}>
              {part}
            </small>
          ))
        : "-"}
    </>
  );
}
function CustomersView({
  items,
  query,
  setQuery,
  sort,
  setSort,
  onReset,
  onEdit,
  onNew,
  onNewWork,
  onCopy,
  onHistory,
  status = "ready", error = "", onRetry,
}: {
  items: Customer[];
  query: string;
  setQuery: (v: string) => void;
  sort: string;
  setSort: (v: string) => void;
  onReset: () => void;
  onEdit: (item: Customer) => void;
  onNew: () => void;
  onNewWork: (item: Customer) => void;
  onCopy: (value: string) => void;
  onHistory: (item: Customer) => void;
  status?: JournalSearchStatus; error?: string; onRetry?: () => void;
}) {
  const resultsVisible = status === "ready" || status === "refreshing";
  const filtered = Boolean(query || sort !== "recent");
  return (
    <>
      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="고객명, 전화번호, 상담 메모 검색"
      >
        <select
          aria-label="고객 정렬"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="recent">최근 업무·등록순</option>
          <option value="name">이름순</option>
          <option value="history">이력 많은 순</option>
        </select>
        {filtered && (
          <button className="filter-reset" onClick={onReset} type="button">
            초기화
          </button>
        )}
        <button
          className="export-button"
          onClick={() =>
            downloadCsv(
              `고객목록-${seoulDate()}.csv`,
              ["고객명", "고객ID", "비고", "최근 업무", "업무 이력 수"],
              items.map((item) => [
                item.name,
                item.id,
                item.notes,
                item.last_work_date,
                item.history_count,
              ]),
            )
          }
          disabled={status !== "ready" || !items.length}
          type="button"
        >
          <Icon name="download" size={18} /> CSV 저장
        </button>
        <button className="secondary-button" onClick={onNew} type="button">
          <Icon name="plus" size={18} /> 고객 등록
        </button>
      </Toolbar>
      {query && <div className="active-filter-row"><strong>{status === "loading" ? "조회 중" : "조회 조건"}</strong><span>검색: {query}</span></div>}
      <section className="panel data-panel" aria-busy={status === "loading" || status === "refreshing"}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">CUSTOMERS</p>
            <h2>
              고객 목록 <span className="count-badge">{resultsVisible ? `${items.length}명` : status === "error" ? "조회 실패" : "조회 중…"}</span>
            </h2>
            <p className="sort-summary">
              <Icon name="sort" size={16} />
              {sort === "name"
                ? "이름 가나다순 · 같은 이름은 고객 ID순"
                : sort === "history"
                  ? "업무 이력 많은 순"
                  : "최근 업무·등록순 · 미래 예약은 제외"}
            </p>
          </div>
          <span className="helper-text">
            이름을 누르면 전체 이력, 고객 ID를 누르면 바로 복사됩니다
          </span>
        </div>
        <ListReadFeedback status={status} error={error} onRetry={onRetry} label="고객 목록" />
        {resultsVisible && (!items.length ? (
          <EmptyState title="조건에 맞는 고객이 없습니다." />
        ) : (
          <div className="responsive-table customer-table">
            <div className="table-head">
              <span>고객명</span>
              <span>연락처 · 고객 ID</span>
              <span>비고</span>
              <span>최근 업무</span>
              <span>빠른 관리</span>
            </div>
            {items.map((item) => (
              <div className="table-row" key={item.id}>
                <button
                  className="customer-link"
                  data-label="고객명"
                  onClick={() => onHistory(item)}
                >
                  <b>{item.name}</b>
                  <small>전체 이력 보기</small>
                </button>
                <button
                  className="customer-id-copy"
                  data-label="고객 ID"
                  onClick={() => onCopy(item.id)}
                  title="고객 ID 복사"
                >
                  {item.id}
                  <small>
                    <Icon name="copy" size={13} /> 눌러서 복사
                  </small>
                </button>
                <span className="customer-notes" data-label="비고">{item.notes || "-"}</span>
                <span data-label="최근 업무">
                  {displayDate(item.last_work_date)}
                  <small>이력 {item.history_count}건</small>
                </span>
                <span className="row-actions" data-label="빠른 관리">
                  <button
                    className="tiny-button accent"
                    onClick={() => onNewWork(item)}
                  >
                    <Icon name="plus" size={16} /> 업무 등록
                  </button>
                  <button className="tiny-button" onClick={() => onEdit(item)}>
                    <Icon name="edit" size={16} /> 수정
                  </button>
                </span>
              </div>
            ))}
          </div>
        ))}
        {resultsVisible && items.length >= 1000 && <p className="workflow-limit-note">관리 화면은 최대 1,000명을 표시합니다. 이름·연락처로 범위를 좁혀 주세요. 새 업무의 고객 선택은 전체 명부에서 검색합니다.</p>}
      </section>
    </>
  );
}
function CalendarView({
  month,
  setMonth,
  workType,
  setWorkType,
  items,
  lookups,
  onOpen,
  onShowDay,
  status = "ready", error = "", onRetry,
}: {
  month: string;
  setMonth: (v: string) => void;
  workType: string;
  setWorkType: (v: string) => void;
  items: WorkSummary[];
  lookups: Lookups;
  onOpen: (id?: string) => void;
  onShowDay: (date: string, items: WorkSummary[]) => void;
  status?: JournalSearchStatus; error?: string; onRetry?: () => void;
}) {
  const resultsVisible = status === "ready" || status === "refreshing";
  const today = seoulDate();
  const { displayedMonth, cells, grouped, firstWeekday } = useMemo(() => {
    const displayedMonth = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
    // ISO parsing avoids Date's special handling of numeric years below 100.
    const first = new Date(`${displayedMonth}-01T12:00:00Z`);
    const last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    const count = last.getUTCDate();
    const grouped = items.reduce<Record<number, WorkSummary[]>>((acc, item) => {
      const day = Number(item.work_date.slice(8, 10));
      // A changed month must not briefly show the previous month's rows.
      if (!item.work_date.startsWith(`${displayedMonth}-`) || !Number.isInteger(day) || day < 1 || day > count) return acc;
      // Keep the selected work type honest while its replacement request is pending.
      if (workType && item.work_type !== workType) return acc;
      (acc[day] ||= []).push(item);
      return acc;
    }, {});
    return {
      displayedMonth,
      cells: [
        ...Array(first.getUTCDay()).fill(null),
        ...Array.from({ length: count }, (_, index) => index + 1),
      ],
      grouped,
      firstWeekday: first.getUTCDay(),
    };
  }, [month, items, today, workType]);
  const agendaDays = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  function changeMonth(amount: number) {
    const date = new Date(`${displayedMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    const next = `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(next)) setMonth(next);
  }
  return (
    <>
      <div className="calendar-controls">
        <button
          type="button"
          aria-label="이전 달"
          disabled={displayedMonth === "0001-01"}
          onClick={() => changeMonth(-1)}
        >
          <Icon name="back" size={18} />
        </button>
        <input
          aria-label="달력 월"
          type="month"
          min="0001-01"
          max="9999-12"
          value={displayedMonth}
          onChange={(event) => {
            if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value);
          }}
        />
        <button
          type="button"
          aria-label="다음 달"
          disabled={displayedMonth === "9999-12"}
          onClick={() => changeMonth(1)}
        >
          <Icon name="next" size={18} />
        </button>
        <select
          aria-label="달력 업무구분 필터"
          value={workType}
          onChange={(event) => setWorkType(event.target.value)}
        >
          <option value="">모든 업무구분</option>
          {lookups.workTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <button className="calendar-today" type="button" onClick={() => setMonth(today.slice(0, 7))}>이번 달</button>
      </div>
      <ListReadFeedback status={status} error={error} onRetry={onRetry} label="달력 기록" />
      {resultsVisible && <>
      <p className="calendar-result-summary">{displayedMonth.replace("-", "년 ")}월 · {workType || "모든 업무구분"} · {Object.values(grouped).reduce((count, rows) => count + rows.length, 0)}건</p>
      <p className="calendar-reading-guide">매물·계약 업무는 물건 중심, 전화·방문 등은 고객 중심으로 표시합니다. 누르면 먼저 내용을 읽을 수 있습니다.</p>
      <section className="panel calendar-panel calendar-desktop-panel" aria-label="월간 업무 달력">
        <div className="calendar-week">
          <span>일</span>
          <span>월</span>
          <span>화</span>
          <span>수</span>
          <span>목</span>
          <span>금</span>
          <span>토</span>
        </div>
        <div className="calendar-grid">
          {cells.map((day, index) => (
            <div
              className={`calendar-cell ${day === Number(today.slice(8, 10)) && displayedMonth === today.slice(0, 7) ? "today-cell" : ""}`}
              key={`${day}-${index}`}
            >
              {day && (
                <>
                  <b>{day}</b>
                  <div>
                    {(grouped[day] || []).slice(0, 4).map((item) => {
                      const presentation = calendarWorkPresentation(item);
                      return (
                      <button
                        type="button"
                        className={statusTone(item.work_type)}
                        onClick={() => onOpen(item.id)}
                        key={item.id}
                        aria-label={`${item.work_type} · ${presentation.entries.join(" · ")} 내용 보기`}
                      >
                        <span className="calendar-card-heading"><span>{item.work_type}</span>{presentation.properties.length > 1 && <span className="calendar-property-count">물건 {presentation.properties.length}개</span>}</span>
                        <CalendarSubjects item={item} />
                      </button>
                    );
                    })}
                    {(grouped[day]?.length || 0) > 4 && (
                      <button
                        className="calendar-more"
                        type="button"
                        onClick={() =>
                          onShowDay(
                            `${displayedMonth}-${String(day).padStart(2, "0")}`,
                            grouped[day],
                          )
                        }
                      >
                        +{grouped[day].length - 4}건 더보기
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel calendar-agenda" aria-label="날짜별 업무 목록">
        {agendaDays.length === 0 ? (
          <p className="calendar-agenda-empty">
            {workType ? "선택한 달에 해당 업무구분의 기록이 없습니다." : "선택한 달에 등록된 업무가 없습니다."}
          </p>
        ) : agendaDays.map((day) => {
          const date = `${displayedMonth}-${String(day).padStart(2, "0")}`;
          const dayItems = grouped[day];
          return (
            <article className={`calendar-agenda-day${date === today ? " is-today" : ""}`} key={date}>
              <header className="calendar-agenda-day-head">
                <h2><time dateTime={date}>{Number(displayedMonth.slice(5))}월 {day}일 ({weekdays[(firstWeekday + day - 1) % 7]})</time>{date === today && <span>오늘</span>}</h2>
                <span>{dayItems.length}건</span>
              </header>
              <div className="calendar-agenda-events">
                {dayItems.slice(0, 4).map((item) => {
                  const presentation = calendarWorkPresentation(item);
                  return (
                    <button className="calendar-agenda-event" type="button" key={item.id} onClick={() => onOpen(item.id)}>
                      <span className="calendar-agenda-event-head"><span className={`tag ${statusTone(item.work_type)}`}>{item.work_type}</span><span className="calendar-agenda-open">내용 보기 <Icon name="next" size={16} /></span></span>
                      {presentation.properties.length > 1 && <span className="calendar-property-count">관련 물건 {presentation.properties.length}개</span>}
                      <CalendarSubjects item={item} />
                      {presentation.propertyFocused && item.customer_name && <small>고객 · {presentation.customerLabel}</small>}
                      {item.content && <span className="calendar-agenda-notes">{item.content}</span>}
                    </button>
                  );
                })}
              </div>
              {dayItems.length > 4 && (
                <button className="calendar-agenda-more" type="button" onClick={() => onShowDay(date, dayItems)}>
                  이 날짜 업무 {dayItems.length}건 모두 보기 <span>· {dayItems.length - 4}건 더 있음</span>
                </button>
              )}
            </article>
          );
        })}
      </section>
      </>}
    </>
  );
}
function SettingsView({
  lookups,
  onSaved,
  onLogout,
}: {
  lookups: Lookups;
  onSaved: () => Promise<void>;
  onLogout: () => void;
}) {
  const [kind, setKind] = useState("workType");
  const [propertyType, setPropertyType] = useState(
    lookups.propertyTypes[0] || "아파트",
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const requestPending = useRef(false);
  async function refreshSavedLookups() {
    setRefreshError("");
    try {
      await onSaved();
    } catch {
      setRefreshError("분류는 추가되었지만 목록을 다시 불러오지 못했습니다. 다시 추가할 필요는 없습니다. 목록만 다시 불러와 주세요.");
    }
  }
  async function retryRefresh() {
    if (requestPending.current) return;
    requestPending.current = true;
    setSaving(true);
    try {
      await refreshSavedLookups();
    } finally {
      requestPending.current = false;
      setSaving(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestPending.current) return;
    requestPending.current = true;
    setSaving(true);
    setError("");
    setSavedMessage("");
    setRefreshError("");
    try {
      await jsonFetch("/api/lookups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, propertyType, name }),
      });
      setName("");
      setSavedMessage(`‘${name.trim()}’ 분류를 추가했습니다.`);
      await refreshSavedLookups();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      requestPending.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">WORK TYPES</p>
            <h2>업무구분</h2>
          </div>
          <span className="count-badge">{lookups.workTypes.length}</span>
        </div>
        <div className="chip-list">
          {lookups.workTypes.map((type) => (
            <span key={type}>{type}</span>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">BUILDINGS</p>
            <h2>물건·건물 분류</h2>
          </div>
          <span className="count-badge">{lookups.buildings.length}</span>
        </div>
        <div className="building-groups">
          {lookups.propertyTypes.map((type) => (
            <details key={type}>
              <summary>
                <Icon name="next" size={18} />
                <span>{type}</span>
                <small>
                  {
                    lookups.buildings.filter(
                      (item) => item.property_type === type,
                    ).length
                  }
                  개
                </small>
              </summary>
              <ul className="building-name-list">
                {lookups.buildings
                  .filter((item) => item.property_type === type)
                  .map((item) => <li key={item.id}>{item.building_name}</li>)}
              </ul>
            </details>
          ))}
        </div>
      </section>
      <form className="panel add-setting" onSubmit={submit}>
        <div>
          <p className="eyebrow">ADD ITEM</p>
          <h2>새 분류 추가</h2>
        </div>
        <label>
          분류
          <select
            value={kind}
            disabled={saving}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="workType">업무구분</option>
            <option value="building">건물명</option>
          </select>
        </label>
        {kind === "building" && (
          <label>
            물건구분
            <select
              value={propertyType}
              disabled={saving}
              onChange={(event) => setPropertyType(event.target.value)}
            >
              {lookups.propertyTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          이름
          <input
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        {savedMessage && <div className="form-help" role="status">{savedMessage}</div>}
        {refreshError && <div className="form-error" role="alert"><p>{refreshError}</p><button type="button" className="secondary-button" onClick={retryRefresh} disabled={saving}><Icon name="refresh" size={17} /> 목록 다시 불러오기</button></div>}
        <button className="primary-button" disabled={saving}>
          {saving ? savedMessage ? "목록 불러오는 중…" : "추가 중…" : "추가"}
        </button>
      </form>
      <BackupPanel />
      <section className="panel account-panel">
        <div>
          <h2>관리자 계정</h2>
          <p>현재 기기에서 안전하게 로그아웃합니다.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onLogout}>
          로그아웃
        </button>
      </section>
    </div>
  );
}

function BackupPanel() {
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadKey, setDownloadKey] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const loadVersion = useRef(0);
  const creatingRef = useRef(false);
  const downloadingRef = useRef(false);
  const createdListPending = useRef(false);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await jsonFetch<{ backups: BackupSummary[] }>(
        "/api/backups",
      );
      if (version !== loadVersion.current) return false;
      setBackups([...data.backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      if (createdListPending.current) {
        createdListPending.current = false;
        setMessage("새 백업 목록을 확인했습니다. 아래 최신 백업에서 내려받을 수 있습니다.");
      }
      return true;
    } catch (error) {
      if (version === loadVersion.current)
        setLoadError(error instanceof Error ? error.message : "백업 목록을 불러오지 못했습니다.");
      return false;
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadVersion.current += 1;
    };
  }, [load]);
  async function createNow() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    createdListPending.current = false;
    setCreating(true);
    setMessage("");
    setActionError("");
    try {
      await jsonFetch("/api/backups", { method: "POST" });
      const refreshed = await load();
      createdListPending.current = !refreshed;
      setMessage(refreshed
        ? "새 백업을 만들었습니다. 아래 최신 백업에서 내려받을 수 있습니다."
        : "새 백업은 만들어졌지만 목록을 확인하지 못했습니다. 아래 ‘다시 불러오기’로 최신 백업을 확인해 주세요.");
    } catch (backupError) {
      setActionError(backupError instanceof Error ? backupError.message : "백업을 만들지 못했습니다.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }
  async function download(backup: BackupSummary) {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    createdListPending.current = false;
    setDownloadKey(backup.key);
    setActionError("");
    setMessage("");
    try {
      const response = await fetch(`/api/backups/download?key=${encodeURIComponent(backup.key)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "백업 파일을 내려받지 못했습니다. 다시 시도해 주세요.");
      }
      if (!response.headers.get("Content-Type")?.includes("application/json"))
        throw new Error("백업 파일을 확인하지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `jipjangbu-backup-${backup.createdAt.slice(0, 10)}-${backup.kind}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage("백업 파일을 준비했습니다. 브라우저의 다운로드 목록에서 저장 여부를 확인해 주세요.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "백업 파일을 내려받지 못했습니다.");
    } finally {
      downloadingRef.current = false;
      setDownloadKey("");
    }
  }
  const kindLabel = (backup: BackupSummary) =>
    backup.kind === "daily"
      ? "접속일 자동"
      : backup.kind === "manual"
        ? "직접 저장"
        : backup.reason.startsWith("post-")
          ? "변경 후 자동"
          : "변경 전 자동";
  const dateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "날짜 정보 없음";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };
  return (
    <section className="panel backup-panel">
      <div className="backup-head">
        <div>
          <p className="eyebrow">BACKUP</p>
          <h2>데이터 안전 백업</h2>
          <span>
            사용한 날 첫 접속 시 1회, 정보 변경 전·후에 서버에 암호화해 보관합니다.
            접속하지 않은 날에는 일일 백업이 생성되지 않으며, 90일이 지난 백업은 정리합니다.
          </span>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={createNow}
          disabled={creating}
        >
          <Icon name="backup" size={18} />
          {creating ? "백업 중…" : "지금 백업"}
        </button>
      </div>
      {message && (
        <p className="backup-message" role="status">
          {message}
        </p>
      )}
      {actionError && <p className="backup-action-error" role="alert">{actionError}</p>}
      {loadError && (
        <div className="backup-load-error" role="alert">
          <div><strong>백업 목록을 확인하지 못했습니다.</strong><p>{loadError}</p></div>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={17} /> 다시 불러오기
          </button>
        </div>
      )}
      {backups[0] && (
        <div className="backup-latest">
          <Icon name="backup" size={19} />
          <span>{loadError || loading ? "마지막으로 확인한 백업" : "가장 최근 백업"}<strong>{dateTime(backups[0].createdAt)}</strong></span>
        </div>
      )}
      <p className="backup-download-help">내려받은 파일에는 고객 정보가 포함됩니다. 안전한 곳에 보관해 주세요. CSV 목록 저장과 달리 전체 데이터를 담는 복구용 파일입니다.</p>
      <div className="backup-list" aria-busy={loading}>
        {loading ? (
          <p className="backup-empty" role="status">백업 목록을 불러오는 중입니다.</p>
        ) : backups.length === 0 && !loadError ? (
          <p className="backup-empty">아직 만들어진 백업이 없습니다.</p>
        ) : (
          backups.slice(0, visibleCount).map((backup) => (
            <div className="backup-row" key={backup.key}>
              <div>
                <strong>{kindLabel(backup)}</strong>
                <span>
                  {dateTime(backup.createdAt)} ·{" "}
                  {Math.max(1, Math.round(backup.size / 1024)).toLocaleString(
                    "ko-KR",
                  )}
                  KB
                </span>
              </div>
              <button
                className="tiny-button"
                type="button"
                disabled={Boolean(downloadKey)}
                onClick={() => void download(backup)}
                aria-label={`${dateTime(backup.createdAt)} ${kindLabel(backup)} 백업 내려받기`}
              >
                <Icon name={downloadKey === backup.key ? "refresh" : "download"} size={16} />
                {downloadKey === backup.key ? "준비 중…" : "내려받기"}
              </button>
            </div>
          ))
        )}
      </div>
      {!loading && visibleCount < backups.length && (
        <button
          className="backup-show-more"
          type="button"
          onClick={() => setVisibleCount((count) => count + 24)}
        >
          이전 백업 더 보기{" "}
          <small>{backups.length - visibleCount}개 남음</small>
        </button>
      )}
    </section>
  );
}

function WorkModal({
  modal,
  customers,
  lookups,
  onNewCustomer,
  onClose,
  onSaved,
  onCopy,
  onDelete,
  onBusyChange,
}: {
  modal: WorkModalState;
  customers: Customer[];
  lookups: Lookups;
  onNewCustomer: () => void;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onCopy: (item: WorkDetail) => void;
  onDelete: (id: string, unsavedDraft: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const source = modal.item;
  const item = modal.mode === "edit" ? source : undefined;
  const [workDate, setWorkDate] = useState(item?.work_date || seoulDate());
  const [customerId, setCustomerId] = useState(
    source?.customer_id || modal.initialCustomerId || "",
  );
  const [workType, setWorkType] = useState(
    source?.work_type || modal.initialWorkType || "",
  );
  const [content, setContent] = useState(source?.content || "");
  const [details, setDetails] = useState<PropertyDetail[]>(
    source?.details?.length
      ? source.details.map((detail) => ({
          propertyType: String(detail.property_type || ""),
          buildingName: String(detail.building_name || ""),
          buildingDong: String(detail.building_dong || ""),
          unitNumber: String(detail.unit_number || ""),
          sizeType: String(detail.size_type || ""),
          salePrice: String(detail.sale_price || ""),
          jeonsePrice: String(detail.jeonse_price || ""),
          monthlyRent: String(detail.monthly_rent || ""),
          source: String(detail.source || ""),
        }))
      : modal.initialListing ? [propertyFromListing(modal.initialListing)] : [blankProperty()],
  );
  const [saving, setSaving] = useState(false);
  const savingMountedRef = useRef(true);
  const busyCallbackRef = useRef(onBusyChange);
  useEffect(() => { busyCallbackRef.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => {
    savingMountedRef.current = true;
    return () => { savingMountedRef.current = false; busyCallbackRef.current?.(false); };
  }, []);
  const [error, setError] = useState("");
  const [referenceHistory, setReferenceHistory] = useState<
    { kind: "customer"; id: string } | { kind: "listing"; index: number; key: string } | null
  >(null);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const [listingPickerIndex, setListingPickerIndex] = useState<number | null>(null);
  const [listingLoadedMessage, setListingLoadedMessage] = useState("");
  const listingPickerTrigger = useRef<HTMLButtonElement | null>(null);
  const workFormRef = useRef<HTMLFormElement | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const changesListing = LISTING_WORK_TYPES.has(workType);
  const enteredPropertyCount = details.filter(hasPropertyDraft).length;
  useEffect(() => {
    if (!error) return;
    if (errorField) {
      const field = workFormRef.current?.querySelector<HTMLElement>(`[data-work-field="${errorField}"]`);
      const input = field?.matches("input, select") ? field : field?.querySelector<HTMLElement>("input, select");
      input?.focus();
      input?.scrollIntoView({ block: "center" });
    } else {
      errorSummaryRef.current?.focus();
      errorSummaryRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error, errorField]);
  function closeReferenceHistory() {
    setReferenceHistory(null);
    historyTrigger.current?.focus();
  }
  function closeListingPicker() {
    setListingPickerIndex(null);
    listingPickerTrigger.current?.focus();
  }
  function applyExistingListing(listing: ListingDraftSource) {
    if (listingPickerIndex === null || saving || !details[listingPickerIndex]) return;
    if (
      hasPropertyDraft(details[listingPickerIndex]) &&
      !window.confirm("이 물건에 입력한 내용이 있습니다. 선택한 기존 매물 정보로 바꿀까요? 고객·상담 내용은 유지됩니다.")
    ) return;
    const next = propertyFromListing(listing);
    setDetails((current) => current.map((detail, index) => index === listingPickerIndex ? next : detail));
    setReferenceHistory(null);
    setListingLoadedMessage(`물건 ${listingPickerIndex + 1}에 기존 매물 정보를 불러왔습니다. 주소와 가격을 확인한 뒤 업무를 저장해 주세요.`);
    closeListingPicker();
  }
  const [initialValues] = useState(() =>
    JSON.stringify({ workDate, customerId, workType, content, details }),
  );
  const dirty =
    JSON.stringify({ workDate, customerId, workType, content, details }) !==
    initialValues;
  useEffect(() => {
    if (!modal.initialCustomerId) return;
    const timer = window.setTimeout(
      () => setCustomerId(modal.initialCustomerId!),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [modal.initialCustomerId]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  function requestClose() {
    if (saving) return;
    if (
      dirty &&
      !window.confirm("작성 중인 내용이 있습니다. 저장하지 않고 닫을까요?")
    )
      return;
    onClose();
  }
  function updateDetail(
    index: number,
    key: keyof PropertyDetail,
    value: string,
  ) {
    if (errorField === `property-${index}-${key}`) {
      setErrorField(null);
      setError("");
    }
    if (["propertyType", "buildingName", "buildingDong", "unitNumber"].includes(key)) {
      setReferenceHistory((current) => current?.kind === "listing" && current.index === index ? null : current);
    }
    setDetails((current) =>
      current.map((detail, detailIndex) =>
        detailIndex === index ? { ...detail, [key]: value } : detail,
      ),
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const issue = findWorkDraftIssue({ workDate, customerId, workType, details }, customers, lookups.workTypes);
    if (issue) {
      setErrorField(issue.field);
      setError(issue.message);
      return;
    }
    setSaving(true);
    setError("");
    setErrorField(null);
    onBusyChange?.(true);
    try {
      const url = item ? `/api/work-logs/${item.id}` : "/api/work-logs";
      await jsonFetch(url, {
        method: item ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workDate,
          customerId,
          workType,
          content,
          details,
        }),
      });
      await onSaved(item ? "업무를 수정했습니다." : "업무를 저장했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      if (savingMountedRef.current) onBusyChange?.(false);
    }
  }
  function remove() {
    if (!saving && item) onDelete(item.id, dirty);
  }
  return (
    <Modal
      title={
        item
          ? "업무 수정"
          : modal.mode === "copy"
            ? "기존 기록으로 새 업무"
            : modal.initialListing && modal.initialWorkType === "매물수정" ? "매물 수정 이력 추가" : "새 업무 등록"
      }
      subtitle="한 업무에 물건을 최대 10개까지 함께 기록할 수 있습니다"
      onClose={requestClose}
      locked={saving}
      wide
    >
      <form ref={workFormRef} className="work-form" onSubmit={submit} noValidate>
        <div className="work-form-overview" aria-label="작성 중인 업무 요약">
          <span><strong>고객</strong>{selectedCustomer?.name || "선택 필요"}</span>
          <span><strong>업무</strong>{workType || "선택 필요"}</span>
          <span><strong>물건</strong>{enteredPropertyCount}개 / 최대 10개</span>
        </div>
        {error && <div ref={errorSummaryRef} className="form-error work-form-error" role="alert" tabIndex={-1}><p>{error}</p></div>}
        {modal.mode === "copy" && (
          <p className="editor-context">
            기존 기록은 그대로 유지됩니다. 날짜는 오늘로 설정했으니 내용을
            확인하고 저장해 주세요.
          </p>
        )}
        {modal.initialListing && modal.initialWorkType === "매물수정" && <p className="editor-context">기존 기록을 덮어쓰지 않고 새 매물 수정 업무를 추가합니다. 날짜는 오늘, 고객은 최근 이력 기준이므로 실제 업무에 맞는지 확인해 주세요. 현재 매물 정보는 업무일이 가장 최근인 이력으로 표시됩니다.</p>}
        <div className="work-form-section"><h3>1. 기본 업무</h3><p>* 표시한 항목은 꼭 입력해 주세요.</p></div>
        <div className="form-grid three">
          <label>
            일자 <b>*</b>
            <input
              type="date"
              data-work-field="workDate"
              aria-invalid={errorField === "workDate" || undefined}
              value={workDate}
              disabled={saving}
              onChange={(event) => { setWorkDate(event.target.value); if (errorField === "workDate") { setErrorField(null); setError(""); } }}
              required
            />
          </label>
          <div className="field-with-action" data-work-field="customerId">
            <div className="field-label">
              <span>
                고객 <b>*</b>
              </span>
              <button type="button" onClick={onNewCustomer} disabled={saving}>
                <Icon name="plus" size={16} /> 새 고객
              </button>
            </div>
            <CustomerPicker
              customers={customers}
              value={customerId}
              onChange={(id) => { setCustomerId(id); setReferenceHistory(null); if (errorField === "customerId") { setErrorField(null); setError(""); } }}
              disabled={saving}
            />
            <button
              type="button"
              className="editor-history-button"
              disabled={saving || !selectedCustomer}
              aria-expanded={referenceHistory?.kind === "customer" && referenceHistory.id === customerId}
              aria-controls="editor-customer-history"
              onClick={(event) => {
                setListingPickerIndex(null);
                historyTrigger.current = event.currentTarget;
                setReferenceHistory((current) => current?.kind === "customer" && current.id === customerId ? null : { kind: "customer", id: customerId });
              }}
            >
              <Icon name="clock" size={17} /> 고객 이력 보기
            </button>
          </div>
          <label>
            업무구분 <b>*</b>
            <select
              data-work-field="workType"
              aria-invalid={errorField === "workType" || undefined}
              value={workType}
              disabled={saving}
              onChange={(event) => { setWorkType(event.target.value); setErrorField(null); setError(""); }}
              required
            >
              <option value="">선택</option>
              {lookups.workTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>
        {selectedCustomer && referenceHistory?.kind === "customer" && referenceHistory.id === customerId && (
          <div id="editor-customer-history">
            <Suspense fallback={<p className="form-help" role="status">고객 이력을 준비하고 있습니다…</p>}>
              <RelatedHistory target={{ kind: "customer", id: selectedCustomer.id, name: selectedCustomer.name }} currentWorkId={item?.id} onClose={closeReferenceHistory} />
            </Suspense>
          </div>
        )}
        <label className="full-label">
          내용 <span className="form-help">선택</span>
          <textarea
            value={content}
            disabled={saving}
            onChange={(event) => setContent(event.target.value)}
            rows={Math.min(14, Math.max(6, content.split("\n").length))}
            placeholder="상담 내용, 일정, 특이사항을 입력하세요"
          />
        </label>
        <div className="detail-head">
          <div>
            <h3>2. 관련 물건 {changesListing ? "· 필수" : "· 선택"}</h3>
            <p>{changesListing ? "기존 매물을 불러오거나 물건구분·건물명·호수를 입력하세요. 완전히 빈 추가 칸은 저장하지 않습니다." : "기존 매물을 불러오거나 직접 입력하세요. 물건이 없는 업무는 비워 두어도 됩니다."}</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={saving || details.length >= 10}
            onClick={() =>
              setDetails((current) => [...current, blankProperty()])
            }
          >
            <Icon name="housePlus" size={18} /> 물건 추가
          </button>
        </div>
        {changesListing && <p className="listing-rule-notice"><strong>{workType}</strong> 업무를 저장하면 연결된 매물의 상태와 이력도 다시 계산됩니다. 주소와 가격을 확인해 주세요.</p>}
        <div className="detail-list">
          {listingLoadedMessage && <p className="listing-loaded-message" role="status"><Icon name="check" size={18} />{listingLoadedMessage}</p>}
          {details.map((detail, index) => (
            <fieldset key={index} disabled={saving}>
              <legend>물건 {index + 1}</legend>
              <div className="detail-history-tools">
                <button
                  type="button"
                  className="editor-history-button"
                  aria-expanded={listingPickerIndex === index}
                  aria-controls={`editor-listing-picker-${index}`}
                  onClick={(event) => {
                    listingPickerTrigger.current = event.currentTarget;
                    setListingLoadedMessage("");
                    setReferenceHistory(null);
                    setListingPickerIndex((current) => current === index ? null : index);
                  }}
                >
                  <Icon name="search" size={17} /> 기존 매물 불러오기
                </button>
                <button
                  type="button"
                  className="editor-history-button"
                  disabled={!createPropertyHistoryTarget(detail)}
                  aria-expanded={referenceHistory?.kind === "listing" && referenceHistory.index === index}
                  aria-controls={`editor-listing-history-${index}`}
                  onClick={(event) => {
                    const target = createPropertyHistoryTarget(detail);
                    if (target?.kind !== "listing") return;
                    setListingPickerIndex(null);
                    historyTrigger.current = event.currentTarget;
                    setReferenceHistory((current) => current?.kind === "listing" && current.index === index ? null : { kind: "listing", index, key: target.key });
                  }}
                >
                  <Icon name="clock" size={17} /> 매물 이력 보기
                </button>
                {!createPropertyHistoryTarget(detail) && <span className="form-help">이력 조회는 물건구분·건물명·호수가 필요합니다.</span>}
              </div>
              {listingPickerIndex === index && (
                <div id={`editor-listing-picker-${index}`}>
                  <Suspense fallback={<p className="form-help" role="status">기존 매물 검색을 준비하고 있습니다…</p>}>
                    <ListingPicker onSelect={applyExistingListing} onClose={closeListingPicker} />
                  </Suspense>
                </div>
              )}
              {referenceHistory?.kind === "listing" && referenceHistory.index === index && (() => {
                const target = createPropertyHistoryTarget(detail);
                return target?.kind === "listing" && target.key === referenceHistory.key ? (
                  <div id={`editor-listing-history-${index}`}>
                    <Suspense fallback={<p className="form-help" role="status">매물 이력을 준비하고 있습니다…</p>}>
                      <RelatedHistory target={target} currentWorkId={item?.id} onClose={closeReferenceHistory} />
                    </Suspense>
                  </div>
                ) : null;
              })()}
              <div className="detail-fields">
                <label>
                  물건구분 {changesListing && <b>*</b>}
                  <select
                    data-work-field={`property-${index}-propertyType`}
                    aria-invalid={errorField === `property-${index}-propertyType` || undefined}
                    aria-required={changesListing && (hasPropertyDraft(detail) || !enteredPropertyCount)}
                    value={detail.propertyType}
                    onChange={(event) =>
                      updateDetail(index, "propertyType", event.target.value)
                    }
                  >
                    <option value="">선택</option>
                    {lookups.propertyTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className="building-field">
                  건물명 {changesListing && <b>*</b>}
                  <input
                    data-work-field={`property-${index}-buildingName`}
                    aria-invalid={errorField === `property-${index}-buildingName` || undefined}
                    aria-required={changesListing && (hasPropertyDraft(detail) || !enteredPropertyCount)}
                    list={`buildings-${index}`}
                    value={detail.buildingName}
                    onChange={(event) =>
                      updateDetail(index, "buildingName", event.target.value)
                    }
                  />
                  <datalist id={`buildings-${index}`}>
                    {lookups.buildings
                      .filter(
                        (building) =>
                          !detail.propertyType ||
                          building.property_type === detail.propertyType,
                      )
                      .map((building) => (
                        <option
                          value={building.building_name}
                          key={building.id}
                        />
                      ))}
                  </datalist>
                </label>
                <label>
                  동
                  <input
                    value={detail.buildingDong}
                    placeholder="예: 106"
                    onChange={(event) =>
                      updateDetail(index, "buildingDong", event.target.value)
                    }
                  />
                </label>
                <label>
                  호수 {changesListing && <b>*</b>}
                  <input
                    data-work-field={`property-${index}-unitNumber`}
                    aria-invalid={errorField === `property-${index}-unitNumber` || undefined}
                    aria-required={changesListing && (hasPropertyDraft(detail) || !enteredPropertyCount)}
                    value={detail.unitNumber}
                    placeholder="예: 1503"
                    onChange={(event) =>
                      updateDetail(index, "unitNumber", event.target.value)
                    }
                  />
                </label>
                <label>
                  타입
                  <input
                    value={detail.sizeType}
                    onChange={(event) =>
                      updateDetail(index, "sizeType", event.target.value)
                    }
                    placeholder="33 / 51A"
                  />
                </label>
                <label>
                  매매가
                  <input
                    value={detail.salePrice}
                    onChange={(event) =>
                      updateDetail(index, "salePrice", event.target.value)
                    }
                  />
                </label>
                <label>
                  전세가
                  <input
                    value={detail.jeonsePrice}
                    onChange={(event) =>
                      updateDetail(index, "jeonsePrice", event.target.value)
                    }
                  />
                </label>
                <label>
                  월세가
                  <input
                    value={detail.monthlyRent}
                    onChange={(event) =>
                      updateDetail(index, "monthlyRent", event.target.value)
                    }
                  />
                </label>
                <label className="source-field">
                  물건지·업소
                  <input
                    value={detail.source}
                    onChange={(event) =>
                      updateDetail(index, "source", event.target.value)
                    }
                  />
                </label>
              </div>
              {details.length > 1 && (
                <button
                  type="button"
                  className="remove-detail"
                  onClick={() => {
                    if (hasPropertyDraft(detail) && !window.confirm(`물건 ${index + 1}에 입력한 내용을 빼시겠습니까? 다른 물건과 상담 내용은 유지됩니다.`)) return;
                    setReferenceHistory(null);
                    setListingPickerIndex(null);
                    setListingLoadedMessage("");
                    setError("");
                    setErrorField(null);
                    setDetails((current) =>
                      current.filter((_, detailIndex) => detailIndex !== index),
                    );
                  }}
                >
                  이 물건 빼기
                </button>
              )}
            </fieldset>
          ))}
        </div>
        {item && <div className="work-record-actions">
          {item && (
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "저장하지 않은 수정 내용은 복사에 포함되지 않습니다. 기존 기록으로 새 업무를 만들까요?",
                  )
                )
                  return;
                onCopy(item);
              }}
            >
              <Icon name="copy" size={18} /> 이 기록으로 새 업무
            </button>
          )}
          {item && (
            <button
              type="button"
              className="danger-button"
              onClick={remove}
              disabled={saving}
            >
              <Icon name="delete" size={18} /> 업무 삭제
            </button>
          )}
        </div>}
        <div className="modal-actions">
          <span className="work-save-state">{saving ? "저장하고 있습니다…" : dirty ? "아직 저장하지 않은 내용이 있습니다." : item ? "저장된 업무를 확인하고 있습니다." : "입력한 내용은 저장 버튼을 눌러야 반영됩니다."}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={requestClose}
            disabled={saving}
          >
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? "저장 중…" : item ? "수정 저장" : "업무 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CustomerModal({
  modal,
  onClose,
  onSaved,
  onDelete,
  onBusyChange,
}: {
  modal: { mode: "new" | "edit"; item?: Customer };
  onClose: () => void;
  onSaved: (message: string, customerId?: string, savedCustomer?: Customer) => Promise<void>;
  onDelete: (id: string, unsavedDraft: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [id, setId] = useState(modal.item?.id || "");
  const [name, setName] = useState(modal.item?.name || "");
  const [notes, setNotes] = useState(modal.item?.notes || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingMountedRef = useRef(true);
  const busyCallbackRef = useRef(onBusyChange);
  useEffect(() => { busyCallbackRef.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => {
    savingMountedRef.current = true;
    return () => { savingMountedRef.current = false; busyCallbackRef.current?.(false); };
  }, []);
  const [initialDraft] = useState(() => ({ id, name, notes }));
  const currentDraft = { id, name, notes };
  const dirty = customerDraftChanged(initialDraft, currentDraft);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  function requestClose() {
    if (
      !canCloseCustomerDraft(initialDraft, currentDraft, saving, () =>
        window.confirm("작성 중인 고객 정보가 있습니다. 저장하지 않고 닫을까요?"),
      )
    )
      return;
    onClose();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      onBusyChange?.(true);
      const response = await jsonFetch<{ customer?: Pick<Customer, "id" | "name" | "notes"> }>(
        modal.item
          ? `/api/customers/${encodeURIComponent(modal.item.id)}`
          : "/api/customers",
        {
          method: modal.item ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name, notes }),
        },
      );
      await onSaved(
        modal.item ? "고객 정보를 수정했습니다." : "고객을 등록했습니다.",
        modal.item ? undefined : response.customer?.id ?? id.trim(),
        !modal.item && response.customer ? {
          ...response.customer,
          created_at: "",
          updated_at: "",
          history_count: 0,
          is_demo: 0,
        } : undefined,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      if (savingMountedRef.current) onBusyChange?.(false);
    }
  }
  function remove() {
    if (!saving && modal.item) onDelete(modal.item.id, dirty);
  }
  return (
    <Modal
      title={modal.item ? "고객 정보 수정" : "새 고객 등록"}
      subtitle="고객 정보와 상담 메모를 간단하게 관리합니다"
      onClose={requestClose}
      locked={saving}
    >
      <form className="customer-form" onSubmit={submit}>
        <label>
          고객 ID <b>*</b>
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            disabled={Boolean(modal.item) || saving}
            placeholder="전화번호 또는 구분할 수 있는 ID"
            required
          />
        </label>
        <label>
          고객명 <b>*</b>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
            required
          />
        </label>
        <label>
          비고
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={saving}
            rows={5}
            placeholder="찾는 물건, 입주일, 상담 메모"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          {modal.item && (
            <button
              type="button"
              className="danger-button"
              onClick={remove}
              disabled={saving}
            >
              <Icon name="delete" size={18} /> 고객 삭제
            </button>
          )}
          <span />
          <button
            type="button"
            className="secondary-button"
            onClick={requestClose}
            disabled={saving}
          >
            취소
          </button>
          <button className="primary-button" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function HistoryModal({
  data,
  onClose,
  onRefresh,
  onOpenWork,
  onNewWork,
  onNewListingWork,
  onModifyListing,
  onFollowUp,
  onCopy,
}: {
  data: HistoryData;
  onClose: () => void;
  onRefresh: () => void;
  onOpenWork: (id: string) => void;
  onNewWork: (id: string) => void;
  onNewListingWork?: (listing: Listing) => void;
  onModifyListing?: (listing: Listing, customerId?: string) => void;
  onFollowUp: (draft: FollowUpDraft) => void;
  onCopy: (id: string) => void;
}) {
  const RecordContainer = data.listing ? "details" : "div";
  return (
    <Modal title={data.title} subtitle={data.subtitle} onClose={onClose} reading>
      {data.loading && <p className="form-help" role="status">이력을 불러오고 있습니다…</p>}
      {data.error && <div className="form-error" role="alert"><p>{data.error}</p>{(data.customer || data.listing || data.listingKey || data.date || data.scheduleDays) && <button type="button" className="secondary-button" onClick={onRefresh}><Icon name="refresh" size={16} /> 다시 불러오기</button>}</div>}
      {data.customer && (
        <div className="history-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onNewWork(data.customer!.id)}
          >
            <Icon name="plus" size={18} /> 이 고객 업무 등록
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onCopy(data.customer!.id)}
          >
            <Icon name="copy" size={18} /> 연락처·ID 복사
          </button>
        </div>
      )}
      {data.listing && (
        <>
        <div className="listing-history-context">
          <p className="listing-history-summary">
            현재 매물 · <strong>{data.listing.status}</strong> ·{" "}
            {[
              data.listing.sale_price && `매매 ${data.listing.sale_price}`,
              data.listing.jeonse_price && `전세 ${data.listing.jeonse_price}`,
              data.listing.monthly_rent && `월세 ${data.listing.monthly_rent}`,
            ]
              .filter(Boolean)
              .join(" / ") || "가격 미기재"}
          </p>
          <ListingHistorySummary
            events={data.items.filter((item): item is ListingEvent => "event_date" in item)}
            sourceNotes={data.listing.source_notes}
          />
        </div>
        <div className="listing-history-actions">
          {onModifyListing && !data.listing.closed_at && (
            <button type="button" className="primary-button" disabled={Boolean(data.loading || data.error)}
              onClick={() => onModifyListing(data.listing!, data.items.find((item) => "event_date" in item && item.customer_id)?.customer_id)}>
              <Icon name="edit" size={18} /> 매물 수정 이력 추가
            </button>
          )}
          {onNewListingWork && (
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(data.loading || data.error)}
              onClick={() => onNewListingWork(data.listing!)}
            >
              <Icon name="plus" size={18} /> 이 매물로 업무 등록
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onFollowUp({
                title: `${targetText(data.listing!)} 매물 확인`,
                listingKey: data.listing!.identity_key,
                listingLabel: targetText(data.listing!),
              })
            }
          >
            <Icon name="tasks" size={18} /> 이 매물 확인할 일 추가
          </button>
        </div>
        </>
      )}
      {(!data.listing || data.items.length > 0) && <RecordContainer className={data.listing ? "listing-work-details" : undefined}>
      {data.listing && <summary><Icon name="next" size={16} /> 개별 업무 보기 <span>{data.items.length.toLocaleString("ko-KR")}건</span></summary>}
      {data.items.length > 0 && <p className="history-list-guide">{data.items.length.toLocaleString("ko-KR")}건의 기록 · 기록을 누르면 업무 내용을 먼저 읽을 수 있습니다.</p>}
      <div className="history-list" aria-busy={Boolean(data.loading)}>
        {!data.items.length ? (
          !data.loading && !data.error ? <EmptyState title={data.emptyMessage || "기록이 없습니다."} /> : null
        ) : (
          data.items.map((raw) => {
            const isEvent = "event_date" in raw;
            const date = isEvent ? raw.event_date : raw.work_date;
            const status = isEvent ? raw.status : raw.work_type;
            const content = isEvent ? raw.notes : raw.content;
            const savedLabel = isEvent
              ? formatHistoryTimestamp(raw.work_updated_at) || formatHistoryTimestamp(raw.created_at)
              : formatHistoryTimestamp(raw.updated_at);
            const id = isEvent ? raw.work_log_id : raw.id;
            const property = !isEvent && getWorkProperties(raw).length > 0;
            return (
              <button
                type="button"
                key={raw.id}
                onClick={() => id && onOpenWork(id)}
                disabled={!id}
              >
                <div className="history-entry-meta">
                  <span className={`history-mark ${statusTone(status)}`} />
                  <time dateTime={date}>업무일 {displayDate(date)}</time>
                  <strong>{status}</strong>
                  {isEvent && <small>{raw.customer_name}</small>}
                  <span className="history-entry-open">{id ? <>내용 보기 <Icon name="next" size={15} /></> : "원본 이력"}</span>
                </div>
                {savedLabel && <p className="history-entry-saved">최근 저장 · <time>{savedLabel}</time></p>}
                {!isEvent && (raw.customer_name || property) && (
                  <div className="history-entry-context">
                    {raw.customer_name && <span><Icon name="customers" size={16} /><span>고객 · {raw.customer_name}</span></span>}
                    {property && <WorkSummaryProperties work={raw} showSingle />}
                  </div>
                )}
                <p className="history-entry-content">{content || "기록된 내용 없음"}</p>
              </button>
            );
          })
        )}
      </div>
      </RecordContainer>}
    </Modal>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  wide,
  reading,
  locked = false,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  reading?: boolean;
  locked?: boolean;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [modalId] = useState(() => ++nextModalId);
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    if (openModalIds.length === 0)
      modalBodyOverflow = document.body.style.overflow;
    openModalIds.push(modalId);
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const preferred = cardRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      );
      (preferred || cardRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (openModalIds.at(-1) !== modalId) return;
      if (event.key === "Escape") {
        if (!lockedRef.current) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusable = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      const index = openModalIds.lastIndexOf(modalId);
      if (index >= 0) openModalIds.splice(index, 1);
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (openModalIds.length === 0)
        document.body.style.overflow = modalBodyOverflow;
      previousFocus?.focus();
    };
  }, [modalId]);
  return (
    <div
      className={`modal-backdrop ${locked ? "locked" : ""}`}
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !locked && onClose()
      }
    >
      <section
        ref={cardRef}
        className={`modal-card ${wide ? "wide" : ""} ${reading ? "reading" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={locked}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            disabled={locked}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function ReaderReferencePanel({ target, onClose }: { target: RelatedHistoryTarget; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start" });
    panel.current?.focus({ preventScroll: true });
  }, [target]);
  return <div ref={panel} tabIndex={-1} aria-label="선택한 관련 이력"><Suspense fallback={<p role="status">관련 이력을 준비하고 있습니다…</p>}><RelatedHistory target={target} onClose={onClose} /></Suspense></div>;
}
function EmptyState({ title }: { title: string }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">
        <Icon name="empty" />
      </span>
      <p>{title}</p>
    </div>
  );
}
