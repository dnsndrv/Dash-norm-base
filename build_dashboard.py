#!/usr/bin/env python3
"""Parse creative testing CSV and generate a standalone HTML dashboard."""

import csv
import json
import os
from datetime import datetime, timedelta

CSV_PATH = os.path.join(os.path.dirname(__file__),
    "Copy of База норм_Тест креативов (Поиск, Браузер)_upd - Ролики, аниматики.csv")

def excel_date_to_str(val):
    """Convert Excel serial date number to readable month.year string."""
    try:
        num = int(float(val))
        base = datetime(1899, 12, 30)
        dt = base + timedelta(days=num)
        months_ru = {
            1: "янв", 2: "фев", 3: "мар", 4: "апр",
            5: "май", 6: "июн", 7: "июл", 8: "авг",
            9: "сен", 10: "окт", 11: "ноя", 12: "дек"
        }
        return f"{months_ru[dt.month]}.{str(dt.year)[2:]}"
    except (ValueError, TypeError):
        return str(val).strip() if val else ""

def parse_period(val):
    """Normalize period value."""
    val = str(val).strip()
    if not val:
        return ""
    try:
        float(val)
        return excel_date_to_str(val)
    except ValueError:
        return val

def safe_float(val):
    """Convert value to float, return None if impossible."""
    if val is None:
        return None
    val = str(val).strip()
    if val == "" or val == "-":
        return None
    try:
        return float(val)
    except ValueError:
        return None

def infer_format(name):
    """Infer creative format from its name."""
    name_lower = name.lower()
    if "10 сек" in name_lower:
        return "10 сек"
    if "15 сек" in name_lower:
        return "15 сек"
    if "20 сек" in name_lower:
        return "20 сек"
    if "25 сек" in name_lower:
        return "25 сек"
    if "30 сек" in name_lower:
        return "30 сек"
    if "строка" in name_lower and "вклад" not in name_lower:
        return "Ролик + строка"
    if "+строка" in name_lower or "+ строка" in name_lower:
        return "Ролик + строка"
    return "Ролик"

def infer_production_type(name):
    """Infer production type from creative name."""
    name_lower = name.lower()
    if "ии" in name_lower or "ai" in name_lower or "cringe" in name_lower or "pixar" in name_lower:
        return "ИИ"
    if "продакшн" in name_lower or "оригинал" in name_lower or "original" in name_lower or "актер" in name_lower:
        return "Продакшн"
    return "Стандарт"

def main():
    rows = []
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            rows.append(row)

    # Number of creatives: columns from index 4 to end (row 7 has names)
    header_row = rows[0]
    num_cols = len(header_row)

    # Extract metadata rows
    task_row = rows[1]       # Номер таска
    period_row = rows[2]     # Период теста
    product_row = rows[3]    # Продукт
    campaign_row = rows[4]   # Кампания
    name_row = rows[6]       # Ролик / Название креатива
    base_row = rows[65]      # База
    link_row = rows[66]      # Ссылка на ролик

    # Key metric rows (0-indexed in rows list)
    metric_rows = {
        "interesting":       rows[7],   # Интересно ли было смотреть (топ-2)
        "like":              rows[8],   # Нравится (топ-2)
        "clarity":           rows[30],  # Понятность идеи (топ-1)
        "relevance":         rows[31],  # Актуальность (топ-2)
        "uniqueness":        rows[32],  # Уникальность (топ-2)
        "brandRecognition":  rows[33],  # Узнаваемость бренда (топ-2)
        "brandFit":          rows[39],  # Соответствие бренду (топ-2)
        "brandAttitude":     rows[40],  # Отношение к бренду улучшилось (топ-2)
        "intent":            rows[41],  # Захотелось воспользоваться (топ-1)
        "brandRecall":       rows[47],  # Верно назвали бренд
        "productRecall":     rows[48],  # Верно назвали продукт
        "correctFeatures":   rows[45],  # Возможности правильный ответ
        "incorrectFeatures": rows[46],  # Возможности НЕправильный ответ
    }

    # Extract averages (column index 3)
    averages = {}
    for key, row in metric_rows.items():
        averages[key] = safe_float(row[3]) if len(row) > 3 else None

    # Build creative objects
    creatives = []
    for col_idx in range(4, num_cols):
        name = name_row[col_idx].strip() if col_idx < len(name_row) else ""
        if not name:
            continue

        task = task_row[col_idx].strip() if col_idx < len(task_row) else ""
        period = parse_period(period_row[col_idx] if col_idx < len(period_row) else "")
        product = product_row[col_idx].strip() if col_idx < len(product_row) else ""
        campaign = campaign_row[col_idx].strip() if col_idx < len(campaign_row) else ""
        base = safe_float(base_row[col_idx]) if col_idx < len(base_row) else None

        metrics = {}
        for key, row in metric_rows.items():
            metrics[key] = safe_float(row[col_idx]) if col_idx < len(row) else None

        fmt = infer_format(name)
        prod_type = infer_production_type(name)

        link = link_row[col_idx].strip() if col_idx < len(link_row) else ""

        creative = {
            "id": col_idx - 4,
            "name": name,
            "task": task,
            "period": period,
            "product": product,
            "campaign": campaign,
            "base": int(base) if base else None,
            "format": fmt,
            "productionType": prod_type,
            "metrics": metrics,
            "rutubeUrl": link if link.startswith("http") else None,
        }
        creatives.append(creative)

    # Compute sorted periods for timeline
    period_order_map = {
        "янв.21": 202101, "фев.21": 202102, "мар.21": 202103, "апр.21": 202104,
        "май.21": 202105, "июн.21": 202106, "июл.21": 202107, "авг.21": 202108,
        "сен.21": 202109, "окт.21": 202110, "ноя.21": 202111, "дек.21": 202112,
        "янв.24": 202401, "фев.24": 202402, "мар.24": 202403, "апр.24": 202404,
        "май.24": 202405, "июн.24": 202406, "июл.24": 202407, "авг.24": 202408,
        "сен.24": 202409, "окт.24": 202410, "ноя.24": 202411, "дек.24": 202412,
        "янв.25": 202501, "фев.25": 202502, "мар.25": 202503, "апр.25": 202504,
        "май.25": 202505, "июн.25": 202506, "июл.25": 202507, "авг.25": 202508,
        "сен.25": 202509, "окт.25": 202510, "ноя.25": 202511, "нояб.25": 202511,
        "дек.25": 202512,
    }

    all_periods = sorted(
        set(c["period"] for c in creatives if c["period"]),
        key=lambda p: period_order_map.get(p, 999999)
    )

    data = {
        "creatives": creatives,
        "averages": averages,
        "periods": all_periods,
        "metricLabels": {
            "interesting": "Интересно (топ-2)",
            "like": "Нравится (топ-2)",
            "clarity": "Понятность (топ-1)",
            "relevance": "Актуальность (топ-2)",
            "uniqueness": "Уникальность (топ-2)",
            "brandRecognition": "Узнаваемость бренда (топ-2)",
            "brandFit": "Соответствие бренду (топ-2)",
            "brandAttitude": "Отношение к бренду ↑ (топ-2)",
            "intent": "Захотелось воспользоваться (топ-1)",
            "brandRecall": "Верно назвали бренд",
            "productRecall": "Верно назвали продукт",
            "correctFeatures": "Функции — правильный ответ",
            "incorrectFeatures": "Функции — НЕправильный ответ",
        },
    }

    # Write data.js
    out_path = os.path.join(os.path.dirname(__file__), "data.js")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated from CSV data\n")
        f.write("const DASHBOARD_DATA = ")
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print(f"Generated data.js with {len(creatives)} creatives")
    print(f"Periods: {all_periods}")
    print(f"Products: {sorted(set(c['product'] for c in creatives))}")
    print(f"Campaigns: {sorted(set(c['campaign'] for c in creatives))}")
    print(f"Formats: {sorted(set(c['format'] for c in creatives))}")

if __name__ == "__main__":
    main()
