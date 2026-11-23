import { apiClient } from "../../../lib/api-client";
import type { CreateProductInput, Product, ProductMaterialRequirement } from "../types/product.types";
import { fetchCsrfToken } from "../../auth/api/auth.api";

export const productsApi = {
  getAll(): Promise<Product[]> {
    return apiClient.get<Product[]>("/api/products");
  },

  create(input: CreateProductInput): Promise<Product> {
    return apiClient.post<Product>("/api/products", input);
  },
  getRequirements(productId: string): Promise<ProductMaterialRequirement[]> {
    return apiClient.get<ProductMaterialRequirement[]>(`/api/products/${encodeURIComponent(productId)}/material-requirements`);
  },
  async addRequirement(productId: string, input: { materialId: string; quantityPerUnit: string }): Promise<ProductMaterialRequirement> {
    const token = await fetchCsrfToken();
    return apiClient.post<ProductMaterialRequirement>(`/api/products/${encodeURIComponent(productId)}/material-requirements`, input, { headers: { "X-CSRF-Token": token } });
  },
  async updateRequirement(productId: string, requirementId: string, quantityPerUnit: string): Promise<ProductMaterialRequirement> {
    const token = await fetchCsrfToken();
    return apiClient.patch<ProductMaterialRequirement>(`/api/products/${encodeURIComponent(productId)}/material-requirements/${encodeURIComponent(requirementId)}`, { quantityPerUnit }, { headers: { "X-CSRF-Token": token } });
  },
  async removeRequirement(productId: string, requirementId: string): Promise<{ removed: boolean }> {
    const token = await fetchCsrfToken();
    return apiClient.delete<{ removed: boolean }>(`/api/products/${encodeURIComponent(productId)}/material-requirements/${encodeURIComponent(requirementId)}`, { headers: { "X-CSRF-Token": token } });
  },
};
