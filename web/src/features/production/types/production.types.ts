export type ProductionStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export interface ProductionBatch {
 id:string; businessId:string; orderId:string; orderItemId:string|null; employeeId:string|null; batchNo:string; status:ProductionStatus; plannedQuantity:number; completedQuantity:number; startDate:string|null; completedAt:string|null; notes:string|null; createdAt:string;
 order:{id:string;orderNo:string;status:string;customer:{name:string};items?:OrderItem[]};
 orderItem:{id:string;quantity:number;product:{id:string;name:string;sku:string|null}}|null;
 employee:{id:string;fullName:string}|null; materialUsages?:MaterialUsage[]; costSheet?:ProductionCostSheet|null;
}
export interface OrderItem {id:string;productId:string;quantity:number;product:{id:string;name:string;sku:string|null}}
export interface ProductionMaterial {id:string;name:string;availableStock:string;unit:{name:string;code:string}}
export interface MaterialUsage {id:string;materialId:string;issuedQuantity:string;consumedQuantity:string;returnedQuantity:string;wastedQuantity:string;unitCostSnapshot:string;totalCost:string;notes:string|null;material:{id:string;name:string;unit:{name:string;code:string}}}
export interface CostAllocation {id:string;allocatedQuantity:string;returnedQuantity:string;unitCostSnapshot:string}
export interface ProductionCostSheet {id:string;materialCost:string;laborCost:string;otherDirectCost:string;totalDirectCost:string;costedQuantity:number;breakEvenUnitPrice:string;markupPercent:string;suggestedUnitPrice:string;notes:string|null;calculatedAt:string}
export interface CreateBatchInput {orderId:string;orderItemId?:string;plannedQuantity:number;employeeId?:string;notes?:string}
export interface CostSheetInput {laborCost:string;otherDirectCost:string;costedQuantity:number;markupPercent:string;notes?:string}
