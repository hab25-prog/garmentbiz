import { prisma } from "../../database/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { MaterialType, StockMovementType } from "../../../generated/prisma/client.js";

interface CreateMaterialInput {
  businessId: string;
  unitId: string;
  name: string;
  sku?: string;
  type?: MaterialType;
  description?: string;
  reorderLevel?: number;
}

export async function createMaterial(input: CreateMaterialInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  const unit = await prisma.unitOfMeasure.findFirst({
    where: {
      id: input.unitId,
      businessId: input.businessId,
    },
  });

  if (!unit) {
    throw new Error("Measurement unit not found for this business");
  }

  return prisma.material.create({
    data: {
      businessId: input.businessId,
      unitId: input.unitId,
      name: input.name,
      type: input.type ?? "OTHER",
      reorderLevel: input.reorderLevel ?? 0,
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    },
    include: {
      unit: true,
    },
  });
}

export async function getMaterials(businessId: string, includeArchived = false) {
  const materials = await prisma.material.findMany({
    where: {
      businessId,
      ...(includeArchived ? {} : { isActive: true }),
      unit: { businessId },
    },
    include: {
      unit: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  return Promise.all(
    materials.map(async (material) => {
      const stock = await prisma.stockMovement.aggregate({
        where: {
          businessId,
          materialId: material.id,
        },
        _sum: {
          quantity: true,
        },
      });

      return {
        ...material,
        availableStock: stock._sum.quantity ?? new Prisma.Decimal(0),
      };
    }),
  );
}

export async function updateMaterial(businessId: string, materialId: string, input: Partial<Omit<CreateMaterialInput,"businessId">> & { isActive?: boolean }) {
  const material=await prisma.material.findFirst({where:{id:materialId,businessId}});
  if(!material) return null;
  if(input.unitId&&!await prisma.unitOfMeasure.findFirst({where:{id:input.unitId,businessId}}))throw new Error("Measurement unit not found for this business");
  if (input.unitId && input.unitId !== material.unitId) {
    const [movements, costLayers, inventoryOperations, purchaseItems, productionUsages] = await Promise.all([
      prisma.stockMovement.count({ where: { businessId, materialId } }),
      prisma.materialCostLayer.count({ where: { businessId, materialId } }),
      prisma.inventoryOperation.count({ where: { businessId, materialId } }),
      prisma.purchaseItem.count({ where: { materialId, purchase: { businessId } } }),
      prisma.productionMaterialUsage.count({ where: { businessId, materialId } }),
    ]);
    if (movements + costLayers + inventoryOperations + purchaseItems + productionUsages > 0) {
      throw new Error("A material unit cannot be changed after inventory or purchase history exists");
    }
  }
  return prisma.material.update({where:{id:materialId},data:{...(input.unitId?{unitId:input.unitId}:{}),...(input.name!==undefined?{name:input.name.trim()}:{}),...(input.sku!==undefined?{sku:input.sku.trim()||null}:{}),...(input.type?{type:input.type}:{}),...(input.description!==undefined?{description:input.description}:{}),...(input.reorderLevel!==undefined?{reorderLevel:new Prisma.Decimal(input.reorderLevel)}:{}),...(input.isActive!==undefined?{isActive:input.isActive}:{})},include:{unit:true}});
}

export async function getStockMovements(businessId: string, filters: { materialId?: string; type?: StockMovementType; search?: string }) {
  return prisma.stockMovement.findMany({
    where: {
      businessId,
      ...(filters.materialId ? { materialId: filters.materialId } : {}),
      ...(filters.type ? { movementType: filters.type } : {}),
      ...(filters.search ? { OR: [
        { notes: { contains: filters.search, mode: "insensitive" } },
        { referenceId: { contains: filters.search, mode: "insensitive" } },
        { material: { name: { contains: filters.search, mode: "insensitive" } } },
      ] } : {}),
    },
    include: { material: { include: { unit: true } } },
    orderBy: { movementDate: "desc" },
    take: 300,
  });
}

export async function getInventorySummary(businessId:string){const materials=await prisma.material.findMany({where:{businessId,isActive:true,unit:{businessId}},include:{unit:true},orderBy:{name:"asc"}});const ids=materials.map(m=>m.id);const [movements,layers]=await Promise.all([prisma.stockMovement.findMany({where:{businessId,materialId:{in:ids}},select:{materialId:true,quantity:true}}),prisma.materialCostLayer.findMany({where:{businessId,status:"OPEN",remainingQty:{gt:0},materialId:{in:ids}},select:{materialId:true,remainingQty:true,unitCost:true}})]);const stock=new Map<string,Prisma.Decimal>(),value=new Map<string,Prisma.Decimal>();for(const m of movements)stock.set(m.materialId,(stock.get(m.materialId)??new Prisma.Decimal(0)).add(m.quantity));for(const l of layers)value.set(l.materialId,(value.get(l.materialId)??new Prisma.Decimal(0)).add(l.remainingQty.mul(l.unitCost)));const rows=materials.map(m=>({...m,availableStock:stock.get(m.id)??new Prisma.Decimal(0),inventoryValue:value.get(m.id)??new Prisma.Decimal(0)}));return{materials:rows,totalItems:rows.length,totalAvailableStock:rows.reduce((s,m)=>s.add(m.availableStock),new Prisma.Decimal(0)),lowStock:rows.filter(m=>m.availableStock.greaterThan(0)&&m.availableStock.lessThanOrEqualTo(m.reorderLevel)),outOfStock:rows.filter(m=>m.availableStock.lessThanOrEqualTo(0)),totalInventoryValue:rows.reduce((s,m)=>s.add(m.inventoryValue),new Prisma.Decimal(0))};}
