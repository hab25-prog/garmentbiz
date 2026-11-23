import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../database/prisma.js";

interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice?: string | number;
  description?: string;
}

export interface CreateOrderInput {
  businessId: string;
  customerId: string;
  orderDate?: string;
  dueDate?: string;
  notes?: string;
  items: CreateOrderItemInput[];
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function isValidMoney(value: string | number): boolean {
  const text = String(value);

  return (
    /^\d+(\.\d{1,2})?$/.test(text) &&
    Number.isFinite(Number(text)) &&
    Number(text) >= 0
  );
}

function getOrderNumber(date: Date, sequence: number): string {
  const year = date.getUTCFullYear();
  return `ORD-${year}-${String(sequence).padStart(4, "0")}`;
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.items || input.items.length === 0) {
    throw new Error("An order must contain at least one item");
  }

  if (!input.customerId?.trim()) {
    throw new Error("Customer is required");
  }

  if (input.items.length > 100) {
    throw new Error("An order cannot contain more than 100 items");
  }

  const orderDate = input.orderDate ? new Date(input.orderDate) : new Date();

  if (input.orderDate && !isValidDate(input.orderDate)) {
    throw new Error("Invalid order date");
  }

  let dueDate: Date | undefined;

  if (input.dueDate) {
    if (!isValidDate(input.dueDate)) {
      throw new Error("Invalid due date");
    }

    dueDate = new Date(input.dueDate);

    if (dueDate < orderDate) {
      throw new Error("Due date cannot be before the order date");
    }
  }

  const productIds = input.items.map((item) => item.productId);

  if (productIds.some((id) => !id?.trim())) {
    throw new Error("Every order item must have a product");
  }

  if (new Set(productIds).size !== productIds.length) {
    throw new Error("A product can only appear once in an order");
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Item quantities must be positive whole numbers");
    }

    if (item.unitPrice !== undefined && !isValidMoney(item.unitPrice)) {
      throw new Error(
        "Unit prices must be valid non-negative amounts with up to 2 decimal places",
      );
    }
  }

  const items = input.items;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const customer = await tx.customer.findFirst({
            where: {
              id: input.customerId,
              businessId: input.businessId,
              isActive: true,
            },
            select: { id: true },
          });

          if (!customer) {
            throw new Error("Customer not found or inactive");
          }

          const products = await tx.product.findMany({
            where: {
              id: { in: productIds },
              businessId: input.businessId,
              isActive: true,
            },
            select: {
              id: true,
              basePrice: true,
            },
          });

          if (products.length !== productIds.length) {
            throw new Error(
              "One or more products were not found or are inactive",
            );
          }

          const productMap = new Map(
            products.map((product) => [product.id, product]),
          );

          const orderItems = items.map((item) => {
            const product = productMap.get(item.productId);

            if (!product) {
              throw new Error("Product not found");
            }

            const unitPrice =
              item.unitPrice !== undefined
                ? new Prisma.Decimal(item.unitPrice)
                : product.basePrice;

            if (unitPrice === null) {
              throw new Error(
                `A unit price is required for product ${item.productId}`,
              );
            }

            const lineTotal = unitPrice.mul(item.quantity);

            return {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice,
              lineTotal,
              ...(item.description !== undefined
                ? { description: item.description.trim() }
                : {}),
            };
          });

          const totalAmount = orderItems.reduce(
            (total, item) => total.add(item.lineTotal),
            new Prisma.Decimal(0),
          );

          // Lock this business row so concurrent order creation
          // for the same business receives a safe sequence.
          await tx.$queryRaw`
            SELECT "id"
            FROM "Business"
            WHERE "id" = ${input.businessId}
            FOR UPDATE
          `;

          const yearPrefix = `ORD-${orderDate.getUTCFullYear()}-`;

          const yearlyOrders = await tx.customerOrder.findMany({
            where: {
              businessId: input.businessId,
              orderNo: { startsWith: yearPrefix },
            },
            select: { orderNo: true },
          });

          const lastSequence = yearlyOrders.reduce((highest, order) => {
            const sequence = Number(order.orderNo.slice(yearPrefix.length));

            return Number.isSafeInteger(sequence) && sequence > highest
              ? sequence
              : highest;
          }, 0);

          if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
            throw new Error("Could not generate the next order number");
          }

          const orderNo = getOrderNumber(orderDate, lastSequence + 1);

          return tx.customerOrder.create({
            data: {
              businessId: input.businessId,
              customerId: input.customerId,
              orderNo,
              orderDate,
              ...(dueDate ? { dueDate } : {}),
              ...(input.notes !== undefined
                ? { notes: input.notes.trim() }
                : {}),
              totalAmount,
              items: {
                create: orderItems,
              },
            },
            include: {
              customer: true,
              items: {
                include: {
                  product: true,
                },
              },
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 20000,
        },
      );
    } catch (error) {
      if (attempt < 3 && isRetryableTransactionError(error)) {
        continue;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error(
          "Could not generate a unique order number. Please try again.",
        );
      }

      throw error;
    }
  }

  throw new Error("Could not create order. Please try again.");
}

export async function getOrders(businessId: string) {
  return prisma.customerOrder.findMany({
    where: { businessId },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      orderDate: "desc",
    },
  });
}

export async function getOrderById(businessId: string, orderId: string) {
  return prisma.customerOrder.findFirst({
    where: {
      id: orderId,
      businessId,
    },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
      batches: true,
    },
  });
}

const allowedOrderTransitions: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED"],
  COMPLETED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export async function updateOrderStatus(
  businessId: string,
  orderId: string,
  newStatus: string,
) {
  const allowedStatuses = Object.keys(allowedOrderTransitions);

  if (!allowedStatuses.includes(newStatus)) {
    throw new Error("Invalid order status");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: {
        id: orderId,
        businessId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const allowedNextStatuses = allowedOrderTransitions[order.status];

    if (!allowedNextStatuses?.includes(newStatus)) {
      throw new Error(
        `Cannot change order status from ${order.status} to ${newStatus}`,
      );
    }

    if (newStatus === "IN_PRODUCTION") {
      const batchCount = await tx.productionBatch.count({
        where: {
          orderId,
          businessId,
        },
      });

      if (batchCount === 0) {
        throw new Error(
          "At least one production batch is required before starting production",
        );
      }
    }

    const updated = await tx.customerOrder.updateMany({
      where: {
        id: orderId,
        businessId,
        status: order.status,
      },
      data: {
        status: newStatus as never,
      },
    });

    if (updated.count !== 1) {
      throw new Error(
        "Order status changed concurrently. Please reload and try again.",
      );
    }

    return tx.customerOrder.findFirst({
      where: {
        id: orderId,
        businessId,
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
        batches: true,
      },
    });
  });
}
