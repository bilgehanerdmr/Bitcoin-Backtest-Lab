import type { Candle } from './types';

export const candleFields = {
  open: { label: 'Açılış', unit: 'USDT' },
  close: { label: 'Kapanış', unit: 'USDT' },
  high: { label: 'En yüksek', unit: 'USDT' },
  low: { label: 'En düşük', unit: 'USDT' },
  body: { label: 'Gövde uzunluğu', unit: 'USDT' },
  upperWick: { label: 'Üst fitil uzunluğu', unit: 'USDT' },
  lowerWick: { label: 'Alt fitil uzunluğu', unit: 'USDT' },
  range: { label: 'Toplam mum uzunluğu', unit: 'USDT' },
  bodyShare: { label: 'Gövde / toplam mum', unit: '%' },
  upperWickShare: { label: 'Üst fitil / toplam mum', unit: '%' },
  lowerWickShare: { label: 'Alt fitil / toplam mum', unit: '%' },
  changePct: { label: 'Açılıştan kapanışa değişim', unit: '%' },
  volume: { label: 'Hacim', unit: 'BTC' },
} as const;
export type CandleField = keyof typeof candleFields;
export const operators = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' } as const;
export type Operator = keyof typeof operators;
export interface CandleReference {
  field: CandleField;
  offset: number;
}
export type Operand =
  { kind: 'number'; value: number } | ({ kind: 'candle'; factor: number } & CandleReference);
export interface CandleRule {
  left: CandleReference;
  operator: Operator;
  right: Operand;
}
export interface RuleGroup {
  mode: 'all' | 'any';
  rules: CandleRule[];
}
export interface CustomStrategy {
  name: string;
  entry: RuleGroup;
  exit: RuleGroup;
}
export const MAX_RULES = 20;
export const MAX_OFFSET = 20;

export function candleValue(
  candles: Candle[],
  index: number,
  reference: CandleReference,
): number | null {
  const b = candles[index - reference.offset];
  if (!b) return null;
  const body = Math.abs(b.close - b.open),
    upper = b.high - Math.max(b.open, b.close),
    lower = Math.min(b.open, b.close) - b.low,
    range = b.high - b.low;
  switch (reference.field) {
    case 'body':
      return body;
    case 'upperWick':
      return upper;
    case 'lowerWick':
      return lower;
    case 'range':
      return range;
    case 'bodyShare':
      return range > 0 ? (body / range) * 100 : null;
    case 'upperWickShare':
      return range > 0 ? (upper / range) * 100 : null;
    case 'lowerWickShare':
      return range > 0 ? (lower / range) * 100 : null;
    case 'changePct':
      return b.open > 0 ? (b.close / b.open - 1) * 100 : null;
    default:
      return b[reference.field];
  }
}
export function matchesRule(candles: Candle[], index: number, rule: CandleRule): boolean {
  const left = candleValue(candles, index, rule.left);
  const raw =
    rule.right.kind === 'number' ? rule.right.value : candleValue(candles, index, rule.right);
  if (left === null || raw === null) return false;
  const right = raw * (rule.right.kind === 'candle' ? rule.right.factor : 1);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (rule.operator) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'eq':
      return left === right;
  }
}
export function matchesGroup(candles: Candle[], index: number, group: RuleGroup): boolean {
  if (!group.rules.length) return false;
  return group.mode === 'all'
    ? group.rules.every((r) => matchesRule(candles, index, r))
    : group.rules.some((r) => matchesRule(candles, index, r));
}
export function customLookback(strategy: CustomStrategy): number {
  return Math.max(
    0,
    ...[...strategy.entry.rules, ...strategy.exit.rules].flatMap((r) => [
      r.left.offset,
      r.right.kind === 'candle' ? r.right.offset : 0,
    ]),
  );
}
export function validateCustomStrategy(input: unknown): asserts input is CustomStrategy {
  const fail = (detail: string): never => {
    throw new Error('Özel strateji: ' + detail);
  };
  if (!input || typeof input !== 'object') fail('mum kuralları gerekli.');
  const c = input as CustomStrategy;
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60)
    fail('1–60 karakterlik bir ad girin.');
  const reference = (r: CandleReference) => {
    if (
      !r ||
      !Object.hasOwn(candleFields, r.field) ||
      !Number.isInteger(r.offset) ||
      r.offset < 0 ||
      r.offset > MAX_OFFSET
    )
      fail('mum alanı geçerli olmalı; geriye bakış 0–20 arasında tam sayı olmalı.');
  };
  for (const side of ['entry', 'exit'] as const) {
    const group = c[side];
    if (!group || !['all', 'any'].includes(group.mode) || !Array.isArray(group.rules))
      fail('geçerli bir kural grubu seçin.');
    if (group.rules.length > MAX_RULES || (side === 'entry' && !group.rules.length))
      fail('girişte 1–20, çıkışta 0–20 koşul olmalı.');
    for (const rule of group.rules) {
      if (!rule || !Object.hasOwn(operators, rule.operator))
        fail('geçerli bir karşılaştırma seçin.');
      reference(rule.left);
      if (!rule.right || !['number', 'candle'].includes(rule.right.kind))
        fail('karşılaştırma hedefi gerekli.');
      if (rule.right.kind === 'number') {
        if (
          !Number.isFinite(rule.right.value) ||
          typeof rule.right.value !== 'number' ||
          Math.abs(rule.right.value) > 1e12
        )
          fail('sonlu bir sayısal eşik girin.');
      } else {
        reference(rule.right);
        if (
          typeof rule.right.factor !== 'number' ||
          !Number.isFinite(rule.right.factor) ||
          rule.right.factor <= 0 ||
          rule.right.factor > 1000
        )
          fail('çarpan 0’dan büyük ve en fazla 1000 olmalı.');
        if (candleFields[rule.left.field].unit !== candleFields[rule.right.field].unit)
          fail('karşılaştırılan alanların birimleri aynı olmalı.');
      }
    }
  }
}
export function candleLabel(offset: number): string {
  return offset === 0 ? 'Son kapanan mum' : `${offset} mum önce`;
}
// Units double as comparison keys; on screen, volume is in the pair's base asset (BTC for
// BTCUSDT, ETH for ETHUSDT) and prices in USDT.
export const unitLabel = (unit: string, base = 'BTC') => (unit === 'BTC' ? base : unit);
export function ruleText(r: CandleRule, base = 'BTC'): string {
  const ref = (v: CandleReference) => `${candleLabel(v.offset)} · ${candleFields[v.field].label}`;
  const number = (n: number) => (Number.isFinite(n) ? String(n) : '…');
  const right =
    r.right.kind === 'number'
      ? `${number(r.right.value)} ${unitLabel(candleFields[r.left.field].unit, base)}`
      : `${ref(r.right)}${r.right.factor === 1 ? '' : ` × ${number(r.right.factor)}`}`;
  return `${ref(r.left)} ${operators[r.operator]} ${right}`;
}
const compare = (
  field: CandleField,
  operator: Operator,
  other: CandleField,
  offset = 0,
  otherOffset = 0,
  factor = 1,
): CandleRule => ({
  left: { field, offset },
  operator,
  right: { kind: 'candle', field: other, offset: otherOffset, factor },
});
const threshold = (
  field: CandleField,
  operator: Operator,
  value: number,
  offset = 0,
): CandleRule => ({ left: { field, offset }, operator, right: { kind: 'number', value } });
export const patternNames = {
  engulfing: 'Yükseliş yutan mum',
  hammer: 'Uzun alt fitil',
  three: 'Üç yükselen mum',
} as const;
export type Pattern = keyof typeof patternNames;
export function patternStrategy(pattern: Pattern): CustomStrategy {
  const entry: CandleRule[] =
    pattern === 'engulfing'
      ? [
          compare('close', 'lt', 'open', 1, 1),
          compare('close', 'gt', 'open'),
          compare('open', 'lte', 'close', 0, 1),
          compare('close', 'gte', 'open', 0, 1),
        ]
      : pattern === 'hammer'
        ? [
            threshold('body', 'gt', 0),
            compare('close', 'gt', 'open'),
            compare('lowerWick', 'gte', 'body', 0, 0, 2),
            compare('upperWick', 'lte', 'body', 0, 0, 0.5),
          ]
        : [
            compare('close', 'gt', 'open', 2, 2),
            compare('close', 'gt', 'open', 1, 1),
            compare('close', 'gt', 'open'),
            compare('close', 'gt', 'close', 1, 2),
            compare('close', 'gt', 'close', 0, 1),
          ];
  return {
    name: patternNames[pattern],
    entry: { mode: 'all', rules: entry },
    exit: { mode: 'all', rules: [compare('close', 'lt', 'open')] },
  };
}
export function newRule(): CandleRule {
  return compare('close', 'gt', 'open');
}
