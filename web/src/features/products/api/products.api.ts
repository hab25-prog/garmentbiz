import { apiClient } from "../../../lib/api-client";
import type { CreateProductInput, Product } from "../types/product.types";

export const productsApi = {
  getAll(): Promise<Product[]> {
    return apiClient.get<Product[]>("/api/products");
  },

  create(input: CreateProductInput): Promise<Product> {
    return apiClient.post<Product>("/api/products", input);
  },
};
