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
  ChevronDown, ChevronUp, Info, Maximize2, HelpCircle, RefreshCw,
} from 'lucide-react';
import type { DashboardData, Creative, MetricKey } from './research/types';
import { MAIN_METRICS, KEY_METRICS, CHART_COLORS } from './research/types';
import { pct, pctN, avg, computeAverages, getUniqueValues, zTestProp, zScoreColor, totalBase, avgByKey } from './research/utils';
import BrandRecallOverview from './components/BrandRecallOverview';
import ChatDrawer, { type ChatContext, type ChatContextRow } from './components/ChatDrawer';
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

function creativeCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? 'креатив'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? 'креатива'
      : 'креативов';
  return `${count} ${word}`;
}

function roundedPercentParts(values: number[]): number[] {
  const floors = values.map(Math.floor);
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  const result = [...floors];
  for (let i = 0; i < order.length && remainder > 0; i++, remainder--) {
    result[order[i].index] += 1;
  }
  return result;
}

type TabKey = 'overview' | 'drivers' | 'help';

const TABS: { key: TabKey; label: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', label: 'Обзор', icon: BarChart3 },
  { key: 'drivers', label: 'Драйверы', icon: TrendingUp },
  { key: 'help', label: 'Справка', icon: HelpCircle },
];


// Standalone build: данные приходят из bundled snapshot, но если задан
// VITE_DASHBOARD_API_URL — кнопка «Обновить» в шапке подтянет свежую версию
// через Yandex Cloud Function (она читает Google Sheet через service account
// и возвращает тот же формат JSON, что лежит в src/data/dashboard.json).
const initialData = dashboardSnapshot as unknown as DashboardData;
const DASHBOARD_API_URL = import.meta.env.VITE_DASHBOARD_API_URL as string | undefined;

export default function Research() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(420);
  const resizingRef = useRef(false);
  const [data, setData] = useState<DashboardData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshError(null);
    if (!DASHBOARD_API_URL) {
      setRefreshError('VITE_DASHBOARD_API_URL не задан в окружении сборки.');
      return;
    }
    setRefreshing(true);
    try {
      const response = await fetch(DASHBOARD_API_URL, { method: 'GET' });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      const fresh = await response.json() as DashboardData;
      if (!Array.isArray(fresh?.creatives)) {
        throw new Error('Ответ не похож на dashboard data');
      }
      setData(fresh);
      setRefreshedAt(new Date());
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'Не удалось обновить данные');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  // Filters
  const [fProduct, setFProduct] = useState('');
  const [fCampaign, setFCampaign] = useState('');
  const [fCompetitor, setFCompetitor] = useState('Яндекс');
  const [fPeriod, setFPeriod] = useState('');
  const [fFormat, setFFormat] = useState('');
  const [fCreatives, setFCreatives] = useState<Set<string>>(new Set());


  type FilterKey = 'product' | 'campaign' | 'competitorType' | 'period' | 'format' | 'creatives';
  type FilterState = {
    product: string;
    campaign: string;
    competitorType: string;
    period: string;
    format: string;
    creatives: Set<string>;
  };

  const [cmpProduct, setCmpProduct] = useState('');
  const [cmpCampaign, setCmpCampaign] = useState('');
  const [cmpCompetitor, setCmpCompetitor] = useState('');
  const [cmpPeriod, setCmpPeriod] = useState('');
  const [cmpFormat, setCmpFormat] = useState('');
  const [cmpCreatives, setCmpCreatives] = useState<Set<string>>(new Set());

  const primaryFilters = useMemo<FilterState>(() => ({
    product: fProduct,
    campaign: fCampaign,
    competitorType: fCompetitor,
    period: fPeriod,
    format: fFormat,
    creatives: fCreatives,
  }), [fProduct, fCampaign, fCompetitor, fPeriod, fFormat, fCreatives]);

  const comparisonFilters = useMemo<FilterState>(() => ({
    product: cmpProduct,
    campaign: cmpCampaign,
    competitorType: cmpCompetitor,
    period: cmpPeriod,
    format: cmpFormat,
    creatives: cmpCreatives,
  }), [cmpProduct, cmpCampaign, cmpCompetitor, cmpPeriod, cmpFormat, cmpCreatives]);

  const filterIsActive = useCallback((filters: FilterState) => (
    !!(filters.product || filters.campaign || filters.competitorType ||
      filters.period || filters.format || filters.creatives.size)
  ), []);

  const matchesFilters = useCallback((c: Creative, filters: FilterState, exclude?: FilterKey) => (
    (exclude === 'product'        || !filters.product        || c.product === filters.product) &&
    (exclude === 'campaign'       || !filters.campaign       || c.campaign === filters.campaign) &&
    (exclude === 'competitorType' || !filters.competitorType || c.competitorType === filters.competitorType) &&
    (exclude === 'period'         || !filters.period         || c.period === filters.period) &&
    (exclude === 'format'         || !filters.format         || c.format === filters.format) &&
    (exclude === 'creatives'      || filters.creatives.size === 0 || filters.creatives.has(c.name))
  ), []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.creatives.filter(c => matchesFilters(c, primaryFilters));
  }, [matchesFilters, primaryFilters]);

  const comparisonHasFilters = filterIsActive(comparisonFilters);
  const comparisonCreatives = useMemo(() => {
    if (!comparisonHasFilters) return data.creatives;
    return data.creatives.filter(c => matchesFilters(c, comparisonFilters));
  }, [comparisonHasFilters, matchesFilters, comparisonFilters]);

  const makeOptions = useCallback((filters: FilterState, exclude: FilterKey) => {
    return getUniqueValues(data.creatives.filter(c => matchesFilters(c, filters, exclude)), exclude as keyof Creative);
  }, [matchesFilters]);

  const makePeriodOptions = useCallback((filters: FilterState) => {
    const allowed = new Set(data.creatives.filter(c => matchesFilters(c, filters, 'period')).map(c => c.period));
    return data.periods.filter(p => allowed.has(p));
  }, [matchesFilters]);

  const makeCreativeOptions = useCallback((filters: FilterState) => {
    const names = [...new Set(data.creatives.filter(c => matchesFilters(c, filters, 'creatives')).map(c => c.name))].filter(Boolean).sort();
    return names.map(n => ({ value: n, label: n.length > 50 ? n.slice(0, 50) + '…' : n }));
  }, [matchesFilters]);

  // Per-field option lists, built from the cross-filtered data minus that field.
  const productOptions    = useMemo(() => makeOptions(primaryFilters, 'product'),        [makeOptions, primaryFilters]);
  const campaignOptions   = useMemo(() => makeOptions(primaryFilters, 'campaign'),       [makeOptions, primaryFilters]);
  const competitorOptions = useMemo(() => makeOptions(primaryFilters, 'competitorType'), [makeOptions, primaryFilters]);
  const periodOptions     = useMemo(() => makePeriodOptions(primaryFilters),             [makePeriodOptions, primaryFilters]);
  const formatOptions     = useMemo(() => makeOptions(primaryFilters, 'format'),         [makeOptions, primaryFilters]);
  const creativeOptions   = useMemo(() => makeCreativeOptions(primaryFilters),           [makeCreativeOptions, primaryFilters]);

  const cmpProductOptions    = useMemo(() => makeOptions(comparisonFilters, 'product'),        [makeOptions, comparisonFilters]);
  const cmpCampaignOptions   = useMemo(() => makeOptions(comparisonFilters, 'campaign'),       [makeOptions, comparisonFilters]);
  const cmpCompetitorOptions = useMemo(() => makeOptions(comparisonFilters, 'competitorType'), [makeOptions, comparisonFilters]);
  const cmpPeriodOptions     = useMemo(() => makePeriodOptions(comparisonFilters),             [makePeriodOptions, comparisonFilters]);
  const cmpFormatOptions     = useMemo(() => makeOptions(comparisonFilters, 'format'),         [makeOptions, comparisonFilters]);
  const cmpCreativeOptions   = useMemo(() => makeCreativeOptions(comparisonFilters),           [makeCreativeOptions, comparisonFilters]);

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

  useEffect(() => { if (cmpProduct    && !cmpProductOptions.includes(cmpProduct))        setCmpProduct(''); },    [cmpProduct, cmpProductOptions]);
  useEffect(() => { if (cmpCampaign   && !cmpCampaignOptions.includes(cmpCampaign))      setCmpCampaign(''); },   [cmpCampaign, cmpCampaignOptions]);
  useEffect(() => { if (cmpCompetitor && !cmpCompetitorOptions.includes(cmpCompetitor))  setCmpCompetitor(''); }, [cmpCompetitor, cmpCompetitorOptions]);
  useEffect(() => { if (cmpPeriod     && !cmpPeriodOptions.includes(cmpPeriod))          setCmpPeriod(''); },     [cmpPeriod, cmpPeriodOptions]);
  useEffect(() => { if (cmpFormat     && !cmpFormatOptions.includes(cmpFormat))          setCmpFormat(''); },     [cmpFormat, cmpFormatOptions]);
  useEffect(() => {
    if (cmpCreatives.size === 0) return;
    const allowed = new Set(cmpCreativeOptions.map(o => o.value));
    let changed = false;
    const next = new Set<string>();
    for (const v of cmpCreatives) {
      if (allowed.has(v)) next.add(v); else changed = true;
    }
    if (changed) setCmpCreatives(next);
  }, [cmpCreatives, cmpCreativeOptions]);

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

  const hasFilters = filterIsActive(primaryFilters);

  const filteredAvg = useMemo(
    () => (hasFilters && filtered.length ? computeAverages(filtered) : allAvg),
    [filtered, allAvg, hasFilters],
  );

  const comparisonAvg = useMemo(
    () => (comparisonCreatives.length ? computeAverages(comparisonCreatives) : allAvg),
    [comparisonCreatives, allAvg],
  );

  const chatContext = useMemo<ChatContext>(() => {
    const activeFilters = {
      product: fProduct || null,
      campaign: fCampaign || null,
      competitorType: fCompetitor || null,
      period: fPeriod || null,
      format: fFormat || null,
      creatives: Array.from(fCreatives),
    };
    const comparisonFiltersPayload = {
      product: cmpProduct || null,
      campaign: cmpCampaign || null,
      competitorType: cmpCompetitor || null,
      period: cmpPeriod || null,
      format: cmpFormat || null,
      creatives: Array.from(cmpCreatives),
    };

    // Сырые строки таблицы — без id/task/rutubeUrl, без null-значений
    // в словарях, чтобы JSON оставался компактным. LLM сам считает
    // агрегаты и сравнения по этим данным.
    const dropNulls = (obj: Record<string, number | null> | undefined): Record<string, number | null> | undefined => {
      if (!obj) return undefined;
      const out: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v != null) out[k] = v;
      }
      return Object.keys(out).length ? out : undefined;
    };

    const toRow = (c: Creative): ChatContextRow => ({
      name: c.name,
      product: c.product,
      campaign: c.campaign,
      period: c.period,
      format: c.format,
      productionType: c.productionType,
      competitorType: c.competitorType,
      respondentBase: c.base || 0,
      metrics: dropNulls(c.metrics as unknown as Record<string, number | null>) ?? {},
      likes: dropNulls(c.likes),
      dislikes: dropNulls(c.dislikes),
      emotional: dropNulls(c.emotional),
      brandAttribution: dropNulls(c.brandAttribution),
    });

    return {
      page: 'Brand Research',
      activeTab: tab,
      labels: {
        metrics: data.metricLabels,
        metricQuestions: data.metricQuestions,
        likes: data.likeLabels,
        dislikes: data.dislikeLabels,
        brandAttribution: data.brandAttributionLabels,
        emotionalPairs: data.emotionalPairs,
      },
      selection: {
        filters: activeFilters,
        count: filtered.length,
        total: data.creatives.length,
        respondentBase: totalBase(filtered),
        rows: filtered.map(toRow),
      },
      comparison: {
        filters: comparisonFiltersPayload,
        isFiltered: comparisonHasFilters,
        count: comparisonCreatives.length,
        total: data.creatives.length,
        respondentBase: totalBase(comparisonCreatives),
        rows: comparisonCreatives.map(toRow),
      },
    };
  }, [
    fProduct, fCampaign, fCompetitor, fPeriod, fFormat, fCreatives,
    cmpProduct, cmpCampaign, cmpCompetitor, cmpPeriod, cmpFormat, cmpCreatives,
    filtered, comparisonHasFilters, comparisonCreatives, data, tab,
  ]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!resizingRef.current) return;
      const nextWidth = Math.min(620, Math.max(340, window.innerWidth - event.clientX));
      setChatWidth(nextWidth);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="page-enter flex h-full min-h-0 gap-4">
      <section className="min-w-0 flex-1 overflow-y-auto pr-1">
        <div className="mx-auto max-w-[1400px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-semibold text-[var(--color-text)]">Brand Research</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--color-text-muted)]">
                {data.creatives.length} креативов
                {refreshedAt && (
                  <span className="ml-1 text-[var(--color-text-muted)]">
                    · обновлено {refreshedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </span>
              {DASHBOARD_API_URL && (
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  title={refreshing ? 'Обновляю…' : 'Подтянуть свежие данные из Google Sheet'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Обновляю…' : 'Обновить'}
                </button>
              )}
              {!chatOpen && (
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
                >
                  Открыть чат
                </button>
              )}
            </div>
          </div>
          {refreshError && (
            <div className="mb-3 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error-light)] px-3 py-2 text-[12px] text-[var(--color-error)]">
              Не удалось обновить данные: {refreshError}
            </div>
          )}
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
          <div className="mb-5 space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="flex flex-wrap gap-3 items-center">
          <span className="w-[118px] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Что сравниваем
          </span>
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
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">
            {filtered.length} из {data.creatives.length}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 items-center border-t border-[var(--color-border)] pt-2">
          <span className="w-[118px] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            База сравнения
          </span>
          <FilterSelect label="Яндекс / Конкуренты" value={cmpCompetitor} onChange={setCmpCompetitor} options={cmpCompetitorOptions} />
          <FilterSelect label="Продукт" value={cmpProduct} onChange={setCmpProduct} options={cmpProductOptions} />
          <FilterSelect label="Кампания" value={cmpCampaign} onChange={setCmpCampaign} options={cmpCampaignOptions} />
          <MultiFilterSelect label="Ролики" selected={cmpCreatives} onChange={setCmpCreatives} options={cmpCreativeOptions} />
          {tab !== 'overview' && (
            <>
              <FilterSelect label="Период" value={cmpPeriod} onChange={setCmpPeriod} options={cmpPeriodOptions} />
              <FilterSelect label="Формат" value={cmpFormat} onChange={setCmpFormat} options={cmpFormatOptions} />
            </>
          )}
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">
            {comparisonHasFilters ? `${comparisonCreatives.length} из ${data.creatives.length}` : `вся база (${data.creatives.length})`}
          </span>
        </div>
          </div>

          {/* Tab content */}
          {tab === 'overview' && <OverviewTab creatives={filtered} allCreatives={data.creatives} comparisonCreatives={comparisonCreatives} comparisonHasFilters={comparisonHasFilters} averages={filteredAvg!} comparisonAverages={comparisonAvg!} competitorAverages={competitorAvg} data={data} />}
          {tab === 'drivers' && <DriversTab creatives={filtered} averages={comparisonAvg!} />}
          {tab === 'help' && <HelpTab />}
        </div>
      </section>

      {chatOpen && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            title="Изменить ширину чата"
            onMouseDown={() => {
              resizingRef.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            className="hidden md:block w-1 shrink-0 cursor-col-resize rounded-full bg-transparent hover:bg-[var(--color-border-strong)] transition-colors"
          />
          <ChatDrawer
            context={chatContext}
            width={chatWidth}
            onClose={() => setChatOpen(false)}
          />
        </>
      )}
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
  /** z-score vs comparison norm. Drives color-coding; shown in hover tooltip. */
  zScore?: number | null;
  /** Delta vs comparison norm in raw proportion units (e.g. 0.032 = +3.2 п.п.).
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
              <div><span className="font-semibold">{deltaLabel}</span> относительно базы сравнения</div>
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
function OverviewTab({ creatives, allCreatives, comparisonCreatives, comparisonHasFilters, averages, comparisonAverages, competitorAverages, data }: {
  creatives: Creative[]; allCreatives: Creative[]; comparisonCreatives: Creative[];
  comparisonHasFilters: boolean;
  averages: Record<MetricKey, number | null>; comparisonAverages: Record<MetricKey, number | null>;
  competitorAverages: Record<MetricKey, number | null> | null;
  data: DashboardData;
}) {
  const { metricLabels, metricQuestions } = data;

  const isFiltered = creatives.length !== allCreatives.length;
  const nFiltered = totalBase(creatives);
  const comparisonLabel = comparisonCreatives.length === allCreatives.length
    ? 'Общее'
    : 'База сравнения';
  const comparisonSubLabel = comparisonCreatives.length === allCreatives.length
    ? `${allCreatives.length} креативов`
    : `${comparisonCreatives.length} из ${allCreatives.length} креативов`;

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
      result[m.key] = zTestProp(averages[m.key], comparisonAverages[m.key], nFiltered);
    }
    return result as Record<MetricKey, number | null>;
  }, [averages, comparisonAverages, nFiltered, isFiltered]);

  const buildBenchmarks = (key: MetricKey): KpiBenchmark[] => {
    if (comparisonHasFilters) {
      return [
        { label: 'Выборка', value: pct(averages[key]) },
        { label: 'База сравнения', value: pct(comparisonAverages[key]) },
      ];
    }
    const bm: KpiBenchmark[] = [
      { label: comparisonLabel, value: pct(comparisonAverages[key]) },
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
    const g = comparisonAverages[key];
    return a != null && g != null ? a - g : null;
  };

  const formatPpDelta = (delta: number | null): string => (
    delta != null ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} п.п.` : '—'
  );

  const renderKpiRow = (title: string, metrics: { key: MetricKey; label: string }[]) => (
    <div>
      <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metrics.map(m => {
          const delta = computePpDelta(m.key);
          return (
            <KpiCard
              key={m.key}
              label={metricLabels[m.key] || m.label}
              value={comparisonHasFilters ? formatPpDelta(delta) : pct(averages[m.key])}
              zScore={isFiltered ? zScores[m.key] : undefined}
              ppDelta={!comparisonHasFilters && isFiltered ? delta : undefined}
              benchmarks={buildBenchmarks(m.key)}
              sub={comparisonHasFilters
                ? `Выборка: ${creativeCountLabel(creatives.length)} · База: ${creativeCountLabel(comparisonCreatives.length)}`
                : subText}
              question={metricQuestions[m.key]}
            />
          );
        })}
      </div>
    </div>
  );

  // Likes / Dislikes averages — both for the current filtered cohort and the
  // global (all creatives) baseline. The baseline lets the combined "что
  // понравилось / не понравилось" chart mark significant deviations vs norm.
  const avgLikes = useMemo(() => avgByKey(creatives, c => c.likes), [creatives]);
  const avgDislikes = useMemo(() => avgByKey(creatives, c => c.dislikes), [creatives]);
  const comparisonAvgLikes = useMemo(() => avgByKey(comparisonCreatives, c => c.likes), [comparisonCreatives]);
  const comparisonAvgDislikes = useMemo(() => avgByKey(comparisonCreatives, c => c.dislikes), [comparisonCreatives]);

  const likeCategories = useMemo(() => {
    if (!data.likeLabels) return [];
    return orderLikeDislikeKeys(Object.keys(data.likeLabels), LIKE_EXTRA);
  }, [data.likeLabels]);

  const dislikeCategories = useMemo(() => {
    if (!data.dislikeLabels) return [];
    return orderLikeDislikeKeys(Object.keys(data.dislikeLabels), DISLIKE_EXTRA);
  }, [data.dislikeLabels]);

  // Combined likes/dislikes rows for the diverging "reactions" chart.
  // Most categories share the same key on both sides (music, voice, …) — for
  // them likeKey == dislikeKey == k. But some are semantically paired but
  // stored under different keys, e.g. "relevant" only lives in likes and
  // "irrelevant" only in dislikes. We bridge them into a single row so the
  // chart reads as: «актуально» зелёный + «не актуально» красный.
  const ASYMMETRIC_PAIRS: { key: string; likeKey: string; dislikeKey: string; label: string }[] = useMemo(() => [
    { key: 'relevance', likeKey: 'relevant', dislikeKey: 'irrelevant', label: 'Актуально / Не актуально' },
  ], []);

  type ReactionRow = { key: string; label: string; likeKey: string | null; dislikeKey: string | null };

  const reactionRows = useMemo<ReactionRow[]>(() => {
    const rows: ReactionRow[] = [];
    const usedLike = new Set<string>();
    const usedDislike = new Set<string>();
    // 1. Shared categories first, ordered by SHARED_ORDER.
    for (const k of SHARED_ORDER) {
      if (likeCategories.includes(k) || dislikeCategories.includes(k)) {
        rows.push({
          key: k,
          label: data.likeLabels?.[k] || data.dislikeLabels?.[k] || k,
          likeKey: likeCategories.includes(k) ? k : null,
          dislikeKey: dislikeCategories.includes(k) ? k : null,
        });
        usedLike.add(k);
        usedDislike.add(k);
      }
    }
    // 2. Asymmetric pairs (relevant/irrelevant etc.) — collapse them into one row.
    for (const pair of ASYMMETRIC_PAIRS) {
      const inLikes = likeCategories.includes(pair.likeKey);
      const inDislikes = dislikeCategories.includes(pair.dislikeKey);
      if (!inLikes && !inDislikes) continue;
      rows.push({
        key: pair.key,
        label: pair.label,
        likeKey: inLikes ? pair.likeKey : null,
        dislikeKey: inDislikes ? pair.dislikeKey : null,
      });
      if (inLikes) usedLike.add(pair.likeKey);
      if (inDislikes) usedDislike.add(pair.dislikeKey);
    }
    // 3. Remaining likes-only categories.
    for (const k of likeCategories) {
      if (usedLike.has(k)) continue;
      rows.push({ key: `L:${k}`, label: data.likeLabels?.[k] || k, likeKey: k, dislikeKey: null });
    }
    // 4. Remaining dislikes-only categories.
    for (const k of dislikeCategories) {
      if (usedDislike.has(k)) continue;
      rows.push({ key: `D:${k}`, label: data.dislikeLabels?.[k] || k, likeKey: null, dislikeKey: k });
    }
    return rows;
  }, [likeCategories, dislikeCategories, data.likeLabels, data.dislikeLabels, ASYMMETRIC_PAIRS]);

  // Emotional averages: filtered cohort + global baseline (for делta vs norm).
  const avgEmotional = useMemo(() => avgByKey(creatives, c => c.emotional), [creatives]);
  const comparisonAvgEmotional = useMemo(() => avgByKey(comparisonCreatives, c => c.emotional), [comparisonCreatives]);

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

      {/* Open-question recall by creative. Wired to the page-level filters
          (Yandex/Competitors → Product → Campaign → Creatives) — no more
          widget-local picker. Top-10 by default, expand to all.
          `baselineCreatives` = full dataset → the widget can mark per-row
          significance (▲/▼) vs «база в целом». */}
      <BrandRecallOverview
        creatives={creatives}
        baselineCreatives={comparisonCreatives}
        only="recall"
      />

      {renderKpiRow('Дополнительные метрики', EXTRA_METRICS)}

      {prodTypes.length > 0 && (() => {
        const visibleProdTypes = prodTypes.filter(p => prodTypeGroups[p]?.length > 0);
        const SIG_Z = 1.96;
        const groupBases: Record<string, number> = {};
        for (const p of visibleProdTypes) {
          groupBases[p] = prodTypeGroups[p].reduce((s, c) => s + (c.base || 0), 0);
        }
        const valueFor = (type: string, key: MetricKey): number | null =>
          avg(prodTypeGroups[type].map(c => c.metrics[key]));
        const pctValue = (value: number | null): number | null =>
          value == null ? null : value * 100;
        const zTwoProp = (p1: number | null, n1: number, p2: number | null, n2: number): number | null => {
          if (p1 == null || p2 == null || n1 <= 0 || n2 <= 0) return null;
          const pooled = ((p1 * n1) + (p2 * n2)) / (n1 + n2);
          if (pooled <= 0 || pooled >= 1) return null;
          const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
          return se > 0 ? (p1 - p2) / se : null;
        };
        const zFor = (type: string, key: MetricKey): number | null => {
          const others = visibleProdTypes.filter(t => t !== type).flatMap(t => prodTypeGroups[t]);
          if (!others.length) return null;
          return zTwoProp(
            valueFor(type, key),
            groupBases[type] || 0,
            avg(others.map(c => c.metrics[key])),
            totalBase(others),
          );
        };
        return (
        <ChartCard
          title="Средние по типу производства"
          info={
            <>
              <p>
                Сравнение типов производства внутри текущей выборки. Для каждой
                метрики столбцы ИИ и Продакшн стоят рядом, чтобы сравнивать их
                друг с другом.
              </p>
              <p className="mt-1">
                ▲ / ▼ возле значения — тип производства значимо выше/ниже
                остальных типов по этой метрике (|z|&nbsp;≥&nbsp;{SIG_Z}, p&nbsp;&lt;&nbsp;0.05).
              </p>
            </>
          }
        >
          <Bar
            data={{
              labels: prodTypeMetrics.map(m => m.label),
              datasets: visibleProdTypes.map((type, idx) => ({
                label: `${type} (${prodTypeGroups[type].length})`,
                data: prodTypeMetrics.map(m => pctValue(valueFor(type, m.key))),
                backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                borderRadius: 4,
              })),
            }}
            options={{
              responsive: true,
              layout: { padding: { top: 16 } },
              plugins: {
                legend: { labels: { font: { size: 12 } } },
                tooltip: {
                  callbacks: {
                    afterLabel: (ctx) => {
                      const type = visibleProdTypes[ctx.datasetIndex];
                      const m = prodTypeMetrics[ctx.dataIndex];
                      const z = zFor(type, m.key);
                      const sigTag =
                        z == null ? '' : z >= SIG_Z ? ' ▲' : z <= -SIG_Z ? ' ▼' : '';
                      return `Сравнение с другими типами: z=${z?.toFixed(2) ?? '—'}${sigTag}`;
                    },
                  },
                },
                datalabels: {
                  display: true,
                  font: { size: 10, weight: 600 },
                  anchor: 'end',
                  align: 'end',
                  offset: 2,
                  // Show the % value plus a tiny ▲/▼ when the cohort is
                  // significantly above/below other production types.
                  formatter: (v: number | null, ctx) => {
                    if (v == null) return '';
                    const type = visibleProdTypes[ctx.datasetIndex];
                    const m = prodTypeMetrics[ctx.dataIndex];
                    const z = zFor(type, m.key);
                    const sig = z == null ? '' : z >= SIG_Z ? ' ▲' : z <= -SIG_Z ? ' ▼' : '';
                    return `${v.toFixed(2)}%${sig}`;
                  },
                  // Marker colors the entire label so users see the direction
                  // of deviation at a glance; neutral cells stay dark gray.
                  color: (ctx) => {
                    const type = visibleProdTypes[ctx.datasetIndex];
                    const m = prodTypeMetrics[ctx.dataIndex];
                    const z = zFor(type, m.key);
                    if (z != null && z >= SIG_Z) return '#00985F';
                    if (z != null && z <= -SIG_Z) return '#FF3333';
                    return '#1F1F1F';
                  },
                },
              },
              scales: {
                x: {
                  ticks: {
                    font: { size: 11 },
                    color: '#374151',
                  },
                  grid: { display: false },
                },
                y: { ticks: { font: { size: 11 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.06)' }, min: 0 },
              },
            }}
          />
        </ChartCard>
        );
      })()}

      {/* Reactions: combined diverging chart for "что понравилось / не понравилось".
          Green = доля «понравилось» (вправо), красный = доля «не понравилось»
          (показывается влево как отрицательное значение). Каждая строка-категория
          несёт обе доли. Если выборка отфильтрована — отмечаем значимое отклонение
          от общей нормы (z-test по сумме баз креативов). */}
      {reactionRows.length > 0 && (() => {
        const n = isFiltered ? nFiltered : totalBase(allCreatives);
        const SIG_Z = 1.65;
        type Side = 'like' | 'dislike';
        const valueFor = (row: ReactionRow, side: Side): number | null => {
          const key = side === 'like' ? row.likeKey : row.dislikeKey;
          if (!key) return null;
          return (side === 'like' ? avgLikes : avgDislikes)[key] ?? null;
        };
        const globalFor = (row: ReactionRow, side: Side): number | null => {
          const key = side === 'like' ? row.likeKey : row.dislikeKey;
          if (!key) return null;
          return (side === 'like' ? comparisonAvgLikes : comparisonAvgDislikes)[key] ?? null;
        };
        const zFor = (row: ReactionRow, side: Side): number | null => {
          if (!isFiltered) return null;
          return zTestProp(valueFor(row, side), globalFor(row, side), n);
        };
        // Significance is encoded directly on the % datalabels next to each
        // bar (green = ▲ vs norm, red = ▼) — no more inline arrows on the
        // y-axis ticks, which Chart.js couldn't color independently and so
        // looked like ambiguous gray symbols.
        const labels = reactionRows.map(row => row.label);
        const likeData = reactionRows.map(r => pctN(valueFor(r, 'like')) ?? 0);
        const dislikeData = reactionRows.map(r => {
          const v = pctN(valueFor(r, 'dislike'));
          return v == null ? 0 : -v;
        });
        return (
          <ChartCard
            title="Реакция аудитории — понравилось / не понравилось"
            info={
              <>
                <p>
                  Слева красное — доля респондентов, отметивших аспект как «не понравился»;
                  справа зелёное — доля «понравился». «Актуально / Не актуально» —
                  парные категории из likes и dislikes объединены в одну строку.
                  Мета-ответы «ничего не понравилось» и «всё устраивает» скрыты.
                </p>
                {isFiltered && (
                  <p className="mt-1">
                    Цвет процента и значок рядом с баром — значимое отклонение
                    текущей выборки от выбранной базы сравнения (|z|&nbsp;≥&nbsp;
                    {SIG_Z.toFixed(2)}).{' '}
                    <span className="text-[var(--color-success)] font-medium">▲ зелёный</span> —
                    значимо выше нормы,{' '}
                    <span className="text-[var(--color-error)] font-medium">▼ красный</span> —
                    значимо ниже, серый без значка — в пределах нормы.
                  </p>
                )}
              </>
            }
          >
            <div style={{ height: Math.max(260, reactionRows.length * 28) }}>
              <Bar
                data={{
                  labels,
                  datasets: [
                    {
                      label: 'Не понравилось',
                      data: dislikeData,
                      backgroundColor: '#EF4444',
                      borderRadius: 4,
                      barThickness: 12,
                    },
                    {
                      label: 'Понравилось',
                      data: likeData,
                      backgroundColor: '#10B981',
                      borderRadius: 4,
                      barThickness: 12,
                    },
                  ],
                }}
                options={{
                  indexAxis: 'y',
                  responsive: true,
                  maintainAspectRatio: false,
                  // Reserve space on both edges so outside-of-bar percentage
                  // labels (left tip of red bars, right tip of green bars)
                  // don't get clipped.
                  layout: { padding: { left: 56, right: 56 } },
                  plugins: {
                    legend: {
                      position: 'top',
                      align: 'start',
                      labels: { font: { size: 12 }, boxWidth: 12, boxHeight: 12, padding: 14 },
                    },
                    tooltip: {
                      callbacks: {
                        title: (items) => reactionRows[items[0].dataIndex]?.label ?? '',
                        // Tooltip: just the current value (the deviation is
                        // already communicated by ▲/▼ on the y-label, so we
                        // drop the noisy "+X пп vs норма" suffix).
                        label: (ctx) => {
                          const row = reactionRows[ctx.dataIndex];
                          const side: Side = ctx.datasetIndex === 0 ? 'dislike' : 'like';
                          const v = pctN(valueFor(row, side));
                          const head = side === 'like' ? 'Понравилось' : 'Не понравилось';
                          if (v == null) return `${head}: —`;
                          return `${head}: ${v.toFixed(1)}%`;
                        },
                      },
                    },
                    datalabels: {
                      display: true,
                      clip: false,
                      clamp: false,
                      font: { size: 11, weight: 700 },
                      // Put labels outside the far end of each bar. For
                      // negative horizontal bars Chart.js treats `end` as the
                      // zero-side edge, so we explicitly use the left edge
                      // (`start`) and absolute left alignment for the red
                      // dislike dataset.
                      anchor: (ctx) => (ctx.datasetIndex === 0 ? 'start' : 'end'),
                      align: (ctx) => (ctx.datasetIndex === 0 ? 'left' : 'right'),
                      offset: 6,
                      color: (ctx) => {
                        const row = reactionRows[ctx.dataIndex];
                        const side: Side = ctx.datasetIndex === 0 ? 'dislike' : 'like';
                        const z = zFor(row, side);
                        if (z != null && z >= SIG_Z) return '#00985F';
                        if (z != null && z <= -SIG_Z) return '#FF3333';
                        return '#374151';
                      },
                      // Append ▲ if significantly above the global norm for
                      // this category/side, ▼ if below. No marker = within
                      // norm. Skip empty bars (asymmetric pairs).
                      formatter: (v: number, ctx) => {
                        if (v == null || v === 0) return '';
                        const row = reactionRows[ctx.dataIndex];
                        const side: Side = ctx.datasetIndex === 0 ? 'dislike' : 'like';
                        const z = zFor(row, side);
                        const mark =
                          z == null ? '' : z >= SIG_Z ? ' ▲' : z <= -SIG_Z ? ' ▼' : '';
                        return `${Math.abs(v).toFixed(0)}%${mark}`;
                      },
                    },
                  },
                  scales: {
                    // Only Y is stacked — this is what collapses both
                    // datasets onto the same row (otherwise grouped bars
                    // offset onto alternating rows). X must NOT be stacked,
                    // because in stacked-X mode the datalabels plugin treats
                    // bar's "end" relative to the stack base (zero) instead
                    // of the data value, which broke outside-tip labels for
                    // negative bars.
                    x: {
                      stacked: false,
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
                      stacked: true,
                      ticks: { font: { size: 11 }, color: '#374151' },
                      grid: { display: false },
                    },
                  },
                }}
              />
            </div>
          </ChartCard>
        );
      })()}

      {/* Emotional Perception — semantic differential with explicit "затрудняюсь
          ответить" share + сравнение со средним. Раньше нормировали pos/neg к
          100% и теряли «затрудняюсь»; теперь показываем три абсолютных доли. */}
      {data.emotionalPairs?.length > 0 && (() => {
        const SIG_PP = 3; // ≥3 пп vs norm считаем «заметным» отклонением
        return (
          <ChartCard
            title="Эмоциональное восприятие"
            info={
              <>
                <p>
                  Полоса — три доли респондентов: <span className="text-[#00985F] font-medium">позитивная</span>,{' '}
                  <span className="text-[#FF3333] font-medium">негативная</span> и{' '}
                  <span className="text-[var(--color-text-muted)] font-medium">«затрудняюсь ответить»</span>{' '}
                  (= 100% − позитив − негатив).
                </p>
                {isFiltered && (
                  <p className="mt-1">
                    Под полосой — отклонение позитива, «затрудняюсь ответить» и негатива от выбранной базы сравнения
                    в процентных пунктах. ▲ выше нормы, ▼ ниже (порог {SIG_PP}&nbsp;пп).
                  </p>
                )}
              </>
            }
          >
            <div className="space-y-3 py-2">
              {data.emotionalPairs.map(pair => {
                const pv = (avgEmotional[pair.positiveKey] ?? 0) * 100;
                const nv = (avgEmotional[pair.negativeKey] ?? 0) * 100;
                const dk = Math.max(0, 100 - pv - nv);
                const [pvLabel, dkLabel, nvLabel] = roundedPercentParts([pv, dk, nv]);
                const gpv = (comparisonAvgEmotional[pair.positiveKey] ?? 0) * 100;
                const gnv = (comparisonAvgEmotional[pair.negativeKey] ?? 0) * 100;
                const gdk = Math.max(0, 100 - gpv - gnv);
                const dpv = pv - gpv;
                const ddk = dk - gdk;
                const dnv = nv - gnv;
                const arrow = (d: number) => (d >= SIG_PP ? '▲' : d <= -SIG_PP ? '▼' : '·');
                const fmt = (d: number) => (d >= 0 ? '+' : '') + d.toFixed(1) + ' пп';
                const cls = (d: number) =>
                  d >= SIG_PP
                    ? 'text-[var(--color-success)]'
                    : d <= -SIG_PP
                      ? 'text-[var(--color-error)]'
                      : 'text-[var(--color-text-muted)]';
                return (
                  <div key={pair.positiveKey} className="flex items-center gap-2">
                    <span className="w-[140px] text-right text-[11px] text-[var(--color-text-secondary)] leading-tight shrink-0">
                      {pair.positiveLabel}
                    </span>
                    <div className="flex-1">
                      <div
                        className="h-6 rounded-full overflow-hidden bg-[var(--color-bg-secondary)] flex"
                        title={`Позитив ${pvLabel}% · Затрудняюсь ${dkLabel}% · Негатив ${nvLabel}%`}
                      >
                        <div className="h-full bg-[#00b894] transition-all flex items-center justify-center overflow-visible" style={{ width: `${pv}%` }}>
                          {pv >= 3 && (
                            <span className="text-[10px] font-semibold text-white drop-shadow-sm whitespace-nowrap">
                              {pvLabel}%
                            </span>
                          )}
                        </div>
                        <div className="h-full bg-[var(--color-border-strong)] transition-all flex items-center justify-center overflow-visible" style={{ width: `${dk}%` }}>
                          {dk >= 6 && (
                            <span className="text-[10px] font-medium text-[var(--color-text-secondary)] whitespace-nowrap">
                              {dkLabel}%
                            </span>
                          )}
                        </div>
                        <div className="h-full bg-[#ff6b6b] transition-all flex items-center justify-center overflow-visible" style={{ width: `${nv}%` }}>
                          {nv >= 3 && (
                            <span className="text-[10px] font-semibold text-white drop-shadow-sm whitespace-nowrap">
                              {nvLabel}%
                            </span>
                          )}
                        </div>
                      </div>
                      {isFiltered && (
                        <div className="flex text-[10px] mt-0.5 leading-none">
                          <span className={`${cls(dpv)} text-center whitespace-nowrap overflow-visible`} style={{ width: `${pv}%` }}>
                            {arrow(dpv)} {fmt(dpv)} <span className="text-[var(--color-text-muted)]">(норма {gpv.toFixed(0)}%)</span>
                          </span>
                          <span className={`${cls(ddk)} text-center whitespace-nowrap overflow-visible`} style={{ width: `${dk}%` }}>
                            {arrow(ddk)} {fmt(ddk)} <span className="text-[var(--color-text-muted)]">(норма {gdk.toFixed(0)}%)</span>
                          </span>
                          <span className={`${cls(-dnv)} text-center whitespace-nowrap overflow-visible`} style={{ width: `${nv}%` }}>
                            {arrow(dnv)} {fmt(dnv)} <span className="text-[var(--color-text-muted)]">(норма {gnv.toFixed(0)}%)</span>
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="w-[140px] text-[11px] text-[var(--color-text-secondary)] leading-tight shrink-0">
                      {pair.negativeLabel}
                    </span>
                  </div>
                );
              })}
              {/* Legend */}
              <div className="flex items-center justify-center gap-4 text-[10px] text-[var(--color-text-muted)] pt-1">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#00b894]" /> Позитивная сторона</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#ff6b6b]" /> Негативная сторона</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[var(--color-border-strong)]" /> Затрудняюсь ответить</span>
              </div>
            </div>
          </ChartCard>
        );
      })()}

      {/* Rating table */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Рейтинг</h2>
        <RatingTab
          creatives={creatives}
          allCreatives={allCreatives}
          comparisonCreatives={comparisonCreatives}
          averages={comparisonAverages}
        />
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
function RatingTab({ creatives, allCreatives, comparisonCreatives, averages }: {
  creatives: Creative[];
  allCreatives: Creative[];
  comparisonCreatives: Creative[];
  averages: Record<MetricKey, number | null>;
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
    if (sortCol === col) {
      return sortDir === 'desc'
        ? <ChevronDown size={11} className="inline ml-1 text-[var(--color-text)]" />
        : <ChevronUp size={11} className="inline ml-1 text-[var(--color-text)]" />;
    }
    return <ChevronDown size={10} className="inline ml-1 text-[var(--color-text-muted)] opacity-45" />;
  };

  const avgIndex = avg(KEY_METRICS.map(k => averages[k]));

  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)] mb-2">
        Цветовая индикация по z-критерию относительно выбранной базы сравнения (95% и 90% уровень значимости).
        Индекс = среднее по 4 метрикам.
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
              {/* Each cell is individually sticky — wrapping <tr> with
                  position:sticky doesn't reliably work in scrollable tables.
                  top-9 (~36px) clears the sticky thead above. */}
              <tr className="text-xs">
                {(() => {
                  const cls = 'sticky top-9 z-[9] bg-[var(--color-bg-secondary)] border-b-2 border-[#7C3AED]/30 px-2.5 py-2';
                  return (
                    <>
                      <td className={`${cls} text-[#7C3AED] font-bold`}>∅</td>
                      <td colSpan={3} className={`${cls} text-[#7C3AED] font-semibold`}>
                        Среднее базы сравнения ({comparisonCreatives.length} из {allCreatives.length})
                      </td>
                      <td className={cls} />
                      <td className={`${cls} font-bold`}>{pct(averages.like)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.clarity)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.uniqueness)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.relevance)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.brandRecognition)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.brandFit)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.brandAttitude)}</td>
                      <td className={`${cls} font-bold`}>{pct(averages.intent)}</td>
                      <td className={`${cls} font-bold`}>
                        {avgIndex != null ? (avgIndex * 100).toFixed(1) + '%' : '—'}
                      </td>
                    </>
                  );
                })()}
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

      {/* Top 30 by intent — colored by deviation from the cohort average. */}
      <ChartCard
        title="Топ-30 по намерению"
        info={
          <>
            Цвет столбика — отклонение от среднего значения «Намерение» по
            текущей выборке (порог ±5&nbsp;пп). Подпись справа от бара — само
            значение метрики.
          </>
        }
      >
        {/* Color legend (always visible — the chart no longer hides it in a tooltip). */}
        <div className="flex items-center gap-4 mb-3 text-[11px] text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#00b894]" />
            Выше среднего (+5&nbsp;пп и больше)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#74b9ff]" />
            В пределах ±5&nbsp;пп от среднего
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#ff6b6b]" />
            Ниже среднего (−5&nbsp;пп и меньше)
          </span>
          <span className="text-[var(--color-text-muted)] ml-auto">
            Среднее по выборке: {pct(averages.intent)}
          </span>
        </div>
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
              layout: { padding: { right: 48 } },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const c = top30[ctx.dataIndex];
                      const v = pctN(c.metrics.intent);
                      const a = pctN(averages.intent);
                      if (v == null) return 'Намерение: —';
                      if (a == null) return `Намерение: ${v.toFixed(1)}%`;
                      const d = v - a;
                      const sign = d >= 0 ? '+' : '';
                      return `Намерение: ${v.toFixed(1)}% · среднее ${a.toFixed(1)}% (${sign}${d.toFixed(1)} пп)`;
                    },
                  },
                },
                datalabels: {
                  display: true,
                  // Dark text outside the bar — the old white-on-end label
                  // was invisible against the page background.
                  color: '#1F1F1F',
                  font: { size: 11, weight: 600 },
                  anchor: 'end',
                  align: 'end',
                  offset: 4,
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
