import { SIGNAL, buildResult } from './base.js';

export const evaluateTechnical = ({ indicators }) => {
  const { rsi, macd, ema20, ema50, ema200, latest, volume } = indicators;
  if (!rsi || !macd || !ema20 || !latest) {
    return buildResult({});
  }

  const price = latest.close;
  const macdHistogram = macd.MACD - macd.signal;

  // LONG conditions: RSI oversold + MACD bullish + Price above EMA20
  const longSetup = rsi < 30 && macd.MACD > macd.signal && price > ema20;

  // SHORT conditions: RSI overbought + MACD bearish + Price below EMA20
  const shortSetup = rsi > 70 && macd.MACD < macd.signal && price < ema20;

  // Calculate multi-factor confidence for LONG
  if (longSetup) {
    let confidence = 0.5; // Base confidence

    // RSI contribution (0-0.2): More extreme RSI = higher confidence
    if (rsi < 20) {
      confidence += 0.2; // Very oversold
    } else if (rsi < 25) {
      confidence += 0.15; // Oversold
    } else if (rsi < 30) {
      confidence += 0.1; // Near oversold
    }

    // MACD strength contribution (0-0.2)
    if (macdHistogram > 0 && macd.MACD > 0) {
      confidence += 0.2; // Strong bullish: MACD above signal and above zero
    } else if (macdHistogram > 0) {
      confidence += 0.12; // Weak bullish: MACD above signal but below zero
    } else if (macd.MACD > macd.signal) {
      confidence += 0.05; // Just crossed above signal
    }

    // EMA alignment contribution (0-0.15): Trend confirmation
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
      confidence += 0.15; // Perfect uptrend alignment
    } else if (price > ema20 && ema20 > ema50) {
      confidence += 0.1; // Short-term uptrend
    } else if (price > ema20) {
      confidence += 0.05; // Price above EMA20 only
    }

    // Volume confirmation (0-0.15): Only bonus when volume > 1.0x
    if (volume.factor > 1.5) {
      confidence += 0.15; // Very high volume
    } else if (volume.factor > 1.2) {
      confidence += 0.1; // High volume
    } else if (volume.factor > 1.0) {
      confidence += 0.05; // Above average volume
    }
    // No bonus for volume < 1.0x

    confidence = Math.min(1.0, confidence); // Cap at 100%

    const reasonParts = [
      `RSI ${rsi.toFixed(1)}`,
      `MACD ${macdHistogram > 0 && macd.MACD > 0 ? 'strong' : 'weak'} bull`,
      price > ema20 && ema20 > ema50 && ema50 > ema200 ? 'uptrend' : 'price>EMA20'
    ];
    if (volume.factor > 1.0) {
      reasonParts.push(`vol ${volume.factor.toFixed(2)}x`);
    }

    return buildResult({
      signal: SIGNAL.LONG,
      confidence,
      reason: reasonParts.join(', ')
    });
  }

  // Calculate multi-factor confidence for SHORT
  if (shortSetup) {
    let confidence = 0.5; // Base confidence

    // RSI contribution (0-0.2): More extreme RSI = higher confidence
    if (rsi > 80) {
      confidence += 0.2; // Very overbought
    } else if (rsi > 75) {
      confidence += 0.15; // Overbought
    } else if (rsi > 70) {
      confidence += 0.1; // Near overbought
    }

    // MACD strength contribution (0-0.2)
    if (macdHistogram < 0 && macd.MACD < 0) {
      confidence += 0.2; // Strong bearish: MACD below signal and below zero
    } else if (macdHistogram < 0) {
      confidence += 0.12; // Weak bearish: MACD below signal but above zero
    } else if (macd.MACD < macd.signal) {
      confidence += 0.05; // Just crossed below signal
    }

    // EMA alignment contribution (0-0.15): Trend confirmation
    if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
      confidence += 0.15; // Perfect downtrend alignment
    } else if (price < ema20 && ema20 < ema50) {
      confidence += 0.1; // Short-term downtrend
    } else if (price < ema20) {
      confidence += 0.05; // Price below EMA20 only
    }

    // Volume confirmation (0-0.15): Only bonus when volume > 1.0x
    if (volume.factor > 1.5) {
      confidence += 0.15; // Very high volume
    } else if (volume.factor > 1.2) {
      confidence += 0.1; // High volume
    } else if (volume.factor > 1.0) {
      confidence += 0.05; // Above average volume
    }
    // No bonus for volume < 1.0x

    confidence = Math.min(1.0, confidence); // Cap at 100%

    const reasonParts = [
      `RSI ${rsi.toFixed(1)}`,
      `MACD ${macdHistogram < 0 && macd.MACD < 0 ? 'strong' : 'weak'} bear`,
      price < ema20 && ema20 < ema50 && ema50 < ema200 ? 'downtrend' : 'price<EMA20'
    ];
    if (volume.factor > 1.0) {
      reasonParts.push(`vol ${volume.factor.toFixed(2)}x`);
    }

    return buildResult({
      signal: SIGNAL.SHORT,
      confidence,
      reason: reasonParts.join(', ')
    });
  }

  return buildResult({});
};
