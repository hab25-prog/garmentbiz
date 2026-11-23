import { prisma } from "../../database/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";

export const DEFAULT_MEASUREMENT_UNITS = [
  { name: "Meter", code: "m" },
  { name: "Centimeter", code: "cm" },
  { name: "Kilogram", code: "kg" },
  { name: "Gram", code: "g" },
  { name: "Piece", code: "pcs" },
  { name: "Roll", code: "roll" },
  { name: "Cone", code: "cone" },
  { name: "Spool", code: "spool" },
  { name: "Liter", code: "L" },
] as const;

export async function ensureDefaultUnits(
  client: Prisma.TransactionClient,
  businessId: string,
): Promise<{ addedCount: number; alreadyExistedCount: number }> {
  const existingUnits = await client.unitOfMeasure.findMany({
    where: { businessId },
    select: { name: true, code: true },
  });
  const existingNames = new Set(existingUnits.map((unit) => unit.name.trim().toLocaleLowerCase()));
  const existingCodes = new Set(existingUnits.map((unit) => unit.code.trim().toLocaleLowerCase()));
  const missingUnits = DEFAULT_MEASUREMENT_UNITS.filter((unit) =>
    !existingNames.has(unit.name.toLocaleLowerCase()) &&
    !existingCodes.has(unit.code.toLocaleLowerCase()),
  );

  if (missingUnits.length === 0) {
    return { addedCount: 0, alreadyExistedCount: DEFAULT_MEASUREMENT_UNITS.length };
  }

  const result = await client.unitOfMeasure.createMany({
    data: missingUnits.map((unit) => ({ ...unit, businessId })),
    skipDuplicates: true,
  });
  return {
    addedCount: result.count,
    alreadyExistedCount: DEFAULT_MEASUREMENT_UNITS.length - result.count,
  };
}

export function initializeDefaultUnits(businessId: string) {
  return prisma.$transaction((transaction) => ensureDefaultUnits(transaction, businessId));
}

export function getUnits(businessId: string) {
  return prisma.unitOfMeasure.findMany({
    where: { businessId },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
}

export async function createUnit(businessId: string, input: { name: string; code: string }) {
  const name = input.name.trim();
  const code = input.code.trim().toLowerCase();
  const duplicate = await prisma.unitOfMeasure.findFirst({
    where: {
      businessId,
      OR: [
        { name: { equals: name, mode: "insensitive" } },
        { code: { equals: code, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (duplicate) throw new Error("A unit with this name or abbreviation already exists");

  return prisma.unitOfMeasure.create({
    data: { businessId, name, code },
    select: { id: true, name: true, code: true },
  });
}
