import {
  placeOrder as placeFuturesOrder,
  cancelOrder as cancelFuturesOrder
} from '../mexc/futures-client.js';
import { telegram } from '../notifications/telegram.js';

export const submitOrder = async ({
  symbol,
  side,
  type = 'LIMIT',
  price,
  vol,
  leverage,
  stopLossPrice
}) => {
  try {
    const result = await placeFuturesOrder({
      symbol,
      side,
      type,
      price,
      vol,
      leverage,
      stopLossPrice
    });
    return result;
  } catch (err) {
    await telegram.notifyError(err, `Order submission failed for ${symbol}`);
    throw err;
  }
};

export const cancelOrder = async ({ symbol, orderId, externalOid }) => {
  try {
    const result = await cancelFuturesOrder({ symbol, orderId, externalOid });
    await telegram.notifyOrderCancelled(symbol, orderId || externalOid, 'Manual cancellation');
    return result;
  } catch (err) {
    await telegram.notifyError(err, `Order cancellation failed for ${symbol}`);
    throw err;
  }
};
