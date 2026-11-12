import { prisma } from "../../database/prisma.js";

export function getUnits(businessId: string) {
  return prisma.unitOfMeasure.findMany({
    where: { businessId },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
}
