import { useState } from 'react';
import { ArrowRight, FileUp, LoaderCircle, Trash2, Upload, X } from 'lucide-react';
import { api, date, money } from '../api';
import { PriceChart } from './Chart';
import {
  fieldLabels,
  fields,
  MAX_UPLOAD_BYTES,
  parseCandleCsv,
  timeFormatLabels,
  type CsvOptions,
  type CsvResult,
  type Field,
  type UploadMeta,
} from '../../shared/upload';
import './upload.css';

const delimiters: [CsvOptions['delimiter'], string][] = [
  [',', 'Virgül ( , )'],
  [';', 'Noktalı virgül ( ; )'],
  ['\t', 'Sekme'],
];
interface Draft {
  fileName: string;
  text: string;
  name: string;
  result: CsvResult;
}
export function UploadPanel({
  uploads,
  onChanged,
  onUse,
  onToast,
}: {
  uploads: UploadMeta[];
  onChanged: () => void;
  onUse: (upload: UploadMeta) => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState('');
  // Parsing a large file takes a moment; let the spinner render first.
  const later = <T,>(work: () => T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(work())));
  async function choose(file: File | undefined) {
    if (!file) return;
    setError('');
    setDraft(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Dosya 50 MB sınırını aşıyor.');
      return;
    }
    setBusy('read');
    try {
      const text = await file.text(),
        result = await later(() => parseCandleCsv(text));
      setDraft({
        fileName: file.name,
        text,
        name: file.name.replace(/\.(csv|txt)$/i, '').slice(0, 60),
        result,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function reparse(change: Partial<CsvOptions>) {
    if (!draft) return;
    setBusy('read');
    const options = { ...draft.result.options, ...change },
      result = await later(() => parseCandleCsv(draft.text, options));
    setDraft({ ...draft, result });
    setBusy('');
  }
  function setColumn(field: Field, value: string) {
    if (!draft) return;
    void reparse({
      columns: { ...draft.result.options.columns, [field]: value === '' ? null : Number(value) },
    });
  }
  async function save() {
    if (!draft) return;
    setBusy('save');
    setError('');
    try {
      const meta = await api<UploadMeta>('/uploads', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          fileName: draft.fileName,
          text: draft.text,
          options: draft.result.options,
        }),
      });
      setDraft(null);
      onChanged();
      onToast(`“${meta.name}” kaydedildi: ${meta.count.toLocaleString('tr-TR')} mum.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove(id: string) {
    setBusy('delete');
    setError('');
    try {
      await api('/uploads/' + id, { method: 'DELETE' });
      setConfirmDelete('');
      onChanged();
      onToast('Veri seti silindi. Bu veriyle oluşturulan raporlar korunuyor.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const r = draft?.result,
    ready = !!r && !r.errors.length && !!draft!.name.trim() && draft!.name.length <= 60;
  return (
    <section className="panel upload-panel" aria-label="Kendi verini yükle">
      <div className="panel-heading">
        <div className="heading-icon">
          <FileUp size={18} />
          <h2>Kendi Verini Yükle</h2>
        </div>
        <span className="tiny-badge">CSV</span>
      </div>
      <div className="upload-body">
        <p>
          Kendi OHLCV mumlarınızla backtest yapın. TradingView dışa aktarımları, Binance arşiv
          dosyaları ve Türkçe Excel çıktıları (noktalı virgül, virgüllü ondalık) otomatik tanınır.
          Dosya bilgisayarınızda kalır; en fazla 50 MB ve 1.000.000 satır.
        </p>
        <label className="secondary upload-choose">
          {busy === 'read' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
          CSV dosyası seç
          <input
            type="file"
            accept=".csv,.txt,text/csv"
            aria-label="CSV dosyası"
            disabled={!!busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {error && (
          <div className="notice error-notice" role="alert">
            {error}
          </div>
        )}
        {draft && r && (
          <div className="upload-preview" aria-label="Yükleme önizlemesi">
            <div className="upload-file">
              <strong>{draft.fileName}</strong>
              <button
                className="icon-button"
                aria-label="Önizlemeyi kapat"
                disabled={!!busy}
                onClick={() => setDraft(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="upload-settings">
              <label className="field">
                <span>Ayraç</span>
                <select
                  value={r.options.delimiter}
                  onChange={(e) =>
                    void reparse({ delimiter: e.target.value as CsvOptions['delimiter'] })
                  }
                >
                  {delimiters.map(([value, label]) => (
                    <option key={label} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Ondalık ayırıcı</span>
                <select
                  value={r.options.decimal}
                  onChange={(e) =>
                    void reparse({ decimal: e.target.value as CsvOptions['decimal'] })
                  }
                >
                  <option value=".">Nokta (1234.56)</option>
                  <option value=",">Virgül (1.234,56)</option>
                </select>
              </label>
              <label className="field upload-check">
                <span>Başlık satırı</span>
                <input
                  type="checkbox"
                  checked={r.options.header}
                  onChange={(e) => void reparse({ header: e.target.checked })}
                />
              </label>
            </div>
            <div className="upload-columns">
              {fields.map((f) => (
                <label className="field" key={f}>
                  <span>{fieldLabels[f]}</span>
                  <select
                    aria-label={fieldLabels[f] + ' sütunu'}
                    value={r.options.columns[f] ?? ''}
                    onChange={(e) => setColumn(f, e.target.value)}
                  >
                    {f === 'volume' && <option value="">Yok</option>}
                    {f !== 'volume' && r.options.columns[f] === null && (
                      <option value="">Seçin</option>
                    )}
                    {r.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Sütun ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {r.errors.length > 0 ? (
              <div className="notice error-notice" role="alert">
                {r.errors[0]}
              </div>
            ) : (
              <>
                <div className="upload-stats">
                  <span>
                    <b>{r.candles.length.toLocaleString('tr-TR')}</b> mum
                  </span>
                  <span>
                    <b>{r.interval}</b> zaman dilimi
                  </span>
                  <span>
                    <b>{date(r.candles[0].time)}</b> → <b>{date(r.candles.at(-1)!.time)}</b> UTC
                  </span>
                  <span>
                    <b>{r.missing.toLocaleString('tr-TR')}</b> eksik mum
                  </span>
                  <span>
                    <b>{r.skippedCount.toLocaleString('tr-TR')}</b> atlanan satır
                  </span>
                  <span>{r.timeFormat && timeFormatLabels[r.timeFormat]}</span>
                </div>
                {r.warnings.length > 0 && (
                  <ul className="upload-warnings">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {r.skipped.length > 0 && (
                  <details className="upload-skipped">
                    <summary>Atlanan satırlardan örnekler</summary>
                    <ul>
                      {r.skipped.map((s) => (
                        <li key={s.line}>
                          Satır {s.line}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="table-scroll">
                  <table className="upload-sample">
                    <thead>
                      <tr>
                        <th>Zaman · UTC</th>
                        <th>Açılış</th>
                        <th>En yüksek</th>
                        <th>En düşük</th>
                        <th>Kapanış</th>
                        <th>Hacim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.candles.slice(0, 4).map((c) => (
                        <tr key={c.time}>
                          <td>
                            {new Date(c.time * 1000).toISOString().slice(0, 16).replace('T', ' ')}
                          </td>
                          <td>{money(c.open, 4)}</td>
                          <td>{money(c.high, 4)}</td>
                          <td>{money(c.low, 4)}</td>
                          <td>{money(c.close, 4)}</td>
                          <td>{money(c.volume, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="upload-chart">
                  <PriceChart
                    candles={r.candles.slice(-500)}
                    indicators={false}
                    fast={9}
                    slow={21}
                  />
                </div>
              </>
            )}
            <div className="upload-save">
              <label className="field">
                <span>Veri seti adı</span>
                <input
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <button className="primary" disabled={!ready || !!busy} onClick={save}>
                {busy === 'save' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Upload size={15} />
                )}
                Veri setini kaydet
              </button>
            </div>
          </div>
        )}
      </div>
      {uploads.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Veri seti</th>
                <th>Zaman dilimi</th>
                <th>Mum</th>
                <th>Aralık · UTC</th>
                <th>Eksik</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <small>{u.fileName}</small>
                  </td>
                  <td>{u.interval}</td>
                  <td>{u.count.toLocaleString('tr-TR')}</td>
                  <td>
                    {date(u.start)}
                    <small>{date(u.end)}</small>
                  </td>
                  <td>{u.missing.toLocaleString('tr-TR')}</td>
                  <td>
                    <div className="report-actions">
                      {confirmDelete === u.id ? (
                        <>
                          <button
                            className="danger-button"
                            disabled={!!busy}
                            onClick={() => void remove(u.id)}
                          >
                            Silmeyi onayla
                          </button>
                          <button
                            className="secondary compact"
                            onClick={() => setConfirmDelete('')}
                          >
                            Vazgeç
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="secondary compact" onClick={() => onUse(u)}>
                            Backtest'te kullan <ArrowRight size={14} />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={'Veri setini sil ' + u.name}
                            onClick={() => setConfirmDelete(u.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
