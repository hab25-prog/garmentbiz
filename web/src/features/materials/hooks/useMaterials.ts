import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { materialsApi } from "../api/materials.api";
import { unitsApi } from "../api/units.api";
import type { CreateMaterialInput } from "../types/material.types";

export const materialKeys = {
  all: ["materials"] as const,
};

export function useMaterials() {
  return useQuery({
    queryKey: materialKeys.all,
    queryFn: materialsApi.getAll,
  });
}

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: unitsApi.getAll,
  });
}

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
