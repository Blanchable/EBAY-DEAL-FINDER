import { request } from 'undici';
import { createTokenBucket, withRetry } from '@packages/utils';
import type { AppConfig, MarketplaceListing } from '@packages/core';

let cachedToken: { token: string; exp: number } | null = null;
const bucket = createTokenBucket(4, 1000);

function mockListings(query: string): MarketplaceListing[] {
  const base = query.includes('ti') ? 'TI-84 Plus CE' : query.includes('xbox') ? 'Xbox Wireless Controller' : 'Apple Pencil 2nd Gen';
  return Array.from({ length: 35 }).map((_, i) => ({
    itemId: `MOCK-${base.replace(/\s+/g, '-')}-${i + 1}`,
    legacyItemId: `L${i + 1}`,
    title: `${base} used tested ${i % 9 === 0 ? 'scratch' : ''}`.trim(),
    itemWebUrl: `https://example.com/mock/${i + 1}`,
    price: 40 + (i % 12) * 3,
    shippingCost: i % 3 === 0 ? 0 : 6,
    freeShipping: i % 3 === 0,
    condition: 'Used',
    conditionId: '3000',
    epid: `${100000 + Math.floor(i / 10)}`,
    seller: 'mock_seller'
  }));
}

export async function getAppToken(config: AppConfig) {
  if (config.mockEbayMode) return 'mock-token';
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }).toString();
  const auth = Buffer.from(`${config.env.EBAY_CLIENT_ID}:${config.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await request('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = (await res.body.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.token;
}

export function buildSearchQuery(params: {
  q?: string;
  epid?: string;
  limit?: number;
  offset?: number;
  sort?: 'newlyListed' | 'price';
  freeShippingOnly?: boolean;
  priceMin?: number;
  priceMax?: number;
  postalCode: string;
  country: string;
}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.epid) qs.set('epid', params.epid);
  qs.set('limit', String(params.limit ?? 50));
  qs.set('offset', String(params.offset ?? 0));
  if (params.sort) qs.set('sort', params.sort);
  const filter = [`buyingOptions:{FIXED_PRICE}`, `deliveryPostalCode:${params.postalCode}`, `deliveryCountry:${params.country}`, `itemLocationCountry:US`];
  if (params.freeShippingOnly) filter.push('maxDeliveryCost:0');
  if (params.priceMin !== undefined || params.priceMax !== undefined) filter.push(`price:[${params.priceMin ?? 0}..${params.priceMax ?? 999999}]`);
  qs.set('filter', filter.join(','));
  return qs.toString();
}

export async function searchListings(config: AppConfig, query: string): Promise<MarketplaceListing[]> {
  if (config.mockEbayMode) return mockListings(query);
  await bucket.take();
  const token = await getAppToken(config);
  const res = await withRetry(async () => {
    const r = await request(`https://api.ebay.com/buy/browse/v1/item_summary/search?${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': config.env.EBAY_MARKETPLACE_ID,
        'X-EBAY-C-ENDUSERCTX': `contextualLocation=${config.env.EBAY_DELIVERY_POSTAL_CODE}`
      }
    });
    if (r.statusCode >= 500 || r.statusCode === 429) throw new Error(`retry ${r.statusCode}`);
    return r;
  });
  const json = (await res.body.json()) as { itemSummaries?: Array<Record<string, any>> };
  return (json.itemSummaries ?? []).map((it) => ({
    itemId: it.itemId,
    legacyItemId: it.legacyItemId,
    title: it.title,
    itemWebUrl: it.itemWebUrl,
    price: Number(it.price?.value ?? 0),
    shippingCost: it.shippingOptions?.[0]?.shippingCost?.value ? Number(it.shippingOptions?.[0]?.shippingCost?.value) : undefined,
    freeShipping: it.shippingOptions?.[0]?.shippingCost?.value === '0.0',
    condition: it.condition,
    conditionId: it.conditionId,
    epid: it.epid,
    seller: it.seller?.username
  }));
}
