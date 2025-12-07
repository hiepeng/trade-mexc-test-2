import { config } from '../config.js';
import { SIGNAL } from '../strategies/base.js';

export const computeStops = ({ price, signal }) => {
  const slPct = config.stopLossPct;
  if (signal === SIGNAL.LONG) {
    const stopLossPrice = Number((price * (1 - slPct)).toFixed(6));

    // Initial trailing stop (will be updated as price moves)
    const initialTrailingStop = config.trailingStopPct
      ? Number((price * (1 - config.trailingStopPct)).toFixed(6))
      : null;

    return {
      stopLossPrice,
      trailingStopPrice: initialTrailingStop
    };
  }
  if (signal === SIGNAL.SHORT) {
    const stopLossPrice = Number((price * (1 + slPct)).toFixed(6));

    // Initial trailing stop (will be updated as price moves)
    const initialTrailingStop = config.trailingStopPct
      ? Number((price * (1 + config.trailingStopPct)).toFixed(6))
      : null;

    return {
      stopLossPrice,
      trailingStopPrice: initialTrailingStop
    };
  }

  return {};
};
