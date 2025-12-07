import { config } from '../config.js';
import { publicRequest, signedRequest } from './auth.js';
import { MexcFuturesClient } from 'mexc-futures-sdk';

// NOTE: Paths are based on current MEXC futures API documentation and may
// require adjustment if the exchange updates routes.
const FUTURES_PATHS = {
  symbols: '/api/v1/contract/detail',
  tickers: '/api/v1/contract/ticker',
  klines: '/api/v1/contract/kline', // GET /api/v1/contract/kline/{symbol}?interval=Min1&start=...&end=...
  account: '/api/v1/private/account/assets',
  positions: '/api/v1/private/position/open_positions',
  orderDetail: '/api/v1/private/order/external/detail'
};

const sdkClient = new MexcFuturesClient({
  authToken: process.env.MEXC_AUTH_TOKEN || ''
});
// Helper functions to convert string values to API integer format
// Side: 1=open long, 2=close short, 3=open short, 4=close long
const convertSideToInt = (side) => {
  const sideMap = {
    'OPEN_LONG': 1,
    'CLOSE_SHORT': 2,
    'OPEN_SHORT': 3,
    'CLOSE_LONG': 4
  };
  if (typeof side === 'number') {
    return side; // Already an integer
  }
  return sideMap[side?.toUpperCase()] || 1; // Default to open long
};

// Type: 1=limit, 2=Post Only, 3=IOC, 4=FOK, 5=market
const convertTypeToInt = (type) => {
  const typeMap = {
    'LIMIT': 1,
    'POST_ONLY': 2,
    'IOC': 3,
    'FOK': 4,
    'MARKET': 5
  };
  if (typeof type === 'number') {
    return type; // Already an integer
  }
  return typeMap[type?.toUpperCase()] || 1; // Default to limit
};

// OpenType: 1=isolated, 2=cross
const convertOpenTypeToInt = (openType) => {
  const openTypeMap = {
    'ISOLATED': 1,
    'CROSS': 2
  };
  if (typeof openType === 'number') {
    return openType; // Already an integer
  }
  return openTypeMap[openType?.toUpperCase()] || 1; // Default to isolated
};

export const getContracts = async () => {
  try {
    return await publicRequest({
      baseUrl: config.futuresBaseUrl,
      path: FUTURES_PATHS.symbols
    });
  } catch (err) {
    console.error('contracts error');
    console.error(err);
    throw err;
  }
};

export const getFuturesTicker = async ({ symbol }) => {
  try {
    return await publicRequest({
      baseUrl: config.futuresBaseUrl,
      path: FUTURES_PATHS.tickers,
      params: symbol ? { symbol } : {}
    });
  } catch (err) {
    console.error('tickers error');
    console.error(err);
    throw err;
  }
};

// Map interval format from config (1m, 5m, 15m) to MEXC Futures API format (Min1, Min5, Min15)
// Config uses readable format (1m), but MEXC Futures kline API requires specific format (Min1)
const mapIntervalToMEXCFutures = (interval) => {
  const mapping = {
    '1m': 'Min1',
    '5m': 'Min5',
    '15m': 'Min15',
    '30m': 'Min30',
    '60m': 'Min60',
    '1h': 'Min60',
    '4h': 'Hour4',
    '8h': 'Hour8',
    '1d': 'Day1',
    '1w': 'Week1',
    '1M': 'Month1'
  };
  // Return mapped value or original if not in mapping (allows direct Min1 format if needed)
  return mapping[interval] || interval;
};

export const getFuturesKlines = async ({ symbol, interval = '1m', limit, startTime, endTime }) => {
  try {
    // Convert interval from config format (1m) to MEXC API format (Min1) for kline endpoint
    const mexcInterval = mapIntervalToMEXCFutures(interval);
    
    // MEXC Futures kline API format: GET /api/v1/contract/kline/{symbol}?interval=Min1&start=...&end=...
    // Example: /api/v1/contract/kline/BTC_USDT?interval=Min15&start=1609992674&end=1610113500
    // Parameters:
    //   - symbol: in PATH (required) - e.g., BTC_USDT
    //   - interval: in query (required: Min1, Min5, Min15, Min30, Min60, Hour4, Hour8, Day1, Week1, Month1)
    //   - start: in query (optional: timestamp in seconds)
    //   - end: in query (optional: timestamp in seconds)
    //   - limit: in query (optional: if not using start/end, max 2000)
    
    // Build path with symbol in path (not query param)
    const path = `${FUTURES_PATHS.klines}/${symbol}`;
    
    // Build query parameters
    const params = {
      interval: mexcInterval
    };
    
    // Add start/end if provided (preferred method for time range)
    if (startTime) {
      params.start = startTime;
    }
    if (endTime) {
      params.end = endTime;
    }
    
    // Add limit if provided and no start/end (fallback method)
    // If limit is provided without start/end, API will return last N candles
    if (limit && !startTime && !endTime) {
      params.limit = limit;
    }
    
    let data

    const requestAndRetry = async (maxRetry = 10) => {
      data = await publicRequest({
        baseUrl: config.futuresBaseUrl,
        path,
        params
      });
      if (!data.success || !data.data || !data.data.time || !data.data.time.length) {
        if (maxRetry > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
          return requestAndRetry(maxRetry - 1);
        }
      }
    }
    await requestAndRetry()
    return data;
  } catch (err) {
    console.error('klines error');
    console.error(err);
    throw err;
  }
};

export const getAccountAssets = async () =>
  signedRequest({
    baseUrl: config.futuresBaseUrl,
    path: FUTURES_PATHS.account
  });

// Get contract info (contractSize, volumePrecision, etc.)
export const getContractInfo = async ({ symbol }) => {
  try {
    const data = await publicRequest({
      baseUrl: config.futuresBaseUrl,
      path: FUTURES_PATHS.symbols,
      params: { symbol }
    });
    
    // Handle different response formats
    const contract = Array.isArray(data?.data)
      ? data.data.find((c) => (c.symbol || c.contractCode) === symbol)
      : data?.data || data;
    
    if (!contract) {
      throw new Error(`Contract info not found for ${symbol}`);
    }
    
    return {
      symbol: contract.symbol || contract.contractCode,
      contractSize: Number(contract.contractSize || 1), // Default to 1 if not provided
      volumePrecision: Number(contract.volScale || 0),
      pricePrecision: Number(contract.priceScale || 5),
      minQuantity: Number(contract.minVol || 1),
      quantityUnit: Number(contract.volUnit || 1)
    };
  } catch (err) {
    console.error(`Error getting contract info for ${symbol}:`, err?.message || err);
    // Return default values if API fails
    return {
      symbol,
      contractSize: 1,
      volumePrecision: 0,
      pricePrecision: 5,
      minQuantity: 1,
      quantityUnit: 1
    };
  }
};

export const getOpenPositions = async () => {
try {
  return await signedRequest({
    baseUrl: config.futuresBaseUrl,
    path: FUTURES_PATHS.positions
  });
}catch(err) {
  console.error('getOpenPositions error');
  console.error(err);
  throw err;
}
}

export const placeOrder = async ({
  symbol,
  side,
  type = 'LIMIT',
  vol,
  leverage = config.leverage,
  openType = 'ISOLATED',
  stopLossPrice,
  takeProfitPrice,
  positionId = 0 // For closing positions, pass positionId
}) => {
  try {
    // Convert string values to integer format as required by API
    const sideInt = convertSideToInt(side);
    const typeInt = convertTypeToInt(type);
    const openTypeInt = convertOpenTypeToInt(openType);
    
    // For MARKET orders (type=5), price can be 0 or reference price
    // API requires price parameter even for market orders
    
    // Build order params similar to reference project
    const orderParams = {
      symbol,
      price: 1,
      vol,
      side: sideInt,
      type: typeInt,
      openType: openTypeInt,
      leverage,
      positionId, // 0 for new positions, actual positionId for closing
      ...(stopLossPrice && { stopLossPrice }),
      ...(takeProfitPrice && { takeProfitPrice })
    };
    
    // Use SDK client.submitOrder() like reference project
    console.log(orderParams, "orderParams")
    const orderResponse = await sdkClient.submitOrder(orderParams);
    
    // Check response similar to reference project
    if (orderResponse && typeof orderResponse === 'object') {
      const { success, code, message, msg } = orderResponse;
      if (success === false || (typeof code !== 'undefined' && code !== 0)) {
        const errMsg = message || msg || 'MEXC rejected order';
        throw new Error(`MEXC order rejected: code=${code}, message=${errMsg}`);
      }
    }
    
    return orderResponse;
  } catch (err) {
    console.error('❌ [PLACE_ORDER_ERROR]:', err.message);
    if (err.response) {
      console.error('Response:', JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }
};

export const cancelOrder = async ({ symbol, orderId, externalOid }) =>
  signedRequest({
    baseUrl: config.futuresBaseUrl,
    path: FUTURES_PATHS.cancelOrder,
    method: 'POST',
    params: { symbol, orderId, externalOid }
  });

export const getOrderDetail = async ({ symbol, orderId, externalOid }) =>
  signedRequest({
    baseUrl: config.futuresBaseUrl,
    path: FUTURES_PATHS.orderDetail,
    params: { symbol, orderId, externalOid }
  });
