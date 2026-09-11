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
import { CustomerPicker } from "./customer-picker";
import { canCloseCustomerDraft, customerDraftChanged } from "./customer-draft";
import { Icon, workTypeIcon } from "./icons";
import { canAppendPage } from "./client-paging";
import { createPropertyHistoryTarget } from "./history-query";
import { fetchWorkWindow } from "./work-window";
import {
  clientJsonFetch as jsonFetch,
  clearClientReadCache,
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
  | "settings";
type WorkSummary = {
  id: string;
  work_date: string;
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
  property_count: number;
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
type WorkModalState = {
  mode: "new" | "edit" | "copy";
  item?: WorkDetail;
  initialCustomerId?: string;
  initialWorkType?: string;
};
type FollowUpDraft = {
  title?: string;
  customerId?: string;
  listingKey?: string;
};
type HistoryData = {
  title: string;
  subtitle: string;
  items: WorkSummary[] | ListingEvent[];
  customer?: Pick<Customer, "id" | "name">;
  listing?: Listing;
  listingKey?: string;
  date?: string;
  loading?: boolean;
  error?: string;
};
type WorkHistoryActions = {
  onCustomerHistory: (customer: Pick<Customer, "id" | "name">) => void;
  onListingHistory: (work: WorkSummary) => void;
};

const navItems: Array<[View, string]> = [
  ["today", "홈"],
  ["tasks", "다시 연락할 일"],
  ["insights", "업무 현황"],
  ["journal", "업무일지"],
  ["listings", "매물 관리"],
  ["customers", "고객 관리"],
  ["calendar", "업무 달력"],
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
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [lookups, setLookups] = useState<Lookups>({
    workTypes: [],
    propertyTypes: [],
    buildings: [],
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkSummary[]>([]);
  const [workTotal, setWorkTotal] = useState(0);
  const [calendarLogs, setCalendarLogs] = useState<WorkSummary[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [workFirstPageLoading, setWorkFirstPageLoading] = useState(false);
  const [loadedWorkQuery, setLoadedWorkQuery] = useState<string | null>(null);
  const loadedWorkQueryRef = useRef<string | null>(null);
  const workFirstRequest = useRef<number | null>(null);
  const workMorePending = useRef(false);
  const [notice, setNotice] = useState("");
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
  const showGlobalSearch = useCallback(() => {
    setGlobalSearchLoaded(true);
    setGlobalSearchOpen(true);
  }, []);
  const showLoadError = useCallback((error: unknown) => {
    if (!isAborted(error)) setNotice((error as Error).message);
  }, []);

  const loadReferenceData = useCallback(async () => {
    const version = ++requestVersion.current.references;
    const [lookupData, customerData] = await Promise.all([
      jsonFetch<Lookups>("/api/lookups"),
      jsonFetch<{ customers: Customer[] }>("/api/customers?sort=recent"),
    ]);
    if (version !== requestVersion.current.references) return;
    setLookups(lookupData);
    setCustomers(customerData.customers);
  }, []);
  const refreshDashboard = useCallback(async () => {
    const version = ++requestVersion.current.dashboard;
    try {
      const dash = await jsonFetch<Dashboard>("/api/bootstrap");
      if (version === requestVersion.current.dashboard) setDashboard(dash);
    } finally {
      if (version === requestVersion.current.dashboard) setLoading(false);
    }
  }, []);
  const refreshBase = useCallback(async () => {
    await Promise.all([refreshDashboard(), loadReferenceData()]);
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
    if (
      view === "tasks" &&
      followUpDirty.current &&
      !window.confirm("작성 중인 할 일을 버리고 새 할 일을 작성할까요?")
    )
      return;
    if (!navigate("tasks")) return;
    setFollowUpDraft(draft);
    historyOpenVersion.current += 1;
    setHistoryModal(null);
  }
  const loadWorkLogs = useCallback(
    async (signal?: AbortSignal, visibleCount = 100) => {
      const version = ++requestVersion.current.work;
      workFirstRequest.current = version;
      setWorkFirstPageLoading(true);
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
      const params = new URLSearchParams({ month: calendarMonth });
      if (calendarWorkType) params.set("workType", calendarWorkType);
      const rows = await fetchAllWorkLogs(params, signal);
      if (version === requestVersion.current.calendar)
        setCalendarLogs(
          rows.filter((item) => item.work_date.startsWith(calendarMonth)),
        );
    },
    [calendarMonth, calendarWorkType],
  );
  const loadListings = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current.listings;
      const params = new URLSearchParams({
        state: listingState,
        sort: listingSort,
      });
      if (listingsSearch) params.set("q", listingsSearch);
      if (propertyTypeFilter) params.set("type", propertyTypeFilter);
      const data = await jsonFetch<{ listings: Listing[] }>(
        `/api/listings?${params}`,
        { signal },
      );
      if (version === requestVersion.current.listings)
        setListings(data.listings);
    },
    [listingState, propertyTypeFilter, listingSort, listingsSearch],
  );
  const loadCustomers = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current.customers;
      const params = new URLSearchParams({ sort: customerSort });
      if (customersSearch) params.set("q", customersSearch);
      const data = await jsonFetch<{ customers: Customer[] }>(
        `/api/customers?${params}`,
        { signal },
      );
      if (version === requestVersion.current.customers)
        setCustomerResults(data.customers);
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
        Date.now() - lastFocusRefresh.current < 1000
      )
        return;
      lastFocusRefresh.current = Date.now();
      clearClientReadCache();
      setInsightsRefreshKey((value) => value + 1);
      setFollowUpRefreshKey((value) => value + 1);
      const active = currentView.current;
      void Promise.all([
        refreshBase(),
        active === "journal" ? loadWorkLogs(undefined, workLogs.length) : undefined,
        active === "calendar" ? loadCalendar() : undefined,
        active === "listings" ? loadListings() : undefined,
        active === "customers" ? loadCustomers() : undefined,
      ]).catch(showLoadError);
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
      const next = navItems.some(([viewKey]) => viewKey === key)
        ? key
        : "today";
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
      if (next !== currentView.current) workOpenVersion.current += 1;
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
  ) {
    const version = ++workOpenVersion.current;
    try {
      // Home can render before reference data; never open a form with an empty name picker.
      const [, data] = await Promise.all([
        loadReferenceData(),
        id
          ? jsonFetch<{ workLog: WorkDetail }>(`/api/work-logs/${id}`)
          : undefined,
      ]);
      if (version !== workOpenVersion.current) return;
      setWorkModal(
        data
          ? { mode: "edit", item: data.workLog }
          : { mode: "new", initialCustomerId, initialWorkType },
      );
    } catch (error) {
      if (version === workOpenVersion.current) showLoadError(error);
    }
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
  async function loadMoreWorkLogs() {
    if (
      !canAppendPage(
        loadedWorkQueryRef.current,
        workQueryKey,
        workFirstRequest.current !== null,
        workMorePending.current,
      ) ||
      workLogs.length >= workTotal ||
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
    try {
      setNotice("전체 업무 기록을 준비하고 있습니다.");
      const params = new URLSearchParams();
      if (queries.journal) params.set("q", queries.journal);
      if (workTypeFilter) params.set("workType", workTypeFilter);
      const [from, to] = periodBounds(workPeriod);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const items = await fetchAllWorkLogs(params);
      downloadCsv(
        `업무일지-${seoulDate()}.csv`,
        ["일자", "업무구분", "고객명", "고객ID", "물건", "내용"],
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
        `${items.length.toLocaleString("ko-KR")}건을 빠짐없이 저장했습니다.`,
      );
    } catch (error) {
      setNotice((error as Error).message);
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
        error: missing
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
    if (!history.date) return;
    const version = ++historyOpenVersion.current;
    setHistoryModal({ ...history, loading: true, error: undefined });
    try {
      const items = await fetchAllWorkLogs(new URLSearchParams({ from: history.date, to: history.date }));
      if (version === historyOpenVersion.current) setHistoryModal({ ...history, items, subtitle: `${items.length}건`, loading: false, error: undefined });
    } catch (error) {
      if (version === historyOpenVersion.current) setHistoryModal({ ...history, loading: false, error: (error as Error).message });
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
    tasks: ["다시 연락할 일", "고객 연락과 매물 확인을 놓치지 않도록"],
    insights: ["업무 현황", "쌓인 기록에서 지금 확인할 흐름을 정리합니다"],
    journal: ["업무일지", "모든 업무 기록을 검색하고 관리합니다"],
    listings: ["매물 관리", "업무 기록에서 자동으로 갱신된 현재 상태입니다"],
    customers: ["고객 관리", "고객 정보와 상담 이력을 함께 관리합니다"],
    calendar: ["업무 달력", "월별 일정과 업무를 한눈에 확인합니다"],
    settings: ["설정", "분류, 백업, 관리자 계정을 관리합니다"],
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
              {view === "today" && dashboard && (
                <DashboardView
                  dashboard={dashboard}
                  onOpen={openWork}
                  onCustomerHistory={showCustomerHistory}
                  onListingHistory={showWorkListingHistory}
                  onNavigate={(next) => {
                    if (next === "calendar") {
                      setCalendarMonth(seoulDate().slice(0, 7));
                      setCalendarWorkType("");
                    }
                    navigate(next);
                  }}
                  onQuickWork={(workType) =>
                    void openWork(undefined, undefined, workType)
                  }
                  followUps={
                    <FollowUpsView
                      compact
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
                    />
                  }
                />
              )}
              {view === "tasks" && (
                <FollowUpsView
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
                    onReviewStale={() => {
                      setQueries((current) => ({ ...current, listings: "" }));
                      setListingState("stale");
                      setListingSort("oldest");
                      setPropertyTypeFilter("");
                      navigate("listings");
                    }}
                    onOpenWork={(id) => {
                      void openWork(id);
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
                  canLoadMore={
                    canAppendPage(
                      loadedWorkQuery,
                      workQueryKey,
                      workFirstPageLoading,
                      loadingMore,
                    ) && queries.journal === journalSearch
                  }
                  onExport={exportWorkLogs}
                  onOpen={openWork}
                  onCustomerHistory={showCustomerHistory}
                  onListingHistory={showWorkListingHistory}
                />
              )}
              {view === "listings" && (
                <ListingsView
                  items={listings}
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
                  month={calendarMonth}
                  setMonth={setCalendarMonth}
                  workType={calendarWorkType}
                  setWorkType={setCalendarWorkType}
                  items={calendarLogs}
                  lookups={lookups}
                  onOpen={openWork}
                  onShowDay={(date, items) => {
                    historyOpenVersion.current += 1;
                    setHistoryModal({
                      title: `${displayDate(date)} 업무`,
                      subtitle: `${items.length}건`,
                      items,
                      date,
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
              void openWork(id);
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
      {historyModal && (
        <HistoryModal
          data={historyModal}
          onClose={() => { historyOpenVersion.current += 1; workOpenVersion.current += 1; setHistoryModal(null); }}
          onRefresh={() => void refreshHistory(historyModal)}
          onOpenWork={(id) => {
            void openWork(id);
          }}
          onNewWork={(id) => void openWork(undefined, id)}
          onFollowUp={addFollowUp}
          onCopy={copyCustomerId}
        />
      )}
      {workModal && (
        <WorkModal
          key={`${workModal.mode}-${workModal.item?.id || "new"}`}
          modal={workModal}
          customers={customers}
          lookups={lookups}
          onNewCustomer={() => setCustomerModal({ mode: "new" })}
          onClose={() => { workOpenVersion.current += 1; setWorkModal(null); }}
          onCopy={(item) => { workOpenVersion.current += 1; setWorkModal({ mode: "copy", item }); }}
          onSaved={async (message) => {
            workOpenVersion.current += 1;
            setWorkModal(null);
            await Promise.all([afterMutation(message), refreshHistory(historyModal)]);
          }}
        />
      )}
      {customerModal && (
        <CustomerModal
          modal={customerModal}
          onClose={() => setCustomerModal(null)}
          onSaved={async (message, customerId) => {
            setCustomerModal(null);
            await afterMutation(message);
            if (customerId)
              setWorkModal((current) =>
                current
                  ? { ...current, initialCustomerId: customerId }
                  : current,
              );
          }}
        />
      )}
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
  onQuickWork,
  followUps,
}: {
  dashboard: Dashboard;
  onOpen: (id?: string) => void;
  onNavigate: (view: View) => void;
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
          <h2>오늘 확인할 일부터 시작하세요.</h2>
          <p>연락할 일과 일정을 확인하고, 새 업무를 바로 기록하세요.</p>
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
          <button className="attention" onClick={() => onNavigate("calendar")}>
            7일 일정 확인 <Icon name="next" size={16} />
          </button>
        </article>
      </div>
      <div className="home-body-grid">
        {followUps}
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
              onClick={() => onNavigate("calendar")}
            >
              일정 보기
            </button>
          </div>
          <WorkRows
            items={dashboard.upcoming ?? []}
            onOpen={onOpen}
            showDate
            empty="앞으로 7일간 등록된 일정이 없습니다."
          />
        </section>
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
              {targetText(item) === "물건 없음"
                ? item.customer_name
                : targetText(item)}
            </strong>
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
  canLoadMore: boolean;
  onExport: () => void | Promise<void>;
  onOpen: (id?: string) => void;
} & WorkHistoryActions) {
  const filtered = Boolean(query || workType || period);
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
          disabled={!total}
          type="button"
        >
          <Icon name="download" size={18} /> CSV 저장
        </button>
      </Toolbar>
      {filtered && (
        <div className="active-filter-row">
          <strong>적용 중</strong>
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
      <section className="panel data-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">WORK RECORDS</p>
            <h2>
              업무 기록{" "}
              <span className="count-badge">
                {items.length} / {total}
              </span>
            </h2>
            <p className="sort-summary">
              <Icon name="sort" size={16} />
              업무일 최신순 · 같은 날은 최근 수정순
            </p>
          </div>
          <span className="helper-text">
            고객·물건을 누르면 이력, 일자·내용을 누르면 업무 수정
          </span>
        </div>
        <WorkTable items={items} onOpen={onOpen} onCustomerHistory={onCustomerHistory} onListingHistory={onListingHistory} />
        {items.length < total && (
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
    <div className="responsive-table work-table">
      <div className="table-head">
        <span>일자</span>
        <span>업무구분</span>
        <span>고객</span>
        <span>물건</span>
        <span>내용</span>
      </div>
      {items.map((item) => (
        <div
          className="table-row work-record-row"
          key={item.id}
        >
          <span data-label="일자"><button type="button" className="work-cell-button" onClick={() => onOpen(item.id)} aria-label={`${displayDate(item.work_date)} ${item.customer_name} 업무 수정`}>{displayDate(item.work_date)}<small><Icon name="edit" size={13} /> 업무 수정</small></button></span>
          <span data-label="업무구분">
            <i className={`tag ${statusTone(item.work_type)}`}>
              {item.work_type}
            </i>
          </span>
          <span data-label="고객">
            <button type="button" className="work-cell-button history-link" onClick={() => onCustomerHistory({ id: item.customer_id, name: item.customer_name })} aria-label={`${item.customer_name} 고객 이력 보기`}>
              <b>{item.customer_name}</b>
              <small className="work-customer-id">{item.customer_id}</small>
              <small><Icon name="clock" size={13} /> 고객 이력</small>
            </button>
          </span>
          <span data-label="물건">
            {item.property_type?.trim() && item.building_name?.trim() && item.unit_number?.trim() ? (
              <button type="button" className="work-cell-button history-link" onClick={() => onListingHistory(item)} aria-label={`${targetText(item)} 매물 이력 보기`}>
                {targetText(item)}<small><Icon name="clock" size={13} /> 매물 이력</small>
              </button>
            ) : targetText(item)}
            {Number(item.property_count) > 1 && (
              <button type="button" className="work-extra-properties" onClick={() => onOpen(item.id)}>외 {Number(item.property_count) - 1}건 보기</button>
            )}
          </span>
          <span data-label="내용"><button type="button" className="work-cell-button" onClick={() => onOpen(item.id)} aria-label={`${item.customer_name} 업무 내용 확인 및 수정`}>{item.content || "내용 확인·수정"}</button></span>
        </div>
      ))}
    </div>
  );
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
}) {
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
          disabled={!items.length}
          type="button"
        >
          <Icon name="download" size={18} /> CSV 저장
        </button>
      </Toolbar>
      <section className="panel data-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">CURRENT LISTINGS</p>
            <h2>
              매물 목록 <span className="count-badge">{items.length}</span>
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
              : "검색·필터는 입력 즉시 반영되고, 행을 누르면 변경 이력이 열립니다"}
          </span>
        </div>
        {!items.length ? (
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
        )}
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
}) {
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
          disabled={!items.length}
          type="button"
        >
          <Icon name="download" size={18} /> CSV 저장
        </button>
        <button className="secondary-button" onClick={onNew} type="button">
          <Icon name="plus" size={18} /> 고객 등록
        </button>
      </Toolbar>
      <section className="panel data-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">CUSTOMERS</p>
            <h2>
              고객 목록 <span className="count-badge">{items.length}</span>
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
        {!items.length ? (
          <EmptyState title="조건에 맞는 고객이 없습니다." />
        ) : (
          <div className="responsive-table customer-table">
            <div className="table-head">
              <span>고객명</span>
              <span>고객 ID</span>
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
                <span data-label="비고">{item.notes || "-"}</span>
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
        )}
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
}: {
  month: string;
  setMonth: (v: string) => void;
  workType: string;
  setWorkType: (v: string) => void;
  items: WorkSummary[];
  lookups: Lookups;
  onOpen: (id?: string) => void;
  onShowDay: (date: string, items: WorkSummary[]) => void;
}) {
  const cells = useMemo(() => {
    const [year, mon] = month.split("-").map(Number);
    const first = new Date(year, mon - 1, 1);
    const count = new Date(year, mon, 0).getDate();
    return [
      ...Array(first.getDay()).fill(null),
      ...Array.from({ length: count }, (_, index) => index + 1),
    ];
  }, [month]);
  const grouped = useMemo(
    () =>
      items.reduce<Record<number, WorkSummary[]>>((acc, item) => {
        const day = Number(item.work_date.slice(8, 10));
        (acc[day] ||= []).push(item);
        return acc;
      }, {}),
    [items],
  );
  return (
    <>
      <div className="calendar-controls">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <Icon name="back" size={18} />
        </button>
        <input
          aria-label="달력 월"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
        <button
          type="button"
          aria-label="다음 달"
          onClick={() => setMonth(shiftMonth(month, 1))}
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
      </div>
      <section className="panel calendar-panel">
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
              className={`calendar-cell ${day === Number(seoulDate().slice(8, 10)) && month === seoulDate().slice(0, 7) ? "today-cell" : ""}`}
              key={`${day}-${index}`}
            >
              {day && (
                <>
                  <b>{day}</b>
                  <div>
                    {(grouped[day] || []).slice(0, 4).map((item) => (
                      <button
                        className={statusTone(item.work_type)}
                        onClick={() => onOpen(item.id)}
                        key={item.id}
                      >
                        <span>{item.work_type}</span>
                        <small>
                          {targetText(item) === "물건 없음"
                            ? item.customer_name
                            : targetText(item)}
                        </small>
                      </button>
                    ))}
                    {(grouped[day]?.length || 0) > 4 && (
                      <button
                        className="calendar-more"
                        type="button"
                        onClick={() =>
                          onShowDay(
                            `${month}-${String(day).padStart(2, "0")}`,
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
    </>
  );
}
function shiftMonth(month: string, amount: number) {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(year, mon - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await jsonFetch("/api/lookups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, propertyType, name }),
      });
      setName("");
      await onSaved();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
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
                {type}
                <small>
                  {
                    lookups.buildings.filter(
                      (item) => item.property_type === type,
                    ).length
                  }
                  개
                </small>
              </summary>
              <p>
                {lookups.buildings
                  .filter((item) => item.property_type === type)
                  .map((item) => item.building_name)
                  .join(" · ")}
              </p>
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
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={saving}>
          {saving ? "추가 중…" : "추가"}
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
  const [visibleCount, setVisibleCount] = useState(12);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await jsonFetch<{ backups: BackupSummary[] }>(
        "/api/backups",
      );
      setBackups(data.backups);
      setMessage("");
    } catch (loadError) {
      setMessage((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function createNow() {
    setCreating(true);
    setMessage("");
    try {
      await jsonFetch("/api/backups", { method: "POST" });
      await load();
      setMessage("새 백업을 안전하게 만들었습니다.");
    } catch (backupError) {
      setMessage((backupError as Error).message);
    } finally {
      setCreating(false);
    }
  }
  const kindLabel = (backup: BackupSummary) =>
    backup.kind === "daily"
      ? "매일 자동"
      : backup.kind === "manual"
        ? "직접 저장"
        : backup.reason.startsWith("post-")
          ? "변경 후 자동"
          : "변경 전 자동";
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  return (
    <section className="panel backup-panel">
      <div className="backup-head">
        <div>
          <p className="eyebrow">BACKUP</p>
          <h2>데이터 안전 백업</h2>
          <span>
            하루 1회, 정보 변경 전·후에 암호화해서 보관하며, 90일이 지난 백업은
            정리합니다.
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
      <div className="backup-list">
        {loading ? (
          <p className="backup-empty">백업 목록을 불러오는 중입니다.</p>
        ) : backups.length === 0 ? (
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
              <a
                className="tiny-button"
                href={`/api/backups/download?key=${encodeURIComponent(backup.key)}`}
              >
                <Icon name="download" size={16} /> 내려받기
              </a>
            </div>
          ))
        )}
      </div>
      {visibleCount < backups.length && (
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
}: {
  modal: WorkModalState;
  customers: Customer[];
  lookups: Lookups;
  onNewCustomer: () => void;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onCopy: (item: WorkDetail) => void;
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
      : [blankProperty()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [referenceHistory, setReferenceHistory] = useState<
    { kind: "customer"; id: string } | { kind: "listing"; index: number; key: string } | null
  >(null);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  function closeReferenceHistory() {
    setReferenceHistory(null);
    historyTrigger.current?.focus();
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
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
    if (!customers.some((customer) => customer.id === customerId)) {
      setError(
        "검색 결과에서 고객을 선택해 주세요. 없는 고객은 ‘새 고객’으로 먼저 등록할 수 있습니다.",
      );
      return;
    }
    setSaving(true);
    setError("");
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
    }
  }
  async function remove() {
    if (
      saving ||
      !item ||
      !window.confirm(
        "이 업무를 삭제하시겠습니까? 연결된 매물 상태도 다시 계산됩니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await jsonFetch(`/api/work-logs/${item.id}`, { method: "DELETE" });
      await onSaved("업무를 삭제했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={
        item
          ? "업무 수정"
          : modal.mode === "copy"
            ? "기존 기록으로 새 업무"
            : "새 업무 등록"
      }
      subtitle="한 업무에 물건을 최대 10개까지 함께 기록할 수 있습니다"
      onClose={requestClose}
      locked={saving}
      wide
    >
      <form className="work-form" onSubmit={submit}>
        {modal.mode === "copy" && (
          <p className="editor-context">
            기존 기록은 그대로 유지됩니다. 날짜는 오늘로 설정했으니 내용을
            확인하고 저장해 주세요.
          </p>
        )}
        <div className="form-grid three">
          <label>
            일자 <b>*</b>
            <input
              type="date"
              value={workDate}
              disabled={saving}
              onChange={(event) => setWorkDate(event.target.value)}
              required
            />
          </label>
          <div className="field-with-action">
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
              onChange={(id) => { setCustomerId(id); setReferenceHistory(null); }}
              disabled={saving}
            />
            <button
              type="button"
              className="editor-history-button"
              disabled={saving || !selectedCustomer}
              aria-expanded={referenceHistory?.kind === "customer" && referenceHistory.id === customerId}
              aria-controls="editor-customer-history"
              onClick={(event) => {
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
              value={workType}
              disabled={saving}
              onChange={(event) => setWorkType(event.target.value)}
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
          내용
          <textarea
            value={content}
            disabled={saving}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            placeholder="상담 내용, 일정, 특이사항을 입력하세요"
          />
        </label>
        <div className="detail-head">
          <div>
            <h3>물건 세부항목</h3>
            <p>물건이 없는 전화·기타 업무는 비워 두어도 됩니다.</p>
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
        <div className="detail-list">
          {details.map((detail, index) => (
            <fieldset key={index} disabled={saving}>
              <legend>물건 {index + 1}</legend>
              <div className="detail-history-tools">
                <button
                  type="button"
                  className="editor-history-button"
                  disabled={!createPropertyHistoryTarget(detail)}
                  aria-expanded={referenceHistory?.kind === "listing" && referenceHistory.index === index}
                  aria-controls={`editor-listing-history-${index}`}
                  onClick={(event) => {
                    const target = createPropertyHistoryTarget(detail);
                    if (target?.kind !== "listing") return;
                    historyTrigger.current = event.currentTarget;
                    setReferenceHistory((current) => current?.kind === "listing" && current.index === index ? null : { kind: "listing", index, key: target.key });
                  }}
                >
                  <Icon name="clock" size={17} /> 매물 이력 보기
                </button>
                {!createPropertyHistoryTarget(detail) && <span className="form-help">물건구분·건물명·호수를 입력하면 조회할 수 있습니다.</span>}
              </div>
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
                  물건구분
                  <select
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
                  건물명
                  <input
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
                    onChange={(event) =>
                      updateDetail(index, "buildingDong", event.target.value)
                    }
                  />
                </label>
                <label>
                  호수
                  <input
                    value={detail.unitNumber}
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
                    setReferenceHistory(null);
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
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
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
}: {
  modal: { mode: "new" | "edit"; item?: Customer };
  onClose: () => void;
  onSaved: (message: string, customerId?: string) => Promise<void>;
}) {
  const [id, setId] = useState(modal.item?.id || "");
  const [name, setName] = useState(modal.item?.name || "");
  const [notes, setNotes] = useState(modal.item?.notes || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
      await jsonFetch(
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
        modal.item ? undefined : id.trim(),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (
      saving ||
      !modal.item ||
      !window.confirm(
        "이 고객을 삭제하시겠습니까? 업무 이력이 있는 고객은 삭제되지 않습니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await jsonFetch(`/api/customers/${encodeURIComponent(modal.item.id)}`, {
        method: "DELETE",
      });
      await onSaved("고객을 삭제했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
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
        {error && <p className="form-error">{error}</p>}
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
  onFollowUp,
  onCopy,
}: {
  data: HistoryData;
  onClose: () => void;
  onRefresh: () => void;
  onOpenWork: (id: string) => void;
  onNewWork: (id: string) => void;
  onFollowUp: (draft: FollowUpDraft) => void;
  onCopy: (id: string) => void;
}) {
  return (
    <Modal title={data.title} subtitle={data.subtitle} onClose={onClose}>
      {data.loading && <p className="form-help" role="status">이력을 불러오고 있습니다…</p>}
      {data.error && <div className="form-error" role="alert"><p>{data.error}</p>{(data.customer || data.listing || data.listingKey || data.date) && <button type="button" className="secondary-button" onClick={onRefresh}><Icon name="refresh" size={16} /> 다시 불러오기</button>}</div>}
      {data.customer && (
        <div className="history-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onNewWork(data.customer!.id)}
          >
            <Icon name="plus" size={18} /> 업무 등록
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onFollowUp({
                title: `${data.customer!.name} 다시 연락`,
                customerId: data.customer!.id,
              })
            }
          >
            <Icon name="tasks" size={18} /> 다시 연락할 일 추가
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
        <div className="editor-context">
          <p>
            <strong>{data.listing.status}</strong> ·{" "}
            {[
              data.listing.sale_price && `매매 ${data.listing.sale_price}`,
              data.listing.jeonse_price && `전세 ${data.listing.jeonse_price}`,
              data.listing.monthly_rent && `월세 ${data.listing.monthly_rent}`,
            ]
              .filter(Boolean)
              .join(" / ") || "가격 미기재"}
          </p>
          {data.listing.source_notes && (
            <p style={{ whiteSpace: "pre-wrap" }}>
              {data.listing.source_notes}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onFollowUp({
                title: `${targetText(data.listing!)} 매물 확인`,
                listingKey: data.listing!.identity_key,
              })
            }
          >
            <Icon name="tasks" size={18} /> 이 매물 확인할 일 추가
          </button>
        </div>
      )}
      <div className="history-list">
        {!data.items.length ? (
          !data.loading && !data.error ? <EmptyState title="기록이 없습니다." /> : null
        ) : (
          data.items.map((raw) => {
            const isEvent = "event_date" in raw;
            const date = isEvent ? raw.event_date : raw.work_date;
            const status = isEvent ? raw.status : raw.work_type;
            const content = isEvent ? raw.notes : raw.content;
            const id = isEvent ? raw.work_log_id : raw.id;
            return (
              <button
                key={raw.id}
                onClick={() => id && onOpenWork(id)}
                disabled={!id}
              >
                <span className={`history-mark ${statusTone(status)}`} />
                <time>{displayDate(date)}</time>
                <div>
                  <strong>{status}</strong>
                  <p>{content || "기록된 내용 없음"}</p>
                </div>
                {isEvent && <small>{raw.customer_name}</small>}
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  wide,
  locked = false,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  wide?: boolean;
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
        className={`modal-card ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={locked}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
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
