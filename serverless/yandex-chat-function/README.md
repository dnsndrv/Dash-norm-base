# Yandex Cloud Function for Brand Research chat

Safe proxy for the public GitHub Pages chat drawer.

The browser never receives the LLM API key. GitHub Pages sends:

```json
{ "question": "...", "context": { "...": "compact dashboard context" } }
```

The function validates origin, calls an OpenAI-compatible chat completions API,
and returns:

```json
{ "answer": "..." }
```

## Required environment variables

- `LLM_API_KEY` — secret API key. Store in Yandex Cloud as an environment secret
  or Lockbox-backed secret. Never commit it.

## Optional environment variables

- `ALLOWED_ORIGIN` — defaults to `https://dnsndrv.github.io`
- `LLM_API_URL` — defaults to `https://openrouter.ai/api/v1/chat/completions`
- `LLM_MODEL` — defaults to `openai/gpt-5.5`

## Frontend wiring

Set this for the GitHub Pages build:

```bash
VITE_CHAT_API_URL=https://functions.yandexcloud.net/<function-id>
```

For GitHub Actions, store it as a repository variable/secret and expose it to
`npm run build`. The frontend only contains this URL, not the LLM key.

## Security notes

- CORS origin is restricted, but this is not a full abuse barrier.
- Add budget alerts in Yandex Billing.
- For public traffic, add a rate limiter (YDB/Cloud Logging based or API
  Gateway quota) before increasing limits.
- Do not log full prompts if they may contain sensitive data.
