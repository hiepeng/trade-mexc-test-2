import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root (one level up from src/)
dotenv.config({ path: join(__dirname, '..', '.env') });

// Helper function to parse number from environment variable
const numberFromEnv = (key, def) => {
  const raw = process.env[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  // API Authentication (REQUIRED)
  apiKey: process.env.MEXC_API_KEY || '', // MEXC API Key - Get from https://www.mexc.com/user/api
  apiSecret: process.env.MEXC_API_SECRET || '', // MEXC API Secret Key - Used for HMAC SHA256 signature

  // API Endpoints
  futuresBaseUrl: process.env.FUTURES_BASE_URL || 'https://contract.mexc.com', // Futures API base URL - For trading operations (long/short) and market data
  wsFuturesUrl: process.env.WS_FUTURES_URL || 'wss://contract.mexc.com/ws', // WebSocket URL for Futures - Real-time market data stream

  // Trading Parameters
  recvWindow: numberFromEnv('RECV_WINDOW', 5000), // Request timeout window in milliseconds - Handles clock skew between client and server
  leverage: numberFromEnv('LEVERAGE', 3), // Leverage multiplier for futures trading (e.g., 3 = 3x leverage)
  positionSizeUsdt: numberFromEnv('POSITION_SIZE_USDT', 1), // Position size in USDT per trade (e.g., 10 = $10 per position)

  // Risk Management
  stopLossPct: numberFromEnv('STOP_LOSS_PCT', 0.01), // Stop loss percentage (e.g., 0.01 = 1% loss from entry price)
  riskMaxOpenPositions: numberFromEnv('RISK_MAX_OPEN_POSITIONS', 3), // Maximum number of open positions allowed simultaneously
  trailingStopPct: numberFromEnv('TRAILING_STOP_PCT', 0.005), // Trailing stop percentage (e.g., 0.005 = 0.5% trailing distance)
  closeOnReverseSignal: numberFromEnv('CLOSE_ON_REVERSE_SIGNAL', 1) === 1, // Close position when opposite signal detected (1 = enabled, 0 = disabled)
  
  // Take Profit (from reference project)
  minProfitRoiForTrail: numberFromEnv('MIN_PROFIT_ROI_FOR_TRAIL', 80), // ROI >= 80% to start trailing stop
  trailDropFromMaxRoi: numberFromEnv('TRAIL_DROP_FROM_MAX_ROI', 40), // Close when ROI drops 40% from max

  // Market Data Configuration
  klines: {
    intervals: ['1m', '5m', '15m'], // Supported time intervals for candlestick data
    limit: 200 // Maximum number of candles to fetch per request
  },

  // Strategy Parameters
  strategy: {
    maxVolumeUsd: numberFromEnv('STRATEGY_MAX_VOLUME_USD', 1000000), // Maximum 24h volume in USD to filter coins (e.g., 1000000 = $1M maximum)
    minVolumeUsd: numberFromEnv('STRATEGY_MIN_VOLUME_USD', 500000), // Minimum 24h volume in USD to filter coins (e.g., 500000 = $500k minimum)
    breakoutVolumeFactor: numberFromEnv('STRATEGY_BREAKOUT_VOL_FACTOR', 1.5) // Volume multiplier for breakout confirmation (e.g., 1.5 = 1.5x average volume)
  },

  // Telegram Notifications (OPTIONAL)
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '', // Telegram Bot Token from @BotFather
    chatId: process.env.TELEGRAM_CHAT_ID || '' // Telegram Chat ID to receive notifications
  }
};

// Validates that required API credentials are present
export const ensureAuth = () => {
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Missing MEXC_API_KEY or MEXC_API_SECRET in environment');
  }
};
