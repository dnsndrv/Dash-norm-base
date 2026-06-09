const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://dnsndrv.github.io';
const LLM_API_URL = process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'openai/gpt-5.5';
const LLM_API_KEY = process.env.LLM_API_KEY;
// Если в env задан LLM_MAX_TOKENS — используем его, иначе совсем не передаём
// max_tokens провайдеру, чтобы ответ не обрезался.
const LLM_MAX_TOKENS = process.env.LLM_MAX_TOKENS ? Number(process.env.LLM_MAX_TOKENS) : null;
// Контекст теперь несёт сырые строки таблицы → допускаем до ~1 MB JSON.
const CONTEXT_LIMIT = Number(process.env.CONTEXT_LIMIT || 1_000_000);
const QUESTION_LIMIT = Number(process.env.QUESTION_LIMIT || 2000);

function response(statusCode, body, origin = ALLOWED_ORIGIN) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Origin',
    },
    body: JSON.stringify(body),
  };
}

function compactContext(context) {
  // Округляем дробные числа до 4 знаков, чтобы JSON был компактнее, но не
  // теряем точность для процентных метрик.
  return JSON.stringify(context, (_key, value) => {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      return Math.round(value * 10000) / 10000;
    }
    return value;
  });
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowed = origin === ALLOWED_ORIGIN;

  if (event.httpMethod === 'OPTIONS') {
    return response(204, {}, allowed ? origin : ALLOWED_ORIGIN);
  }

  if (!allowed) {
    return response(403, { error: 'Origin is not allowed' });
  }

  if (!LLM_API_KEY) {
    return response(500, { error: 'LLM_API_KEY is not configured' }, origin);
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Invalid JSON' }, origin);
  }

  const question = String(payload.question || '').trim();
  if (!question) return response(400, { error: 'Question is required' }, origin);
  if (question.length > QUESTION_LIMIT) {
    return response(413, { error: 'Question is too long' }, origin);
  }

  const context = payload.context || {};
  const contextText = compactContext(context);
  if (contextText.length > CONTEXT_LIMIT) {
    return response(413, { error: 'Context is too large' }, origin);
  }

  const system = [
    'Ты — аналитик Brand Research. Помогаешь команде разбираться в результатах',
    'тестирования рекламных креативов. Общайся с пользователем как живой коллега-',
    'аналитик: спокойно, естественно, по-человечески. Не используй шаблонные шапки',
    'и заголовки типа «Анализ», «Выводы», «Резюме», если о них не попросили. Не',
    'начинай с пересказа того, что у тебя в данных — сразу отвечай по сути.',
    '',
    'Подстраивайся под тон и длину вопроса. На короткий вопрос — короткий ответ',
    'одним-двумя предложениями. На развёрнутый — развёрнутый. Списки и **жирный',
    'текст** используй только если они правда помогают читать, не из привычки.',
    'Не используй markdown-таблицы. Эмодзи не используй.',
    '',
    'Где-то в контексте лежит фрагмент исходной таблицы дашборда: `selection.rows` —',
    'выборка пользователя, `comparison.rows` — база сравнения, `labels` — подписи',
    'к метрикам, категориям лайков/дизлайков, эмоциям. Считай агрегаты, средние,',
    'доли и сравнения сам по этим строкам. Размер выборки n — это сумма',
    '`respondentBase` по нужным строкам. При сравнении долей применяй z-test;',
    '|z| ≥ 1.96 — значимо при p<0.05. Но не выпячивай статистику, если она',
    'не нужна для ответа — просто учитывай её внутри.',
    '',
    'Цифры подаёшь осмысленно: не «вот процент 47.2», а «у этих роликов чаще',
    'отмечают, что воспроизведение понятное — 47% против 39% по базе». Используй',
    'человекочитаемые названия из `labels`, а не сырые ключи. Если данных не',
    'хватает или поле пустое — спокойно скажи об этом и предложи, что можно',
    'посмотреть взамен. Не выдумывай ролики, кампании или метрики, которых нет',
    'в переданных строках.',
  ].join(' ');

  const llmBody = {
    model: LLM_MODEL,
    temperature: 0.6,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Данные таблицы (JSON):\n${contextText}\n\nВопрос:\n${question}` },
    ],
  };
  if (LLM_MAX_TOKENS && LLM_MAX_TOKENS > 0) {
    llmBody.max_tokens = LLM_MAX_TOKENS;
  }

  const llmResponse = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(llmBody),
  });

  if (!llmResponse.ok) {
    const errText = await llmResponse.text().catch(() => '');
    return response(502, {
      error: `LLM request failed: ${llmResponse.status}`,
      details: errText.slice(0, 500) || undefined,
    }, origin);
  }

  const data = await llmResponse.json();
  const answer = data?.choices?.[0]?.message?.content || 'Не удалось сформировать ответ.';
  return response(200, { answer }, origin);
}
