import { apiClient } from "../../../lib/api-client";
import type { Material, CreateMaterialInput } from "../types/material.types";

export const materialsApi = {
  getAll(): Promise<Material[]> {
    return apiClient.get<Material[]>("/api/materials");
  },

  create(input: CreateMaterialInput): Promise<Material> {
    return apiClient.post<Material>("/api/materials", input);
  },
};
