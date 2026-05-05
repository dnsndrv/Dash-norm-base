# Dash-norm-base — Brand Research

Standalone веб-версия вкладки **Brand Research** из [Aisha](https://github.com/) (внутреннего marketing-инструмента). Это статический SPA на React + Vite, который рендерит дашборд по тестированию рекламных креативов.

Live: https://dnsndrv.github.io/Dash-norm-base/

## Что внутри

- Обзор средних значений по основным/бренд-/допметрикам с z-критерием против общей нормы и нормы конкурентов.
- Запоминаемость бренда и продукта (открытые вопросы).
- Чистота коммуникации (правильные − неправильные считывания).
- Драйверы намерения (scatter + топ-30).
- Справочник по методологии и шкалам.
- Каскадные фильтры: `Яндекс / Конкуренты → Продукт → Кампания → Ролики`, плюс период и формат.

## Данные

Данные берутся из публичной Google-таблицы [«База норм»](https://docs.google.com/spreadsheets/d/1xb9WAV74CPxMXAuOIaLbrpjXzVYAf8Cz3D9a1GldjtQ). В сборку включён JSON-снапшот по адресу `src/data/dashboard.json`.

Чтобы обновить данные, на машине с доступом к Aisha-бэкенду:

```bash
APP_ENV=test python3 -c "
import asyncio, json
from src.services.dashboard_data import fetch_dashboard_data
d = asyncio.run(fetch_dashboard_data(force_refresh=True))
json.dump(d, open('src/data/dashboard.json','w'), ensure_ascii=False)
"
```

…и закоммитить файл — GitHub Actions пересоберёт и задеплоит Pages.

## Локально

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # подсмотреть собранный билд
```

## Деплой

Любой push в ветку `web` запускает workflow `.github/workflows/deploy-pages.yml`, который билдит проект и публикует `dist/` на GitHub Pages.

В настройках репозитория **Settings → Pages → Build and deployment → Source** должно стоять **GitHub Actions**.

## Стек

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Chart.js (react-chartjs-2)
- lucide-react
