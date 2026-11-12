export type MaterialType =
  | "FABRIC"
  | "POLYMER"
  | "THREAD"
  | "ACCESSORY"
  | "PACKAGING"
  | "OTHER";

export interface Material {
  id: string;
  name: string;
  sku: string | null;
  type: MaterialType;
  description: string | null;
  reorderLevel: string;
  availableStock: string;
  unit: {
    id?: string;
    name: string;
    code: string;
  };
}

export interface UnitOfMeasure {
  id: string;
  name: string;
  code: string;
}

export interface CreateMaterialInput {
  unitId: string;
  name: string;
  sku?: string;
  type: MaterialType;
  reorderLevel: number;
}
