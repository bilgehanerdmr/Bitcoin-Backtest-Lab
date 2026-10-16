import { useRef, useState } from 'react';
import { Archive, Check, Download, FileJson, LoaderCircle, Upload, X } from 'lucide-react';
import { api, download } from '../api';
import {
  MAX_BACKUP_BYTES,
  validateBackup,
  type Backup,
  type ImportSummary,
} from '../../shared/backup';
import './storage.css';

export function BackupPanel({
  disabled,
  onImported,
}: {
  disabled: boolean;
  onImported: (summary: ImportSummary) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; backup: Backup } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function exportData() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const backup = await api<Backup>('/backup'),
        json = JSON.stringify(backup);
      if (new Blob([json]).size > MAX_BACKUP_BYTES)
        throw new Error(
          'Yedek 100 MB sınırını aşıyor. Büyük depoları taşımak için uygulama kapalıyken data klasörünün tamamını kopyalayın.',
        );
      download(
        `bitcoin-lab-yedek-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        json,
        'application/json',
      );
      setMessage(
        `${backup.candles.length.toLocaleString('tr-TR')} mum, ${backup.backtests.length} rapor, ${backup.workspace.presets.length} şablon ve ${backup.paperSessions?.length ?? 0} canlı test oturumu dışa aktarıldı.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setMessage('');
    setPending(null);
    setBusy(true);
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error('En fazla 100 MB boyutunda bir yedek seçin.');
      let parsed: unknown;
      try {
        parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      } catch {
        throw new Error('Dosya geçerli bir JSON yedeği değil.');
      }
      validateBackup(parsed);
      setPending({ name: file.name, backup: parsed });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function importData() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const summary = await api<ImportSummary>('/backup/import', {
        method: 'POST',
        body: JSON.stringify(pending.backup),
      });
      onImported(summary);
      setPending(null);
      setMessage(
        `${summary.candlesAdded.toLocaleString('tr-TR')} mum, ${summary.reportsAdded} rapor, ${summary.presetsAdded} şablon ve ${summary.sessionsAdded} canlı test oturumu eklendi. Mevcut ${summary.candlesSkipped.toLocaleString('tr-TR')} mum ve ${summary.reportsSkipped} rapor korundu. Ayarlar yerel depoya kaydedildi.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel backup-panel">
      <div className="panel-heading">
        <div className="heading-icon">
          <Archive size={18} />
          <h2>Yerel Yedekleme ve Taşıma</h2>
        </div>
        <span className="tiny-badge">JSON · v1</span>
      </div>
      <div className="backup-body">
        <p>
          Mum verileri, tüm test raporları, canlı test oturumları, özel mum kuralları, şablonlar ve
          varsayılan ayarlar bilgisayarınızdaki SQLite dosyasında saklanır. Tek bir yedekle başka
          bilgisayardaki Bitcoin Lab'a taşıyın.
        </p>
        <div className="backup-actions">
          <button className="secondary" disabled={disabled || busy} onClick={exportData}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}Tüm
            verileri dışa aktar
          </button>
          <button
            className="primary"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={15} />
            Yedek dosyası seç
          </button>
          <input
            ref={input}
            aria-label="Yedek dosyası"
            type="file"
            accept=".json,application/json"
            hidden
            disabled={disabled || busy}
            onChange={(e) => void chooseFile(e.target.files?.[0])}
          />
        </div>
        <small>
          Yerel dosya: data/bitcoin-lab.sqlite · En fazla 100 MB JSON · CSV çıktıları yedek olarak
          içe alınmaz.
        </small>
        {pending && (
          <div className="backup-preview">
            <div className="backup-file">
              <FileJson size={24} />
              <div>
                <strong>{pending.name}</strong>
                <small>{new Date(pending.backup.exportedAt).toLocaleString('tr-TR')}</small>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="Yedek seçimini iptal et"
                onClick={() => setPending(null)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="backup-counts">
              <span>
                <b>{pending.backup.candles.length.toLocaleString('tr-TR')}</b> mum
              </span>
              <span>
                <b>{pending.backup.backtests.length}</b> rapor
              </span>
              <span>
                <b>{pending.backup.workspace.presets.length}</b> şablon
              </span>
              <span>
                <b>{pending.backup.paperSessions?.length ?? 0}</b> canlı test
              </span>
            </div>
            <p>
              Yeni kayıtlar eklenir; aynı zaman dilimi/tarihli mumlar ve aynı kimlikli raporlar
              korunur. Şablonlar birleştirilir. Yedekteki varsayılan ayarlar uygulanır. Canlı test
              oturumları durdurulmuş olarak eklenir; içe aktarma strateji kodu çalıştırmaz.
            </p>
            <button className="primary" disabled={disabled || busy} onClick={importData}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}İçe
              aktarmayı başlat
            </button>
          </div>
        )}
        {error && (
          <div className="notice error-notice" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="backup-success" role="status">
            <Check size={16} />
            {message}
          </div>
        )}
      </div>
    </section>
  );
}
