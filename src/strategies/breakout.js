import { SIGNAL, buildResult } from './base.js';
import { config } from '../config.js';

export const evaluateBreakout = ({ series, indicators }) => {
  if (!series?.length || !indicators?.latest) {
    return buildResult({});
  }
  const lookback = 40;
  const slice = series.slice(-lookback);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const recentHigh = Math.max(...highs);
  const recentLow = Math.min(...lows);
  const price = indicators.latest.close;
  const volFactor = indicators.volume.factor;

  const breakoutUp = price > recentHigh && volFactor >= config.strategy.breakoutVolumeFactor;
  const breakoutDown = price < recentLow && volFactor >= config.strategy.breakoutVolumeFactor;


  if (breakoutUp) {
    // Breakout confidence: base 0.65 + volume bonus
    // Volume bonus only applies when volFactor > 1.0 (already required by condition)
    // Better scaling: from 1.5x to 2.5x to reach max
    const volumeBonus = Math.min(0.33, (volFactor - 1) / 3.5);
    const confidence = Math.min(0.98, 0.65 + volumeBonus);

    return buildResult({
      signal: SIGNAL.LONG,
      confidence,
      reason: `Breakout up with volume factor ${volFactor.toFixed(2)}`
    });
  }

  if (breakoutDown) {
    // Breakout confidence: base 0.65 + volume bonus
    // Volume bonus only applies when volFactor > 1.0 (already required by condition)
    // Better scaling: from 1.5x to 2.5x to reach max
    const volumeBonus = Math.min(0.33, (volFactor - 1) / 3.5);
    const confidence = Math.min(0.98, 0.65 + volumeBonus);

    return buildResult({
      signal: SIGNAL.SHORT,
      confidence,
      reason: `Breakdown with volume factor ${volFactor.toFixed(2)}`
    });
  }

  return buildResult({});
};
