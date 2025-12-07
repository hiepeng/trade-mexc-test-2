import { getKlines as getSpotKlines } from '../mexc/spot-client.js';
import { getFuturesKlines } from '../mexc/futures-client.js';
import { RSI, MACD, EMA } from 'technicalindicators';
import { config } from '../config.js';

// Convert MEXC Futures kline format to series format
// MEXC Futures API returns columnar format:
// {
//   "data": {
//     "time": [1761876000, 1761876900, ...],
//     "open": [109573.9, 109006.4, ...],
//     "close": [109006.4, 109301.5, ...],
//     "high": [109628.1, 109426.2, ...],
//     "low": [108953.3, 109006.4, ...],
//     "vol": [5587051.0, 5739575.0, ...]
//   }
// }
const toSeries = (klineData) => {
  // Handle columnar format (MEXC Futures API format)
  if (klineData && typeof klineData === 'object' && !Array.isArray(klineData)) {
    const time = klineData.time || [];
    const open = klineData.open || [];
    const close = klineData.close || [];
    const high = klineData.high || [];
    const low = klineData.low || [];
    const vol = klineData.vol || klineData.volume || [];

    // Get the length (all arrays should have same length)
    const length = Math.max(
      time.length,
      open.length,
      close.length,
      high.length,
      low.length,
      vol.length
    );

    // Convert columnar format to array of objects
    const series = [];
    for (let i = 0; i < length; i++) {
      series.push({
        openTime: Number(time[i] || 0) * 1000, // Convert seconds to milliseconds
        open: Number(open[i] || 0),
        high: Number(high[i] || 0),
        low: Number(low[i] || 0),
        close: Number(close[i] || 0),
        volume: Number(vol[i] || 0)
      });
    }

    return series;
  }

  // Fallback: Handle array of objects format (legacy support)
  if (Array.isArray(klineData)) {
    return klineData.map((k) => {
      // Handle object format: {t, o, h, l, c, v}
      if (typeof k === 'object' && k !== null && !Array.isArray(k)) {
        return {
          openTime: Number(k.t || k.openTime || 0),
          open: Number(k.o || k.open || 0),
          high: Number(k.h || k.high || 0),
          low: Number(k.l || k.low || 0),
          close: Number(k.c || k.close || 0),
          volume: Number(k.v || k.volume || 0)
        };
      }

      // Handle array format: [timestamp, open, high, low, close, volume]
      if (Array.isArray(k)) {
        return {
          openTime: Number(k[0] || 0),
          open: Number(k[1] || 0),
          high: Number(k[2] || 0),
          low: Number(k[3] || 0),
          close: Number(k[4] || 0),
          volume: Number(k[5] || 0)
        };
      }

      return null;
    }).filter((k) => k !== null);
  }

  return [];
};

export const fetchSpotSeries = async ({ symbol, interval, limit }) => {
  const data = await getSpotKlines({ symbol, interval, limit });
  return toSeries(data);
};

export const fetchFuturesSeries = async ({ symbol, interval, limit, proxy = null }) => {
  // MEXC Futures kline API supports both start/end and limit parameters
  // For getting last N candles, we can use limit directly if API supports it
  // Otherwise, calculate start/end from limit to ensure we get exactly N candles
  
  // Try using limit first (simpler, if API supports it)
  // If API doesn't support limit, fallback to calculating start/end
  let startTime = null;
  let endTime = null;
  
  // Calculate start/end from limit to ensure we get exactly the requested number of candles
  // This ensures we get exactly 'limit' candles regardless of API behavior
  if (limit) {
    // Map interval to seconds
    const intervalSeconds = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '60m': 3600,
      '1h': 3600,
      '4h': 14400,
      '8h': 28800,
      '1d': 86400,
      '1w': 604800,
      '1M': 2592000
    };
    
    const seconds = intervalSeconds[interval] || 60;
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    
    // Calculate time range for exactly 'limit' candles
    // endTime = current time (most recent candle)
    // startTime = endTime - (limit * interval_seconds) to get exactly 'limit' candles
    endTime = now;
    startTime = now - (limit * seconds) - 12000;
  }
  
  const data = await getFuturesKlines({ 
    symbol, 
    interval, 
    limit: null, // Use start/end instead of limit to ensure exact number of candles
    startTime,
    endTime,
    proxy // Pass proxy to getFuturesKlines
  });
  
  // Handle MEXC Futures kline response format
  // Response: {success: true, code: 0, data: {time: [...], open: [...], close: [...], ...}}
  // The data field contains columnar arrays, not array of objects
  const klineData = data?.data || null;

  // Convert columnar format to series format
  const series = toSeries(klineData);
  // Ensure we return exactly 'limit' candles (take last N if we got more)
  // API may return more candles than requested due to time range calculation
  if (limit && series.length > limit) {
    // Take last N candles to ensure we have exactly 'limit' candles
    return series.slice(-limit);
  }
  
  // Log if we got fewer candles than requested
  if (limit && series.length < limit) {
    console.log(series, "series")
    console.warn(
      `[${symbol}] Requested ${limit} candles but got ${series.length}. ` +
      `Interval: ${interval}, Start: ${startTime}, End: ${endTime}`
    );
  }
  
  return series;
};

export const computeIndicators = (series) => {
  const closes = series.map((c) => c.close);
  const volumes = series.map((c) => c.volume);

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });

  const latest = series[series.length - 1];
  const avgVolume =
    volumes.slice(-20).reduce((sum, v) => sum + v, 0) / Math.max(1, Math.min(20, volumes.length));
  const lastVolume = volumes[volumes.length - 1] || 0;

  return {
    latest,
    rsi: rsi[rsi.length - 1],
    macd: macd[macd.length - 1],
    ema20: ema20[ema20.length - 1],
    ema50: ema50[ema50.length - 1],
    ema200: ema200[ema200.length - 1],
    volume: {
      last: lastVolume,
      avg20: avgVolume,
      factor: avgVolume ? lastVolume / avgVolume : 0
    }
  };
};

export const loadMarketSnapshot = async ({ symbol }) => {
  const interval = config.klines.intervals[0];
  const limit = config.klines.limit;
  const series = await fetchFuturesSeries({ symbol, interval, limit });
  return computeIndicators(series);
};
