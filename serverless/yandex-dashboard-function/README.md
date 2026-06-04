# Yandex Cloud Function: dashboard refresh

Читает Google Sheet через service account и возвращает JSON в формате
`src/data/dashboard.json`. Используется кнопкой «Обновить» на дашборде.

## Деплой

1. В Yandex Cloud Console создайте Function:
   - Runtime: **Python 3.12** (или новее).
   - Entry point: `main.handler`.
   - Memory: `512 MB`.
   - Timeout: `60s`.
2. Загрузите содержимое этой папки (`main.py`, `requirements.txt`).
   Yandex сам подтянет зависимости из `requirements.txt`.
3. Сделайте функцию публичной (Public function / Разрешить вызов без IAM).

## Environment variables

- `GOOGLE_SHEETS_CREDENTIALS_JSON` — **весь** JSON service account целиком,
  одной многострочной переменной. Можно положить в Lockbox-secret и
  подключить к функции через `lockbox-payload-binding`.
- `GOOGLE_SHEET_ID` — id таблицы (по умолчанию ID базы норм).
- `SHEET_NAME` — название листа (по умолчанию `Ролики, аниматики (техническая)`).
- `ALLOWED_ORIGIN` — единственный разрешённый Origin (default
  `https://dnsndrv.github.io`).

## Frontend wiring

В GitHub repository variable или secret:

```
VITE_DASHBOARD_API_URL=https://functions.yandexcloud.net/<function-id>
```

После пересборки кнопка «Обновить» в шапке дашборда начнёт работать.

## Безопасность

- Service account имеет только `*.readonly` scopes — он не может писать в
  таблицу.
- CORS Origin ограничен GitHub Pages, но это не защита от прямых curl-запросов;
  поставьте budget alert на проект Yandex Cloud.
- Никогда не коммитьте service account JSON в репозиторий.
