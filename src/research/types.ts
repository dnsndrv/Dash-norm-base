export interface CreativeMetrics {
  interesting: number | null;
  like: number | null;
  clarity: number | null;
  relevance: number | null;
  uniqueness: number | null;
  brandRecognition: number | null;
  brandFit: number | null;
  brandAttitude: number | null;
  intent: number | null;
  useMore: number | null;
  startUsing: number | null;
  correctFeatures: number | null;
  incorrectFeatures: number | null;
  brandRecall: number | null;
  productRecall: number | null;
}

export interface Creative {
  id: number;
  name: string;
  task: string;
  period: string;
  product: string;
  campaign: string;
  base: number;
  format: string;
  productionType: string;
  competitorType: string;
  rutubeUrl: string | null;
  metrics: CreativeMetrics;
  dislikes: Record<string, number | null>;
  likes: Record<string, number | null>;
  brandAttribution: Record<string, number | null>;
  emotional: Record<string, number | null>;
}

export interface EmotionalPairDef {
  positiveKey: string;
  negativeKey: string;
  positiveLabel: string;
  negativeLabel: string;
}

export interface DashboardData {
  creatives: Creative[];
  periods: string[];
  metricLabels: Record<string, string>;
  metricQuestions: Record<string, string>;
  dislikeLabels: Record<string, string>;
  likeLabels: Record<string, string>;
  brandAttributionLabels: Record<string, string>;
  emotionalPairs: EmotionalPairDef[];
}

export type MetricKey = keyof CreativeMetrics;

export interface MetricDef {
  key: MetricKey;
  label: string;
}

export const MAIN_METRICS: MetricDef[] = [
  { key: 'intent', label: 'Намерение' },
  { key: 'like', label: 'Нравится' },
  { key: 'clarity', label: 'Понятность' },
  { key: 'uniqueness', label: 'Уникальность' },
  { key: 'brandRecognition', label: 'Узнаваемость' },
];

export const KEY_METRICS: MetricKey[] = ['like', 'clarity', 'uniqueness', 'intent'];

export const CHART_COLORS = [
  '#6c5ce7', '#00b894', '#fdcb6e', '#74b9ff',
  '#e17055', '#fd79a8', '#00cec9', '#a29bfe',
  '#55efc4', '#fab1a0', '#81ecec', '#ffeaa7',
];
