import { config } from '../config.js';
import { getOpenPositions, getFuturesTicker } from '../mexc/futures-client.js';
import { SIGNAL } from '../strategies/base.js';
import { telegram } from '../notifications/telegram.js';

// Close position by placing opposite order (full close)
export const closePosition = async ({ symbol, side }) => {
  try {
    // Get current position from API to get holdVol (contracts to close)
    const positions = await getOpenPositions();
    const positionsList = Array.isArray(positions?.data)
      ? positions.data
      : Array.isArray(positions)
        ? positions
        : [];
    
    const position = positionsList.find((p) => {
      const posSymbol = p.symbol || p.contractCode;
      return posSymbol === symbol && Number(p.holdVol || 0) > 0;
    });
    
    if (!position) {
      throw new Error(`Position not found for ${symbol}`);
    }
    
    const holdVol = Number(position.holdVol || 0);
    if (holdVol <= 0) {
      throw new Error(`No volume to close for ${symbol}`);
    }
    
    // Determine close side based on current position side
    const closeSide = side.includes('LONG') ? 'CLOSE_LONG' : 'CLOSE_SHORT';
    
    // Get positionId for closing (required by SDK)
    const positionId = Number(position.positionId || 0);

    // Use market order to close position immediately
    const { placeOrder } = await import('../mexc/futures-client.js');
    const result = await placeOrder({
      symbol,
      side: closeSide,
      type: 'MARKET',
      price: 0, // Market order doesn't need price
      vol: holdVol, // Use holdVol from API
      leverage: config.leverage,
      positionId // Pass positionId for closing (required by SDK)
    });

    return result;
  } catch (err) {
    console.error(`Error closing position for ${symbol}:`, err?.message || err);
    throw err;
  }
};

// Get detailed open positions with symbol mapping
export const getOpenPositionsBySymbol = async () => {
  try {
    const positions = await getOpenPositions();
    const positionsList = Array.isArray(positions?.data)
      ? positions.data
      : Array.isArray(positions)
        ? positions
        : [];

    const activePositions = positionsList.filter((p) => p && Number(p.holdVol || p.vol || 0) > 0);

    // Map positions by symbol
    // According to MEXC API response:
    // - positionType: 1 = LONG, 2 = SHORT
    // - holdVol: volume being held (for both LONG and SHORT)
    // - holdAvgPrice or openAvgPrice: entry price
    // - profitRatio: unrealized profit ratio (can be negative)
    const bySymbol = new Map();
    activePositions.forEach((pos) => {
      const symbol = pos.symbol || pos.contractCode;
      if (symbol) {
        const holdVol = Number(pos.holdVol || 0);
        if (holdVol <= 0) {
          return; // Skip positions with no volume
        }

        // Determine side from positionType: 1 = LONG, 2 = SHORT
        // If positionType is not available, fallback to checking holdVol
        const positionType = Number(pos.positionType || 0);
        let side = null;
        if (positionType === 1) {
          side = 'LONG';
        } else if (positionType === 2) {
          side = 'SHORT';
        } else {
          // Fallback: assume LONG if positionType is not available
          // (This should not happen with proper API response)
          side = 'LONG';
        }

        // Entry price: use holdAvgPrice or openAvgPrice (both are available in API response)
        const entryPrice = Number(pos.holdAvgPrice || pos.openAvgPrice || pos.openPriceAvg || pos.avgPrice || pos.openPrice || 0);

        // Get margin used (USD) from API - this is the actual USD value of the position
        // im = initial margin, oim = open initial margin
        const marginUsed = Number(pos.im || pos.oim || 0);
        const leverage = Number(pos.leverage || 1);
        
        // Calculate notional value (USD): marginUsed * leverage
        // This represents the total position size in USD
        const notional = marginUsed > 0 ? marginUsed * leverage : 0;
        
        bySymbol.set(symbol, {
          symbol,
          side,
          entryPrice,
          marginUsed, // Margin used in USD (from API: im or oim)
          notional, // Notional value in USD (marginUsed * leverage)
          leverage,
          positionId: pos.positionId || pos.id,
          unrealizedPnl: 0, // Will be calculated below
          roi: 0, // Will be calculated below
          maxRoi: null, // Track maximum ROI reached (for trailing stop)
          highestPrice: entryPrice, // Track highest price for LONG (for trailing stop)
          lowestPrice: entryPrice, // Track lowest price for SHORT (for trailing stop)
          trailingStopPrice: null // Current trailing stop price
        });
      }
    });

    // Get current prices for all symbols to calculate Unrealized PnL
    // Fetch ticker data for each position symbol
    const currentPrices = new Map();
    const symbols = Array.from(bySymbol.keys());
    
    // Fetch ticker for each symbol
    for (const symbol of symbols) {
      try {
        const tickerData = await getFuturesTicker({ symbol });
        // Handle different response formats
        const ticker = tickerData?.data || tickerData;
        if (ticker) {
          // Try different field names for price
          const price = Number(ticker.lastPrice || ticker.last || ticker.close || ticker.price || 0);
          if (price > 0) {
            currentPrices.set(symbol, price);
          }
        }
      } catch (err) {
        console.error(`Error fetching ticker for ${symbol}:`, err?.message || err);
        // Continue with other symbols
      }
    }

    // Calculate Unrealized PnL for each position based on current price
    // Formula from reference project: coins = contracts * contractSize, then PnL = entryValue - currentValue
    for (const [symbol, position] of bySymbol) {
      const currentPrice = currentPrices.get(symbol);
      if (currentPrice && position.entryPrice > 0 && position.marginUsed > 0) {
        try {
          // Update highest/lowest price for trailing stop tracking
          if (position.side === 'LONG') {
            if (currentPrice > position.highestPrice) {
              position.highestPrice = currentPrice;
            }
          } else if (position.side === 'SHORT') {
            if (currentPrice < position.lowestPrice) {
              position.lowestPrice = currentPrice;
            }
          }
          
          // Calculate price change percentage
          let priceChangePct = 0;
          if (position.side === 'SHORT') {
            // SHORT: profit when price goes down
            priceChangePct = (position.entryPrice - currentPrice) / position.entryPrice;
          } else if (position.side === 'LONG') {
            // LONG: profit when price goes up
            priceChangePct = (currentPrice - position.entryPrice) / position.entryPrice;
          }
          
          // Calculate Unrealized PnL using notional value
          // PnL = Price Change % × Notional Value
          // This is the standard futures PnL formula
          position.unrealizedPnl = priceChangePct * position.notional;
          
          // Calculate ROI: (PnL / Margin Used) × 100
          position.roi = position.marginUsed > 0 ? (position.unrealizedPnl / position.marginUsed) * 100 : 0;
          
          // Calculate trailing stop price
          const signal = position.side === 'LONG' ? SIGNAL.LONG : SIGNAL.SHORT;
          const newTrailingStop = calculateTrailingStop({
            currentPrice,
            signal,
            highestPrice: position.highestPrice,
            lowestPrice: position.lowestPrice
          });
          
          // Update trailing stop price if new high/low reached
          if (newTrailingStop !== null) {
            position.trailingStopPrice = newTrailingStop;
          }
        } catch (err) {
          console.error(`Error calculating PnL for ${symbol}:`, err?.message || err);
          // Fallback: use profitRatio if calculation fails
          const pos = activePositions.find((p) => (p.symbol || p.contractCode) === symbol);
          if (pos) {
            const profitRatio = Number(pos.profitRatio || 0);
            // Use marginUsed from position
            position.unrealizedPnl = position.marginUsed * profitRatio;
            console.log(`  Fallback PnL (from profitRatio): ${position.unrealizedPnl.toFixed(4)} USD`);
          }
        }
      } else {
        // Fallback: use profitRatio if current price is not available
        const pos = activePositions.find((p) => (p.symbol || p.contractCode) === symbol);
        if (pos) {
          const profitRatio = Number(pos.profitRatio || 0);
          // Use marginUsed from position
          position.unrealizedPnl = position.marginUsed * profitRatio;
          console.log(`  Fallback PnL (from profitRatio, no current price): ${position.unrealizedPnl.toFixed(4)} USD`);
        }
      }
    }

    return bySymbol;
  } catch (err) {
    console.error('Error getting positions by symbol:', err?.message || err);
    return new Map();
  }
};

// Check if should close position due to reverse signal
export const shouldCloseOnReverseSignal = (currentSide, newSignal) => {
  if (!config.closeOnReverseSignal) {
    return false;
  }

  if (newSignal === SIGNAL.FLAT) {
    return false;
  }

  // Close LONG if new signal is SHORT
  if (currentSide === 'LONG' && newSignal === SIGNAL.SHORT) {
    return true;
  }

  // Close SHORT if new signal is LONG
  if (currentSide === 'SHORT' && newSignal === SIGNAL.LONG) {
    return true;
  }

  return false;
};

// Calculate trailing stop price (exported for use in position-monitor)
export const calculateTrailingStop = ({ currentPrice, signal, highestPrice, lowestPrice }) => {
  if (!config.trailingStopPct) {
    return null;
  }

  if (signal === SIGNAL.LONG) {
    // For LONG: trailing stop follows price up
    if (currentPrice > highestPrice) {
      // Price is at new high, update trailing stop
      const trailingStop = currentPrice * (1 - config.trailingStopPct);
      return Number(trailingStop.toFixed(6));
    }
    // Return null if price hasn't reached new high (keep existing stop)
    return null;
  }

  if (signal === SIGNAL.SHORT) {
    // For SHORT: trailing stop follows price down
    if (currentPrice < lowestPrice) {
      // Price is at new low, update trailing stop
      const trailingStop = currentPrice * (1 + config.trailingStopPct);
      return Number(trailingStop.toFixed(6));
    }
    // Return null if price hasn't reached new low (keep existing stop)
    return null;
  }

  return null;
};

// Manage open positions: check for reverse signals, take profit
export const manageOpenPositions = async (symbolSignals) => {
  const positions = await getOpenPositionsBySymbol();
  const results = [];

  for (const [symbol, position] of positions) {
    try {
      const currentSignal = symbolSignals.get(symbol);
      if (!currentSignal) {
        continue; // No signal for this symbol, skip
      }

      // Update maxRoi tracking
      if (position.maxRoi === null || position.roi > position.maxRoi) {
        position.maxRoi = position.roi;
      }

      console.log(position, currentSignal, "position.side, currentSignal.signal")

      // 1. Check reverse signal
      if (shouldCloseOnReverseSignal(position.side, currentSignal.signal)) {
        console.log(
          `[${symbol}] Closing position due to reverse signal: ${position.side} -> ${currentSignal.signal}`
        );
       const resClose = await closePosition({
          symbol,
          side: position.side
        });
        console.log(resClose, "resClose");
        await telegram.notifyPositionClosed(
          symbol,
          position.side,
          position.entryPrice,
          currentSignal.price,
          position.unrealizedPnl,
          position.roi,
          `Reverse signal`
        );
        results.push({ symbol, action: 'CLOSED', reason: 'Reverse signal' });
        continue;
      }

      // 2. Check Trailing Stop
      const currentPrice = currentSignal.price;
      let shouldCloseTrailingStop = false;
      
      console.log(position, "position");

      if (config.trailingStopPct && position.trailingStopPrice !== null) {
        if (position.side === 'LONG') {
          // LONG: Close if price drops below trailing stop
          if (currentPrice <= position.trailingStopPrice) {
            shouldCloseTrailingStop = true;
          }
        } else if (position.side === 'SHORT') {
          // SHORT: Close if price rises above trailing stop
          if (currentPrice >= position.trailingStopPrice) {
            shouldCloseTrailingStop = true;
          }
        }
      }
      
      if (shouldCloseTrailingStop) {
        console.log(
          `[${symbol}] Trailing Stop triggered: Current Price $${currentPrice.toFixed(6)}, Trailing Stop $${position.trailingStopPrice.toFixed(6)}`
        );
        
        const resClose = await closePosition({
          symbol,
          side: position.side
        });
        console.log(resClose, "resClose");
        await telegram.notifyPositionClosed(
          symbol,
          position.side,
          position.entryPrice,
          currentPrice,
          position.unrealizedPnl,
          position.roi,
          `Trailing Stop`
        );
        results.push({ symbol, action: 'CLOSED', reason: 'Trailing Stop' });
        continue;
      }

      // 3. Take Profit - Close when ROI is high and drops from max
      // Logic from reference project: ROI >= 80% and drops 40% from max
      const enoughProfit = position.roi >= config.minProfitRoiForTrail;
      const droppedFromMax =
        position.maxRoi !== null &&
        (position.maxRoi - position.roi) >= config.trailDropFromMaxRoi;

      if (enoughProfit && droppedFromMax) {
        console.log(
          `[${symbol}] Take Profit triggered: ROI ${position.roi.toFixed(2)}%, Max ROI ${position.maxRoi.toFixed(2)}%, Drop ${(position.maxRoi - position.roi).toFixed(2)}%`
        );
        
        const resClose = await closePosition({
          symbol,
          side: position.side
        });
        console.log(resClose, "resClose");
        await telegram.notifyPositionClosed(
          symbol,
          position.side,
          position.entryPrice,
          currentSignal.price,
          position.unrealizedPnl,
          position.roi,
          `Take Profit (ROI Trailing)`
        );
        results.push({ symbol, action: 'CLOSED', reason: 'Take Profit (ROI Trailing)' });
        continue;
      }

      results.push({ symbol, action: 'HOLD', position });
    } catch (err) {
      console.error(`Error managing position for ${symbol}:`, err?.message || err);
      results.push({ symbol, action: 'ERROR', error: err.message });
    }
  }

  return results;
};
