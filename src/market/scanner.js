import { getContracts, getFuturesTicker } from '../mexc/futures-client.js';
import { config } from '../config.js';

// Cache for contracts data (TTL: 1 minute)
let contractsCache = null;
let contractsCacheTime = 0;
const CONTRACTS_CACHE_TTL = 60 * 1000; // 1 minute in milliseconds

export const scanMarkets = async () => {
  // Get tickers (always fetch fresh data as it changes frequently)
  const tickersResp = await getFuturesTicker({});

  // Get contracts from cache or fetch if expired
  let contractsResp;
  const now = Date.now();
  if (contractsCache && now - contractsCacheTime < CONTRACTS_CACHE_TTL) {
    // Use cached contracts
    contractsResp = contractsCache;
  } else {
    // Fetch fresh contracts and update cache
    contractsResp = await getContracts();
    contractsCache = contractsResp;
    contractsCacheTime = now;
  }

  // Handle different response formats for contracts
  // MEXC API may return: {code: 0, data: [...]} or [...] directly
  const contracts = Array.isArray(contractsResp?.data)
    ? contractsResp.data
    : Array.isArray(contractsResp)
      ? contractsResp
      : [];

  // Handle different response formats for tickers
  // MEXC API may return: {code: 0, data: [...]} or [...] directly
  const tickers = Array.isArray(tickersResp?.data)
    ? tickersResp.data
    : Array.isArray(tickersResp)
      ? tickersResp
      : [];

  // Create Map from tickers for fast lookup
  const bySymbol = new Map();
  tickers.forEach((t) => {
    if (t?.symbol) {
      bySymbol.set(t.symbol, t);
    }
  });

  // Merge contracts with ticker data
  // Only include contracts that have ticker data (active trading)
  const response = contracts
    .filter((c) => {
      // Filter: contract must have symbol and exist in tickers
      const symbol = c.symbol || c.contractCode;
      return symbol && bySymbol.has(symbol);
    })
    .filter((c) => {
      return Date.now() - c.createTime > 21 * 24 * 60 * 60 * 1000
    })
    .map((c) => {
      const symbol = c.symbol || c.contractCode;
      const t = bySymbol.get(symbol);

      // Try different field names for volume (MEXC API may use different names)
      const volumeUsd = Number(
        t.turnover24h || t.amount24h || t.volume24h || t.volume24 || t.volume || 0
      );

      // Try different field names for price
      const lastPrice = Number(t.lastPrice || t.last || t.close || t.price || 0);

      return {
        symbol,
        volumeUsd,
        lastPrice
      };
    })
    .filter(
      (c) =>
        c.volumeUsd >= config.strategy.minVolumeUsd && c.volumeUsd <= config.strategy.maxVolumeUsd
    )
    // .filter(c => c.symbol === 'BTC_USDT')
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
  return response;
};
