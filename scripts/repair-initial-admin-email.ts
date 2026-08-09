import "dotenv/config";
import * as z from "zod";
import { prisma } from "../src/lib/prisma";
import { repairInitialAdminEmail } from "../src/lib/security/bootstrap-admin";

const email = process.env.REPAIR_ADMIN_EMAIL?.trim().toLowerCase();

if (!email || !z.email().max(254).safeParse(email).success) {
  throw new Error("REPAIR_ADMIN_EMAIL must be a valid email address.");
}

await repairInitialAdminEmail(prisma, { email });

console.info("Repaired the initial HFLive Auth administrator email.");
await prisma.$disconnect();
