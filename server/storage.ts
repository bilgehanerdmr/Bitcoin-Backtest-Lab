import { db } from './market';
import { type Backup, type ImportSummary, validateBackup, isReportId } from '../shared/backup';
import {
  emptyWorkspace,
  mergeWorkspace,
  validateWorkspace,
  type Workspace,
} from '../shared/workspace';
import { DEFAULT_SYMBOL, type Result } from '../shared/types';
import * as paperStore from './paper-store';
db.exec(
  'CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
);
export function saveReport(result: Result) {
  db.prepare('INSERT INTO backtests VALUES(?,?,?)').run(
    result.id,
    result.createdAt,
    JSON.stringify(result),
  );
}
export function readWorkspace(): Workspace | null {
  const row = db.prepare('SELECT payload FROM workspace WHERE id=1').get() as
    { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}
export function writeWorkspace(workspace: Workspace) {
  validateWorkspace(workspace);
  db.prepare(
    'INSERT INTO workspace (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
  ).run(JSON.stringify(workspace));
}
export function exportBackup(): Backup {
  return {
    format: 'bitcoin-lab-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    candles: db
      .prepare(
        'SELECT symbol,interval,time,open,high,low,close,volume FROM candles ORDER BY symbol,interval,time',
      )
      .all() as unknown as Backup['candles'],
    backtests: (
      db.prepare('SELECT payload FROM backtests ORDER BY created_at').all() as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as Result),
    workspace: readWorkspace() ?? emptyWorkspace(),
    paperSessions: paperStore.listSessions().map((session) => ({
      session,
      signals: paperStore.readSignals(session.id),
      equity: paperStore.readEquity(session.id),
      trades: paperStore.readTrades(session.id),
    })),
  };
}
export function importBackup(input: unknown): ImportSummary {
  validateBackup(input);
  const before = readWorkspace() ?? emptyWorkspace(),
    workspace = mergeWorkspace(before, input.workspace);
  const summary: ImportSummary = {
    candlesAdded: 0,
    candlesSkipped: 0,
    reportsAdded: 0,
    reportsSkipped: 0,
    presetsAdded: workspace.presets.length - before.presets.length,
    sessionsAdded: 0,
    sessionsSkipped: 0,
    workspace,
  };
  const candle = db.prepare(
      'INSERT OR IGNORE INTO candles (symbol,interval,time,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?,?)',
    ),
    report = db.prepare('INSERT OR IGNORE INTO backtests (id,created_at,payload) VALUES (?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const c of input.candles) {
      const { changes } = candle.run(
        c.symbol ?? DEFAULT_SYMBOL,
        c.interval,
        c.time,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
      );
      if (changes) summary.candlesAdded++;
      else summary.candlesSkipped++;
    }
    for (const r of input.backtests) {
      const { changes } = report.run(r.id, r.createdAt, JSON.stringify(r));
      if (changes) summary.reportsAdded++;
      else summary.reportsSkipped++;
    }
    for (const { session, signals, equity, trades } of input.paperSessions ?? []) {
      if (paperStore.sessionExists(session.id)) {
        summary.sessionsSkipped++;
        continue;
      }
      // Importing must never run strategy code, so sessions arrive stopped.
      const restored =
        session.status === 'stopped'
          ? session
          : {
              ...session,
              status: 'stopped' as const,
              stoppedAt: new Date().toISOString(),
              stopReason:
                'Yedekten içe aktarıldı; içe aktarılan oturumlar kendiliğinden devam etmez.',
              clock: null,
            };
      paperStore.writeSessionRows(restored, { signals, equity, trades });
      summary.sessionsAdded++;
    }
    writeWorkspace(workspace);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return summary;
}
export function deleteReports(ids: unknown): string[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every(isReportId))
    throw new Error('Silmek için 1–1000 geçerli rapor seçin.');
  const statement = db.prepare('DELETE FROM backtests WHERE id=?'),
    deleted: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const id of new Set(ids)) {
      if (statement.run(id).changes) deleted.push(id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return deleted;
}
