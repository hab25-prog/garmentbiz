import { apiClient } from "../../../lib/api-client";
import type { UnitOfMeasure } from "../types/material.types";

export const unitsApi = {
  getAll(): Promise<UnitOfMeasure[]> {
    return apiClient.get<UnitOfMeasure[]>("/api/units");
  },
};
