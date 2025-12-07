import { config } from './config.js';
import { scanMarkets } from './market/scanner.js';
import { fetchFuturesSeries, computeIndicators } from './market/data.js';
import { evaluateTechnical } from './strategies/technical.js';
import { evaluateBreakout } from './strategies/breakout.js';
import { SIGNAL } from './strategies/base.js';
import { computeStops } from './trading/risk.js';
import { submitOrder } from './trading/order.js';
import { telegram } from './notifications/telegram.js';
import { manageOpenPositions, getOpenPositionsBySymbol } from './trading/position.js';

const pickSignal = (tech, brk) => {
  const candidates = [tech, brk].filter((c) => c.signal && c.signal !== SIGNAL.FLAT);
  if (!candidates.length) {
    return { signal: SIGNAL.FLAT };
  }
  return candidates.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
};

// Calculate signal for a symbol (reusable function to avoid duplication)
const calculateSignal = async (symbol) => {
  try {
    // Fetch kline data: uses config.klines.limit (default: 200 candles)
    const series = await fetchFuturesSeries({
      symbol,
      interval: config.klines.intervals[0], // First interval from config (default: '1m')
      limit: config.klines.limit // Number of candles from config (default: 200)
    });
    const indicators = computeIndicators(series);
    const tech = evaluateTechnical({ indicators });
    const brk = evaluateBreakout({ series, indicators });
    const chosen = pickSignal(tech, brk);
    
    return {
      signal: chosen.signal,
      confidence: chosen.confidence || 0,
      reason: chosen.reason,
      price: indicators.latest.close,
      indicators,
      tech,
      brk
    };
  } catch (err) {
    console.error(`Error calculating signal for ${symbol}:`, err?.message || err);
    return null;
  }
};

const tradeSymbol = async (symbol, signalData = null, allPositions = null) => {
  let signalResult = signalData;
  if (!signalResult) {
    signalResult = await calculateSignal(symbol);
    console.log(signalResult)
    if (!signalResult) {
      return { symbol, action: 'SKIP', reason: 'Failed to calculate signal' };
    }
  }

  const chosen = {
    signal: signalResult.signal,
    confidence: signalResult.confidence,
    reason: signalResult.reason
  };

  if (chosen.signal !== SIGNAL.FLAT) {
    await telegram.sendMessage(`${symbol} ${chosen.signal} ${chosen.confidence} ${chosen.reason}`)
  }

  // testing auto comment
  // if (chosen.signal === SIGNAL.FLAT || (chosen.confidence || 0) < 0.55) {
  //   if (chosen.confidence && chosen.confidence < 0.55) {
  //     await telegram.sendMessage(`${symbol} ${chosen.signal} ${chosen.confidence} ${chosen.reason || 'Low confidence'}`)
  //   }
  //   return { symbol, action: 'SKIP', reason: chosen.reason || 'Low confidence' };
  // }

  // Use provided positions Map or fetch if not provided
  const existingPositions = allPositions || await getOpenPositionsBySymbol();
  const existingPosition = existingPositions.get(symbol);
  if (existingPosition) {
    await telegram.sendMessage(`${symbol} Position already exists: ${existingPosition.side}`)
    // Already have position for this symbol, skip new entry
    return {
      symbol,
      action: 'SKIP',
      reason: `Position already exists: ${existingPosition.side}`
    };
  }

  // Check current open positions count (use size from existingPositions Map to avoid extra API call)
  const currentPositionsCount = existingPositions.size;
  if (currentPositionsCount >= config.riskMaxOpenPositions) {
    await telegram.sendMessage(`${symbol} Max positions reached (${currentPositionsCount}/${config.riskMaxOpenPositions})`)
    return {
      symbol,
      action: 'SKIP',
      reason: `Max positions reached (${currentPositionsCount}/${config.riskMaxOpenPositions})`
    };
  }

  const price = signalResult.price;
  const stops = computeStops({ price, signal: chosen.signal });
  // SL and TP handler after
  const side = chosen.signal === SIGNAL.LONG ? 'OPEN_LONG' : 'OPEN_SHORT';

  // Notify signal detected
  await telegram.notifySignal(symbol, chosen.signal, chosen.confidence || 0, chosen.reason, price);


  const orderPayload = {
    symbol,
    side,
    type: 'MARKET',
    // price,
    vol: config.positionSizeUsdt,
    leverage: config.leverage,
    // ...stops
  };

  console.log(orderPayload, "orderPayload");

  const res = await submitOrder(orderPayload);

  // Notify order placed
  if (res && res.orderId) {
    await telegram.notifyOrderPlaced(
      symbol,
      side,
      orderPayload.type,
      price,
      sizing.vol,
      sizing.leverage,
      res.orderId
    );
  }

  return { symbol, action: 'ORDER', payload: orderPayload, response: res, reason: chosen.reason };
};

export const runBot = async () => {
  // simple loop; in production use scheduler/queue.
  const loop = async () => {
    try {
      // Step 1: Manage existing positions (check reverse signals, trailing stop, break even)
      const markets = await scanMarkets();
      console.log("length markets", markets.length)
      const top = markets.slice(0, 1);
      console.log(top, "top")
      // const top = markets
      // Collect signals for all symbols we're tracking (process in batches of 10)
      const symbolSignals = new Map();
      const batchSize = 10;
      
      for (let i = 0; i < top.length; i += batchSize) {
        const batch = top.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (m) => {
            try {
              const signalResult = await calculateSignal(m.symbol);
              if (signalResult) {
                return {
                  symbol: m.symbol,
                  signal: signalResult.signal,
                  confidence: signalResult.confidence,
                  price: signalResult.price
                };
              }
              return null;
            } catch (err) {
              console.error(`Error calculating signal for ${m.symbol}:`, err?.message || err);
              return null;
            }
          })
        );
        
        // Add results to symbolSignals Map
        batchResults.forEach((result) => {
          if (result) {
            symbolSignals.set(result.symbol, {
              signal: result.signal,
              confidence: result.confidence,
              price: result.price
            });
          }
        });
        
        console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(top.length / batchSize)} (${batch.length} symbols)`);
      }

      // Get all open positions once (reuse for both position management and tradeSymbol)
      const allPositions = await getOpenPositionsBySymbol();
      
      // Calculate signals for positions we're holding (if not already calculated)
      for (const [symbol] of allPositions) {
        if (!symbolSignals.has(symbol)) {
          // Get signal for positions we're holding (only if not already calculated)
          const signalResult = await calculateSignal(symbol);
          if (signalResult) {
            symbolSignals.set(symbol, {
              signal: signalResult.signal,
              confidence: signalResult.confidence,
              price: signalResult.price
            });
          }
        }
      }


      // Manage existing positions
      const positionResults = await manageOpenPositions(symbolSignals);
      for (const result of positionResults) {
        if (result.action === 'CLOSED') {
          console.log(`[${result.symbol}] Position closed: ${result.reason}`);
        }
      }

      for (const m of top) {
        const signalData = symbolSignals.get(m.symbol);
        const result = await tradeSymbol(m.symbol, signalData, allPositions);
        // console.log(`[${m.symbol}]`, result);
      }

      // Position tracking will be handled by API calls in manageOpenPositions
    } catch (err) {
      console.error(err);
      console.error('Bot loop error', err?.message || err);
      await telegram.notifyError(err, 'Bot loop');
    }
    setTimeout(loop, 1000000);
  };

  loop();
};
