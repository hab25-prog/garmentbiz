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
  inventoryValue?: string;
  isActive?: boolean;
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
  description?: string;
}
export type UpdateMaterialInput = Partial<CreateMaterialInput> & {isActive?:boolean;description?:string|null};
export interface InventorySummary {materials:Material[];totalItems:number;totalAvailableStock:string;totalInventoryValue:string;lowStock:Material[];outOfStock:Material[]}
export interface StockMovement {id:string;materialId:string;movementType:string;quantity:string;referenceId:string|null;referenceType:string|null;notes:string|null;movementDate:string;material:Material}
