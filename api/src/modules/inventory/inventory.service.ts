import { Prisma } from "../../../generated/prisma/client.js";
import type { InventoryOperationType } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";
const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
function decimal(value:string,label:string,scale:number,positive=true){let x:Prisma.Decimal;try{x=new D(value);}catch{throw new Error(`${label} must be a valid decimal`);}if(!x.isFinite()||(positive?!x.greaterThan(0):x.isNegative())||x.decimalPlaces()>scale)throw new Error(`${label} is outside the supported range`);return x;}
function metadata(reason:string,key:string){if(!reason?.trim())throw new Error("Reason is required");if(!key?.trim())throw new Error("Operation key is required");}
async function lockMaterial(tx: Tx, businessId: string, materialId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id"=${materialId} AND "businessId"=${businessId} FOR UPDATE`;
  const material = await tx.material.findFirst({
    where: { id: materialId, businessId, isActive: true },
    include: { unit: { select: { id: true, businessId: true } } },
  });
  if (!material) throw new Error("Material not found for this business");
  if (!material.unit || material.unit.id !== material.unitId || material.unit.businessId !== businessId) {
    throw new Error("Material base unit not found for this business");
  }
  const [movementAggregate, layerAggregate] = await Promise.all([
    tx.stockMovement.aggregate({ where: { businessId, materialId }, _sum: { quantity: true } }),
    tx.materialCostLayer.aggregate({ where: { businessId, materialId, status: "OPEN" }, _sum: { remainingQty: true } }),
  ]);
  const balance = movementAggregate._sum.quantity ?? new D(0);
  const layers = layerAggregate._sum.remainingQty ?? new D(0);
  if (!balance.equals(layers)) {
    throw new Error(`Inventory discrepancy for material ${materialId}: movement ${balance} differs from FIFO ${layers}`);
  }
  if (balance.isNegative()) throw new Error("Inventory balance is negative");
  return { material, balance };
}

async function baseQuantity(tx: Tx, businessId: string, materialId: string, value: string, unitId?: string) {
  const quantity = decimal(value, "Quantity", 3);
  const { material } = await lockMaterial(tx, businessId, materialId);
  if (unitId === undefined) return quantity;
  if (typeof unitId !== "string" || !unitId.trim()) throw new Error("Unit not found for this business");
  if (unitId === material.unitId) return quantity;

  const requestedUnit = await tx.unitOfMeasure.findFirst({
    where: { id: unitId, businessId },
    select: { id: true },
  });
  if (!requestedUnit) throw new Error("Unit not found for this business");

  const conversion = await tx.unitConversion.findFirst({
    where: {
      businessId,
      OR: [
        { fromUnitId: unitId, toUnitId: material.unitId, fromUnit: { businessId }, toUnit: { businessId } },
        { fromUnitId: material.unitId, toUnitId: unitId, fromUnit: { businessId }, toUnit: { businessId } },
      ],
    },
  });
  if (!conversion) throw new Error("No explicit conversion exists between the selected unit and material base unit");

  const converted = conversion.fromUnitId === unitId
    ? quantity.mul(conversion.factor)
    : quantity.div(conversion.factor);
  const rounded = converted.toDecimalPlaces(3, D.ROUND_HALF_UP);
  if (!rounded.greaterThan(0)) throw new Error("Converted quantity is below supported precision");
  return rounded;
}
async function existing(tx:Tx,b:string,key:string){return tx.inventoryOperation.findUnique({where:{businessId_operationKey:{businessId:b,operationKey:key}},include:{movement:true,costLayer:true,allocations:true}});}
async function inbound(tx:Tx,i:{businessId:string;membershipId:string;materialId:string;quantity:Prisma.Decimal;unitCost:string;reason:string;reference?:string;operationKey:string;type:"MANUAL_RECEIPT"|"ADJUSTMENT_IN";supplierId?:string}){const old=await existing(tx,i.businessId,i.operationKey);if(old)return old;const cost=decimal(i.unitCost,"Unit cost",2,false);const op=await tx.inventoryOperation.create({data:{businessId:i.businessId,materialId:i.materialId,performedByMembershipId:i.membershipId,operationType:i.type,quantity:i.quantity,unitCost:cost,...(i.supplierId?{supplierId:i.supplierId}:{}),reason:i.reason.trim(),...(i.reference?{reference:i.reference}:{}),operationKey:i.operationKey}});await tx.stockMovement.create({data:{businessId:i.businessId,materialId:i.materialId,movementType:i.type==="MANUAL_RECEIPT"?"MANUAL_RECEIPT":"ADJUSTMENT_IN",quantity:i.quantity,inventoryOperationId:op.id,unitCostSnapshot:cost,reason:i.reason.trim(),referenceType:"INVENTORY_OPERATION",referenceId:op.id}});await tx.materialCostLayer.create({data:{businessId:i.businessId,materialId:i.materialId,sourceOperationId:op.id,sourceType:i.type,originalQty:i.quantity,remainingQty:i.quantity,unitCost:cost,status:"OPEN",receivedAt:new Date()}});return op;}
export async function receive(b:string,m:string,i:{materialId:string;quantity:string;unitId?:string;unitCost:string;reason:string;reference?:string;supplierId?:string;operationKey:string}){metadata(i.reason,i.operationKey);return prisma.$transaction(async tx=>{const old=await existing(tx,b,i.operationKey);if(old)return old;const q=await baseQuantity(tx,b,i.materialId,i.quantity,i.unitId);await lockMaterial(tx,b,i.materialId);if(i.supplierId&&!await tx.supplier.findFirst({where:{id:i.supplierId,businessId:b,isActive:true}}))throw new Error("Supplier not found for this business");return inbound(tx,{businessId:b,membershipId:m,materialId:i.materialId,quantity:q,unitCost:i.unitCost,reason:i.reason,...(i.reference?{reference:i.reference}:{}),operationKey:i.operationKey,type:"MANUAL_RECEIPT",...(i.supplierId?{supplierId:i.supplierId}:{})});},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
type Out="ISSUE"|"WASTE"|"ADJUSTMENT_OUT";
async function stockOut(tx:Tx,b:string,m:string,i:{materialId:string;quantity:string;unitId?:string;reason:string;reference?:string;operationKey:string;type:Out},membershipId:string){metadata(i.reason,i.operationKey);const old=await existing(tx,b,i.operationKey);if(old)return old;const q=await baseQuantity(tx,b,i.materialId,i.quantity,i.unitId),{balance}=await lockMaterial(tx,b,i.materialId);if(balance.lessThan(q))throw new Error("Insufficient available stock");const layers=await tx.materialCostLayer.findMany({where:{businessId:b,materialId:i.materialId,status:"OPEN",remainingQty:{gt:0}},orderBy:[{receivedAt:"asc"},{createdAt:"asc"},{id:"asc"}]});let left=q,cost=new D(0);const allocations:Array<{materialCostLayerId:string;allocatedQuantity:Prisma.Decimal;unitCostSnapshot:Prisma.Decimal}>=[];for(const layer of layers){if(left.isZero())break;const take=D.min(left,layer.remainingQty);const changed=await tx.materialCostLayer.updateMany({where:{id:layer.id,businessId:b,status:"OPEN",remainingQty:{gte:take}},data:{remainingQty:{decrement:take},...(layer.remainingQty.equals(take)?{status:"DEPLETED"}:{})}});if(changed.count!==1)throw new Error("FIFO layer changed concurrently; retry operation");allocations.push({materialCostLayerId:layer.id,allocatedQuantity:take,unitCostSnapshot:layer.unitCost});cost=cost.add(take.mul(layer.unitCost));left=left.sub(take);}if(!left.isZero())throw new Error("Insufficient FIFO layer stock");const operationType:InventoryOperationType=i.type;const op=await tx.inventoryOperation.create({data:{businessId:b,materialId:i.materialId,performedByMembershipId:membershipId,operationType,quantity:q,reason:i.reason.trim(),...(i.reference?{reference:i.reference}:{}),operationKey:i.operationKey}});await tx.inventoryCostAllocation.createMany({data:allocations.map(a=>({businessId:b,inventoryOperationId:op.id,...a}))});const movementType=i.type==="ISSUE"?"INVENTORY_ISSUE":i.type==="WASTE"?"INVENTORY_WASTE":"ADJUSTMENT_OUT";await tx.stockMovement.create({data:{businessId:b,materialId:i.materialId,movementType,quantity:q.negated(),inventoryOperationId:op.id,unitCostSnapshot:cost.div(q).toDecimalPlaces(2,D.ROUND_HALF_UP),reason:i.reason.trim(),referenceType:"INVENTORY_OPERATION",referenceId:op.id}});return op;}
export async function issue(b:string,membershipId:string,i:{materialId:string;quantity:string;unitId?:string;reason:string;reference?:string;operationKey:string}){return prisma.$transaction(tx=>stockOut(tx,b,membershipId,{...i,type:"ISSUE"},membershipId),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function waste(b:string,membershipId:string,i:{materialId:string;quantity:string;unitId?:string;reason:string;reference?:string;operationKey:string}){return prisma.$transaction(tx=>stockOut(tx,b,membershipId,{...i,type:"WASTE"},membershipId),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function adjustOut(b:string,membershipId:string,i:{materialId:string;quantity:string;unitId?:string;reason:string;reference?:string;operationKey:string}){return prisma.$transaction(tx=>stockOut(tx,b,membershipId,{...i,type:"ADJUSTMENT_OUT"},membershipId),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function adjustIn(b:string,membershipId:string,i:Parameters<typeof receive>[2]){metadata(i.reason,i.operationKey);return prisma.$transaction(async tx=>{const old=await existing(tx,b,i.operationKey);if(old)return old;const q=await baseQuantity(tx,b,i.materialId,i.quantity,i.unitId);await lockMaterial(tx,b,i.materialId);return inbound(tx,{businessId:b,membershipId,materialId:i.materialId,quantity:q,unitCost:i.unitCost,reason:i.reason,...(i.reference?{reference:i.reference}:{}),operationKey:i.operationKey,type:"ADJUSTMENT_IN"});},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function returnIssue(b:string,m:string,i:{issueOperationId:string;quantity:string;reason:string;reference?:string;operationKey:string}){metadata(i.reason,i.operationKey);const q=decimal(i.quantity,"Quantity",3);return prisma.$transaction(async tx=>{const dupe=await existing(tx,b,i.operationKey);if(dupe)return dupe;await tx.$queryRaw`SELECT "id" FROM "InventoryOperation" WHERE "id"=${i.issueOperationId} AND "businessId"=${b} FOR UPDATE`;const issue=await tx.inventoryOperation.findFirst({where:{id:i.issueOperationId,businessId:b,operationType:"ISSUE"}});if(!issue)throw new Error("Original inventory issue not found");await tx.$queryRaw`SELECT "id" FROM "InventoryCostAllocation" WHERE "inventoryOperationId"=${issue.id} ORDER BY "id" FOR UPDATE`;await lockMaterial(tx,b,issue.materialId);const allocations=await tx.inventoryCostAllocation.findMany({where:{businessId:b,inventoryOperationId:issue.id},orderBy:{createdAt:"asc"}});const returned=await tx.inventoryOperation.aggregate({where:{businessId:b,operationType:"RETURN",reversesOperationId:issue.id},_sum:{quantity:true}});if((returned._sum.quantity??new D(0)).add(q).greaterThan(issue.quantity))throw new Error("Return quantity exceeds unreturned issued quantity");let left=q;for(const a of allocations){if(left.isZero())break;const take=D.min(left,a.allocatedQuantity.sub(a.returnedQuantity));if(!take.greaterThan(0))continue;const changed=await tx.inventoryCostAllocation.updateMany({where:{id:a.id,returnedQuantity:{lte:a.allocatedQuantity.sub(take)}},data:{returnedQuantity:{increment:take}}});if(changed.count!==1)throw new Error("Return allocation changed concurrently; retry operation");await tx.materialCostLayer.update({where:{id:a.materialCostLayerId,businessId:b},data:{remainingQty:{increment:take},status:"OPEN"}});left=left.sub(take);}if(!left.isZero())throw new Error("Return exceeds original FIFO allocations");const op=await tx.inventoryOperation.create({data:{businessId:b,materialId:issue.materialId,performedByMembershipId:m,operationType:"RETURN",quantity:q,reason:i.reason.trim(),...(i.reference?{reference:i.reference}:{}),operationKey:i.operationKey,reversesOperationId:issue.id}});const value=allocations.reduce((s,a)=>s.add(a.allocatedQuantity.mul(a.unitCostSnapshot)),new D(0));await tx.stockMovement.create({data:{businessId:b,materialId:issue.materialId,movementType:"INVENTORY_RETURN",quantity:q,inventoryOperationId:op.id,unitCostSnapshot:value.div(issue.quantity).toDecimalPlaces(2,D.ROUND_HALF_UP),reason:i.reason.trim(),referenceType:"INVENTORY_OPERATION",referenceId:op.id}});return op;},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
export async function createConversion(b:string,i:{fromUnitId:string;toUnitId:string;factor:string}){if(i.fromUnitId===i.toUnitId)throw new Error("Conversion units must be different");const factor=decimal(i.factor,"Conversion factor",9);return prisma.$transaction(async tx=>{const units=await tx.unitOfMeasure.findMany({where:{businessId:b,id:{in:[i.fromUnitId,i.toUnitId]}},select:{id:true}});if(units.length!==2)throw new Error("Both units must belong to this business");return tx.unitConversion.create({data:{businessId:b,...i,factor}});});}
export async function listConversions(b:string){return prisma.unitConversion.findMany({where:{businessId:b},include:{fromUnit:true,toUnit:true},orderBy:{createdAt:"desc"}});}
export async function listOperations(b:string,materialId?:string){return prisma.inventoryOperation.findMany({where:{businessId:b,...(materialId?{materialId}:{})},include:{material:{include:{unit:true}},movement:true,allocations:{include:{materialCostLayer:true}},performedBy:{select:{id:true,role:true}}},orderBy:{createdAt:"desc"},take:300});}

export async function balances(b:string){const materials=await prisma.material.findMany({where:{businessId:b,isActive:true},include:{unit:true},orderBy:{name:"asc"}});return Promise.all(materials.map(async m=>{const[mv,ls]=await Promise.all([prisma.stockMovement.aggregate({where:{businessId:b,materialId:m.id},_sum:{quantity:true}}),prisma.materialCostLayer.findMany({where:{businessId:b,materialId:m.id,status:"OPEN"},select:{remainingQty:true,unitCost:true}})]);const movement=mv._sum.quantity??new D(0),layerQty=ls.reduce((s,l)=>s.add(l.remainingQty),new D(0)),value=ls.reduce((s,l)=>s.add(l.remainingQty.mul(l.unitCost)),new D(0));return{material:m,stockBalance:movement,fifoQuantity:layerQty,inventoryValue:value,isConsistent:movement.equals(layerQty)}}));}
