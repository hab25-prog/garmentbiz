import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {productionApi} from "../api/production.api";
import type {CostSheetInput,CreateBatchInput,ProductionStatus} from "../types/production.types";
export const productionKeys={all:["production"] as const,detail:(id:string)=>["production",id] as const,usage:(id:string)=>["production",id,"usage"] as const,cost:(id:string)=>["production",id,"cost"] as const};
export function useProduction(){return useQuery({queryKey:productionKeys.all,queryFn:productionApi.list})}
export function useProductionDetail(id:string|null){return useQuery({queryKey:productionKeys.detail(id??""),queryFn:()=>productionApi.detail(id!),enabled:Boolean(id)})}
export function useProductionMaterials(){return useQuery({queryKey:["materials"],queryFn:productionApi.materials})}
export function useProductionUsage(id:string|null){return useQuery({queryKey:productionKeys.usage(id??""),queryFn:()=>productionApi.usages(id!),enabled:Boolean(id)})}
export function useProductionCost(id:string|null){return useQuery({queryKey:productionKeys.cost(id??""),queryFn:()=>productionApi.costSheet(id!),enabled:Boolean(id),retry:false})}
function invalidate(q:ReturnType<typeof useQueryClient>,id?:string){return Promise.all([q.invalidateQueries({queryKey:productionKeys.all}),...(id?[q.invalidateQueries({queryKey:productionKeys.detail(id)}),q.invalidateQueries({queryKey:productionKeys.usage(id)}),q.invalidateQueries({queryKey:productionKeys.cost(id)})]:[])])}
export function useCreateBatch(){const q=useQueryClient();return useMutation({mutationFn:(x:CreateBatchInput)=>productionApi.create(x),onSuccess:()=>invalidate(q)})}
export function useUpdateProductionStatus(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;status:ProductionStatus;completedQuantity:number})=>productionApi.updateStatus(x.id,x.status,x.completedQuantity),onSuccess:x=>invalidate(q,x.id)})}
export function useIssueMaterial(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;materialId:string;quantity:string;notes?:string})=>productionApi.issue(x.id,x),onSuccess:(_,x)=>invalidate(q,x.id)})}
export function useReconcileUsage(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;usageId:string;consumedQuantity:string;returnedQuantity:string;wastedQuantity:string;notes?:string})=>productionApi.reconcile(x.id,x.usageId,x),onSuccess:(_,x)=>invalidate(q,x.id)})}
export function useSaveProductionCost(){const q=useQueryClient();return useMutation({mutationFn:(x:{id:string;input:CostSheetInput})=>productionApi.saveCost(x.id,x.input),onSuccess:(_,x)=>invalidate(q,x.id)})}
export function useCalculateProductionCost(){const q=useQueryClient();return useMutation({mutationFn:(id:string)=>productionApi.calculate(id),onSuccess:(_,id)=>invalidate(q,id)})}
