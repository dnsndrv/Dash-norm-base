import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, Loader2, PanelRightClose, Send } from 'lucide-react';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface ChatContextRow {
  name: string;
  product: string;
  campaign: string;
  period: string;
  format: string;
  productionType: string;
  competitorType: string;
  /** Размер базы респондентов (n) для этого ролика — нужен для z-test. */
  respondentBase: number;
  metrics: Record<string, number | null>;
  likes?: Record<string, number | null>;
  dislikes?: Record<string, number | null>;
  emotional?: Record<string, number | null>;
  brandAttribution?: Record<string, number | null>;
}

export interface ChatContext {
  page: string;
  activeTab: string;
  /** Подписи метрик и категорий — LLM работает с raw ключами,
   *  это словарь key → человекочитаемая подпись. */
  labels: {
    metrics: Record<string, string>;
    metricQuestions: Record<string, string>;
    likes: Record<string, string>;
    dislikes: Record<string, string>;
    brandAttribution: Record<string, string>;
    emotionalPairs: Array<{
      positiveKey: string;
      negativeKey: string;
      positiveLabel: string;
      negativeLabel: string;
    }>;
  };
  selection: {
    filters: Record<string, string | string[] | null>;
    count: number;
    /** Всего роликов в исходной таблице. */
    total: number;
    respondentBase: number;
    rows: ChatContextRow[];
  };
  comparison: {
    filters: Record<string, string | string[] | null>;
    isFiltered: boolean;
    count: number;
    total: number;
    respondentBase: number;
    rows: ChatContextRow[];
  };
}

const CHAT_API_URL = import.meta.env.VITE_CHAT_API_URL as string | undefined;

const STARTERS = [
  'Что сильнее всего отличает выбранную кампанию от базы сравнения?',
  'Какие ролики лучшие по намерению?',
  'Что лучше у ИИ vs Продакшн в текущей выборке?',
];

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-[var(--color-text)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-white px-1 py-0.5 text-[12px] text-[var(--color-text-secondary)]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function ChatMessageText({ text }: { text: string }) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const blocks: ReactNode[] = [];
  let listItems: Array<{ ordered: boolean; text: string }> = [];
  const flushList = () => {
    if (!listItems.length) return;
    const ordered = listItems[0].ordered;
    const content = listItems.map((item, index) => (
      <li key={index} className="pl-1">{renderInline(item.text)}</li>
    ));
    blocks.push(ordered
      ? <ol key={`ol-${blocks.length}`} className="my-2 list-decimal space-y-1 pl-5">{content}</ol>
      : <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">{content}</ul>);
    listItems = [];
  };

  for (const line of lines) {
    const numbered = line.match(/^\d+[\.)]\s+(.+)$/);
    const bullet = line.match(/^[-–—]\s+(.+)$/);
    if (numbered) {
      if (listItems.length && !listItems[0].ordered) flushList();
      listItems.push({ ordered: true, text: numbered[1] });
      continue;
    }
    if (bullet) {
      if (listItems.length && listItems[0].ordered) flushList();
      listItems.push({ ordered: false, text: bullet[1] });
      continue;
    }
    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-2 first:mt-0 last:mb-0">
        {renderInline(line)}
      </p>,
    );
  }
  flushList();
  return <div className="chat-message-text">{blocks}</div>;
}

export default function ChatDrawer({
  context,
  width,
  onClose,
}: {
  context: ChatContext;
  width: number;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Задайте вопрос по текущей выборке и базе сравнения. Я буду отвечать только по данным дашборда.',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const contextLabel = useMemo(() => {
    const base = context.comparison.isFiltered
      ? `${context.comparison.count} в базе сравнения`
      : `вся база сравнения · ${context.comparison.count}`;
    return `${context.selection.count} в выборке · ${base}`;
  }, [context]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendQuestion();
    }
  };

  const sendQuestion = async (text = question.trim()) => {
    if (!text || loading) return;
    setError('');
    setQuestion('');
    setMessages(prev => [...prev, { role: 'user', text }]);

    if (!CHAT_API_URL) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: 'Чат-интерфейс готов, но backend ещё не подключён. Нужно задать VITE_CHAT_API_URL на Yandex Cloud Function endpoint.',
        },
      ]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, context }),
      });
      if (!response.ok) {
        throw new Error(`Chat API error: ${response.status}`);
      }
      const payload = await response.json() as { answer?: string };
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: payload.answer || 'Не удалось получить ответ по данным.' },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось отправить вопрос';
      setError(message);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: 'Не удалось получить ответ. Проверьте подключение chat backend.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside
      className="hidden md:flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
      style={{ width }}
      aria-label="Чат по базе"
    >
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot size={16} className="shrink-0" />
              <h2 className="truncate text-sm font-semibold text-[var(--color-text)]">Вопрос по базе</h2>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">{contextLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] cursor-pointer transition-colors"
            aria-label="Закрыть чат"
            title="Закрыть чат"
          >
            <PanelRightClose size={17} className="mx-auto" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {!CHAT_API_URL && (
          <div className="rounded-xl border border-[var(--color-warning)]/20 bg-[var(--color-warning-light)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            Backend ещё не подключён. Для боевого чата задайте <code>VITE_CHAT_API_URL</code> на Yandex Cloud Function.
          </div>
        )}
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
              msg.role === 'user'
                ? 'ml-8 bg-[var(--color-primary)] text-white'
                : 'mr-6 bg-[var(--color-bg-secondary)] text-[var(--color-text)]'
            }`}
          >
            {msg.role === 'assistant' ? <ChatMessageText text={msg.text} /> : msg.text}
          </div>
        ))}
        {loading && (
          <div className="mr-8 rounded-2xl bg-[var(--color-bg-secondary)] px-3 py-2 text-[13px] text-[var(--color-text-muted)] flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Думаю по данным...
          </div>
        )}
        {error && <p className="text-[11px] text-[var(--color-error)]">{error}</p>}
      </div>

      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {STARTERS.map(starter => (
            <button
              key={starter}
              type="button"
              onClick={() => sendQuestion(starter)}
              className="shrink-0 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] cursor-pointer transition-colors"
            >
              {starter}
            </button>
          ))}
        </div>
        <form
          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 focus-within:border-[var(--color-border-strong)]"
          onSubmit={e => {
            e.preventDefault();
            void sendQuestion();
          }}
        >
          <label className="sr-only" htmlFor="chat-question">Вопрос по базе</label>
          <textarea
            id="chat-question"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder="Спросите по таблице… Enter — отправить, Shift+Enter — перенос строки"
            className="min-h-[76px] w-full resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">Enter — отправить · Shift+Enter — перенос строки</span>
            <button
              type="submit"
              disabled={!question.trim() || loading}
              className="min-h-11 min-w-11 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] cursor-pointer transition-colors"
              aria-label="Отправить вопрос"
            >
              <Send size={16} className="mx-auto" />
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
