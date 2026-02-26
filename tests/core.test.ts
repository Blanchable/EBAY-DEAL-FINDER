import { describe, it, expect } from 'vitest';
import { normalizeTitle, filterIqr, computeDealScore } from '../packages/core/src/index';

describe('title normalization', () => {
  it('normalizes punctuation/case', () => {
    expect(normalizeTitle('TI-84 Plus, CE!!')).toBe('ti 84 plus ce');
  });
});

describe('iqr filtering', () => {
  it('removes outlier', () => {
    const out = filterIqr([10,11,12,12,13,100]);
    expect(out.includes(100)).toBe(false);
  });
});

describe('scoring math', () => {
  it('computes roi/profit', () => {
    const result = computeDealScore({
      purchaseTotal: 50,
      resaleEstimate: 100,
      packagingProfile: 'SMALL',
      baseRisk: 0.1,
      title: 'good condition item',
      liquidityProxy: 0.7,
      shippingUnknown: false,
      config: {
        thresholds: { minProfit: 20, minRoi: 0.25, maxRiskScore: 0.5 },
        feeModel: { sellFeeRate: 0.1325, sellFeeFixed: 0.3 },
        shippingEstByProfile: { SMALL: 6, MEDIUM: 9 },
        packagingCostByProfile: { SMALL: 1, MEDIUM: 2 },
        oracle: { sampleSize: 200, iqrMultiplier: 1.5, discountBuffer: 0.1 },
        scanIntervals: { huntMs: 1, scanMs: 1 },
        filters: { requireFixedPrice: true, requireUsItemLocation: true, optionalFreeShippingOnly: false },
        keywords: { hardReject: [], softRisk: [] },
        dryRun: false,
        debugRawResponses: false
      }
    });
    expect(result.profit).toBeGreaterThan(10);
    expect(result.roi).toBeGreaterThan(0.2);
  });
});
