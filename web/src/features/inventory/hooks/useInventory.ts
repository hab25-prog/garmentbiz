import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {inventoryApi} from "../api/inventory.api";
export const inventoryKeys={balances:["inventory","balances"] as const,operations:["inventory","operations"] as const,conversions:["inventory","conversions"] as const};
export function useInventoryBalances(){return useQuery({queryKey:inventoryKeys.balances,queryFn:inventoryApi.balances});}
export function useInventoryOperations(){return useQuery({queryKey:inventoryKeys.operations,queryFn:inventoryApi.operations});}
export function useUnitConversions(){return useQuery({queryKey:inventoryKeys.conversions,queryFn:inventoryApi.conversions});}
function useInventoryMutation<T>(fn:(x:T)=>Promise<unknown>){const client=useQueryClient();return useMutation({mutationFn:fn,onSuccess:()=>Promise.all([client.invalidateQueries({queryKey:inventoryKeys.balances}),client.invalidateQueries({queryKey:inventoryKeys.operations}),client.invalidateQueries({queryKey:["materials"]})])});}
export const useReceiveStock=()=>useInventoryMutation(inventoryApi.receive);export const useIssueStock=()=>useInventoryMutation(inventoryApi.issue);export const useReturnStock=()=>useInventoryMutation(inventoryApi.returnStock);export const useRecordWaste=()=>useInventoryMutation(inventoryApi.waste);export const useAdjustIn=()=>useInventoryMutation(inventoryApi.adjustIn);export const useAdjustOut=()=>useInventoryMutation(inventoryApi.adjustOut);
export function useCreateUnitConversion(){const c=useQueryClient();return useMutation({mutationFn:inventoryApi.createConversion,onSuccess:()=>c.invalidateQueries({queryKey:inventoryKeys.conversions})});}
