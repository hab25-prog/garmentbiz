import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {productionApi} from "../api/production.api";
import type {CostSheetInput,CreateBatchInput,ProductionStatus} from "../types/production.types";
import { orderKeys } from "../../orders/hooks/useOrders";
import { inventoryKeys } from "../../inventory/hooks/useInventory";
export const productionKeys={all:["production"] as const,detail:(id:string)=>["production",id] as const,usage:(id:string)=>["production",id,"usage"] as const,cost:(id:string)=>["production",id,"cost"] as const};
export function useProduction(){return useQuery({queryKey:productionKeys.all,queryFn:productionApi.list})}
export function useProductionDetail(id:string|null){return useQuery({queryKey:productionKeys.detail(id??""),queryFn:()=>productionApi.detail(id!),enabled:Boolean(id)})}
export function useProductionMaterials(){return useQuery({queryKey:["materials"],queryFn:productionApi.materials})}
export function useProductionUsage(id:string|null){return useQuery({queryKey:productionKeys.usage(id??""),queryFn:()=>productionApi.usages(id!),enabled:Boolean(id)})}
export function useProductionCost(id:string|null){return useQuery({queryKey:productionKeys.cost(id??""),queryFn:()=>productionApi.costSheet(id!),enabled:Boolean(id),retry:false})}
function relatedOrderId(q:ReturnType<typeof useQueryClient>,batchId:string){return q.getQueryData<{orderId?:string}>(productionKeys.detail(batchId))?.orderId;}
function invalidateBatch(q:ReturnType<typeof useQueryClient>,batchId?:string,orderId?:string,inventory=false,refreshOrder=true){const relatedOrder=orderId??(batchId?relatedOrderId(q,batchId):undefined);return Promise.all([
 q.invalidateQueries({queryKey:productionKeys.all}),
 ...(batchId?[q.invalidateQueries({queryKey:productionKeys.detail(batchId)}),q.invalidateQueries({queryKey:productionKeys.usage(batchId)}),q.invalidateQueries({queryKey:productionKeys.cost(batchId)})]:[]),
 ...(refreshOrder&&relatedOrder?[q.invalidateQueries({queryKey:orderKeys.detail(relatedOrder)}),q.invalidateQueries({queryKey:orderKeys.all})]:[]),
 ...(inventory?[q.invalidateQueries({queryKey:inventoryKeys.balances}),q.invalidateQueries({queryKey:inventoryKeys.operations}),q.invalidateQueries({queryKey:["materials"]})]:[]),
]);}
export function useCreateBatch(){const q=useQueryClient();return useMutation({mutationFn:(x:CreateBatchInput)=>productionApi.create(x),onSuccess:(batch)=>invalidateBatch(q,batch.id,batch.orderId)})}
export function useUpdateProductionStatus(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;status:ProductionStatus;completedQuantity:number})=>productionApi.updateStatus(x.id,x.status,x.completedQuantity),onSuccess:(batch,x)=>invalidateBatch(q,x.id,batch.orderId)})}
export function useIssueMaterial(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;materialId:string;quantity:string;notes?:string})=>productionApi.issue(x.id,x),onSuccess:(_,x)=>invalidateBatch(q,x.id,undefined,true)})}
export function useReconcileUsage(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;usageId:string;consumedQuantity:string;returnedQuantity:string;wastedQuantity:string;notes?:string})=>productionApi.reconcile(x.id,x.usageId,x),onSuccess:(_,x)=>invalidateBatch(q,x.id,undefined,true)})}
export function useSaveProductionCost(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;input:CostSheetInput})=>productionApi.saveCost(x.id,x.input),onSuccess:(_,x)=>invalidateBatch(q,x.id,undefined,false,false)})}
export function useCalculateProductionCost(){const q=useQueryClient();return useMutation({mutationFn:(id:string)=>productionApi.calculate(id),onSuccess:(_,id)=>invalidateBatch(q,id,undefined,false,false)})}
