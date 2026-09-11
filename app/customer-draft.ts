export type CustomerDraft = {
  id: string;
  name: string;
  notes: string;
};

export function customerDraftChanged(initial: CustomerDraft, current: CustomerDraft) {
  return initial.id !== current.id || initial.name !== current.name || initial.notes !== current.notes;
}

export function canCloseCustomerDraft(
  initial: CustomerDraft,
  current: CustomerDraft,
  saving: boolean,
  confirmDiscard: () => boolean,
) {
  if (saving) return false;
  return !customerDraftChanged(initial, current) || confirmDiscard();
}
