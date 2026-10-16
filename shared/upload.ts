import { intervals, type Candle, type Interval } from './types';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 1_000_000;
export const UPLOAD_SOURCE_PREFIX = 'Yüklenen veri · ';
export const uploadSource = (name: string) => UPLOAD_SOURCE_PREFIX + name;
export type Field = 'time' | 'open' | 'high' | 'low' | 'close' | 'volume';
export const fields: Field[] = ['time', 'open', 'high', 'low', 'close', 'volume'];
export const fieldLabels: Record<Field, string> = {
  time: 'Zaman',
  open: 'Açılış',
  high: 'En yüksek',
  low: 'En düşük',
  close: 'Kapanış',
  volume: 'Hacim',
};
export interface CsvOptions {
  delimiter: ',' | ';' | '\t';
  decimal: '.' | ',';
  header: boolean;
  // Column index per field; only volume may be missing.
  columns: Record<Field, number | null>;
}
export type TimeFormat = 'seconds' | 'milliseconds' | 'microseconds' | 'date';
export const timeFormatLabels: Record<TimeFormat, string> = {
  seconds: 'Unix zamanı (saniye)',
  milliseconds: 'Unix zamanı (milisaniye)',
  microseconds: 'Unix zamanı (mikrosaniye)',
  date: 'Tarih ve saat',
};
export interface CsvResult {
  options: CsvOptions;
  headers: string[];
  timeFormat: TimeFormat | null;
  candles: Candle[];
  interval: Interval | null;
  rows: number;
  skipped: { line: number; reason: string }[];
  skippedCount: number;
  duplicates: number;
  missing: number;
  errors: string[];
  warnings: string[];
}
export interface UploadMeta {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
  interval: Interval;
  count: number;
  start: number;
  end: number;
  missing: number;
  hasVolume: boolean;
}
export function validateUploadName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.length > 60)
    throw new Error('Veri seti adı 1–60 karakter olmalı.');
}

// Header names in English and Turkish, compared after folding case and Turkish letters.
const aliases: Record<Field, string[]> = {
  time: [
    'time',
    'date',
    'datetime',
    'timestamp',
    'opentime',
    'tarih',
    'zaman',
    'tarihsaat',
    'saat',
  ],
  open: ['open', 'opening', 'acilis', 'acilisfiyati'],
  high: ['high', 'highest', 'max', 'yuksek', 'enyuksek'],
  low: ['low', 'lowest', 'min', 'dusuk', 'endusuk'],
  close: ['close', 'closing', 'last', 'kapanis', 'kapanisfiyati', 'son'],
  volume: ['volume', 'vol', 'hacim'],
};
const fold = (s: string) =>
  s
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]/g, '');
// Splits one line, honouring double-quoted fields with "" escapes.
function split(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '',
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(field.trim());
      field = '';
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}
function number(raw: string, decimal: '.' | ','): number | null {
  let s = raw.replace(/[\s ]/g, '');
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s) ? Number(s) : null;
}
const iso =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const turkish = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
// Seconds since the epoch, or null. `zone` reports whether the text named a time zone.
function date(raw: string): { time: number; zone: boolean } | null {
  let y, mo, d, h, mi, se, frac, zone;
  const a = iso.exec(raw),
    b = a ? null : turkish.exec(raw);
  if (a) [, y, mo, d, h, mi, se, frac, zone] = a;
  else if (b) [, d, mo, y, h, mi, se] = b;
  else return null;
  if (frac && /[1-9]/.test(frac)) return null;
  const parts = [y, mo, d, h ?? '0', mi ?? '0', se ?? '0'].map(Number);
  const ms = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]),
    check = new Date(ms);
  if (
    check.getUTCFullYear() !== parts[0] ||
    check.getUTCMonth() !== parts[1] - 1 ||
    check.getUTCDate() !== parts[2] ||
    parts[3] > 23
  )
    return null;
  let offset = 0;
  if (zone && zone.toUpperCase() !== 'Z') {
    const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
    offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60;
  }
  return { time: ms / 1000 - offset, zone: !!zone };
}
const unitOf = (v: number): TimeFormat | null =>
  v < 1e6
    ? null
    : v < 1e11
      ? 'seconds'
      : v < 1e14
        ? 'milliseconds'
        : v < 1e17
          ? 'microseconds'
          : null;
const factors = { seconds: 1, milliseconds: 1e3, microseconds: 1e6 };
const stamp = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const human = (seconds: number) =>
  seconds % 86400 === 0
    ? `${seconds / 86400} gün`
    : seconds % 3600 === 0
      ? `${seconds / 3600} saat`
      : seconds % 60 === 0
        ? `${seconds / 60} dakika`
        : `${seconds} saniye`;

// Reads OHLCV candles from CSV text. Separator, decimal mark, header, columns and time format
// are detected unless given. Nothing is guessed silently: every skipped row, removed duplicate
// and gap is reported, and anything that would change the data's meaning is an error.
export function parseCandleCsv(text: string, given: Partial<CsvOptions> = {}): CsvResult {
  const result: CsvResult = {
    options: { delimiter: ',', decimal: '.', header: false, columns: emptyColumns() },
    headers: [],
    timeFormat: null,
    candles: [],
    interval: null,
    rows: 0,
    skipped: [],
    skippedCount: 0,
    duplicates: 0,
    missing: 0,
    errors: [],
    warnings: [],
  };
  const lines: { line: number; text: string }[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .forEach((t, i) => {
      if (t.trim()) lines.push({ line: i + 1, text: t });
    });
  if (!lines.length) return fail(result, 'Dosya boş.');
  const sample = lines.slice(0, 20);
  const delimiter =
    given.delimiter ??
    ([';', '\t', ','] as const).find((d) => {
      const counts = sample.map((l) => split(l.text, d).length);
      return counts[0] >= 5 && counts.every((c) => c === counts[0]);
    }) ??
    ([';', '\t', ','] as const).find((d) => split(sample[0].text, d).length >= 5);
  if (!delimiter)
    return fail(
      result,
      'Sütunlar ayrılamadı. Dosya virgül, noktalı virgül veya sekmeyle ayrılmış en az 5 sütun içermeli.',
    );
  result.options.delimiter = delimiter;
  const first = split(lines[0].text, delimiter);
  const header =
    given.header ?? first.filter((f) => number(f, '.') === null && date(f) === null).length >= 2;
  result.options.header = header;
  result.headers = header ? first : first.map((_, i) => `Sütun ${i + 1}`);
  const columns = given.columns ?? detectColumns(header ? first : null, first.length);
  result.options.columns = columns;
  const unmapped = fields.filter((f) => f !== 'volume' && columns[f] === null);
  if (unmapped.length)
    return fail(
      result,
      `Şu sütunlar bulunamadı: ${unmapped.map((f) => fieldLabels[f]).join(', ')}. Sütun eşleştirmesini elle seçin.`,
    );
  const body = header ? lines.slice(1) : lines;
  result.rows = body.length;
  if (body.length > MAX_UPLOAD_ROWS)
    return fail(
      result,
      `Dosyada ${body.length.toLocaleString('tr-TR')} satır var; en fazla ${MAX_UPLOAD_ROWS.toLocaleString('tr-TR')} satır yüklenebilir.`,
    );
  const priceFields = (['open', 'high', 'low', 'close'] as const).map((f) => columns[f]!);
  const decimal =
    given.decimal ??
    (delimiter !== ',' &&
    body
      .slice(0, 50)
      .some((l) =>
        priceFields.some((c) =>
          /^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/.test(split(l.text, delimiter)[c] ?? ''),
        ),
      )
      ? ','
      : '.');
  result.options.decimal = decimal;
  let zoneless = false;
  const skip = (line: number, reason: string) => {
    result.skippedCount++;
    if (result.skipped.length < 5) result.skipped.push({ line, reason });
  };
  const parsed: (Candle & { line: number })[] = [];
  for (const { line, text: row } of body) {
    const cells = split(row, delimiter),
      needed = Math.max(...fields.map((f) => columns[f] ?? -1));
    if (cells.length <= needed) {
      skip(line, 'Eksik sütun.');
      continue;
    }
    const rawTime = cells[columns.time!].replace(/^"|"$/g, '');
    let time: number | null = null;
    const numeric = /^\d+(\.\d+)?$/.test(rawTime) ? Number(rawTime) : null;
    if (numeric !== null) {
      result.timeFormat ??= unitOf(numeric);
      if (!result.timeFormat)
        return fail(
          result,
          `Satır ${line}: zaman sütunundaki sayı (${rawTime}) Unix zamanı değil. Excel tarih numarasıysa sütunu tarih biçimine çevirin.`,
        );
      if (result.timeFormat !== 'date') {
        const seconds = numeric / factors[result.timeFormat];
        time = Number.isInteger(seconds) ? seconds : null;
      }
    } else {
      const d = date(rawTime);
      if (d) {
        result.timeFormat ??= 'date';
        if (result.timeFormat === 'date') time = d.time;
        if (!d.zone) zoneless = true;
      }
    }
    if (time === null) {
      skip(line, `Zaman okunamadı: “${rawTime.slice(0, 40)}”.`);
      continue;
    }
    const [open, high, low, close] = priceFields.map((c) => number(cells[c], decimal)),
      volume = columns.volume === null ? 0 : number(cells[columns.volume], decimal);
    if ([open, high, low, close, volume].some((v) => v === null)) {
      skip(line, 'Sayı okunamadı.');
      continue;
    }
    const b = { time, open: open!, high: high!, low: low!, close: close!, volume: volume!, line };
    if (
      b.low <= 0 ||
      b.volume < 0 ||
      b.high < Math.max(b.open, b.close) ||
      b.low > Math.min(b.open, b.close)
    ) {
      skip(line, 'Fiyatlar tutarsız: en yüksek / en düşük açılış ve kapanışı kapsamıyor.');
      continue;
    }
    parsed.push(b);
  }
  if (!parsed.length) return fail(result, 'Geçerli satır bulunamadı.');
  if (parsed.some((b, i) => i && b.time < parsed[i - 1].time)) {
    parsed.sort((a, b) => a.time - b.time || a.line - b.line);
    result.warnings.push('Satırlar zamana göre sıralandı.');
  }
  const candles: (Candle & { line: number })[] = [];
  for (const b of parsed) {
    const prev = candles.at(-1);
    if (prev && prev.time === b.time) {
      if (
        ['open', 'high', 'low', 'close', 'volume'].every((k) => prev[k as Field] === b[k as Field])
      ) {
        result.duplicates++;
        continue;
      }
      return fail(
        result,
        `Satır ${prev.line} ve ${b.line}: aynı zaman (${stamp(b.time)} UTC) için farklı değerler var.`,
      );
    }
    candles.push(b);
  }
  if (candles.length < 3) return fail(result, 'En az 3 geçerli mum gerekli.');
  const diffs = new Map<number, number>();
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time;
    diffs.set(d, (diffs.get(d) ?? 0) + 1);
  }
  const step = [...diffs].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0],
    interval = (Object.keys(intervals) as Interval[]).find((i) => intervals[i] === step) ?? null;
  if (!interval)
    return fail(
      result,
      `Algılanan mum aralığı (${human(step)}) desteklenmiyor. Desteklenenler: ${Object.keys(intervals).join(', ')}.`,
    );
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d % step)
      return fail(
        result,
        `Satır ${candles[i].line}: ${stamp(candles[i - 1].time)} → ${stamp(candles[i].time)} arası ${human(d)}; ${interval} mumlarla uyuşmuyor.`,
      );
    result.missing += d / step - 1;
  }
  result.interval = interval;
  result.candles = candles.map(({ line: _line, ...b }) => b);
  if (zoneless) result.warnings.push('Saat dilimi belirtilmeyen tarihler UTC kabul edildi.');
  if (columns.volume === null)
    result.warnings.push('Hacim sütunu yok; hacim 0 kabul edildi, hacim koşulları eşleşmez.');
  if (result.skippedCount)
    result.warnings.push(
      `${result.skippedCount.toLocaleString('tr-TR')} hatalı satır atlandı; bu zamanlar eksik mum sayılır.`,
    );
  if (result.duplicates)
    result.warnings.push(
      `${result.duplicates.toLocaleString('tr-TR')} yinelenen satır kaldırıldı.`,
    );
  if (result.missing)
    result.warnings.push(
      `${result.missing.toLocaleString('tr-TR')} mum eksik. Backtest bu zamanları atlar ve doğrulanamayan boşluk olarak sayar.`,
    );
  return result;
}
function emptyColumns(): Record<Field, number | null> {
  return { time: null, open: null, high: null, low: null, close: null, volume: null };
}
// By header name, or for headerless files the Binance kline order (time, OHLC, volume).
function detectColumns(header: string[] | null, count: number): Record<Field, number | null> {
  const columns = emptyColumns();
  if (!header) {
    fields.forEach((f, i) => (columns[f] = i < count ? i : null));
    return columns;
  }
  const names = header.map(fold);
  for (const f of fields) {
    const exact = names.findIndex((n) => aliases[f].includes(n));
    columns[f] =
      exact >= 0
        ? exact
        : f === 'volume'
          ? ((i) => (i >= 0 ? i : null))(names.findIndex((n) => /^(volume|hacim)/.test(n)))
          : null;
  }
  return columns;
}
function fail(result: CsvResult, message: string): CsvResult {
  result.errors.push(message);
  result.candles = [];
  result.interval = null;
  return result;
}
