import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  label: string;
  selected: Set<string>;
  onChange: (v: Set<string>) => void;
  options: { value: string; label: string }[];
  /** Width of the dropdown panel in px (defaults to 300). */
  menuWidth?: number;
  /** Max visible chars in the trigger before truncation. Defaults to "220px" CSS width. */
  triggerMaxWidth?: string;
}

/**
 * Reusable multi-select filter: shows a button with current selection summary
 * and a checkbox dropdown. Empty selection means "all".
 *
 * Lives in `components/` (not `pages/Research`) so widgets rendered on the
 * Dashboard can reuse it without importing a 1300-line page module.
 */
export default function MultiFilterSelect({
  label,
  selected,
  onChange,
  options,
  menuWidth = 300,
  triggerMaxWidth = '220px',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  };

  const btnLabel = selected.size === 0
    ? 'Все'
    : selected.size <= 2
      ? [...selected].map(v => { const o = options.find(x => x.value === v); return o ? o.label : v; }).join(', ')
      : `${selected.size} выбрано`;

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <label className="text-xs font-medium text-[var(--color-text-secondary)]">{label}:</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] cursor-pointer flex items-center gap-1.5"
          style={{ maxWidth: triggerMaxWidth }}
        >
          <span className="truncate">{btnLabel}</span>
          <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div
            className="absolute top-full left-0 mt-1 max-h-[320px] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-50"
            style={{ width: menuWidth }}
          >
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--color-primary)] hover:bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]"
              >
                Сбросить всё
              </button>
            )}
            {options.map(o => (
              <label
                key={o.value}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.value)}
                  onChange={() => toggle(o.value)}
                  className="rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
