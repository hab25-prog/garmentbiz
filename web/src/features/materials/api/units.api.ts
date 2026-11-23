import { apiClient } from "../../../lib/api-client";
import type { UnitOfMeasure } from "../types/material.types";

export interface CreateUnitInput {
  name: string;
  code: string;
}

export interface RecommendedUnitsResult {
  units: UnitOfMeasure[];
  addedCount: number;
  alreadyExistedCount: number;
}

export const unitsApi = {
  getAll(): Promise<UnitOfMeasure[]> {
    return apiClient.get<UnitOfMeasure[]>("/api/units");
  },

  create(input: CreateUnitInput): Promise<UnitOfMeasure> {
    return apiClient.post<UnitOfMeasure>("/api/units", input);
  },

  addRecommendedDefaults(): Promise<RecommendedUnitsResult> {
    return apiClient.post<RecommendedUnitsResult>("/api/units/defaults");
  },
};
