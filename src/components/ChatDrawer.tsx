import { useMemo, useState } from 'react';
import { Bot, Loader2, PanelRightClose, Send } from 'lucide-react';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface ChatContext {
  page: string;
  activeTab: string;
  selection: {
    filters: Record<string, string | string[] | null>;
    count: number;
    total: number;
    base: number;
  };
  comparison: {
    filters: Record<string, string | string[] | null>;
    isFiltered: boolean;
    count: number;
    total: number;
    base: number;
  };
  metrics: Array<{
    key: string;
    label: string;
    selection: number | null;
    comparison: number | null;
    deltaPp: number | null;
  }>;
  topIntent: Array<Record<string, string | number | null>>;
  productionTypes: Array<{
    type: string;
    count: number;
    averages: Record<string, number | null>;
  }>;
}

const CHAT_API_URL = import.meta.env.VITE_CHAT_API_URL as string | undefined;

const STARTERS = [
  'Что сильнее всего отличает выбранную кампанию от базы сравнения?',
  'Какие ролики лучшие по намерению?',
  'Что лучше у ИИ vs Продакшн в текущей выборке?',
];

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
      : 'вся база сравнения';
    return `${context.selection.count} в выборке · ${base}`;
  }, [context]);

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
                : 'mr-8 bg-[var(--color-bg-secondary)] text-[var(--color-text)]'
            }`}
          >
            {msg.text}
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
            rows={3}
            placeholder="Спросите по текущей выборке..."
            className="min-h-[76px] w-full resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">Enter не отправляет, используйте кнопку</span>
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
