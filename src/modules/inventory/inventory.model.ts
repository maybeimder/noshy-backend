export type InventoryItem = {
  id: string;
  userId: string;
  name: string;
  quantity: number;
  unit: string;
  createdAt: string;
};

export type InventoryItemInput = {
  name: string;
  quantity: number;
  unit: string;
};
