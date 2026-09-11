import {
  House,
  ListTodo,
  ChartNoAxesCombined,
  NotebookPen,
  Building2,
  UsersRound,
  CalendarDays,
  Settings2,
  Search,
  Plus,
  X,
  ArrowLeft,
  ChevronRight,
  ArrowUpRight,
  Phone,
  CalendarPlus,
  HousePlus,
  Download,
  DatabaseBackup,
  LogOut,
  Pencil,
  Trash2,
  Copy,
  Save,
  Check,
  TriangleAlert,
  Clock3,
  RefreshCw,
  Type,
  Inbox,
  Unlink,
  ListFilter,
  ArrowDownWideNarrow,
  CalendarClock,
  CircleCheck,
} from "lucide-react";

const icons = {
  home: House,
  tasks: ListTodo,
  insights: ChartNoAxesCombined,
  journal: NotebookPen,
  listings: Building2,
  customers: UsersRound,
  calendar: CalendarDays,
  settings: Settings2,
  search: Search,
  plus: Plus,
  close: X,
  back: ArrowLeft,
  next: ChevronRight,
  upRight: ArrowUpRight,
  phone: Phone,
  calendarPlus: CalendarPlus,
  housePlus: HousePlus,
  download: Download,
  backup: DatabaseBackup,
  logout: LogOut,
  edit: Pencil,
  delete: Trash2,
  copy: Copy,
  save: Save,
  check: Check,
  warning: TriangleAlert,
  clock: Clock3,
  refresh: RefreshCw,
  text: Type,
  empty: Inbox,
  unlink: Unlink,
  filter: ListFilter,
  sort: ArrowDownWideNarrow,
  upcoming: CalendarClock,
  completed: CircleCheck,
} as const;

export type IconName = keyof typeof icons;

/** Labels live on the enclosing control; icons never replace accessible text. */
export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      className={`ui-icon ${className}`.trim()}
    />
  );
}

export function workTypeIcon(workType: string): IconName {
  if (/취소|파기|타계약/.test(workType)) return "warning";
  if (/예정|예약/.test(workType)) return "upcoming";
  if (/전화/.test(workType)) return "phone";
  if (/매물등록/.test(workType)) return "housePlus";
  if (/매물/.test(workType)) return "listings";
  if (/집방문|내방|방문/.test(workType)) return "home";
  if (/계약|잔금|중도금/.test(workType)) return "journal";
  return "tasks";
}
