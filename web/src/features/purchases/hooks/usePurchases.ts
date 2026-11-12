import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { purchasesApi } from "../api/purchases.api";
import type { CreatePurchaseInput } from "../types/purchase.types";

export const purchaseKeys = {
  all: ["purchases"] as const,
};

export function usePurchases() {
  return useQuery({
    queryKey: purchaseKeys.all,
    queryFn: purchasesApi.getAll,
  });
}

export function useCreatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePurchaseInput) => purchasesApi.create(input),

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: purchaseKeys.all,
      });
    },
  });
}

export function useReceivePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purchaseId: string) => purchasesApi.receive(purchaseId),

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: purchaseKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: ["materials"],
        }),
      ]);
    },
  });
}
