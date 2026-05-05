import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Bar, Scatter,
} from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, LineController, Tooltip, Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import {
  ExternalLink, X, BarChart3, TrendingUp,
  ChevronDown, ChevronUp, Info, Maximize2, HelpCircle,
} from 'lucide-react';
import type { DashboardData, Creative, MetricKey } from './research/types';
import { MAIN_METRICS, KEY_METRICS, CHART_COLORS } from './research/types';
import { pct, pctN, avg, computeAverages, getUniqueValues, zTestProp, zScoreColor, totalBase, avgByKey } from './research/utils';
import BrandRecallOverview from './components/BrandRecallOverview';
import MultiFilterSelect from './components/MultiFilterSelect';
// Static snapshot of /api/research/dashboard-data — refreshed via `npm run update-data`.
import dashboardSnapshot from './data/dashboard.json';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, LineController, Tooltip, Legend, ChartDataLabels,
);
ChartJS.defaults.plugins.datalabels = { display: false } as never;

// Order for the "what user liked/disliked" categories.
// SHARED are present in both likes and dislikes (e.g. music, voice, …).
// LIKE_EXTRA / DISLIKE_EXTRA are asymmetric — only on one side; they used to
// be silently dropped, so we append them after the shared ones to keep
// visual alignment but not lose data.
const SHARED_ORDER = ['music', 'voice', 'video', 'color', 'text', 'sound', 'characters', 'plot'];
const LIKE_EXTRA = ['relevant'];
const DISLIKE_EXTRA = ['unclear', 'irrelevant'];
// Meta-answers respondents gave — not informative for this chart and clutter it:
//   - `nothing`  — «Ничего не понравилось» (side: likes)
//   - `allGood`  — «Всё устраивает / ничего не раздражает» (side: dislikes)
// Kept in raw backend response (used elsewhere in aggregates), but hidden here.
const HIDDEN_KEYS = new Set(['nothing', 'allGood']);

function orderLikeDislikeKeys(keys: string[], extras: string[]): string[] {
  const visible = keys.filter(k => !HIDDEN_KEYS.has(k));
  const shared = SHARED_ORDER.filter(k => visible.includes(k));
  const onSide = extras.filter(k => visible.includes(k));
  const known = new Set([...shared, ...onSide]);
  // Any keys the backend adds in the future land after the known ones rather
  // than disappearing — making this chart forward-compatible with sheet edits.
  const rest = visible.filter(k => !known.has(k));
  return [...shared, ...onSide, ...rest];
}

type TabKey = 'overview' | 'drivers' | 'help';

const TABS: { key: TabKey; label: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', label: 'Обзор', icon: BarChart3 },
  { key: 'drivers', label: 'Драйверы', icon: TrendingUp },
  { key: 'help', label: 'Справка', icon: HelpCircle },
];


// Standalone build: data is bundled at build time from a snapshot of the
// Aisha backend (/api/research/dashboard-data). The original page used
// `useOutletContext<ProductConfig>` for tenant gating and `apiFetch` for live
// loading — both stripped here since this is a single-page public dashboard.
const data = dashboardSnapshot as unknown as DashboardData;

export default function Research() {
  const [tab, setTab] = useState<TabKey>('overview');

  // Filters
  const [fProduct, setFProduct] = useState('');
  const [fCampaign, setFCampaign] = useState('');
  const [fCompetitor, setFCompetitor] = useState('Яндекс');
  const [fPeriod, setFPeriod] = useState('');
  const [fFormat, setFFormat] = useState('');
  const [fCreatives, setFCreatives] = useState<Set<string>>(new Set());


  // Cascading filters: each dropdown's option list is computed from the data
  // narrowed by all OTHER active filters. This way picks at any level (Yandex/
  // competitor → product → campaign → creative) constrain neighbors, including
  // the "skip a level" case (product without campaign still limits creatives).
  // The final `filtered` list applies all active filters together.
  type FilterKey = 'product' | 'campaign' | 'competitorType' | 'period' | 'format' | 'creatives';

  const matches = useCallback((c: Creative, exclude?: FilterKey) => (
    (exclude === 'product'        || !fProduct    || c.product === fProduct) &&
    (exclude === 'campaign'       || !fCampaign   || c.campaign === fCampaign) &&
    (exclude === 'competitorType' || !fCompetitor || c.competitorType === fCompetitor) &&
    (exclude === 'period'         || !fPeriod     || c.period === fPeriod) &&
    (exclude === 'format'         || !fFormat     || c.format === fFormat) &&
    (exclude === 'creatives'      || fCreatives.size === 0 || fCreatives.has(c.name))
  ), [fProduct, fCampaign, fCompetitor, fPeriod, fFormat, fCreatives]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.creatives.filter(c => matches(c));
  }, [data, matches]);

  // Per-field option lists, built from the cross-filtered data minus that field.
  const productOptions    = useMemo(() => data ? getUniqueValues(data.creatives.filter(c => matches(c, 'product')),        'product')        : [], [data, matches]);
  const campaignOptions   = useMemo(() => data ? getUniqueValues(data.creatives.filter(c => matches(c, 'campaign')),       'campaign')       : [], [data, matches]);
  const competitorOptions = useMemo(() => data ? getUniqueValues(data.creatives.filter(c => matches(c, 'competitorType')), 'competitorType') : [], [data, matches]);
  const periodOptions     = useMemo(() => {
    if (!data) return [];
    const allowed = new Set(data.creatives.filter(c => matches(c, 'period')).map(c => c.period));
    return data.periods.filter(p => allowed.has(p));
  }, [data, matches]);
  const formatOptions     = useMemo(() => data ? getUniqueValues(data.creatives.filter(c => matches(c, 'format')),         'format')         : [], [data, matches]);
  const creativeOptions   = useMemo(() => {
    if (!data) return [];
    const names = [...new Set(data.creatives.filter(c => matches(c, 'creatives')).map(c => c.name))].filter(Boolean).sort();
    return names.map(n => ({ value: n, label: n.length > 50 ? n.slice(0, 50) + '…' : n }));
  }, [data, matches]);

  // Auto-clear selections that became invalid after a parent filter changed
  // (e.g. picked a product, then switched competitorType to one that doesn't
  // include this product). Without this, the dropdown shows stale text and
  // `filtered` silently collapses to empty.
  useEffect(() => { if (fProduct    && !productOptions.includes(fProduct))      setFProduct(''); },    [fProduct, productOptions]);
  useEffect(() => { if (fCampaign   && !campaignOptions.includes(fCampaign))    setFCampaign(''); },   [fCampaign, campaignOptions]);
  useEffect(() => { if (fCompetitor && !competitorOptions.includes(fCompetitor))setFCompetitor(''); }, [fCompetitor, competitorOptions]);
  useEffect(() => { if (fPeriod     && !periodOptions.includes(fPeriod))        setFPeriod(''); },     [fPeriod, periodOptions]);
  useEffect(() => { if (fFormat     && !formatOptions.includes(fFormat))        setFFormat(''); },     [fFormat, formatOptions]);
  useEffect(() => {
    if (fCreatives.size === 0) return;
    const allowed = new Set(creativeOptions.map(o => o.value));
    let changed = false;
    const next = new Set<string>();
    for (const v of fCreatives) {
      if (allowed.has(v)) next.add(v); else changed = true;
    }
    if (changed) setFCreatives(next);
  }, [fCreatives, creativeOptions]);

  const allAvg = useMemo(() => data ? computeAverages(data.creatives) : null, [data]);

  const competitorCreatives = useMemo(() => {
    if (!data) return [];
    return data.creatives.filter(c =>
      c.competitorType && !c.competitorType.toLowerCase().includes('яндекс')
    );
  }, [data]);

  const competitorAvg = useMemo(
    () => competitorCreatives.length ? computeAverages(competitorCreatives) : null,
    [competitorCreatives],
  );

  const hasFilters = !!(fProduct || fCampaign || fCompetitor || fPeriod || fFormat || fCreatives.size);

  const filteredAvg = useMemo(
    () => (hasFilters && filtered.length ? computeAverages(filtered) : allAvg),
    [filtered, allAvg, hasFilters],
  );

  return (
    <div className="page-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Brand Research</h1>
        <span className="text-xs text-[var(--color-text-muted)]">
          {data.creatives.length} креативов
        </span>
      </div>
      <p className="text-[13px] text-[var(--color-text-muted)] mb-5">
        Дашборд тестирования рекламных креативов · данные из{' '}
        <a href="https://docs.google.com/spreadsheets/d/1xb9WAV74CPxMXAuOIaLbrpjXzVYAf8Cz3D9a1GldjtQ"
          target="_blank" rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-[var(--color-text-secondary)] transition-colors">
          Базы норм
        </a>
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--color-border)] overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px cursor-pointer transition-colors duration-150 whitespace-nowrap ${
                tab === t.key
                  ? 'border-[var(--color-primary)] text-[var(--color-text)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}>
              <Icon size={15} strokeWidth={1.5} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <FilterSelect label="Яндекс / Конкуренты" value={fCompetitor} onChange={setFCompetitor} options={competitorOptions} />
        <FilterSelect label="Продукт" value={fProduct} onChange={setFProduct} options={productOptions} />
        <FilterSelect label="Кампания" value={fCampaign} onChange={setFCampaign} options={campaignOptions} />
        <MultiFilterSelect label="Ролики" selected={fCreatives} onChange={setFCreatives} options={creativeOptions} />
        {tab !== 'overview' && (
          <>
            <FilterSelect label="Период" value={fPeriod} onChange={setFPeriod} options={periodOptions} />
            <FilterSelect label="Формат" value={fFormat} onChange={setFFormat} options={formatOptions} />
          </>
        )}
        {hasFilters && (
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">
            {filtered.length} из {data.creatives.length}
          </span>
        )}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab creatives={filtered} allCreatives={data.creatives} averages={filteredAvg!} globalAverages={allAvg!} competitorAverages={competitorAvg} data={data} />}
      {tab === 'drivers' && <DriversTab creatives={filtered} averages={allAvg!} />}
      {tab === 'help' && <HelpTab />}

    </div>
  );
}

/* ============================================ */
/* Filter dropdown                              */
/* ============================================ */
function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-[var(--color-text-secondary)]">{label}:</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] cursor-pointer">
        <option value="">Все</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}


/* ============================================ */
/* KPI Card                                     */
/* ============================================ */
interface KpiBenchmark {
  label: string;
  value: string;
}

function KpiCard({ label, value, sub, question, zScore, ppDelta, benchmarks }: {
  label: string; value: string; sub?: string; question?: string;
  /** z-score vs global norm. Drives color-coding; shown in hover tooltip. */
  zScore?: number | null;
  /** Delta vs "Общее" norm in raw proportion units (e.g. 0.032 = +3.2 п.п.).
   *  When provided, the small badge under the value shows this instead of z,
   *  since п.п. is what marketers actually read. */
  ppDelta?: number | null;
  benchmarks?: KpiBenchmark[];
}) {
  const [showTip, setShowTip] = useState(false);
  const [showDelta, setShowDelta] = useState(false);
  const zCls = zScoreColor(zScore ?? null);
  const deltaLabel = ppDelta != null
    ? `${ppDelta >= 0 ? '+' : ''}${(ppDelta * 100).toFixed(1)} п.п.`
    : null;
  const zLabel = zScore != null ? (zScore >= 0 ? '+' : '') + zScore.toFixed(2) : null;
  // Fallback to showing z when no ppDelta is passed (keeps backwards compat).
  const badgeText = deltaLabel ?? (zLabel != null ? `z = ${zLabel}` : null);
  return (
    <div className="bento-card rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center relative">
      <div className="flex items-center justify-center gap-1.5 mb-2">
        <span className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider leading-tight">
          {label}
        </span>
        {question && (
          <button onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)}
            className="relative cursor-help">
            <Info size={12} className="text-[var(--color-text-muted)]" />
            {showTip && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[260px] p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg text-xs text-[var(--color-text)] text-left leading-relaxed z-50 whitespace-normal normal-case tracking-normal">
                {question}
              </div>
            )}
          </button>
        )}
      </div>
      <p className={`text-2xl font-bold ${zCls || 'text-[var(--color-text)]'}`}>{value}</p>
      {badgeText && (
        <span
          className={`relative inline-block mt-1 text-[10px] font-medium ${zCls || 'text-[var(--color-text-muted)]'} ${zLabel != null ? 'cursor-help' : ''}`}
          onMouseEnter={() => setShowDelta(true)}
          onMouseLeave={() => setShowDelta(false)}
        >
          {badgeText}
          {showDelta && zLabel != null && deltaLabel && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[220px] p-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg text-[11px] text-[var(--color-text)] text-left leading-relaxed z-50 whitespace-normal normal-case tracking-normal">
              <div><span className="font-semibold">{deltaLabel}</span> относительно «Общее»</div>
              <div className="mt-1 text-[var(--color-text-muted)]">z = {zLabel} — стат. значимость (|z| {'>'} 1.96 ≈ заметно выше/ниже нормы)</div>
            </span>
          )}
        </span>
      )}
      {benchmarks && benchmarks.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {benchmarks.map((b, i) => (
            <p key={i} className="text-[11px] text-[var(--color-text-muted)] leading-snug">
              {b.label}: <span className="font-semibold text-[var(--color-text-secondary)]">{b.value}</span>
            </p>
          ))}
        </div>
      )}
      {sub && <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 leading-snug">{sub}</p>}
    </div>
  );
}

/* ============================================ */
/* Metric cell with deviation coloring          */
/* ============================================ */
function MetricCell({ value, avgVal, base }: { value: number | null; avgVal: number | null; base?: number }) {
  const z = base ? zTestProp(value, avgVal, base) : null;
  const cls = zScoreColor(z);
  return (
    <td className="px-2.5 py-2 text-xs">
      <span className={`inline-block px-1.5 py-0.5 rounded ${cls}`}>{pct(value)}</span>
    </td>
  );
}

/* ============================================ */
/* TAB 1: Overview                              */
/* ============================================ */
function OverviewTab({ creatives, allCreatives, averages, globalAverages, competitorAverages, data }: {
  creatives: Creative[]; allCreatives: Creative[];
  averages: Record<MetricKey, number | null>; globalAverages: Record<MetricKey, number | null>;
  competitorAverages: Record<MetricKey, number | null> | null;
  data: DashboardData;
}) {
  const { metricLabels, metricQuestions } = data;

  const isFiltered = creatives.length !== allCreatives.length;
  const nFiltered = totalBase(creatives);

  const BRAND_METRICS: { key: MetricKey; label: string }[] = [
    { key: 'brandRecall', label: 'Верно назвали бренд' },
    { key: 'productRecall', label: 'Верно назвали продукт / фичу' },
    { key: 'brandRecognition', label: 'Узнаваемость' },
    { key: 'brandFit', label: 'Соотв. бренду' },
    { key: 'brandAttitude', label: 'Отношение к бренду' },
  ];

  const EXTRA_METRICS: { key: MetricKey; label: string }[] = [
    { key: 'interesting', label: 'Интересно' },
    { key: 'relevance', label: 'Актуальность' },
    { key: 'useMore', label: 'Использовать чаще' },
    { key: 'startUsing', label: 'Начать использовать' },
  ];

  const allKpiMetrics = [...MAIN_METRICS, ...BRAND_METRICS, ...EXTRA_METRICS];

  const zScores = useMemo(() => {
    if (!isFiltered) return {} as Record<MetricKey, number | null>;
    const result: Partial<Record<MetricKey, number | null>> = {};
    for (const m of allKpiMetrics) {
      result[m.key] = zTestProp(averages[m.key], globalAverages[m.key], nFiltered);
    }
    return result as Record<MetricKey, number | null>;
  }, [averages, globalAverages, nFiltered, isFiltered]);

  const buildBenchmarks = (key: MetricKey): KpiBenchmark[] => {
    const bm: KpiBenchmark[] = [
      { label: 'Общее', value: pct(globalAverages[key]) },
    ];
    if (competitorAverages) {
      bm.push({ label: 'Конкуренты', value: pct(competitorAverages[key]) });
    }
    return bm;
  };

  const subText = isFiltered
    ? `${creatives.length} из ${allCreatives.length} креативов`
    : `${allCreatives.length} креативов`;

  const computePpDelta = (key: MetricKey): number | null => {
    const a = averages[key];
    const g = globalAverages[key];
    return a != null && g != null ? a - g : null;
  };

  const renderKpiRow = (title: string, metrics: { key: MetricKey; label: string }[]) => (
    <div>
      <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metrics.map(m => (
          <KpiCard key={m.key} label={metricLabels[m.key] || m.label} value={pct(averages[m.key])}
            zScore={isFiltered ? zScores[m.key] : undefined}
            ppDelta={isFiltered ? computePpDelta(m.key) : undefined}
            benchmarks={buildBenchmarks(m.key)}
            sub={subText}
            question={metricQuestions[m.key]} />
        ))}
      </div>
    </div>
  );

  // Likes / Dislikes averages
  const avgLikes = useMemo(() => avgByKey(creatives, c => c.likes), [creatives]);
  const avgDislikes = useMemo(() => avgByKey(creatives, c => c.dislikes), [creatives]);

  const likeCategories = useMemo(() => {
    if (!data.likeLabels) return [];
    return orderLikeDislikeKeys(Object.keys(data.likeLabels), LIKE_EXTRA);
  }, [data.likeLabels]);

  const dislikeCategories = useMemo(() => {
    if (!data.dislikeLabels) return [];
    return orderLikeDislikeKeys(Object.keys(data.dislikeLabels), DISLIKE_EXTRA);
  }, [data.dislikeLabels]);

  // Emotional averages
  const avgEmotional = useMemo(() => avgByKey(creatives, c => c.emotional), [creatives]);

  // Group by production type (ИИ vs Продакшн etc.) — moved here from the "Форматы" tab
  // so it sits next to the main KPI rows and gives a top-level cut before deep-dives.
  const prodTypeGroups = useMemo(() => {
    const map: Record<string, Creative[]> = {};
    creatives.forEach(c => { if (c.productionType) (map[c.productionType] ??= []).push(c); });
    return map;
  }, [creatives]);
  const prodTypes = Object.keys(prodTypeGroups).sort();

  const prodTypeMetrics: { key: MetricKey; label: string; color: string }[] = [
    { key: 'like', label: 'Нравится', color: '#6c5ce7' },
    { key: 'clarity', label: 'Понятность', color: '#00b894' },
    { key: 'intent', label: 'Намерение', color: '#fd79a8' },
    { key: 'uniqueness', label: 'Уникальность', color: '#74b9ff' },
    { key: 'brandRecognition', label: 'Узнаваемость', color: '#00cec9' },
  ];

  return (
    <div className="space-y-6">
      {renderKpiRow('Средние значения', MAIN_METRICS)}
      {renderKpiRow('Бренд-метрики', BRAND_METRICS)}

      {/* Open-question recall by product — migrated here after "Бренд" tab was retired.
          IMPORTANT: we feed the UNFILTERED list on purpose. This widget has its own
          internal creative picker and must not react to top-of-page filters. */}
      <BrandRecallOverview creatives={allCreatives} only="recall" />

      {renderKpiRow('Дополнительные метрики', EXTRA_METRICS)}

      {prodTypes.length > 0 && (
        <ChartCard title="Средние по типу производства">
          <Bar
            data={{
              labels: prodTypes,
              datasets: prodTypeMetrics.map(m => ({
                label: m.label,
                data: prodTypes.map(p => pctN(avg(prodTypeGroups[p].map(c => c.metrics[m.key])))),
                backgroundColor: m.color,
                borderRadius: 4,
              })),
            }}
            options={{
              responsive: true,
              plugins: { legend: { labels: { font: { size: 12 } } }, datalabels: { display: false } },
              scales: {
                x: { ticks: { font: { size: 11 } }, grid: { display: false } },
                y: { ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' }, min: 0 },
              },
            }}
          />
        </ChartCard>
      )}

      {/* Likes — full list, including asymmetric categories like "relevant" / "nothing" */}
      {likeCategories.length > 0 && (
        <ChartCard title="Что понравилось в ролике">
          <Bar
            data={{
              labels: likeCategories.map(k => data.likeLabels?.[k] || k),
              datasets: [
                {
                  label: 'Понравилось',
                  data: likeCategories.map(k => pctN(avgLikes[k] ?? null)),
                  backgroundColor: '#10B981',
                  borderRadius: 4,
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: { legend: { display: false }, datalabels: { display: false } },
              scales: {
                x: { ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 30 }, grid: { display: false } },
                y: { ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' }, min: 0 },
              },
            }}
          />
        </ChartCard>
      )}

      {/* Dislikes — full list, including asymmetric categories like "unclear" / "irrelevant" / "allGood" */}
      {dislikeCategories.length > 0 && (
        <ChartCard title="Что НЕ понравилось в ролике">
          <Bar
            data={{
              labels: dislikeCategories.map(k => data.dislikeLabels?.[k] || k),
              datasets: [
                {
                  label: 'НЕ понравилось',
                  data: dislikeCategories.map(k => pctN(avgDislikes[k] ?? null)),
                  backgroundColor: '#EF4444',
                  borderRadius: 4,
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: { legend: { display: false }, datalabels: { display: false } },
              scales: {
                x: { ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 30 }, grid: { display: false } },
                y: { ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' }, min: 0 },
              },
            }}
          />
        </ChartCard>
      )}

      {/* Emotional Perception — semantic differential */}
      {data.emotionalPairs?.length > 0 && (
        <ChartCard title="Эмоциональное восприятие">
          <div className="space-y-2 py-2">
            {data.emotionalPairs.map(pair => {
              const pv = (avgEmotional[pair.positiveKey] ?? 0) * 100;
              const nv = (avgEmotional[pair.negativeKey] ?? 0) * 100;
              const total = pv + nv || 1;
              const pPct = pv / total * 100;
              return (
                <div key={pair.positiveKey} className="flex items-center gap-2">
                  <span className="w-[140px] text-right text-[11px] text-[var(--color-text-secondary)] leading-tight shrink-0">
                    {pair.positiveLabel}
                  </span>
                  <div className="flex-1 h-6 rounded-full overflow-hidden bg-[var(--color-bg-secondary)] relative flex">
                    <div className="h-full bg-[#00b894] transition-all" style={{ width: `${pPct}%` }} />
                    <div className="h-full bg-[#ff6b6b] transition-all" style={{ width: `${100 - pPct}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white drop-shadow-sm">
                      {pv.toFixed(0)}% / {nv.toFixed(0)}%
                    </span>
                  </div>
                  <span className="w-[140px] text-[11px] text-[var(--color-text-secondary)] leading-tight shrink-0">
                    {pair.negativeLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}

      {/* Rating table */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Рейтинг</h2>
        <RatingTab creatives={creatives} allCreatives={allCreatives} averages={globalAverages} />
      </div>
    </div>
  );
}


function CreativeName({ creative, maxLen, className }: { creative: Creative; maxLen?: number; className?: string }) {
  const name = maxLen && creative.name.length > maxLen ? creative.name.slice(0, maxLen) + '…' : creative.name;
  if (creative.rutubeUrl) {
    return (
      <a href={creative.rutubeUrl} target="_blank" rel="noopener noreferrer"
        className={`text-[var(--color-text)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text-secondary)] ${className ?? ''}`}>
        {name} <ExternalLink size={10} className="inline -mt-0.5" />
      </a>
    );
  }
  return <span className={`text-[var(--color-text)] ${className ?? ''}`}>{name}</span>;
}

/* ============================================ */
/* TAB 2: Creative Rating                       */
/* ============================================ */
function RatingTab({ creatives, allCreatives, averages }: {
  creatives: Creative[]; allCreatives: Creative[]; averages: Record<MetricKey, number | null>;
}) {
  const [sortCol, setSortCol] = useState<string>('intent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const enriched = useMemo(() => {
    return creatives.map(c => {
      const vals = KEY_METRICS.map(k => c.metrics[k]).filter((v): v is number => v != null);
      const index = vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return { ...c, index };
    }).sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';
      if (['name', 'product', 'campaign', 'period'].includes(sortCol)) {
        const key = sortCol as 'name' | 'product' | 'campaign' | 'period';
        va = String(a[key] ?? '');
        vb = String(b[key] ?? '');
      } else if (sortCol === 'base') {
        va = a.base || 0;
        vb = b.base || 0;
      } else if (sortCol === 'index') {
        va = a.index ?? -999;
        vb = b.index ?? -999;
      } else {
        va = a.metrics[sortCol as MetricKey] ?? -999;
        vb = b.metrics[sortCol as MetricKey] ?? -999;
      }
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [creatives, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return null;
    return sortDir === 'desc' ? <ChevronDown size={10} className="inline" /> : <ChevronUp size={10} className="inline" />;
  };

  const avgIndex = avg(KEY_METRICS.map(k => averages[k]));

  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)] mb-2">
        Цветовая индикация по z-критерию (95% и 90% уровень значимости). Индекс = среднее по 4 метрикам.
      </p>
      <div className="flex gap-4 mb-3 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]" /> z ≥ 1.96</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)] opacity-60" /> z ≥ 1.65</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-error)]" /> z ≤ −1.96</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-error)] opacity-60" /> z ≤ −1.65</span>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-320px)]">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
              <tr className="border-b-2 border-[var(--color-border)]">
                <Th onClick={() => handleSort('rank')}>#<SortIcon col="rank" /></Th>
                <Th onClick={() => handleSort('name')}>Креатив<SortIcon col="name" /></Th>
                <Th onClick={() => handleSort('product')}>Продукт<SortIcon col="product" /></Th>
                <Th onClick={() => handleSort('period')}>Период<SortIcon col="period" /></Th>
                <Th onClick={() => handleSort('base')}>База<SortIcon col="base" /></Th>
                <Th onClick={() => handleSort('like')}>Нравится<SortIcon col="like" /></Th>
                <Th onClick={() => handleSort('clarity')}>Понятность<SortIcon col="clarity" /></Th>
                <Th onClick={() => handleSort('uniqueness')}>Уникальность<SortIcon col="uniqueness" /></Th>
                <Th onClick={() => handleSort('relevance')}>Актуальность<SortIcon col="relevance" /></Th>
                <Th onClick={() => handleSort('brandRecognition')}>Узнаваемость<SortIcon col="brandRecognition" /></Th>
                <Th onClick={() => handleSort('brandFit')}>Соотв. бренду<SortIcon col="brandFit" /></Th>
                <Th onClick={() => handleSort('brandAttitude')}>Отнош. к бренду<SortIcon col="brandAttitude" /></Th>
                <Th onClick={() => handleSort('intent')}>Намерение<SortIcon col="intent" /></Th>
                <Th onClick={() => handleSort('index')}>Индекс<SortIcon col="index" /></Th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-[var(--color-bg-secondary)] border-b-2 border-[#7C3AED]/30 text-xs">
                <td className="px-2.5 py-2 text-[#7C3AED] font-bold">∅</td>
                <td colSpan={3} className="px-2.5 py-2 text-[#7C3AED] font-semibold">
                  Среднее по {allCreatives.length} креативам
                </td>
                <td className="px-2.5 py-2" />
                <td className="px-2.5 py-2 font-bold">{pct(averages.like)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.clarity)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.uniqueness)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.relevance)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.brandRecognition)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.brandFit)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.brandAttitude)}</td>
                <td className="px-2.5 py-2 font-bold">{pct(averages.intent)}</td>
                <td className="px-2.5 py-2 font-bold">{avgIndex != null ? (avgIndex * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
              {enriched.map((c, i) => {
                return (
                  <tr key={c.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]/50 transition-colors text-xs">
                    <td className="px-2.5 py-2 text-[var(--color-text-muted)]">{i + 1}</td>
                    <td className="px-2.5 py-2 max-w-[220px] truncate" title={c.name}>
                      <CreativeName creative={c} maxLen={35} className="text-xs" />
                    </td>
                    <td className="px-2.5 py-2 text-[var(--color-text-muted)]">{c.product}</td>
                    <td className="px-2.5 py-2 text-[var(--color-text-muted)]">{c.period}</td>
                    <td className="px-2.5 py-2 text-[var(--color-text-muted)]">{c.base || '—'}</td>
                    <MetricCell value={c.metrics.like} avgVal={averages.like} base={c.base} />
                    <MetricCell value={c.metrics.clarity} avgVal={averages.clarity} base={c.base} />
                    <MetricCell value={c.metrics.uniqueness} avgVal={averages.uniqueness} base={c.base} />
                    <MetricCell value={c.metrics.relevance} avgVal={averages.relevance} base={c.base} />
                    <MetricCell value={c.metrics.brandRecognition} avgVal={averages.brandRecognition} base={c.base} />
                    <MetricCell value={c.metrics.brandFit} avgVal={averages.brandFit} base={c.base} />
                    <MetricCell value={c.metrics.brandAttitude} avgVal={averages.brandAttitude} base={c.base} />
                    <MetricCell value={c.metrics.intent} avgVal={averages.intent} base={c.base} />
                    <td className="px-2.5 py-2 font-bold">{c.index != null ? (c.index * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th onClick={onClick}
      className="px-2.5 py-2.5 text-left text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-[var(--color-text)] select-none">
      {children}
    </th>
  );
}

/* ============================================ */
/* TAB: Intent Drivers                          */
/* ============================================ */
function DriversTab({ creatives, averages }: {
  creatives: Creative[]; averages: Record<MetricKey, number | null>;
}) {
  const scatterPairs: { key: MetricKey; label: string }[] = [
    { key: 'like', label: 'Нравится' },
    { key: 'clarity', label: 'Понятность' },
    { key: 'uniqueness', label: 'Уникальность' },
    { key: 'brandRecognition', label: 'Узнаваемость' },
  ];

  const top30 = [...creatives]
    .filter(c => c.metrics.intent != null)
    .sort((a, b) => (b.metrics.intent ?? 0) - (a.metrics.intent ?? 0))
    .slice(0, 30);

  return (
    <div className="space-y-5">
      {/* Scatter plots */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scatterPairs.map(sp => {
          const points = creatives
            .filter(c => c.metrics[sp.key] != null && c.metrics.intent != null)
            .map(c => ({
              x: c.metrics[sp.key]! * 100,
              y: c.metrics.intent! * 100,
              name: c.name,
              product: c.product,
              rutubeUrl: c.rutubeUrl,
            }));

          const products = [...new Set(creatives.map(c => c.product))].sort();

          return (
            <ChartCard key={sp.key} title={`${sp.label} × Намерение`}>
              <Scatter
                data={{
                  datasets: [{
                    data: points,
                    backgroundColor: points.map(p => CHART_COLORS[products.indexOf(p.product) % CHART_COLORS.length] + 'AA'),
                    borderColor: points.map(p => p.rutubeUrl ? '#000' : 'transparent'),
                    borderWidth: points.map(p => p.rutubeUrl ? 1.5 : 0) as number[],
                    pointRadius: points.map(p => p.rutubeUrl ? 7 : 5),
                    pointHoverRadius: points.map(p => p.rutubeUrl ? 10 : 8),
                  }],
                }}
                options={{
                  responsive: true,
                  onClick: (_event, elements) => {
                    if (elements.length > 0) {
                      const url = points[elements[0].index]?.rutubeUrl;
                      if (url) window.open(url, '_blank', 'noopener');
                    }
                  },
                  onHover: (event, elements) => {
                    const canvas = (event.native?.target) as HTMLCanvasElement | undefined;
                    if (canvas) {
                      canvas.style.cursor = elements.length > 0 && points[elements[0].index]?.rutubeUrl ? 'pointer' : 'default';
                    }
                  },
                  plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const d = ctx.raw as typeof points[number];
                          const lines = [`${d.name} (${d.product})`, `${sp.label}: ${d.x.toFixed(1)}%  Намерение: ${d.y.toFixed(1)}%`];
                          if (d.rutubeUrl) lines.push('▶ Нажмите, чтобы открыть видео');
                          return lines;
                        },
                      },
                    },
                  },
                  scales: {
                    x: { title: { display: true, text: sp.label, font: { size: 12 } }, ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' } },
                    y: { title: { display: true, text: 'Намерение', font: { size: 12 } }, ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' } },
                  },
                }}
              />
            </ChartCard>
          );
        })}
      </div>

      {/* Top 30 by intent */}
      <ChartCard title="Топ-30 по намерению">
        <div style={{ height: Math.max(400, top30.length * 22) }}>
          <Bar
            data={{
              labels: top30.map(c => c.name.length > 30 ? c.name.slice(0, 30) + '…' : c.name),
              datasets: [{
                data: top30.map(c => pctN(c.metrics.intent)),
                backgroundColor: top30.map(c => {
                  const d = (c.metrics.intent ?? 0) - (averages.intent ?? 0);
                  return d > 0.05 ? '#00b894' : d < -0.05 ? '#ff6b6b' : '#74b9ff';
                }),
                borderRadius: 4,
              }],
            }}
            options={{
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                datalabels: {
                  display: true,
                  color: '#fff',
                  font: { size: 11 },
                  anchor: 'end',
                  align: 'end',
                  formatter: (v: number | null) => v != null ? v.toFixed(1) + '%' : '',
                },
              },
              scales: {
                x: { ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' }, min: 0 },
                y: { ticks: { font: { size: 11 } }, grid: { display: false } },
              },
            }}
          />
        </div>
      </ChartCard>
    </div>
  );
}

/* ============================================ */
/* ChartCard wrapper                            */
/* ============================================ */
function ChartCard({ title, info, children }: {
  title: string;
  /** Optional footnote shown under the title via an info toggle. */
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (isOpen && d && !d.open) d.showModal();
  }, [isOpen]);

  return (
    <>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{title}</p>
            {info && (
              <button
                type="button"
                onClick={() => setShowInfo(v => !v)}
                className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
                aria-label="Что это значит"
                aria-expanded={showInfo}
                title="Что это значит"
              >
                <Info size={13} />
              </button>
            )}
          </div>
          <button onClick={() => setIsOpen(true)}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
            aria-label="На весь экран">
            <Maximize2 size={14} />
          </button>
        </div>
        {info && showInfo && (
          <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60 p-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            {info}
          </div>
        )}
        {!isOpen && children}
        {isOpen && (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-10">Развёрнуто на весь экран</p>
        )}
      </div>

      {isOpen && (
        <dialog
          ref={dialogRef}
          onClose={() => setIsOpen(false)}
          className="chart-dialog m-0 p-0 border-none bg-[var(--color-bg)] w-screen h-screen max-w-[100vw] max-h-[100vh]"
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-8 pt-5 pb-4 shrink-0 border-b border-[var(--color-border)]">
              <p className="text-sm font-semibold text-[var(--color-text)] uppercase tracking-wider">{title}</p>
              <button onClick={() => dialogRef.current?.close()}
                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
                aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-8">
              <div className="max-w-[1100px] mx-auto">
                {children}
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

/* ============================================ */
/* TAB: Help / Справка по метрикам              */
/* ============================================ */

interface HelpMetric {
  name: string;
  badge?: string;
  question: string;
  detail: string;
}

const HELP_MAIN: HelpMetric[] = [
  { name: 'Нравится', badge: 'топ-2', question: 'В целом, понравилась ли вам эта реклама?', detail: 'Шкала от 1 до 7. Топ-2 = доля ответивших 6 или 7.' },
  { name: 'Понятность идеи', badge: 'топ-1', question: 'Насколько, по вашему мнению, эта реклама проста для понимания?', detail: 'Шкала от 1 до 5. Топ-1 = доля ответивших 5.' },
  { name: 'Актуальность', badge: 'топ-2', question: 'Насколько то, что рассказывается в этой рекламе, актуально и близко для вас?', detail: 'Шкала от 1 до 5. Топ-2 = доля ответивших 4 или 5.' },
  { name: 'Уникальность', badge: 'топ-2', question: 'Насколько эта реклама отличается от другой рекламы, которую вы видите по ТВ и в интернете?', detail: 'Шкала от 1 до 5. Топ-2 = доля ответивших 4 или 5.' },
  { name: 'Соответствие бренду', badge: 'топ-2', question: 'Насколько такая реклама соответствует вашему представлению об этом бренде?', detail: 'Шкала от 1 до 5 + затрудняюсь ответить. Топ-2 = доля ответивших 4 или 5.' },
  { name: 'Захотелось приобрести / воспользоваться', badge: 'топ-1', question: 'Если бы вы увидели такую рекламу по ТВ или в интернете, захотелось бы вам воспользоваться продуктом?', detail: 'Шкала от 1 до 5. Топ-1 = доля ответивших 5 («Точно захотелось бы»).' },
  { name: 'Интересно ли было смотреть ролик', badge: 'топ-2', question: 'Интересно ли было смотреть этот ролик?', detail: 'Шкала от 1 до 5. Топ-2 = доля ответивших 4 или 5.' },
  { name: 'Узнаваемость бренда в ролике', badge: 'топ-2', question: '«Я бы понял(а), что этот ролик про бренд, даже если бы это название не упоминали в ролике»', detail: 'Шкала от 1 до 7. Топ-2 = доля ответивших 6 или 7.' },
  { name: 'Отношение к бренду после ролика улучшилось', badge: 'топ-2', question: 'Как изменилось ваше отношение к бренду после просмотра этого ролика?', detail: 'Топ-2 = улучшилось.' },
];

const HELP_OPTIONAL: HelpMetric[] = [
  { name: 'Возможности/функции — правильный ответ', badge: 'откр. вопрос', question: 'Какие функции или возможности рекламировались в этом ролике?', detail: 'Список ответов: правильные + неправильные. Показывает долю правильных ответов.' },
  { name: 'Возможности/функции — НЕправильный ответ', badge: 'откр. вопрос', question: 'Какие функции или возможности рекламировались в этом ролике?', detail: 'Тот же вопрос. Показывает долю неправильных считываний. Используется для расчёта индекса чистоты = правильные − неправильные.' },
  { name: 'Верно назвали бренд', badge: 'откр. вопрос', question: 'Какой бренд рекламировался в этой рекламе?', detail: 'Правильные и близкие к правильным ответы.' },
  { name: 'Верно назвали продукт / фичу', badge: 'откр. вопрос', question: 'А какой именно продукт или его возможность?', detail: 'Уточняющий открытый вопрос к предыдущему.' },
];

const HELP_OPTIONAL2: HelpMetric[] = [
  { name: 'Желание использовать чаще', badge: 'топ-1 · среди пользователей', question: 'Как вы думаете, как этот ролик повлияет на ваше использование продукта?', detail: 'Топ-1 = «Стану пользоваться чаще».' },
  { name: 'Желание скачать / начать использовать', badge: 'топ-1 · среди непользователей', question: 'Как вы думаете, как этот ролик повлияет на ваше желание установить и начать использовать продукт?', detail: 'Топ-1 = «Точно скачаю и начну пользоваться».' },
];

const HELP_EMOTIONAL = [
  ['Лаконичный, простой, понятный', 'Загроможденный, сложный'],
  ['Инновационный, современный', 'Отсталый, устаревший'],
  ['Яркий', 'Скучный'],
  ['Заботливый, помогающий', 'Чужой, отстраненный'],
  ['Вселяющий уверенность, надежный', 'Сомнительный, вызывающий недоверие'],
  ['Оптимистичный, воодушевляющий', 'Унылый, тоскливый'],
  ['Умиротворяющий', 'Вызывающий беспокойство'],
  ['Выделяющийся', 'Заурядный'],
];

function HelpMetricCard({ m }: { m: HelpMetric }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-semibold text-[var(--color-text)]">{m.name}</span>
        {m.badge && (
          <span className="px-1.5 py-[1px] rounded-md bg-[#EDE9FE] text-[#7C3AED] text-[9px] font-semibold uppercase tracking-wide shrink-0">{m.badge}</span>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed italic mb-1.5">{m.question}</p>
      <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">{m.detail}</p>
    </div>
  );
}

function HelpTab() {
  return (
    <div className="space-y-8">
      <p className="text-[13px] text-[var(--color-text-muted)]">
        Описание вопросов анкеты и логики расчёта показателей.
      </p>

      {/* Main metrics */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1">Основные показатели</h2>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
          Измеряются для каждого ролика. Подсветка в таблицах — статистически значимое отличие от нормы (z-критерий, p{'<'}0.05).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HELP_MAIN.map(m => <HelpMetricCard key={m.name} m={m} />)}
        </div>
      </div>

      {/* Optional metrics */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1">Опциональные показатели</h2>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
          Измеряются не для всех роликов. Прочерк в таблице означает, что вопрос не задавался.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HELP_OPTIONAL.map(m => <HelpMetricCard key={m.name} m={m} />)}
        </div>
      </div>

      {/* Optional part 2 */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1">Опциональные показатели — часть 2</h2>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
          Оцениваем разницу между контрольной группой (видели креатив) и тестовой группой (не видели креатив).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HELP_OPTIONAL2.map(m => <HelpMetricCard key={m.name} m={m} />)}
        </div>
      </div>

      {/* Emotional perception */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1">Эмоциональное восприятие — пары высказываний</h2>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
          Какие ассоциации у вас возникают после просмотра ролика? Из каждой пары выберите только одно высказывание.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HELP_EMOTIONAL.map(([pos, neg]) => (
            <div key={pos} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-center gap-3">
              <span className="text-xs font-medium text-[var(--color-success)] flex-1 text-right">{pos}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">↔</span>
              <span className="text-xs font-medium text-[var(--color-error)] flex-1">{neg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Index */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1">Индекс</h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-2">
            Сводный показатель качества креатива, используемый в таблице «Рейтинг».
          </p>
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-2 font-mono">
            Индекс = (Нравится + Понятность + Уникальность + Намерение) / 4
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
            Среднее арифметическое четырёх ключевых метрик. Если у креатива заполнены хотя бы 3 из 4 значений — считается среднее по доступным. Если меньше 3 — индекс не рассчитывается.
          </p>
        </div>
      </div>

      {/* Methodology */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1">Методология подсветки</h2>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-2">
            Цветовая подсветка значений в таблицах основана на z-тесте для долей (уровень значимости p{'<'}0.05, |z|{'>'}1.96).
          </p>
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-3 font-mono">
            z = (p − p₀) / √(p₀·(1−p₀) / n)
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed mb-2">
            где p — значение метрики для конкретного ролика, n — база ролика, p₀ — среднее по всем роликам базы норм.
          </p>
          <div className="flex gap-6 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]" /> Значимо выше нормы</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[var(--color-error)]" /> Значимо ниже нормы</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--color-bg-secondary)] border border-[var(--color-border)]" /> В пределах нормы</span>
          </div>
        </div>
      </div>
    </div>
  );
}
