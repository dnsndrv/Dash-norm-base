const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://dnsndrv.github.io';
const LLM_API_URL = process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'openai/gpt-5.5';
const LLM_API_KEY = process.env.LLM_API_KEY;

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
  return JSON.stringify(context, (_key, value) => {
    if (typeof value === 'number') return Math.round(value * 10000) / 10000;
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
  if (question.length > 1200) return response(413, { error: 'Question is too long' }, origin);

  const context = payload.context || {};
  const contextText = compactContext(context);
  if (contextText.length > 50000) return response(413, { error: 'Context is too large' }, origin);

  const system = [
    'Ты аналитический помощник Brand Research dashboard.',
    'Отвечай только на основе переданного JSON-контекста.',
    'Если данных недостаточно, так и скажи.',
    'Кратко объясняй, какая выборка и база сравнения использованы.',
    'Проценты из долей форматиуй как проценты, deltaPp уже в процентных пунктах.',
    'Не придумывай значения и не ссылайся на внешние источники.',
  ].join(' ');

  const llmResponse = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Контекст дашборда:\n${contextText}\n\nВопрос:\n${question}` },
      ],
    }),
  });

  if (!llmResponse.ok) {
    return response(502, { error: `LLM request failed: ${llmResponse.status}` }, origin);
  }

  const data = await llmResponse.json();
  const answer = data?.choices?.[0]?.message?.content || 'Не удалось сформировать ответ.';
  return response(200, { answer }, origin);
}
