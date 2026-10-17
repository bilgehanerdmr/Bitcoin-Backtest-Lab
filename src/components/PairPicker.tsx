import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { pairLabel, popularBases, type PairInfo } from '../../shared/pairs';
import './pair-picker.css';

const LIMIT = 60;
// A searchable list of Binance USDT spot pairs: type to filter, arrows and Enter to choose,
// Escape to close. Popular pairs come first.
export function PairPicker({
  value,
  pairs,
  onChange,
}: {
  value: string;
  pairs: PairInfo[];
  onChange: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    box = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    listId = useId();
  const matches = useMemo(() => {
    const q = query
        .trim()
        .toUpperCase()
        .replace(/\s*\/\s*USDT$|USDT$/, ''),
      rank = (p: PairInfo) => {
        const popular = popularBases.indexOf(p.base);
        return popular >= 0 ? popular : popularBases.length;
      };
    return pairs
      .filter((p) => !q || p.base.includes(q))
      .sort(
        (a, b) =>
          Number(b.base.startsWith(q)) - Number(a.base.startsWith(q)) ||
          rank(a) - rank(b) ||
          a.base.localeCompare(b.base),
      );
  }, [pairs, query]);
  const shown = matches.slice(0, LIMIT);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  // Closing returns focus to the button, so the keyboard stays in the form.
  function close() {
    setOpen(false);
    setQuery('');
    button.current?.focus();
  }
  function choose(symbol: string) {
    onChange(symbol);
    close();
  }
  return (
    <div
      className="pair-picker"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="pair-picker-button"
        aria-label={'İşlem çifti: ' + pairLabel(value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setActive(0);
        }}
      >
        <span>{pairLabel(value)}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="pair-picker-popover">
          <div className="pair-picker-search">
            <Search size={14} />
            <input
              autoFocus
              role="combobox"
              aria-label="İşlem çifti ara"
              aria-controls={listId}
              aria-expanded
              aria-activedescendant={
                shown[active] ? `${listId}-${shown[active].symbol}` : undefined
              }
              placeholder="Coin ara (ör. ETH)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, shown.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && shown[active]) {
                  e.preventDefault();
                  choose(shown[active].symbol);
                }
              }}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="İşlem çiftleri">
            {shown.map((p, i) => (
              <li
                key={p.symbol}
                id={`${listId}-${p.symbol}`}
                role="option"
                aria-selected={p.symbol === value}
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p.symbol);
                }}
              >
                <b>{p.base}</b> / USDT
              </li>
            ))}
          </ul>
          <small>
            {!pairs.length
              ? 'Çift listesi yüklenemedi; Binance bağlantısını kontrol edin.'
              : !matches.length
                ? 'Eşleşen USDT çifti yok.'
                : matches.length > LIMIT
                  ? `${matches.length - LIMIT} çift daha; aramayı daraltın.`
                  : `${matches.length} USDT spot çifti`}
          </small>
        </div>
      )}
    </div>
  );
}
