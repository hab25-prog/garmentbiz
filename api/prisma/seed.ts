import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";

const prisma = new PrismaClient();

async function main() {
  const businessName = "GarmentBiz Demo Workshop";

  let business = await prisma.business.findFirst({
    where: { name: businessName },
  });

  if (!business) {
    business = await prisma.business.create({
      data: {
        name: businessName,
        currency: "ETB",
        timezone: "Africa/Addis_Ababa",
      },
    });
  }

  const units = [
    { name: "Meter", code: "m" },
    { name: "Kilogram", code: "kg" },
    { name: "Piece", code: "pcs" },
    { name: "Roll", code: "roll" },
    { name: "Bundle", code: "bundle" },
  ];

  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({
      where: {
        businessId_code: {
          businessId: business.id,
          code: unit.code,
        },
      },
      update: {},
      create: {
        businessId: business.id,
        name: unit.name,
        code: unit.code,
      },
    });
  }

  console.log("Demo business initialized:", business.name);
  console.log("Measurement units initialized:", units.length);
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
