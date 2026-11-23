import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { productsApi } from "../api/products.api";
import type { CreateProductInput } from "../types/product.types";
import { materialsApi } from "../../materials/api/materials.api";

export const productKeys = {
  all: ["products"] as const,
  requirements: (productId: string) => ["products", productId, "material-requirements"] as const,
};

export function useProductMaterialRequirements(productId: string | null) {
  return useQuery({
    queryKey: productKeys.requirements(productId ?? ""),
    queryFn: () => productsApi.getRequirements(productId!),
    enabled: Boolean(productId),
  });
}

export function useBomMaterials() {
  return useQuery({ queryKey: ["materials", { includeArchived: false }], queryFn: () => materialsApi.getAll() });
}

function useRequirementMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_data, variables) => {
      const productId = (variables as { productId: string }).productId;
      await client.invalidateQueries({ queryKey: productKeys.requirements(productId) });
    },
  });
}

export function useAddMaterialRequirement() {
  return useRequirementMutation(({ productId, materialId, quantityPerUnit }: { productId: string; materialId: string; quantityPerUnit: string }) => productsApi.addRequirement(productId, { materialId, quantityPerUnit }));
}

export function useUpdateMaterialRequirement() {
  return useRequirementMutation(({ productId, requirementId, quantityPerUnit }: { productId: string; requirementId: string; quantityPerUnit: string }) => productsApi.updateRequirement(productId, requirementId, quantityPerUnit));
}

export function useRemoveMaterialRequirement() {
  return useRequirementMutation(({ productId, requirementId }: { productId: string; requirementId: string }) => productsApi.removeRequirement(productId, requirementId));
}

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
