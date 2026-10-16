import { db } from './market';
import type { PaperSession, PaperSignal } from '../shared/paper';
import type { EquityPoint, Trade } from '../shared/types';
// Signals, equity and closed trades never change once written, so rows are only appended.
db.exec(
  'CREATE TABLE IF NOT EXISTS paper_sessions (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paper_signals (session_id TEXT, time INTEGER, signal TEXT, PRIMARY KEY(session_id,time)); CREATE TABLE IF NOT EXISTS paper_equity (session_id TEXT, time INTEGER, value REAL, benchmark REAL, drawdown REAL, PRIMARY KEY(session_id,time)); CREATE TABLE IF NOT EXISTS paper_trades (session_id TEXT, id INTEGER, payload TEXT, PRIMARY KEY(session_id,id));',
);
export type SignalRow = PaperSignal;
export interface SessionRows {
  signals?: SignalRow[];
  equity?: EquityPoint[];
  trades?: Trade[];
}
export function listSessions(): PaperSession[] {
  return (
    db.prepare('SELECT payload FROM paper_sessions ORDER BY created_at DESC').all() as {
      payload: string;
    }[]
  ).map((row) => JSON.parse(row.payload));
}
export function readSession(id: string): PaperSession | null {
  const row = db.prepare('SELECT payload FROM paper_sessions WHERE id=?').get(id) as
    { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}
export function readSignals(id: string): SignalRow[] {
  return db
    .prepare('SELECT time,signal FROM paper_signals WHERE session_id=? ORDER BY time')
    .all(id) as unknown as SignalRow[];
}
export function readEquity(id: string): EquityPoint[] {
  return db
    .prepare(
      'SELECT time,value,benchmark,drawdown FROM paper_equity WHERE session_id=? ORDER BY time',
    )
    .all(id) as unknown as EquityPoint[];
}
export function readTrades(id: string): Trade[] {
  return (
    db.prepare('SELECT payload FROM paper_trades WHERE session_id=? ORDER BY id').all(id) as {
      payload: string;
    }[]
  ).map((row) => JSON.parse(row.payload));
}
export function countTrades(id: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM paper_trades WHERE session_id=?').get(id) as {
      count: number;
    }
  ).count;
}
// Writes without a transaction, for callers that already hold one (backup import).
export function writeSessionRows(s: PaperSession, rows: SessionRows = {}) {
  db.prepare(
    'INSERT INTO paper_sessions (id,created_at,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
  ).run(s.id, s.createdAt, JSON.stringify(s));
  const signal = db.prepare('INSERT OR IGNORE INTO paper_signals VALUES (?,?,?)'),
    point = db.prepare('INSERT OR IGNORE INTO paper_equity VALUES (?,?,?,?,?)'),
    trade = db.prepare('INSERT OR IGNORE INTO paper_trades VALUES (?,?,?)');
  for (const r of rows.signals ?? []) signal.run(s.id, r.time, r.signal);
  for (const p of rows.equity ?? []) point.run(s.id, p.time, p.value, p.benchmark, p.drawdown);
  for (const t of rows.trades ?? []) trade.run(s.id, t.id, JSON.stringify(t));
}
// The session and everything a batch of candles added, committed together.
export function saveSession(s: PaperSession, rows: SessionRows = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    writeSessionRows(s, rows);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function sessionExists(id: string): boolean {
  return !!db.prepare('SELECT 1 FROM paper_sessions WHERE id=?').get(id);
}
