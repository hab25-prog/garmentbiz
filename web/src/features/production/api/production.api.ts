import { apiClient } from "../../../lib/api-client";
import { fetchCsrfToken } from "../../auth/api/auth.api";
import type { CostSheetInput, MaterialUsage, ProductionBatch, ProductionCostSheet, ProductionMaterial, ProductionStatus, CreateBatchInput } from "../types/production.types";
async function post<T>(path:string,body:unknown){const token=await fetchCsrfToken();return apiClient.post<T>(path,body,{headers:{"X-CSRF-Token":token}})}
async function patch<T>(path:string,body:unknown){const token=await fetchCsrfToken();return apiClient.patch<T>(path,body,{headers:{"X-CSRF-Token":token}})}
async function put<T>(path:string,body:unknown){const token=await fetchCsrfToken();return apiClient.put<T>(path,body,{headers:{"X-CSRF-Token":token}})}
const root="/api/production";
export const productionApi={
 list:()=>apiClient.get<ProductionBatch[]>(root), detail:(id:string)=>apiClient.get<ProductionBatch>(`${root}/${encodeURIComponent(id)}`),
 create:(input:CreateBatchInput)=>post<ProductionBatch>(root,input), updateStatus:(id:string,status:ProductionStatus,completedQuantity:number)=>patch<ProductionBatch>(`${root}/${encodeURIComponent(id)}/status`,{status,completedQuantity}),
 issue:(id:string,input:{materialId:string;quantity:string;notes?:string})=>post<MaterialUsage>(`${root}/${encodeURIComponent(id)}/material-issues`,input), usages:(id:string)=>apiClient.get<MaterialUsage[]>(`${root}/${encodeURIComponent(id)}/material-usage`),
 reconcile:(id:string,usageId:string,input:{consumedQuantity:string;returnedQuantity:string;wastedQuantity:string;notes?:string})=>patch<MaterialUsage>(`${root}/${encodeURIComponent(id)}/material-usage/${encodeURIComponent(usageId)}`,input),
 costSheet:(id:string)=>apiClient.get<ProductionCostSheet>(`${root}/${encodeURIComponent(id)}/cost-sheet`), saveCost:(id:string,input:CostSheetInput)=>put<ProductionCostSheet>(`${root}/${encodeURIComponent(id)}/cost-sheet`,input), calculate:(id:string)=>post<ProductionCostSheet>(`${root}/${encodeURIComponent(id)}/calculate-cost`,{}), materials:()=>apiClient.get<ProductionMaterial[]>("/api/materials"),
};
