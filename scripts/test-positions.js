#!/usr/bin/env node

/**
 * Test script for MEXC Futures Get Positions API
 * Usage: node scripts/test-positions.js [SYMBOL]
 * Example: node scripts/test-positions.js
 * Example: node scripts/test-positions.js BTC_USDT
 */

import { getOpenPositionsBySymbol } from '../src/trading/position.js';
import { getOpenPositions } from '../src/mexc/futures-client.js';

const args = process.argv.slice(2);
const symbolFilter = args[0] || null;

async function testGetPositions() {
  try {
    console.log('🔐 API credentials loaded');

    console.log('\n📊 Fetching open positions...');
    const positions = await getOpenPositionsBySymbol();

    // Filter by symbol if provided
    const filteredPositions = symbolFilter
      ? Array.from(positions.entries()).filter(([symbol]) => symbol === symbolFilter)
      : Array.from(positions.entries());

    console.log(`\n✅ Found ${filteredPositions.length} active position(s)`);

    if (filteredPositions.length === 0) {
      console.log('ℹ️  No active positions found');
      return;
    }

    console.log('\n📋 Position Details:');
    filteredPositions.forEach(([symbol, position], index) => {
      console.log(`\n   Position ${index + 1}:`);
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Side: ${position.side}`);
      console.log(`   Entry Price: $${position.entryPrice.toFixed(8)}`);
      console.log(`   Margin Used: $${position.marginUsed.toFixed(4)} USD`);
      console.log(`   Notional: $${position.notional.toFixed(4)} USD`);
      console.log(`   Unrealized PnL: $${position.unrealizedPnl.toFixed(4)}`);
      if (position.positionId) {
        console.log(`   Position ID: ${position.positionId}`);
      }
    });

    // Also show raw API response for debugging
    // console.log('\n📦 Raw API Response:');
    // const rawResult = await getOpenPositions();
    // console.log(JSON.stringify(rawResult, null, 2));

  } catch (error) {
    console.error('\n❌ Error fetching positions:');
    console.error(error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response, null, 2));
    }
    process.exit(1);
  }
}

testGetPositions();

