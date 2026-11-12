import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { suppliersApi } from "../api/suppliers.api";
import type { CreateSupplierInput } from "../types/supplier.types";

export const supplierKeys = {
  all: ["suppliers"] as const,
};

export function useSuppliers() {
  return useQuery({
    queryKey: supplierKeys.all,
    queryFn: suppliersApi.getAll,
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSupplierInput) => suppliersApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: supplierKeys.all,
      });
    },
  });
}
