import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { productsApi } from "../api/products.api";
import type { CreateProductInput } from "../types/product.types";

export const productKeys = {
  all: ["products"] as const,
};

export function useProducts() {
  return useQuery({
    queryKey: productKeys.all,
    queryFn: productsApi.getAll,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProductInput) => productsApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}
