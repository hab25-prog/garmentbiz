import { apiClient } from "../../../lib/api-client";
import type { Material, CreateMaterialInput, UpdateMaterialInput, InventorySummary, StockMovement } from "../types/material.types";
import { fetchCsrfToken } from "../../auth/api/auth.api";

export const materialsApi = {
  getAll(includeArchived = false): Promise<Material[]> {
    return apiClient.get<Material[]>(`/api/materials${includeArchived ? "?includeArchived=true" : ""}`);
  },

  create(input: CreateMaterialInput): Promise<Material> {
    return this.mutate("POST","/api/materials",input);
  },
  async update(id:string,input:UpdateMaterialInput):Promise<Material>{return this.mutate("PATCH",`/api/materials/${encodeURIComponent(id)}`,input);},
  getSummary:()=>apiClient.get<InventorySummary>("/api/materials/inventory-summary"),
  getMovements:(params:{materialId?:string;type?:string;search?:string}={})=>{const query=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v)query.set(k,v);return apiClient.get<StockMovement[]>(`/api/materials/stock-movements${query.size?`?${query}`:""}`);},
  async mutate<T=Material>(method:"POST"|"PATCH",url:string,input:unknown):Promise<T>{const token=await fetchCsrfToken();return method==="POST"?apiClient.post<T>(url,input,{headers:{"X-CSRF-Token":token}}):apiClient.patch<T>(url,input,{headers:{"X-CSRF-Token":token}});},
};
