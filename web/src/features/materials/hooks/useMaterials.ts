import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { materialsApi } from "../api/materials.api";
import { unitsApi, type CreateUnitInput } from "../api/units.api";
import type { CreateMaterialInput } from "../types/material.types";

export const materialKeys = {
  all: ["materials"] as const,
};

export function useMaterials(includeArchived = false) {
  return useQuery({
    queryKey: [...materialKeys.all, { includeArchived }],
    queryFn: () => materialsApi.getAll(includeArchived),
  });
}

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: unitsApi.getAll,
  });
}
export function useCreateUnit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUnitInput) => unitsApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["units"] }),
  });
}
export function useAddRecommendedUnits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unitsApi.addRecommendedDefaults,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["units"] }),
  });
}
export function useInventorySummary(){return useQuery({queryKey:[...materialKeys.all,"summary"],queryFn:materialsApi.getSummary});}
export function useStockMovements(filters:{materialId?:string;type?:string;search?:string}={}){return useQuery({queryKey:[...materialKeys.all,"movements",filters],queryFn:()=>materialsApi.getMovements(filters)});}

export function useCreateMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMaterialInput) => materialsApi.create(input),

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: materialKeys.all,
      });
    },
  });
}
export function useUpdateMaterial(){const queryClient=useQueryClient();return useMutation({mutationFn:({id,input}: {id:string;input:import("../types/material.types").UpdateMaterialInput})=>materialsApi.update(id,input),onSuccess:()=>Promise.all([queryClient.invalidateQueries({queryKey:materialKeys.all})])});}
