export const SIGNAL = {
  LONG: 'LONG',
  SHORT: 'SHORT',
  FLAT: 'FLAT'
};

export const buildResult = ({ signal = SIGNAL.FLAT, confidence = 0, reason = '', meta = {} }) => ({
  signal,
  confidence,
  reason,
  meta
});
