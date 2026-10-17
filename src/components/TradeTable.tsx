import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Trade } from '../../shared/types';
import { date, money, pct } from '../api';

export function tradesCsv(trades: Trade[]): string {
  return [
    'ID,Giris UTC,Cikis UTC,Giris fiyati,Cikis fiyati,BTC miktari,Komisyon USDT,Net PnL USDT,Getiri %,Cikis nedeni',
    ...trades.map((t) =>
      [
        t.id,
        new Date(t.entryTime * 1000).toISOString(),
        new Date(t.exitTime * 1000).toISOString(),
        t.entry,
        t.exit,
        t.quantity,
        t.fees,
        t.pnl,
        t.returnPct,
        t.reason,
      ].join(','),
    ),
  ].join('\n');
}
export function TradeTable({
  trades,
  page,
  setPage,
  digits = 2,
  empty = {
    title: 'Bu aralıkta işlem sinyali oluşmadı.',
    hint: 'Tarih aralığını genişletin veya strateji parametrelerini değiştirin.',
  },
}: {
  trades: Trade[];
  page: number;
  setPage: (n: number) => void;
  // Price decimals of the traded pair.
  digits?: number;
  empty?: { title: string; hint: string };
}) {
  const size = 7,
    rows = trades.slice(page * size, (page + 1) * size);
  return trades.length ? (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>İşlem</th>
              <th>Giriş / Çıkış · UTC</th>
              <th>Giriş / Çıkış Fiyatı</th>
              <th>Net PnL</th>
              <th>Çıkış</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="long-tag">LONG</span>
                  <small>#{String(t.id).padStart(3, '0')}</small>
                </td>
                <td>
                  {date(t.entryTime)}
                  <small>{date(t.exitTime)}</small>
                </td>
                <td>
                  {money(t.entry, digits)}
                  <small>{money(t.exit, digits)}</small>
                </td>
                <td className={t.pnl >= 0 ? 'positive' : 'negative'}>
                  {t.pnl >= 0 ? '+' : ''}
                  {money(t.pnl)}
                  <small className={t.pnl >= 0 ? 'positive' : 'negative'}>{pct(t.returnPct)}</small>
                </td>
                <td>{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          {page * size + 1}–{Math.min((page + 1) * size, trades.length)} / {trades.length} işlem
        </span>
        <div>
          <button
            className="icon-button"
            disabled={!page}
            onClick={() => setPage(page - 1)}
            aria-label="Önceki sayfa"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            disabled={(page + 1) * size >= trades.length}
            onClick={() => setPage(page + 1)}
            aria-label="Sonraki sayfa"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </>
  ) : (
    <div className="empty-state">
      <Activity size={25} />
      <h3>{empty.title}</h3>
      <p>{empty.hint}</p>
    </div>
  );
}
