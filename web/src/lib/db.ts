import { PrismaClient } from "@prisma/client";

// В dev горячая перезагрузка пересоздаёт модули, поэтому клиент держим в globalThis.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
