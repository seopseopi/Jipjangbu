export type DeletionEntityType = "work" | "customer" | "followup";

export type DeletionPreview = {
  type: DeletionEntityType;
  id: string;
  title: string;
  subtitle: string;
  content: string;
  affectedListings: Array<{ key: string; label: string }>;
  warnings: string[];
  blockedReason: string | null;
  revision: string;
};

export type TrashItem = {
  id: string;
  type: DeletionEntityType;
  entityId: string;
  title: string;
  subtitle: string;
  deletedAt: string;
};

export type TrashListResponse = {
  items: TrashItem[];
  total: number;
  limit: number;
  offset: number;
};

export type TrashDetailResponse = {
  item: TrashItem;
  preview: DeletionPreview;
};

export type DeletionResult = { ok: true; trashId: string };
export type RestoreResult = { ok: true; type: DeletionEntityType; entityId: string };
