import type { Material } from "../../materials/types/material.types";
export type OperationType="MANUAL_RECEIPT"|"ISSUE"|"RETURN"|"WASTE"|"ADJUSTMENT_IN"|"ADJUSTMENT_OUT";
export interface InventoryBalance {material:Material;stockBalance:string;fifoQuantity:string;inventoryValue:string;isConsistent:boolean}
export interface InventoryOperation {id:string;materialId:string;operationType:OperationType;quantity:string;unitCost:string|null;reason:string;reference:string|null;operationKey:string;createdAt:string;material:Material;movement:{movementType:string;quantity:string;unitCostSnapshot:string|null;movementDate:string}|null;performedBy:{id:string;role:string};reversesOperationId:string|null;allocations:{allocatedQuantity:string;returnedQuantity:string;unitCostSnapshot:string}[]}
export interface UnitConversion {id:string;fromUnitId:string;toUnitId:string;factor:string;fromUnit:{id:string;name:string;code:string};toUnit:{id:string;name:string;code:string}}
