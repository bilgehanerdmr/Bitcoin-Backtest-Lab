// A Binance USDT spot pair. Price and quantity steps are Binance's own strings, e.g. "0.01".
export interface PairInfo {
  symbol: string;
  base: string;
  tickSize: string;
  stepSize: string;
  // Open time of the first daily candle, once looked up; null until then.
  listed: number | null;
}
export const pairLabel = (symbol: string) => symbol.replace(/USDT$/, '') + ' / USDT';
export const baseOf = (symbol: string) => symbol.replace(/USDT$/, '');
// Shown first in the pair picker.
export const popularBases = [
  'BTC',
  'ETH',
  'BNB',
  'SOL',
  'XRP',
  'DOGE',
  'ADA',
  'TRX',
  'AVAX',
  'LINK',
];
// Decimals of a Binance step such as "0.00010000" (4) or "1.00" (0).
export function stepDecimals(step: string): number {
  const trimmed = step.includes('.') ? step.replace(/0+$/, '') : step,
    dot = trimmed.indexOf('.');
  return dot < 0 ? 0 : trimmed.length - dot - 1;
}
// Decimals that keep a price readable when no step is known (uploaded data): cents for large
// prices, four significant digits for small ones, at most eight decimals.
export function priceDecimals(value: number): number {
  const v = Math.abs(value);
  if (!Number.isFinite(v) || v === 0 || v >= 1000) return 2;
  if (v >= 1) return 4;
  return Math.min(8, 3 - Math.floor(Math.log10(v)));
}
