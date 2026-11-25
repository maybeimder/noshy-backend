import { ulid } from 'ulid';

/** Prefijos de ID del contrato. `rcp_` es receta, `rct_` es factura. */
export const IdPrefix = {
  user: 'usr',
  recipe: 'rcp',
  receipt: 'rct',
  receiptItem: 'rci',
  pantryItem: 'pit',
  shoppingList: 'shl',
  shoppingItem: 'sli',
  thread: 'thr',
  message: 'msg',
  cookingSession: 'cks',
  media: 'med',
  meal: 'mlg',
  menu: 'mnu',
  menuEntry: 'mne',
  nudge: 'ndg',
  insight: 'ins',
  adaptation: 'adp',
  proposal: 'prp',
  comment: 'cmt',
  report: 'rep',
  event: 'evt',
  outbox: 'obx',
  refreshToken: 'rtk',
  identity: 'oid',
} as const;

export type IdKind = keyof typeof IdPrefix;

export const newId = (kind: IdKind): string => `${IdPrefix[kind]}_${ulid()}`;
