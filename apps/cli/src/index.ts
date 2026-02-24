import 'dotenv/config';
import { loadConfig, createHuntRun, finishHuntRun, upsertSkuFromGroup, computeOracle, persistOracle, persistHuntItem, findLatestHuntItems, hasKeyword, recordListingSeen, computeDealScore, persistDealScore, hasAlertForListing, persistAlert } from '@packages/core';
import { buildSearchQuery, searchListings } from '@packages/ebay';
import { sendConsole, sendTelegram } from '@packages/notifiers';
import { AlertChannel } from '@prisma/client';
import { logger } from '@packages/utils';

const config = loadConfig();

async function runHunt() {
  const seedText = JSON.stringify(config.seeds);
  const run = await createHuntRun(seedText);
  let rank = 1;
  const rows: Array<{name:string;median:number;vol:number;count:number;score:number}> = [];
  for (const [category, queries] of Object.entries(config.seeds)) {
    for (const q of queries) {
      const query = buildSearchQuery({ q, sort: 'price', postalCode: config.env.EBAY_DELIVERY_POSTAL_CODE, country: config.env.EBAY_DELIVERY_COUNTRY, limit: 50, freeShippingOnly: config.runtime.filters.optionalFreeShippingOnly, priceMin: 25, priceMax: 150 });
      const listings = await searchListings(config, query);
      const grouped = new Map<string, typeof listings>();
      for (const l of listings) {
        const key = l.epid ?? `${category}:${l.title.toLowerCase().split(' ').slice(0,4).join('_')}`;
        const arr = grouped.get(key) ?? [];
        arr.push(l);
        grouped.set(key, arr);
      }
      for (const [key, group] of grouped.entries()) {
        if (group.length < 5) continue;
        const oracle = computeOracle(group, config.runtime);
        if (oracle.medianTotalCost < 25 || oracle.medianTotalCost > 150 || oracle.volatilityRatio > 0.35) continue;
        const riskRate = group.filter((g) => hasKeyword(g.title, config.runtime.keywords.hardReject)).length / group.length;
        if (riskRate > 0.15) continue;
        const huntScore = group.length * 0.5 + (1 - oracle.volatilityRatio) * 30 + (1 - riskRate) * 20 - oracle.medianTotalCost * 0.03;
        const sku = await upsertSkuFromGroup({ canonicalName: group[0].title.slice(0, 80), category, epid: group[0].epid, clusterKey: key });
        await persistOracle(sku.id, oracle);
        await persistHuntItem({ huntRunId: run.id, skuId: sku.id, rank: rank++, huntScore, scanQuery: group[0].epid ?? q, scanFiltersJson: JSON.stringify({ buyingOptions: 'FIXED_PRICE', itemLocationCountry: 'US' }) });
        rows.push({ name: sku.canonicalName, median: oracle.medianTotalCost, vol: oracle.volatilityRatio, count: group.length, score: huntScore });
      }
    }
  }
  await finishHuntRun(run.id);
  rows.sort((a,b)=>b.score-a.score);
  console.log('Top SKUs');
  rows.slice(0,20).forEach((r,i)=>console.log(`${i+1}. ${r.name} | median $${r.median.toFixed(2)} | vol ${r.vol.toFixed(2)} | listings ${r.count} | score ${r.score.toFixed(2)}`));
}

async function runScan() {
  const huntItems = await findLatestHuntItems();
  let listingsScored = 0, alertsSent = 0, listingsFetched = 0;
  for (const item of huntItems) {
    const query = buildSearchQuery({ epid: item.sku.epid ?? undefined, q: item.sku.epid ? undefined : item.scanQuery, sort: 'newlyListed', postalCode: config.env.EBAY_DELIVERY_POSTAL_CODE, country: config.env.EBAY_DELIVERY_COUNTRY, limit: 50, freeShippingOnly: config.runtime.filters.optionalFreeShippingOnly, priceMin: 25, priceMax: 150 });
    const listings = await searchListings(config, query);
    listingsFetched += listings.length;
    const oracle = await (await import('@packages/core')).dbClient().oracleSnapshot.findFirst({ where: { skuId: item.skuId }, orderBy: { updatedAt: 'desc' } });
    if (!oracle) continue;
    for (const l of listings) {
      if (hasKeyword(l.title, config.runtime.keywords.hardReject)) continue;
      const shippingUnknown = l.shippingCost === undefined && !l.freeShipping;
      const purchaseTotal = l.price + (l.shippingCost ?? (l.freeShipping ? 0 : 12));
      if (purchaseTotal < 25 || purchaseTotal > 150) continue;
      const listingSeen = await recordListingSeen(item.skuId, l, purchaseTotal, shippingUnknown);
      const score = computeDealScore({ purchaseTotal, resaleEstimate: oracle.p25TotalCost, packagingProfile: item.sku.packagingProfile, baseRisk: item.sku.baseRisk, title: l.title, config: config.runtime, liquidityProxy: Math.min(1, huntItems.length / 20), shippingUnknown });
      listingsScored++;
      await persistDealScore(listingSeen.id, oracle.id, score, oracle.p25TotalCost, Math.min(1, huntItems.length / 20));
      if (score.decision === 'ALERT' && !(await hasAlertForListing(listingSeen.id)) && !config.runtime.dryRun) {
        const msg = `[ALERT] ${item.sku.canonicalName}\nPurchase total: $${purchaseTotal.toFixed(2)}\nResale estimate (oracle p25): $${oracle.p25TotalCost.toFixed(2)}\nExpected net: $${score.expectedNet.toFixed(2)}\nProfit: $${score.profit.toFixed(2)}\nROI: ${(score.roi * 100).toFixed(1)}%\nRisk flags: ${score.riskFlags.join(', ') || 'none'}\nLink: ${l.itemWebUrl}\nNext step: Buy now if still available`;
        await persistAlert(listingSeen.id, AlertChannel.CONSOLE, { purchaseTotal, oracle, score, listing: l });
        await sendConsole(msg);
        await sendTelegram(config, msg);
        alertsSent++;
      }
    }
  }
  logger.info({ listings_fetched: listingsFetched, listings_scored: listingsScored, alerts_sent: alertsSent, api_errors: 0, rate_limited_events: 0 }, 'scan complete');
}

const cmd = process.argv[2];
if (cmd === 'hunt:run') runHunt();
else if (cmd === 'scan:run') runScan();
else console.error('Usage: hunt:run | scan:run');
