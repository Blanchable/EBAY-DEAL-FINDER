import { describe, it, expect } from 'vitest';
import { loadConfig } from '../packages/core/src/index';

describe('config parsing', () => {
  it('loads runtime and env defaults', () => {
    process.env.EBAY_DELIVERY_POSTAL_CODE = '10001';
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    process.env.MOCK_EBAY_MODE = '1';
    const cfg = loadConfig();
    expect(cfg.runtime.thresholds.minProfit).toBeTypeOf('number');
    expect(cfg.mockEbayMode).toBe(true);
  });
});
