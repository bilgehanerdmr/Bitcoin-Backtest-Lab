import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  candleFields,
  candleLabel,
  customLookback,
  matchesGroup,
  MAX_OFFSET,
  MAX_RULES,
  newRule,
  operators,
  patternNames,
  patternStrategy,
  ruleText,
  validateCustomStrategy,
  type CandleField,
  type CandleReference,
  type CandleRule,
  type CustomStrategy,
  type Operator,
  type Pattern,
  type RuleGroup,
} from '../../shared/candle-rules';
import { intervals, type Candle, type Interval } from '../../shared/types';
import './custom-strategy.css';

interface Props {
  value: CustomStrategy;
  candles: Candle[];
  interval: Interval;
  // Names the preview's data when it is not the Binance chart (an uploaded dataset).
  sourceLabel?: string;
  onApply: (value: CustomStrategy) => void;
  onClose: () => void;
}
export function CustomStrategyEditor({
  value,
  candles,
  interval,
  sourceLabel,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(() => structuredClone(value)),
    [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('input')?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const focusable = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,a[href]',
          ) || []),
        ];
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  const preview = useMemo(() => {
    try {
      validateCustomStrategy(draft);
    } catch {
      return null;
    }
    const closed = candles.filter((c) => (c.time + intervals[interval]) * 1000 <= Date.now());
    const warmup = customLookback(draft);
    let entry = 0,
      exit = 0;
    for (let i = warmup; i < closed.length; i++) {
      const sell = matchesGroup(closed, i, draft.exit);
      if (sell) exit++;
      else if (matchesGroup(closed, i, draft.entry)) entry++;
    }
    return { count: Math.max(0, closed.length - warmup), entry, exit };
  }, [draft, candles, interval]);
  function changeGroup(side: 'entry' | 'exit', group: RuleGroup) {
    setError('');
    setDraft((d) => ({ ...d, [side]: group }));
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal panel custom-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Özel mum stratejisi editörü"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-heading">
          <div className="heading-icon">
            <SlidersHorizontal size={18} />
            <h2>Mumlarla kendi stratejinizi tanımlayın</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Editörü kapat">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body custom-editor-body">
          <div className="custom-intro">
            <p>
              <strong>Formasyonu tarif edin, geçmişte test edin.</strong>
              <br />
              “Son kapanan mum” sinyal mumudur. “1 mum önce” onun hemen öncesidir. Koşullar
              kapanışta değerlendirilir; işlem sonraki mumun açılışında gerçekleşir.
            </p>
          </div>
          <div className="custom-editor-top">
            <label className="field">
              <span>Özel strateji adı</span>
              <input
                value={draft.name}
                maxLength={60}
                onChange={(e) => {
                  setError('');
                  setDraft((d) => ({ ...d, name: e.target.value }));
                }}
              />
            </label>
            <div className="pattern-shortcuts">
              <span>Bir örnekle başla · mevcut kuralları değiştirir</span>
              <div>
                {Object.entries(patternNames).map(([id, name]) => (
                  <button
                    className="secondary compact"
                    key={id}
                    onClick={() => {
                      setDraft(patternStrategy(id as Pattern));
                      setError('');
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <RuleGroupEditor
            title="Giriş kuralları"
            description="Pozisyon yokken bu koşullar sağlanırsa LONG açılır."
            value={draft.entry}
            onChange={(group) => changeGroup('entry', group)}
            entry
          />
          <RuleGroupEditor
            title="Çıkış kuralları"
            description="Açık pozisyon bu koşullarda kapatılır. Boş bırakırsanız stop-loss, take-profit ve test sonu çıkışı kullanılır."
            value={draft.exit}
            onChange={(group) => changeGroup('exit', group)}
          />
          <div className="custom-preview">
            <div>
              <strong>Grafikteki kapanmış mumlarda önizleme</strong>
              <span>
                {interval} · {sourceLabel ?? 'Binance Spot'} · {preview?.count ?? 0}{' '}
                değerlendirilebilir mum
              </span>
            </div>
            <div className="preview-counts">
              <span>
                <b className="positive">{preview?.entry ?? '—'}</b> giriş eşleşmesi
              </span>
              <span>
                <b>{preview?.exit ?? '—'}</b> çıkış eşleşmesi
              </span>
            </div>
            <small>
              Eşleşmeler işlem sayısı değildir. Pozisyon durumu ve risk kuralları backtest sırasında
              uygulanır.
            </small>
          </div>
          <p className="custom-method">
            Fiyat ve fitil uzunlukları USDT, hacim BTC cinsindedir. “Gövde / toplam mum” gibi
            oranlar yüzdeyle girilir. Toplam uzunluğu sıfır olan mumlarda bu oran koşulları
            eşleşmez. Giriş ve çıkış aynı anda eşleşirse çıkış önceliklidir; çıkış yapılan mumda
            yeniden giriş yapılmaz.
          </p>
          {error && (
            <div className="notice error-notice" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="custom-editor-footer">
          <span>Son 21 mum · Grup başına en fazla 20 koşul</span>
          <div>
            <button className="secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button
              className="primary"
              onClick={() => {
                try {
                  const next = { ...draft, name: draft.name.trim() };
                  validateCustomStrategy(next);
                  onApply(structuredClone(next));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Check size={15} />
              Kuralları uygula <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
function RuleGroupEditor({
  title,
  description,
  value,
  onChange,
  entry = false,
}: {
  title: string;
  description: string;
  value: RuleGroup;
  onChange: (group: RuleGroup) => void;
  entry?: boolean;
}) {
  function update(index: number, rule: CandleRule) {
    onChange({ ...value, rules: value.rules.map((r, i) => (i === index ? rule : r)) });
  }
  return (
    <fieldset className="rule-group">
      <legend>{title}</legend>
      <div className="rule-group-header">
        <p>{description}</p>
        <label className="field">
          <span>Koşulların birleşimi</span>
          <select
            value={value.mode}
            onChange={(e) => onChange({ ...value, mode: e.target.value as RuleGroup['mode'] })}
          >
            <option value="all">Tümü sağlanmalı (VE)</option>
            <option value="any">En az biri sağlanmalı (VEYA)</option>
          </select>
        </label>
      </div>
      <div className="rule-list">
        {value.rules.map((rule, i) => (
          <div className="candle-rule" key={i}>
            <div className="rule-number">{String(i + 1).padStart(2, '0')}</div>
            <div className="rule-main">
              <div className="rule-controls">
                <CandleReferenceInputs
                  value={rule.left}
                  label={`Koşul ${i + 1} sol`}
                  onChange={(left) =>
                    update(i, {
                      ...rule,
                      left,
                      right:
                        rule.right.kind === 'candle' &&
                        candleFields[left.field].unit !== candleFields[rule.right.field].unit
                          ? { kind: 'number', value: 0 }
                          : rule.right,
                    })
                  }
                />
                <select
                  className="operator-select"
                  aria-label={`Koşul ${i + 1} karşılaştırma`}
                  value={rule.operator}
                  onChange={(e) => update(i, { ...rule, operator: e.target.value as Operator })}
                >
                  {Object.entries(operators).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="rule-target">
                  <select
                    aria-label={`Koşul ${i + 1} hedef türü`}
                    value={rule.right.kind}
                    onChange={(e) =>
                      update(i, {
                        ...rule,
                        right:
                          e.target.value === 'number'
                            ? { kind: 'number', value: 0 }
                            : { kind: 'candle', field: rule.left.field, offset: 0, factor: 1 },
                      })
                    }
                  >
                    <option value="candle">Mum değeri</option>
                    <option value="number">Sabit sayı</option>
                  </select>
                  {rule.right.kind === 'number' ? (
                    <div className="rule-constant">
                      <input
                        aria-label={`Koşul ${i + 1} eşik`}
                        type="number"
                        step="any"
                        value={Number.isNaN(rule.right.value) ? '' : rule.right.value}
                        onChange={(e) =>
                          update(i, {
                            ...rule,
                            right: { kind: 'number', value: e.target.valueAsNumber },
                          })
                        }
                      />
                      <span>{candleFields[rule.left.field].unit}</span>
                    </div>
                  ) : (
                    <>
                      <CandleReferenceInputs
                        value={rule.right}
                        label={`Koşul ${i + 1} sağ`}
                        unit={candleFields[rule.left.field].unit}
                        onChange={(ref) =>
                          update(i, {
                            ...rule,
                            right: {
                              ...ref,
                              kind: 'candle',
                              factor: rule.right.kind === 'candle' ? rule.right.factor : 1,
                            },
                          })
                        }
                      />
                      <label className="factor-input">
                        <span>×</span>
                        <input
                          aria-label={`Koşul ${i + 1} çarpan`}
                          type="number"
                          min="0.001"
                          max="1000"
                          step="any"
                          value={Number.isNaN(rule.right.factor) ? '' : rule.right.factor}
                          onChange={(e) => {
                            if (rule.right.kind === 'candle')
                              update(i, {
                                ...rule,
                                right: { ...rule.right, factor: e.target.valueAsNumber },
                              });
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
              <div className="rule-summary">{ruleText(rule)}</div>
            </div>
            <button
              className="icon-button"
              aria-label={`Koşul ${i + 1} sil`}
              disabled={entry && value.rules.length === 1}
              onClick={() =>
                onChange({ ...value, rules: value.rules.filter((_, index) => index !== i) })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {!value.rules.length && (
        <p className="no-exit-rules">
          Mum formasyonuyla çıkış kapalı. Terminaldeki risk ayarları ve test sonu çıkışı geçerli.
        </p>
      )}
      <button
        className="secondary compact"
        disabled={value.rules.length >= MAX_RULES}
        onClick={() => onChange({ ...value, rules: [...value.rules, newRule()] })}
      >
        <Plus size={14} />
        Koşul ekle
      </button>
    </fieldset>
  );
}
function CandleReferenceInputs({
  value,
  label,
  onChange,
  unit,
}: {
  value: CandleReference;
  label: string;
  onChange: (v: CandleReference) => void;
  unit?: string;
}) {
  return (
    <div className="candle-reference">
      <select
        aria-label={label + ' mum'}
        value={value.offset}
        onChange={(e) => onChange({ ...value, offset: Number(e.target.value) })}
      >
        {Array.from({ length: MAX_OFFSET + 1 }, (_, i) => (
          <option key={i} value={i}>
            {candleLabel(i)}
          </option>
        ))}
      </select>
      <select
        aria-label={label + ' alan'}
        value={value.field}
        onChange={(e) => onChange({ ...value, field: e.target.value as CandleField })}
      >
        {Object.entries(candleFields)
          .filter(([, field]) => !unit || field.unit === unit)
          .map(([id, field]) => (
            <option key={id} value={id}>
              {field.label}
            </option>
          ))}
      </select>
    </div>
  );
}
