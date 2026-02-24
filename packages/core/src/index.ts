import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { PrismaClient, PackagingProfile, DealDecision, AlertChannel, AlertStatus, OracleMode } from '@prisma/client';

export type MarketplaceListing = {
  itemId: string;
  legacyItemId?: string;
  title: string;
  itemWebUrl: string;
  price: number;
  shippingCost?: number;
  freeShipping?: boolean;
  condition?: string;
  conditionId?: string;
  epid?: string;
  seller?: string;
};

const envSchema = z.object({
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),
  EBAY_MARKETPLACE_ID: z.string().default('EBAY_US'),
  EBAY_DELIVERY_COUNTRY: z.string().default('US'),
  EBAY_DELIVERY_POSTAL_CODE: z.string().default('10001'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DB_PATH: z.string().default('./data/dev.sqlite'),
  DATABASE_URL: z.string().optional(),
  MOCK_EBAY_MODE: z.string().optional()
});

const runtimeSchema = z.object({
  scanIntervals: z.object({ huntMs: z.number(), scanMs: z.number() }),
  thresholds: z.object({ minProfit: z.number(), minRoi: z.number(), maxRiskScore: z.number() }),
  feeModel: z.object({ sellFeeRate: z.number(), sellFeeFixed: z.number() }),
  shippingEstByProfile: z.object({ SMALL: z.number(), MEDIUM: z.number() }),
  packagingCostByProfile: z.object({ SMALL: z.number(), MEDIUM: z.number() }),
  oracle: z.object({ sampleSize: z.number(), iqrMultiplier: z.number(), discountBuffer: z.number() }),
  filters: z.object({ requireFixedPrice: z.boolean(), requireUsItemLocation: z.boolean(), optionalFreeShippingOnly: z.boolean() }),
  keywords: z.object({ hardReject: z.array(z.string()), softRisk: z.array(z.string()) }),
  dryRun: z.boolean(),
  debugRawResponses: z.boolean()
});

export type AppConfig = ReturnType<typeof loadConfig>;


function findRepoRoot(start = process.cwd()) {
  let current = start;
  while (true) {
    const candidate = path.join(current, 'config', 'runtime.json');
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

export function loadConfig() {
  const env = envSchema.parse(process.env);
  const repoRoot = findRepoRoot();
  const runtime = runtimeSchema.parse(JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/runtime.json'), 'utf-8')));
  const seeds = YAML.parse(fs.readFileSync(path.join(repoRoot, 'config/seeds.yaml'), 'utf-8')) as Record<string, string[]>;
  const databaseUrl = env.DATABASE_URL ?? `file:${env.DB_PATH}`;
  process.env.DATABASE_URL = databaseUrl;
  const mockEbayMode = env.MOCK_EBAY_MODE === '1' || !env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET;
  return { env: { ...env, EBAY_CLIENT_ID: env.EBAY_CLIENT_ID ?? '', EBAY_CLIENT_SECRET: env.EBAY_CLIENT_SECRET ?? '' }, runtime, seeds, databaseUrl, mockEbayMode, repoRoot };
}

let prismaSingleton: PrismaClient | null = null;
export function dbClient() {
  if (!prismaSingleton) prismaSingleton = new PrismaClient();
  return prismaSingleton;
}

export function normalizeTitle(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function hasKeyword(title: string, keywords: string[]) {
  const n = normalizeTitle(title);
  return keywords.find((k) => n.includes(normalizeTitle(k)));
}

export function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export function filterIqr(values: number[], mult = 1.5) {
  if (values.length < 4) return values;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const low = q1 - mult * iqr;
  const high = q3 + mult * iqr;
  return values.filter((v) => v >= low && v <= high);
}

export function computeOracle(listings: MarketplaceListing[], cfg: AppConfig['runtime']) {
  const filtered = listings.filter((l) => !hasKeyword(l.title, cfg.keywords.hardReject));
  const totals = filterIqr(filtered.map((l) => l.price + (l.shippingCost ?? (l.freeShipping ? 0 : 9.99))), cfg.oracle.iqrMultiplier);
  const shipping = filtered.map((l) => l.shippingCost ?? (l.freeShipping ? 0 : 9.99));
  const median = quantile(totals, 0.5);
  const p25 = quantile(totals, 0.25);
  const p75 = quantile(totals, 0.75);
  return {
    medianTotalCost: median,
    p25TotalCost: p25,
    p75TotalCost: p75,
    medianShipping: quantile(shipping, 0.5),
    sampleSize: totals.length,
    listingDepth: listings.length,
    volatilityRatio: median ? (p75 - p25) / median : 1
  };
}

export function computeDealScore(args: {
  purchaseTotal: number;
  resaleEstimate: number;
  packagingProfile: PackagingProfile;
  baseRisk: number;
  title: string;
  config: AppConfig['runtime'];
  liquidityProxy: number;
  shippingUnknown?: boolean;
}) {
  const { config } = args;
  const sellFees = args.resaleEstimate * config.feeModel.sellFeeRate + config.feeModel.sellFeeFixed;
  const shipping = config.shippingEstByProfile[args.packagingProfile];
  const packaging = config.packagingCostByProfile[args.packagingProfile];
  const softRiskHits = config.keywords.softRisk.filter((k) => normalizeTitle(args.title).includes(normalizeTitle(k)));
  const riskScore = Math.min(1, args.baseRisk + softRiskHits.length * 0.1 + (args.shippingUnknown ? 0.1 : 0));
  const riskBuffer = Math.max(3, args.resaleEstimate * 0.08) + softRiskHits.length;
  const expectedNet = args.resaleEstimate - sellFees - shipping - packaging - riskBuffer;
  const profit = expectedNet - args.purchaseTotal;
  const roi = args.purchaseTotal ? profit / args.purchaseTotal : -1;
  const score = roi * 100 + profit + args.liquidityProxy * 10 - riskScore * 20 - (args.shippingUnknown ? 3 : 0);
  const decision =
    profit >= config.thresholds.minProfit && roi >= config.thresholds.minRoi && riskScore <= config.thresholds.maxRiskScore
      ? DealDecision.ALERT
      : DealDecision.IGNORE;
  return { expectedNet, profit, roi, score, riskScore, riskFlags: softRiskHits, decision };
}

export async function upsertSkuFromGroup(group: { canonicalName: string; category: string; epid?: string; clusterKey?: string }) {
  const db = dbClient();
  return db.sku.upsert({
    where: group.epid ? { epid: group.epid } : { clusterKey: group.clusterKey! },
    create: {
      canonicalName: group.canonicalName,
      category: group.category,
      epid: group.epid,
      clusterKey: group.clusterKey,
      synonymsJson: JSON.stringify([]),
      conditionPolicyJson: JSON.stringify(['1000', '1500', '3000']),
      packagingProfile: PackagingProfile.SMALL,
      baseRisk: 0.2,
      testChecklistJson: JSON.stringify(['Power on', 'Basic function test'])
    },
    update: { canonicalName: group.canonicalName, category: group.category }
  });
}

export async function createHuntRun(seedText: string) {
  return dbClient().huntRun.create({ data: { startedAt: new Date(), seedConfigHash: createHash('sha256').update(seedText).digest('hex') } });
}

export async function finishHuntRun(id: string) {
  return dbClient().huntRun.update({ where: { id }, data: { finishedAt: new Date() } });
}

export async function persistOracle(skuId: string, stats: ReturnType<typeof computeOracle>) {
  return dbClient().oracleSnapshot.create({ data: { skuId, mode: OracleMode.ACTIVE_LISTING_DERIVED, ...stats } });
}

export async function persistHuntItem(input: { huntRunId: string; skuId: string; rank: number; huntScore: number; scanQuery: string; scanFiltersJson: string }) {
  return dbClient().huntListItem.create({ data: input });
}

export async function findLatestHuntItems() {
  const run = await dbClient().huntRun.findFirst({ orderBy: { startedAt: 'desc' } });
  if (!run) return [];
  return dbClient().huntListItem.findMany({ where: { huntRunId: run.id }, include: { sku: true }, orderBy: { rank: 'asc' } });
}

export async function recordListingSeen(skuId: string, listing: MarketplaceListing, purchaseTotal: number, shippingUnknown: boolean) {
  const now = new Date();
  return dbClient().listingSeen.upsert({
    where: { skuId_ebayItemId: { skuId, ebayItemId: listing.itemId } },
    create: {
      skuId,
      ebayItemId: listing.itemId,
      legacyItemId: listing.legacyItemId,
      title: listing.title,
      itemPrice: listing.price,
      buyerShipping: shippingUnknown ? null : (listing.shippingCost ?? 0),
      purchaseTotal,
      condition: listing.condition,
      epid: listing.epid,
      url: listing.itemWebUrl,
      sellerMetaJson: JSON.stringify({ seller: listing.seller }),
      firstSeenAt: now,
      lastSeenAt: now
    },
    update: { lastSeenAt: now, purchaseTotal }
  });
}

export async function persistDealScore(
  listingSeenId: string,
  oracleSnapshotId: string,
  score: ReturnType<typeof computeDealScore>,
  resaleEstimate: number,
  liquidityProxy: number
) {
  return dbClient().dealScore.create({
    data: {
      listingSeenId,
      oracleSnapshotId,
      resaleEstimate,
      expectedNet: score.expectedNet,
      profit: score.profit,
      roi: score.roi,
      riskFlagsJson: JSON.stringify(score.riskFlags),
      riskScore: score.riskScore,
      liquidityProxy,
      score: score.score,
      decision: score.decision
    }
  });
}

export async function hasAlertForListing(listingSeenId: string) {
  return (await dbClient().alert.count({ where: { listingSeenId } })) > 0;
}

export async function persistAlert(listingSeenId: string, channel: AlertChannel, snapshot: unknown) {
  return dbClient().alert.create({ data: { listingSeenId, channel, snapshotJson: JSON.stringify(snapshot), status: AlertStatus.SENT } });
}
