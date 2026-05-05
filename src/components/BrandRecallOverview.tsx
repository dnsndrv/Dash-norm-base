import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, LineController, Tooltip, Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Info } from 'lucide-react';
import type { Creative } from '../research/types';
import { pctN } from '../research/utils';
import MultiFilterSelect from './MultiFilterSelect';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, LineController, Tooltip, Legend, ChartDataLabels,
);

interface Props {
  /** Source of creatives. In the standalone build this is always passed in;
   *  the legacy live-fetch fallback was removed. */
  creatives: Creative[];
  /** Optional link shown in the header (e.g. "Подробнее в Brand Research"). */
  detailLink?: { to: string; label: string };
  /** Which widgets to render. Defaults to 'both'. */
  only?: 'recall' | 'purity' | 'both';
}

/**
 * "Brand Research" overview: two widgets that are readable at a glance.
 *   1. Brand / Product Recall by product (horizontal, sorted, value labels).
 *   2. Communication purity (diverging chart: correct vs incorrect features).
 *
 * Includes a short definition footer so non-analysts can interpret the chart
 * without bouncing to the Help tab.
 */
export default function BrandRecallOverview({ creatives, detailLink, only = 'both' }: Props) {
  const showRecall = only !== 'purity';
  const showPurity = only !== 'recall';

  // Widget-local selection of creatives to compare. Empty Set = "use all".
  // Intentionally NOT wired to parent filters — this widget is meant to be
  // an ad-hoc comparison tool; parent filters are applied elsewhere.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showDefs, setShowDefs] = useState(false);

  // Options for the widget-local picker. Ordered by product then name so
  // the dropdown reads as pre-grouped clusters.
  const pickerOptions = useMemo(() => {
    return [...creatives]
      .sort((a, b) => {
        const p = a.product.localeCompare(b.product);
        return p !== 0 ? p : a.name.localeCompare(b.name);
      })
      .map(c => ({ value: String(c.id), label: `${c.product} — ${c.name}` }));
  }, [creatives]);

  // Sanitize selection: drop IDs that no longer exist in the data (e.g. data
  // refreshed). Avoids stale picks quietly filtering everything out.
  useEffect(() => {
    if (picked.size === 0) return;
    const known = new Set(creatives.map(c => String(c.id)));
    let dirty = false;
    const next = new Set<string>();
    picked.forEach(id => {
      if (known.has(id)) next.add(id);
      else dirty = true;
    });
    if (dirty) setPicked(next);
  }, [creatives, picked]);

  const scoped = useMemo(() => {
    if (picked.size === 0) return creatives;
    return creatives.filter(c => picked.has(String(c.id)));
  }, [creatives, picked]);

  // Per-creative rows (previously aggregated by product).
  // Kept the same row shape (brand/product) so the chart datasets below didn't
  // change — only the source of rows is different.
  //
  // Default-view cutoff: when the user hasn't explicitly picked creatives, we
  // show only the top-N by brand recall to keep the chart readable. As soon as
  // they pick anything, we honor their full selection (no cutoff).
  const TOP_N_RECALL = 10;
  const recallRowsAll = useMemo(() => {
    return scoped
      .filter(c => c.name && c.name.trim().length > 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        url: c.rutubeUrl,
        brand: pctN(c.metrics.brandRecall),
        product: pctN(c.metrics.productRecall),
      }))
      .filter(r => r.brand != null || r.product != null)
      .sort((a, b) => (b.brand ?? 0) - (a.brand ?? 0));
  }, [scoped]);
  const isDefaultRecallView = picked.size === 0;
  const recallRows = useMemo(
    () => (isDefaultRecallView ? recallRowsAll.slice(0, TOP_N_RECALL) : recallRowsAll),
    [recallRowsAll, isDefaultRecallView],
  );

  const truncateName = (s: string, max = 42) =>
    s.length > max ? s.slice(0, max - 1) + '…' : s;

  const purityRows = useMemo(() => {
    const rows = scoped
      .filter(c => c.metrics.correctFeatures != null && c.metrics.incorrectFeatures != null)
      .map(c => ({
        id: c.id,
        fullName: c.name,
        correct: pctN(c.metrics.correctFeatures) ?? 0,
        incorrect: pctN(c.metrics.incorrectFeatures) ?? 0,
      }))
      .map(r => ({ ...r, delta: r.correct - r.incorrect }))
      .sort((a, b) => b.delta - a.delta);
    return rows.slice(0, 15);
  }, [scoped]);

  const purityLabel = (name: string) => (name.length > 32 ? name.slice(0, 32) + '…' : name);

  const hasRecall = showRecall && recallRows.length > 0;
  const hasPurity = showPurity && purityRows.length > 0;

  // Nothing to show — either filtered out everything, or backend returned empty.
  if (!hasRecall && !hasPurity) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] p-6 text-center">
        <p className="text-[12px] text-[var(--color-text-muted)]">Нет данных о правильных ответах по бренду и продукту для текущей выборки</p>
      </div>
    );
  }

  const headerTitle = only === 'recall'
    ? 'Запоминаемость бренда и продукта'
    : only === 'purity'
      ? 'Чистота коммуникации'
      : 'Запоминаемость и чистота коммуникации';

  const scopeLabel = picked.size === 0
    ? `Все ролики (${creatives.length})`
    : `Выбрано ${picked.size} из ${creatives.length}`;

  return (
    <section className="space-y-3">
      {/* Header with info toggle + widget-local picker */}
      <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-[var(--color-text)]">{headerTitle}</h2>
          <button
            type="button"
            onClick={() => setShowDefs(v => !v)}
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
            aria-label="Что означают метрики"
            aria-expanded={showDefs}
            title="Что означают метрики"
          >
            <Info size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[var(--color-text-muted)]">{scopeLabel}</span>
          <MultiFilterSelect
            label="Ролики"
            selected={picked}
            onChange={setPicked}
            options={pickerOptions}
            menuWidth={360}
            triggerMaxWidth="260px"
          />
          {detailLink && (
            <a
              href={detailLink.to}
              className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline underline-offset-2 decoration-dotted"
            >
              {detailLink.label}
            </a>
          )}
        </div>
      </div>

      {/* Definitions footnote (toggleable) */}
      {showDefs && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60 p-4 text-[12px] leading-relaxed text-[var(--color-text-secondary)] space-y-2">
          {showRecall && (
            <>
              <div>
                <span className="font-semibold text-[var(--color-text)]">Верно назвали бренд (открытый вопрос)</span> —
                доля респондентов, которые после просмотра ролика <em>без подсказок</em> верно назвали бренд рекламодателя
                (вопрос: «Какой бренд рекламировался в этой рекламе?»). Показывает, насколько бренд «прилипает» к сообщению.
              </div>
              <div>
                <span className="font-semibold text-[var(--color-text)]">Верно назвали продукт / фичу (открытый вопрос)</span> —
                доля респондентов, которые верно назвали <em>конкретный продукт или фичу</em> из ролика
                (уточняющий открытый вопрос). Показывает, дошёл ли key message до зрителя, а не только лого.
              </div>
            </>
          )}
          {showPurity && (
            <div>
              <span className="font-semibold text-[var(--color-text)]">Чистота коммуникации</span> — разница между долей
              правильных и неправильных считываний рекламируемых функций (вопрос «Какие функции или возможности
              рекламировались?»). Чем больше разрыв в плюс, тем точнее аудитория поняла ролик.
            </div>
          )}
        </div>
      )}

      {/* Widgets grid — single column when only one widget is visible */}
      <div className={`grid grid-cols-1 gap-4 ${hasRecall && hasPurity ? 'md:grid-cols-2' : ''}`}>
        {/* Recall by creative */}
        {hasRecall && (
          <ChartCard
            title="Верно назвали бренд и продукт — по роликам"
            subtitle={
              isDefaultRecallView && recallRowsAll.length > TOP_N_RECALL
                ? `Открытые вопросы. Топ-${TOP_N_RECALL} из ${recallRowsAll.length} по доле верно назвавших бренд. Чтобы сравнить другие — выберите ролики в фильтре. Клик по названию открывает видео.`
                : 'Открытые вопросы. Сортировка по доле верно назвавших бренд. Клик по названию открывает видео.'
            }
          >
            <div style={{ height: Math.max(240, recallRows.length * 40) }}>
              <Bar
                data={{
                  labels: recallRows.map(r => truncateName(r.name)),
                  datasets: [
                    {
                      label: 'Верно назвали бренд (открытый вопрос)',
                      data: recallRows.map(r => r.brand),
                      backgroundColor: '#0E9F94',
                      borderRadius: 6,
                      barThickness: 12,
                    },
                    {
                      label: 'Верно назвали продукт / фичу (открытый вопрос)',
                      data: recallRows.map(r => r.product),
                      backgroundColor: '#7C3AED',
                      borderRadius: 6,
                      barThickness: 12,
                    },
                  ],
                }}
                options={{
                  indexAxis: 'y',
                  responsive: true,
                  maintainAspectRatio: false,
                  layout: { padding: { right: 36 } },
                  // Resolve which y-category a canvas click/hover is over, by
                  // finding the closest tick pixel. Chart.js doesn't expose a
                  // dedicated "axis label click" event, so we approximate.
                  onClick: (event, _elems, chart) => {
                    const yScale = chart.scales.y;
                    const yPx = event.y;
                    if (!yScale || yPx == null) return;
                    let bestIdx = -1;
                    let bestDist = Infinity;
                    for (let i = 0; i < recallRows.length; i++) {
                      const d = Math.abs(yScale.getPixelForValue(i) - yPx);
                      if (d < bestDist) { bestDist = d; bestIdx = i; }
                    }
                    // Only treat as "label click" if click was inside the axis
                    // gutter (left of the chart area) OR close enough to a tick.
                    const inGutter = event.x != null && event.x < chart.chartArea.left;
                    if (bestIdx < 0) return;
                    if (!inGutter && bestDist > 14) return;
                    const row = recallRows[bestIdx];
                    if (row?.url) window.open(row.url, '_blank', 'noopener,noreferrer');
                  },
                  onHover: (event, _elems, chart) => {
                    const canvas = chart.canvas;
                    if (!canvas) return;
                    const yScale = chart.scales.y;
                    const yPx = event.y;
                    const xPx = event.x;
                    if (!yScale || yPx == null || xPx == null) {
                      canvas.style.cursor = 'default';
                      return;
                    }
                    const inGutter = xPx < chart.chartArea.left;
                    if (!inGutter) { canvas.style.cursor = 'default'; return; }
                    let bestIdx = -1;
                    let bestDist = Infinity;
                    for (let i = 0; i < recallRows.length; i++) {
                      const d = Math.abs(yScale.getPixelForValue(i) - yPx);
                      if (d < bestDist) { bestDist = d; bestIdx = i; }
                    }
                    const row = bestIdx >= 0 ? recallRows[bestIdx] : null;
                    canvas.style.cursor = row?.url ? 'pointer' : 'default';
                  },
                  plugins: {
                    legend: {
                      position: 'top',
                      align: 'start',
                      labels: { font: { size: 12 }, boxWidth: 12, boxHeight: 12, padding: 14 },
                    },
                    tooltip: {
                      callbacks: {
                        // Full, untruncated name in the tooltip header.
                        title: (items) => recallRows[items[0].dataIndex]?.name ?? '',
                        label: (ctx) => {
                          const v = ctx.parsed.x;
                          return `${ctx.dataset.label}: ${v == null ? '—' : v.toFixed(1) + '%'}`;
                        },
                        afterBody: (items) => {
                          const row = recallRows[items[0].dataIndex];
                          return row?.url ? ['', 'Клик по названию — открыть видео'] : [];
                        },
                      },
                    },
                    datalabels: {
                      anchor: 'end',
                      align: 'end',
                      offset: 4,
                      color: '#1F1F1F',
                      font: { size: 11, weight: 600 },
                      formatter: (v: number | null) => (v == null ? '' : v.toFixed(1) + '%'),
                    },
                  },
                  scales: {
                    x: {
                      beginAtZero: true,
                      ticks: { font: { size: 11 }, callback: v => v + '%' },
                      grid: { color: 'rgba(0,0,0,0.05)' },
                    },
                    y: {
                      ticks: {
                        font: { size: 12 },
                        // Tint clickable rows so "this is a link" is communicated
                        // even before the user hovers. Non-clickable rows keep
                        // the neutral text color.
                        color: (ctx) => (recallRows[ctx.index]?.url ? '#0E9F94' : '#374151'),
                      },
                      grid: { display: false },
                    },
                  },
                }}
              />
            </div>
          </ChartCard>
        )}

        {/* Communication purity: diverging horizontal bars */}
        {hasPurity && (
          <ChartCard
            title="Чистота коммуникации"
            subtitle={`Правильные − неправильные считывания, топ-${purityRows.length} креативов по дельте`}
          >
            <div style={{ height: Math.max(220, purityRows.length * 26) }}>
              <Bar
                data={{
                  labels: purityRows.map(r => purityLabel(r.fullName)),
                  datasets: [
                    {
                      label: 'Правильные',
                      data: purityRows.map(r => r.correct),
                      backgroundColor: '#10B981',
                      borderRadius: 4,
                      barThickness: 12,
                    },
                    {
                      label: 'Неправильные',
                      // Flip to negative so incorrect stretches LEFT of zero —
                      // diverging chart reads "positive = good, negative = bad".
                      data: purityRows.map(r => -r.incorrect),
                      backgroundColor: '#EF4444',
                      borderRadius: 4,
                      barThickness: 12,
                    },
                  ],
                }}
                options={{
                  indexAxis: 'y',
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'top',
                      align: 'start',
                      labels: { font: { size: 12 }, boxWidth: 12, boxHeight: 12, padding: 14 },
                    },
                    tooltip: {
                      callbacks: {
                        title: (items) => {
                          const row = purityRows[items[0].dataIndex];
                          return row?.fullName ?? '';
                        },
                        label: (ctx) => {
                          const idx = ctx.dataIndex;
                          const row = purityRows[idx];
                          if (!row) return '';
                          if (ctx.datasetIndex === 0) return `Правильные: ${row.correct.toFixed(1)}%`;
                          return `Неправильные: ${row.incorrect.toFixed(1)}%`;
                        },
                        footer: (items) => {
                          const row = purityRows[items[0].dataIndex];
                          if (!row) return '';
                          const d = row.delta;
                          const sign = d >= 0 ? '+' : '';
                          return `Δ: ${sign}${d.toFixed(1)} пп`;
                        },
                      },
                    },
                    datalabels: {
                      color: '#1F1F1F',
                      font: { size: 10, weight: 500 },
                      anchor: (ctx) => (ctx.datasetIndex === 0 ? 'end' : 'start'),
                      align: (ctx) => (ctx.datasetIndex === 0 ? 'end' : 'start'),
                      offset: 3,
                      formatter: (v: number) => {
                        if (v == null) return '';
                        const abs = Math.abs(v);
                        // Hide tiny labels to reduce noise.
                        if (abs < 1.5) return '';
                        return abs.toFixed(0) + '%';
                      },
                    },
                  },
                  scales: {
                    x: {
                      ticks: {
                        font: { size: 11 },
                        callback: (v) => {
                          const n = Number(v);
                          return (n >= 0 ? n : -n) + '%';
                        },
                      },
                      grid: { color: (ctx) => (ctx.tick.value === 0 ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)') },
                    },
                    y: {
                      ticks: { font: { size: 11 }, color: '#374151' },
                      grid: { display: false },
                    },
                  },
                }}
              />
            </div>
          </ChartCard>
        )}
      </div>
    </section>
  );
}

function ChartCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{title}</p>
        {subtitle && (
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
