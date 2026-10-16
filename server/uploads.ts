import { randomUUID } from 'node:crypto';
import { db } from './market';
import { HttpError } from './errors';
import {
  fields,
  MAX_UPLOAD_BYTES,
  parseCandleCsv,
  validateUploadName,
  type CsvOptions,
  type UploadMeta,
} from '../shared/upload';
import type { Candle } from '../shared/types';
db.exec(
  'CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS upload_candles (upload_id TEXT NOT NULL, time INTEGER NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(upload_id,time));',
);
export function listUploads(): UploadMeta[] {
  return (
    db.prepare('SELECT payload FROM uploads ORDER BY created_at DESC').all() as {
      payload: string;
    }[]
  ).map((row) => JSON.parse(row.payload));
}
export function readUpload(id: string): UploadMeta | null {
  const row = db.prepare('SELECT payload FROM uploads WHERE id=?').get(id) as
    { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}
export function uploadCandles(id: string, start = -Infinity, end = Infinity): Candle[] {
  return db
    .prepare(
      'SELECT time,open,high,low,close,volume FROM upload_candles WHERE upload_id=? AND time>=? AND time<=? ORDER BY time',
    )
    .all(id, start, end) as unknown as Candle[];
}
export function latestUploadCandles(id: string, count: number): Candle[] {
  return db
    .prepare(
      'SELECT * FROM (SELECT time,open,high,low,close,volume FROM upload_candles WHERE upload_id=? ORDER BY time DESC LIMIT ?) ORDER BY time',
    )
    .all(id, count) as unknown as Candle[];
}
// Without a transaction, for callers that already hold one (backup import).
export function writeUploadRows(meta: UploadMeta, candles: Candle[]) {
  db.prepare('INSERT INTO uploads (id,created_at,payload) VALUES (?,?,?)').run(
    meta.id,
    meta.createdAt,
    JSON.stringify(meta),
  );
  const insert = db.prepare('INSERT INTO upload_candles VALUES (?,?,?,?,?,?,?)');
  for (const b of candles) insert.run(meta.id, b.time, b.open, b.high, b.low, b.close, b.volume);
}
export function uploadExists(id: string): boolean {
  return !!db.prepare('SELECT 1 FROM uploads WHERE id=?').get(id);
}
function csvOptions(input: unknown): Partial<CsvOptions> {
  if (input === undefined) return {};
  const o = input as Partial<CsvOptions>,
    column = (v: unknown) =>
      v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000);
  if (
    !o ||
    typeof o !== 'object' ||
    (o.delimiter !== undefined && ![',', ';', '\t'].includes(o.delimiter)) ||
    (o.decimal !== undefined && !['.', ','].includes(o.decimal)) ||
    (o.header !== undefined && typeof o.header !== 'boolean') ||
    (o.columns !== undefined &&
      (!o.columns ||
        !fields.every((f) => column(o.columns![f])) ||
        fields.some((f) => f !== 'volume' && o.columns![f] === null)))
  )
    throw new Error('Geçersiz dosya okuma ayarları.');
  return o;
}
// The file is parsed again here with the settings the user confirmed in the preview; the
// server's reading is the one that is stored.
export function createUpload(input: unknown): UploadMeta {
  const body = (input ?? {}) as {
    name?: unknown;
    fileName?: unknown;
    text?: unknown;
    options?: unknown;
  };
  validateUploadName(body.name);
  if (typeof body.fileName !== 'string' || body.fileName.length > 200)
    throw new Error('Geçersiz dosya adı.');
  if (typeof body.text !== 'string' || !body.text.length) throw new Error('Dosya içeriği gerekli.');
  if (Buffer.byteLength(body.text) > MAX_UPLOAD_BYTES)
    throw new HttpError(413, 'Dosya 50 MB sınırını aşıyor.');
  const parsed = parseCandleCsv(body.text, csvOptions(body.options));
  if (parsed.errors.length) throw new Error(parsed.errors[0]);
  const meta: UploadMeta = {
    id: randomUUID(),
    name: body.name.trim(),
    fileName: body.fileName,
    createdAt: new Date().toISOString(),
    interval: parsed.interval!,
    count: parsed.candles.length,
    start: parsed.candles[0].time,
    end: parsed.candles.at(-1)!.time,
    missing: parsed.missing,
    hasVolume: parsed.options.columns.volume !== null,
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    writeUploadRows(meta, parsed.candles);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return meta;
}
// Reports made from the dataset keep their own copy of the results.
export function deleteUpload(id: string): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { changes } = db.prepare('DELETE FROM uploads WHERE id=?').run(id);
    db.prepare('DELETE FROM upload_candles WHERE upload_id=?').run(id);
    db.exec('COMMIT');
    return changes > 0;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
