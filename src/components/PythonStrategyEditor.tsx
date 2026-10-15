import { useEffect, useRef, useState } from 'react';
import { Download, FileCode2, LoaderCircle, Save, X } from 'lucide-react';
import {
  examplePython,
  MAX_PYTHON_BYTES,
  validatePythonStrategy,
  type PythonStrategy,
} from '../../shared/python-strategy';
import { api, download } from '../api';
import './python-strategy.css';

export function PythonStrategyEditor({
  value,
  onClose,
  onApply,
  ready,
}: {
  value: PythonStrategy;
  onClose: () => void;
  onApply: (value: PythonStrategy) => Promise<void>;
  ready: boolean;
}) {
  const [draft, setDraft] = useState(() => ({ ...value }));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]',
        ) ?? []),
      ];
      if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault();
        elements.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
        event.preventDefault();
        elements[0]?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  function change(next: PythonStrategy) {
    setDraft(next);
    setError('');
    setStatus('');
  }
  async function check(save: boolean) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      validatePythonStrategy(draft);
      await api('/python/validate', { method: 'POST', body: JSON.stringify(draft) });
      if (save) await onApply({ ...draft, name: draft.name.trim() });
      else
        setStatus(
          'Sözdizimi uygun. Kod çalıştırılmadı; işlem sinyalleri backtest sırasında kontrol edilir.',
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="modal panel python-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Python strateji editörü"
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-heading">
          <div className="heading-icon">
            <FileCode2 size={19} />
            <h2>Python Strateji Atölyesi</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Python editörünü kapat"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body python-editor-body">
          <p>Kendi mum formasyonunu Python ile yaz, dosyanı yükle ve geçmiş verilerle test et.</p>
          <div className="python-toolbar">
            <label className="field">
              <span>Python strateji adı</span>
              <input
                value={draft.name}
                maxLength={60}
                disabled={busy}
                onChange={(e) => change({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>.py dosyası yükle · en fazla 64 KB</span>
              <input
                type="file"
                accept=".py"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setBusy(true);
                  setError('');
                  setStatus('');
                  try {
                    if (!file.name.toLowerCase().endsWith('.py'))
                      throw new Error('Bir .py dosyası seçin.');
                    if (file.size > MAX_PYTHON_BYTES)
                      throw new Error('Python dosyası 64 KB sınırını aşamaz.');
                    const next = {
                      name: file.name.replace(/\.py$/i, '').slice(0, 60),
                      source: (await file.text()).replace(/^\uFEFF/, ''),
                    };
                    validatePythonStrategy(next);
                    change(next);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </div>
          <div className="python-actions">
            <button
              className="secondary compact"
              disabled={busy}
              onClick={() => download('ornek_strateji.py', examplePython.source, 'text/x-python')}
            >
              <Download size={14} />
              Örnek .py indir
            </button>
            <button
              className="secondary compact"
              disabled={busy}
              onClick={() => download('strateji.py', draft.source, 'text/x-python')}
            >
              <Download size={14} />
              Kodu .py indir
            </button>
          </div>
          <label className="field">
            <span>Python kodu</span>
            <textarea
              aria-label="Python kodu"
              className="python-code"
              value={draft.source}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={busy}
              onChange={(e) => change({ ...draft, source: e.target.value })}
            />
          </label>
          <details className="python-contract" open>
            <summary>Strateji nasıl yazılır?</summary>
            <p>
              <code>def on_candle(candles, state):</code> her kapanmış mum için çağrılır.
              <code> candles[-1]</code> son kapanan mum, <code>candles[-2]</code> bir önceki mumdur.
              Alanlar: <code>time, open, high, low, close, volume</code>. Zaman UTC Unix
              saniyesidir.
            </p>
            <p>
              <code>"buy"</code> long açar, <code>"sell"</code> long kapatır, <code>"hold"</code>{' '}
              veya <code>None</code> bekler. İşlem sonraki mumun açılışında gerçekleşir. Pozisyon
              varken yeni alım, pozisyon yokken satış yok sayılır.
            </p>
            <p>
              <code>state</code> her testte boş başlayan, kendi sayaç ve hesaplarını
              saklayabileceğin sözlüktür; açık pozisyon bilgisi içermez. Isınma süresini kodunda{' '}
              <code>len(candles)</code> ile kontrol et. Sermaye, komisyon, stop-loss ve take-profit
              terminalden uygulanır.
            </p>
            <p>
              Hazır bir Backtrader, pandas veya başka framework kodu bu fonksiyon arayüzüne
              uyarlanmalıdır. Python 3.9+ gerekir; ek paketler otomatik kurulmaz.
            </p>
          </details>
          <p className="python-notice">
            Backtest Başlat, kodu bu bilgisayarda çalıştırır. Python dosyalara ve ağa erişebilir;
            yalnızca güvendiğin kodları kullan. Yükleme ve sözdizimi kontrolü kodu çalıştırmaz.
            Kaydedilen kod, yerel şablonlara ve dışa aktarılan yedeklere dahil edilir.
          </p>
          {error && (
            <p className="python-error" role="alert">
              {error}
            </p>
          )}
          {status && (
            <p className="python-status" role="status">
              {status}
            </p>
          )}
          <div className="python-actions python-footer">
            <button className="secondary" disabled={busy} onClick={() => void check(false)}>
              Sözdizimini kontrol et
            </button>
            <button className="primary" disabled={busy || !ready} onClick={() => void check(true)}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}Kaydet ve
              kullan
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
