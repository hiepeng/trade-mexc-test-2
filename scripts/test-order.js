#!/usr/bin/env node

/**
 * Test script for MEXC Futures Order API
 * Usage: node scripts/test-order.js [LONG|SHORT] [SYMBOL]
 * Example: node scripts/test-order.js LONG BTC_USDT
 */

import { config } from '../src/config.js';
import { submitOrder } from '../src/trading/order.js';
import { computeOrderSizing, computeStops } from '../src/trading/risk.js';
import { getFuturesTicker } from '../src/mexc/futures-client.js';
import { SIGNAL } from '../src/strategies/base.js';

const args = process.argv.slice(2);

// Parse arguments
const sideArg = args[0]?.toUpperCase() || 'LONG';
const symbolArg = args[1] || 'BTC_USDT';

// Validate side
if (!['LONG', 'SHORT'].includes(sideArg)) {
  console.error('❌ Invalid side. Use LONG or SHORT');
  process.exit(1);
}

// Determine order side
const side = sideArg === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';

async function testPlaceOrder() {
  try {
    // Get current price for calculating volume and stops
    console.log(`📊 Fetching current price for ${symbolArg}...`);
    const ticker = await getFuturesTicker({ symbol: symbolArg });

    // Handle different response formats from MEXC API
    // Format 1: {code: 0, data: [{symbol: "...", lastPrice: ...}]}
    // Format 2: {code: 0, data: {symbol: "...", lastPrice: ...}}
    // Format 3: [{symbol: "...", lastPrice: ...}]
    let tickerData = null;
    if (Array.isArray(ticker?.data)) {
      tickerData =
        ticker.data.find((t) => (t.symbol || t.contractCode) === symbolArg) || ticker.data[0];
    } else if (ticker?.data) {
      tickerData = ticker.data;
    } else if (Array.isArray(ticker)) {
      tickerData = ticker.find((t) => (t.symbol || t.contractCode) === symbolArg) || ticker[0];
    } else {
      tickerData = ticker;
    }

    const price = Number(
      tickerData?.lastPrice ||
        tickerData?.last ||
        tickerData?.close ||
        tickerData?.price ||
        tickerData?.p ||
        0
    );

    if (!price || price === 0) {
      console.error('❌ Could not get current price');
      console.error('Ticker response:', JSON.stringify(ticker, null, 2));
      process.exit(1);
    }
    console.log(`✅ Current price: $${price}`);

    // Calculate volume using computeOrderSizing (same as bot)
    const sizing = computeOrderSizing({ price });
    console.log(`📏 Calculated volume: ${sizing.vol} (based on $${config.positionSizeUsdt} position size)`);

    // Calculate stop loss and take profit using computeStops (same as bot)
    const signal = sideArg === 'LONG' ? SIGNAL.LONG : SIGNAL.SHORT;
    const stops = computeStops({ price, signal });

    console.log('\n📋 Order Details:');
    console.log(`   Symbol: ${symbolArg}`);
    console.log(`   Side: ${sideArg} (${side})`);
    console.log(`   Type: MARKET`);
    console.log(`   Current Price: $${price} (for reference only)`);
    console.log(`   Volume: ${sizing.vol}`);
    console.log(`   Leverage: ${sizing.leverage}x`);
    console.log(`   Stop Loss: $${stops.stopLossPrice} (${(config.stopLossPct * 100).toFixed(2)}%)`);
    console.log(
      `   Take Profit: $${stops.takeProfitPrice} (${(config.takeProfitPct * 100).toFixed(2)}%)`
    );

    console.log('\n🚀 Placing order...');
    // For MARKET orders, price is not needed (will use current market price)
    const result = await submitOrder({
      symbol: symbolArg,
      side,
      type: 'MARKET',
      vol: sizing.vol,
      leverage: sizing.leverage,
      stopLossPrice: stops.stopLossPrice,
      takeProfitPrice: stops.takeProfitPrice
      // Note: price is not passed for MARKET orders
    });

    console.log('\n✅ Order placed successfully!');
    console.log('📦 Response:');
    console.log(JSON.stringify(result, null, 2));

    if (result?.orderId) {
      console.log(`\n📝 Order ID: ${result.orderId}`);
      console.log(`💡 Order placed successfully with ID: ${result.orderId}`);
    }
  } catch (error) {
    console.error('\n❌ Error placing order:');
    console.error(error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response, null, 2));
    }
    process.exit(1);
  }
}

testPlaceOrder();
