import { calcStock } from "../utils/records.js";
import { getProviderClient } from "../../integrations/providers/index.js";

const DEFAULT_POLICY = {
  mode: "NORMAL",
  buffer: 1,
  minVisible: 1,
  exclusiveProvider: null,
};

function clampNonNegative(value) {
  return value < 0 ? 0 : value;
}

function computeVisibleNormal(centralStock, buffer, minVisible) {
  if (centralStock <= 0) return 0;
  const visible = Math.max(minVisible, centralStock - buffer);
  return clampNonNegative(visible);
}

function computeVisibleExclusive(centralStock) {
  return centralStock <= 0 ? 0 : centralStock;
}

async function getCentralStock({ prisma, userId, itemId }) {
  return calcStock(prisma, userId, itemId);
}

async function computeTargetQuantities({ prisma, userId, itemId }) {
  const [listings, policyRaw, centralStock] = await Promise.all([
    prisma.channelListing.findMany({
      where: { userId, itemId, isActive: true },
      orderBy: [{ id: "asc" }],
    }),
    prisma.itemInventoryPolicy.findUnique({ where: { itemId } }),
    getCentralStock({ prisma, userId, itemId }),
  ]);

  const policy = policyRaw || DEFAULT_POLICY;
  const mode = policy.mode || DEFAULT_POLICY.mode;
  const buffer = Number.isFinite(policy.buffer) ? policy.buffer : DEFAULT_POLICY.buffer;
  const minVisible = Number.isFinite(policy.minVisible)
    ? policy.minVisible
    : DEFAULT_POLICY.minVisible;

  return listings.map((listing) => {
    let targetQty = 0;

    if (mode === "EXCLUSIVE" && policy.exclusiveProvider) {
      if (listing.provider === policy.exclusiveProvider) {
        targetQty = computeVisibleExclusive(centralStock);
      } else {
        targetQty = 0;
      }
    } else {
      targetQty = computeVisibleNormal(centralStock, buffer, minVisible);
    }

    return {
      provider: listing.provider,
      listingId: listing.id,
      targetQty,
    };
  });
}

async function enqueueInventorySync({ prisma, userId, itemId, targets }) {
  let enqueued = 0;
  const now = new Date();

  for (const target of targets) {
    await prisma.inventorySyncJob.upsert({
      where: {
        userId_provider_itemId: {
          userId,
          provider: target.provider,
          itemId,
        },
      },
      create: {
        userId,
        provider: target.provider,
        itemId,
        listingId: target.listingId,
        targetQty: target.targetQty,
        status: "PENDING",
        attempts: 0,
        nextRunAt: now,
      },
      update: {
        listingId: target.listingId,
        targetQty: target.targetQty,
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextRunAt: now,
        lockedAt: null,
      },
    });
    enqueued += 1;
  }

  return { enqueued };
}

function computeBackoffMinutes(attempts) {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  if (attempts === 3) return 15;
  if (attempts === 4) return 30;
  return 60;
}

async function runInventorySyncJobs({ prisma, userId, limit = 20 }) {
  const now = new Date();
  const jobs = await prisma.inventorySyncJob.findMany({
    where: {
      userId,
      status: "PENDING",
      nextRunAt: { lte: now },
      lockedAt: null,
    },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: limit,
    include: { listing: true, item: true },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const locked = await prisma.inventorySyncJob.updateMany({
      where: {
        id: job.id,
        status: "PENDING",
        lockedAt: null,
      },
      data: {
        status: "RUNNING",
        lockedAt: new Date(),
      },
    });
    if (locked.count === 0) continue;

    processed += 1;

    try {
      if (!job.listing) {
        throw new Error("listing missing");
      }

      const client = getProviderClient(job.provider);
      const result = await client.updateStock({
        listing: job.listing,
        targetQty: job.targetQty,
      });

      if (!result?.ok) {
        throw new Error(result?.message || "provider update failed");
      }

      await prisma.inventorySyncJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          lockedAt: null,
          lastError: null,
        },
      });
      succeeded += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const delayMinutes = computeBackoffMinutes(attempts);
      const nextRunAt = new Date(Date.now() + delayMinutes * 60 * 1000);
      const terminal = attempts >= 5;

      await prisma.inventorySyncJob.update({
        where: { id: job.id },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          attempts,
          lastError: String(error?.message || error),
          nextRunAt,
          lockedAt: null,
        },
      });
      failed += 1;
    }
  }

  return { processed, succeeded, failed };
}

export {
  getCentralStock,
  computeTargetQuantities,
  enqueueInventorySync,
  runInventorySyncJobs,
};
