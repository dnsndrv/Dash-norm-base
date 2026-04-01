#!/usr/bin/env python3
"""Local server for the creative testing dashboard with LLM chat proxy.
Run: python3 server.py
"""

import http.server
import socketserver
import socket
import os
import sys
import json
import webbrowser
import errno
import urllib.request
import urllib.error
from datetime import date, timedelta

DEFAULT_PORT = 8899
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(DIRECTORY, ".env")
DATA_JS_PATH = os.path.join(DIRECTORY, "data.js")

LLM_API_URL = "REDACTED_LLM_API_URL"
LLM_MODEL = "google/gemini-2.5-pro"

SHEET_ID = "REDACTED_SHEET_ID"
SHEET_NAME = "Ролики, аниматики (техническая)"
KEY_FILE = os.path.join(DIRECTORY, "REDACTED_KEY_FILE.json")

MONTHS_RU = ["янв", "февр", "март", "апр", "май", "июн",
             "июл", "авг", "сент", "окт", "нояб", "дек"]

# Row indices in the sheet (0-based)
ROW_TASK          = 1
ROW_PERIOD        = 2
ROW_PRODUCT       = 3
ROW_CAMPAIGN      = 4
ROW_NAME          = 6
ROW_DURATION      = 7
ROW_PRODUCTION    = 8
ROW_COMPETITOR    = 9
ROW_INTERESTING   = 10
ROW_LIKE          = 11
ROW_CLARITY       = 33
ROW_RELEVANCE     = 34
ROW_UNIQUENESS    = 35
ROW_BRAND_RECOG   = 36
ROW_BRAND_FIT     = 42
ROW_BRAND_ATTIT   = 43
ROW_INTENT        = 44
ROW_CORRECT_FEAT  = 48
ROW_INCORRECT_FEAT= 49
ROW_BRAND_RECALL  = 50
ROW_PROD_RECALL   = 51
ROW_BASE          = 68
ROW_LINK          = 69

# First data column index (before this are label columns)
DATA_COL_START = 5


def excel_to_period(val):
    """Convert Excel serial date or Russian text like 'май.25' to period string."""
    if isinstance(val, (int, float)) and val > 0:
        d = date(1899, 12, 30) + timedelta(days=int(val))
        return f"{MONTHS_RU[d.month - 1]}.{str(d.year)[2:]}"
    if isinstance(val, str) and val.strip():
        return val.strip()
    return ""


def fetch_and_write_data_js():
    """Fetch data from Google Sheets and write data.js. Returns True on success."""
    if not os.path.exists(KEY_FILE):
        print("  Google Sheets: ключ не найден, используются локальные данные")
        return False
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        print("  Google Sheets: библиотеки не установлены, используются локальные данные")
        return False

    try:
        scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
        creds = Credentials.from_service_account_file(KEY_FILE, scopes=scopes)
        service = build("sheets", "v4", credentials=creds, cache_discovery=False)

        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=f"'{SHEET_NAME}'",
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        rows = result.get("values", [])

        if len(rows) < ROW_LINK + 1:
            print(f"  Google Sheets: слишком мало строк ({len(rows)}), пропускаю")
            return False

        def cell(ri, ci):
            if ri >= len(rows): return None
            row = rows[ri]
            if ci >= len(row): return None
            v = row[ci]
            return v if v != "" else None

        def flt(ri, ci):
            v = cell(ri, ci)
            if v is None: return None
            try: return round(float(v), 6)
            except: return None

        def txt(ri, ci):
            v = cell(ri, ci)
            return str(v).strip() if v is not None else ""

        def row_label(ri):
            row = rows[ri] if ri < len(rows) else []
            c0 = row[0] if len(row) > 0 else ""
            c1 = row[1] if len(row) > 1 else ""
            return str(c0 or c1).strip()

        def row_question(ri):
            row = rows[ri] if ri < len(rows) else []
            return str(row[2]).strip() if len(row) > 2 else ""

        total_cols = len(rows[0])
        creatives = []
        for ci in range(DATA_COL_START, total_cols):
            name = txt(ROW_NAME, ci)
            if not name:
                continue
            period_raw = cell(ROW_PERIOD, ci)
            period = excel_to_period(period_raw) if period_raw is not None else ""
            base_raw = cell(ROW_BASE, ci)
            try:
                base = int(float(base_raw)) if base_raw is not None else 0
            except:
                base = 0
            link = txt(ROW_LINK, ci) or None

            creatives.append({
                "id":             ci - DATA_COL_START,
                "name":           name,
                "task":           txt(ROW_TASK, ci),
                "period":         period,
                "product":        txt(ROW_PRODUCT, ci),
                "campaign":       txt(ROW_CAMPAIGN, ci),
                "base":           base,
                "format":         txt(ROW_DURATION, ci),
                "productionType": txt(ROW_PRODUCTION, ci),
                "competitorType": txt(ROW_COMPETITOR, ci),
                "rutubeUrl":      link,
                "metrics": {
                    "interesting":      flt(ROW_INTERESTING,    ci),
                    "like":             flt(ROW_LIKE,           ci),
                    "clarity":          flt(ROW_CLARITY,        ci),
                    "relevance":        flt(ROW_RELEVANCE,      ci),
                    "uniqueness":       flt(ROW_UNIQUENESS,     ci),
                    "brandRecognition": flt(ROW_BRAND_RECOG,    ci),
                    "brandFit":         flt(ROW_BRAND_FIT,      ci),
                    "brandAttitude":    flt(ROW_BRAND_ATTIT,    ci),
                    "intent":           flt(ROW_INTENT,         ci),
                    "correctFeatures":  flt(ROW_CORRECT_FEAT,   ci),
                    "incorrectFeatures":flt(ROW_INCORRECT_FEAT, ci),
                    "brandRecall":      flt(ROW_BRAND_RECALL,   ci),
                    "productRecall":    flt(ROW_PROD_RECALL,    ci),
                },
            })

        periods = sorted(set(c["period"] for c in creatives if c["period"]))

        metric_labels = {
            "interesting":      row_label(ROW_INTERESTING),
            "like":             row_label(ROW_LIKE),
            "clarity":          row_label(ROW_CLARITY),
            "relevance":        row_label(ROW_RELEVANCE),
            "uniqueness":       row_label(ROW_UNIQUENESS),
            "brandRecognition": row_label(ROW_BRAND_RECOG),
            "brandFit":         row_label(ROW_BRAND_FIT),
            "brandAttitude":    row_label(ROW_BRAND_ATTIT),
            "intent":           row_label(ROW_INTENT),
            "correctFeatures":  row_label(ROW_CORRECT_FEAT),
            "incorrectFeatures":row_label(ROW_INCORRECT_FEAT),
            "brandRecall":      row_label(ROW_BRAND_RECALL),
            "productRecall":    row_label(ROW_PROD_RECALL),
        }

        metric_questions = {
            "interesting":      row_question(ROW_INTERESTING),
            "like":             row_question(ROW_LIKE),
            "clarity":          row_question(ROW_CLARITY),
            "relevance":        row_question(ROW_RELEVANCE),
            "uniqueness":       row_question(ROW_UNIQUENESS),
            "brandRecognition": row_question(ROW_BRAND_RECOG),
            "brandFit":         row_question(ROW_BRAND_FIT),
            "brandAttitude":    row_question(ROW_BRAND_ATTIT),
            "intent":           row_question(ROW_INTENT),
            "correctFeatures":  row_question(ROW_CORRECT_FEAT),
            "incorrectFeatures":row_question(ROW_INCORRECT_FEAT),
            "brandRecall":      row_question(ROW_BRAND_RECALL),
            "productRecall":    row_question(ROW_PROD_RECALL),
        }

        dashboard_data = {
            "creatives":       creatives,
            "periods":         periods,
            "metricLabels":    metric_labels,
            "metricQuestions": metric_questions,
        }

        js = ("// Auto-generated from Google Sheets\n"
              "const DASHBOARD_DATA = "
              + json.dumps(dashboard_data, ensure_ascii=False, indent=2)
              + ";\n")

        with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
            f.write(js)

        print(f"  Google Sheets: загружено {len(creatives)} креативов ✓")
        return True

    except Exception as e:
        print(f"  Google Sheets: ошибка загрузки — {e}")
        return False


def load_env():
    """Parse .env file and return dict of key=value pairs."""
    env = {}
    if not os.path.exists(ENV_PATH):
        return env
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip("'\"")
    return env


def load_data_context():
    """Load data.js and build a compact context string for the LLM system prompt."""
    if not os.path.exists(DATA_JS_PATH):
        return "Данные дашборда не найдены."

    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        raw = f.read()

    # Extract JSON from "const DASHBOARD_DATA = {...};"
    start = raw.index("{")
    end = raw.rindex("}") + 1
    data = json.loads(raw[start:end])

    creatives = data.get("creatives", [])
    metric_keys = ["intent", "like", "clarity", "uniqueness", "brandRecognition",
                   "brandRecall", "productRecall", "brandFit", "interesting",
                   "relevance", "brandAttitude", "correctFeatures", "incorrectFeatures"]

    # Compute averages
    avgs = {}
    for k in metric_keys:
        vals = [c["metrics"].get(k) for c in creatives if c["metrics"].get(k) is not None]
        avgs[k] = round(sum(vals) / len(vals), 4) if vals else None

    avg_lines = []
    labels = {
        "intent": "Намерение (захотелось воспользоваться, топ-1)",
        "like": "Нравится (топ-2)",
        "clarity": "Понятность идеи (топ-1)",
        "uniqueness": "Уникальность (топ-2)",
        "brandRecognition": "Узнаваемость бренда в ролике (топ-2)",
        "brandRecall": "Brand Recall (верно назвали бренд)",
        "productRecall": "Product Recall (верно назвали продукт)",
        "brandFit": "Соответствие бренду (топ-2)",
        "interesting": "Интересно смотреть (топ-2)",
        "relevance": "Актуальность (топ-2)",
        "brandAttitude": "Отношение к бренду улучшилось (топ-2)",
        "correctFeatures": "Функции — правильный ответ",
        "incorrectFeatures": "Функции — неправильный ответ",
    }
    for k in metric_keys:
        v = avgs.get(k)
        avg_lines.append(f"  {labels.get(k, k)}: {round(v * 100, 1)}%" if v else f"  {labels.get(k, k)}: нет данных")

    # Compact creative list
    creative_lines = []
    for c in creatives:
        m = c["metrics"]
        intent = f"{round(m['intent'] * 100, 1)}%" if m.get("intent") is not None else "—"
        like = f"{round(m['like'] * 100, 1)}%" if m.get("like") is not None else "—"
        clarity = f"{round(m['clarity'] * 100, 1)}%" if m.get("clarity") is not None else "—"
        uniq = f"{round(m['uniqueness'] * 100, 1)}%" if m.get("uniqueness") is not None else "—"
        br = f"{round(m['brandRecognition'] * 100, 1)}%" if m.get("brandRecognition") is not None else "—"
        creative_lines.append(
            f"  {c['name']} | {c['product']} | {c['campaign']} | {c['period']} | "
            f"Намерение={intent}, Нравится={like}, Понятность={clarity}, Уникальность={uniq}, Узнаваемость={br}"
        )

    products = sorted(set(c["product"] for c in creatives))
    campaigns = sorted(set(c["campaign"] for c in creatives))

    context = f"""Ты — аналитик-ассистент дашборда тестирования рекламных креативов (роликов и аниматиков).
Отвечай на русском языке. Ссылайся на конкретные данные из таблицы. Будь лаконичным, но точным.

ДАННЫЕ ДАШБОРДА ({len(creatives)} креативов):

Средние значения по всем креативам:
{chr(10).join(avg_lines)}

Продукты: {', '.join(products)}
Кампании: {', '.join(campaigns)}

Описание метрик:
- Намерение (intent) — «Захотелось приобрести / воспользоваться» (топ-1 по шкале). Главная целевая метрика.
- Нравится (like) — эмоциональная оценка ролика (топ-2).
- Понятность (clarity) — понятность идеи ролика (топ-1).
- Уникальность (uniqueness) — непохожесть на другие ролики (топ-2).
- Узнаваемость (brandRecognition) — узнаваемость бренда в ролике (топ-2).
- Brand Recall — доля верно назвавших бренд (открытый вопрос).
- Product Recall — доля верно назвавших продукт/фичу (открытый вопрос).
- Соответствие бренду (brandFit) — насколько ролик подходит бренду (топ-2).
- Индекс чистоты коммуникации = correctFeatures − incorrectFeatures.

Список креативов (Название | Продукт | Кампания | Период | ключевые метрики):
{chr(10).join(creative_lines)}"""

    return context


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# Pre-load context at startup
SYSTEM_PROMPT = load_data_context()
ENV = load_env()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        print(f"  {self.address_string()} — {args[0]}")

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_POST(self):
        if self.path == "/api/chat":
            self._handle_chat()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _handle_chat(self):
        api_key = ENV.get("OPENROUTER_API_KEY", "")
        if not api_key or api_key == "your-api-key-here":
            self.send_response(500)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "API ключ не настроен. Укажите OPENROUTER_API_KEY в файле .env"}).encode())
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length))
        user_messages = body.get("messages", [])

        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + user_messages

        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": messages,
            "stream": True,
            "temperature": 0.3,
            "max_tokens": 4096,
        }).encode()

        req = urllib.request.Request(
            LLM_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            resp = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            self.send_response(e.code)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"LLM API error {e.code}: {error_body}"}).encode())
            return
        except Exception as e:
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                self.wfile.write((line + "\n\n").encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            resp.close()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def find_available_port(start_port, attempts=50):
    for port in range(start_port, start_port + max(1, attempts)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError as e:
                if e.errno == errno.EADDRINUSE:
                    continue
                raise
    return start_port


def main():
    local_ip = get_local_ip()
    port = find_available_port(DEFAULT_PORT)

    print()
    print("=" * 60)
    print("  Creative Testing Dashboard — Local Server + LLM Chat")
    print("=" * 60)
    print()
    print("  Загрузка данных из Google Sheets...")
    fetch_and_write_data_js()
    print()
    if port != DEFAULT_PORT:
        print(f"  Порт {DEFAULT_PORT} занят — использую {port}")
        print()
    print(f"  Этот компьютер:    http://localhost:{port}/dashboard.html")
    print(f"  Другие устройства: http://{local_ip}:{port}/dashboard.html")
    print()

    api_key = ENV.get("OPENROUTER_API_KEY", "")
    if api_key and api_key != "your-api-key-here":
        print(f"  LLM чат:  Включён (модель: {LLM_MODEL})")
    else:
        print("  LLM чат:  ВЫКЛЮЧЕН — укажите OPENROUTER_API_KEY в .env")

    print()
    print("  Для остановки нажмите Ctrl+C")
    print("=" * 60)
    print()

    with ReusableTCPServer(("0.0.0.0", port), Handler) as httpd:
        try:
            webbrowser.open(f"http://localhost:{port}/dashboard.html")
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Сервер остановлен.")
            sys.exit(0)


if __name__ == "__main__":
    main()
