"""Yandex Cloud Function: refresh Brand Research dashboard data.

Читает Google Sheet через service account и возвращает тот же JSON,
который лежит в src/data/dashboard.json как статический snapshot.

Env-переменные:
- GOOGLE_SHEETS_CREDENTIALS_JSON — содержимое service account JSON
  (положить целиком в env Yandex Cloud Function или в Lockbox).
- GOOGLE_SHEET_ID — id таблицы.
- SHEET_NAME — название листа (по умолчанию "Ролики, аниматики (техническая)").
- ALLOWED_ORIGIN — единственный разрешённый Origin (CORS).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, timedelta
from typing import Any

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://dnsndrv.github.io")
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1xb9WAV74CPxMXAuOIaLbrpjXzVYAf8Cz3D9a1GldjtQ")
SHEET_NAME = os.environ.get("SHEET_NAME", "Ролики, аниматики")

ROW_TASK = 1
ROW_PERIOD = 2
ROW_PRODUCT = 3
ROW_CAMPAIGN = 4
ROW_NAME = 6
ROW_DURATION = 7
ROW_PRODUCTION = 8
ROW_COMPETITOR = 9
ROW_INTERESTING = 10
ROW_LIKE = 11
ROW_CLARITY = 33
ROW_RELEVANCE = 34
ROW_UNIQUENESS = 35
ROW_BRAND_RECOG = 36
ROW_BRAND_FIT = 42
ROW_BRAND_ATTIT = 43
ROW_INTENT = 44
ROW_USE_MORE = 46
ROW_START_USING = 47
ROW_CORRECT_FEAT = 48
ROW_INCORRECT_FEAT = 49
ROW_BRAND_RECALL = 50
ROW_PROD_RECALL = 51
ROW_BASE = 68
ROW_LINK = 69

DATA_COL_START = 5

DISLIKE_ROWS = [
    ("music", 12), ("voice", 13), ("video", 14), ("color", 15),
    ("text", 16), ("sound", 17), ("characters", 18), ("plot", 19),
    ("unclear", 20), ("irrelevant", 21), ("allGood", 22),
]

LIKE_ROWS = [
    ("music", 23), ("voice", 24), ("video", 25), ("color", 26),
    ("text", 27), ("sound", 28), ("characters", 29), ("plot", 30),
    ("relevant", 31), ("nothing", 32),
]

BRAND_ATTRIB_ROWS = [
    ("unforgettable", 37), ("goodEnough", 38), ("notEnough", 39),
    ("anyService", 40), ("anything", 41),
]

EMOTIONAL_PAIR_ROWS = [
    ("simple", 52, "cluttered", 53),
    ("innovative", 54, "outdated", 55),
    ("bright", 56, "boring", 57),
    ("caring", 58, "distant", 59),
    ("confident", 60, "doubtful", 61),
    ("optimistic", 62, "gloomy", 63),
    ("calming", 64, "anxious", 65),
    ("standout", 66, "ordinary", 67),
]

MONTHS_RU = [
    "янв", "февр", "март", "апр", "май", "июн",
    "июл", "авг", "сент", "окт", "нояб", "дек",
]

PRODUCTION_TYPE_KEYWORDS = {"продакшн", "ии", "и.и.", "стандарт"}

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


def _excel_to_period(val: Any) -> str:
    if isinstance(val, (int, float)) and val > 0:
        d = date(1899, 12, 30) + timedelta(days=int(val))
        return f"{MONTHS_RU[d.month - 1]}.{str(d.year)[2:]}"
    if isinstance(val, str) and val.strip():
        return val.strip()
    return ""


def _fetch_sheet_rows() -> list[list[Any]]:
    """Читаем лист целиком через Google Sheets API."""
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    raw = os.environ.get("GOOGLE_SHEETS_CREDENTIALS_JSON")
    if not raw:
        raise RuntimeError("GOOGLE_SHEETS_CREDENTIALS_JSON env var is not set")
    creds_info = json.loads(raw)
    creds = Credentials.from_service_account_info(creds_info, scopes=_SCOPES)
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    result = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=GOOGLE_SHEET_ID,
            range=f"'{SHEET_NAME}'" if SHEET_NAME else "A:ZZ",
            valueRenderOption="UNFORMATTED_VALUE",
        )
        .execute()
    )
    return result.get("values", [])


def _parse_rows(rows: list[list[Any]]) -> dict[str, Any]:
    def cell(ri: int, ci: int) -> Any:
        if ri >= len(rows):
            return None
        row = rows[ri]
        if ci >= len(row):
            return None
        v = row[ci]
        return v if v != "" else None

    def flt(ri: int, ci: int) -> float | None:
        v = cell(ri, ci)
        if v is None:
            return None
        try:
            return round(float(v), 6)
        except (ValueError, TypeError):
            return None

    def txt(ri: int, ci: int) -> str:
        v = cell(ri, ci)
        return str(v).strip() if v is not None else ""

    def row_label(ri: int) -> str:
        row = rows[ri] if ri < len(rows) else []
        c0 = row[0] if len(row) > 0 else ""
        c1 = row[1] if len(row) > 1 else ""
        return str(c0 or c1).strip()

    def row_question(ri: int) -> str:
        row = rows[ri] if ri < len(rows) else []
        return str(row[2]).strip() if len(row) > 2 else ""

    total_cols = len(rows[0]) if rows else 0
    creatives: list[dict[str, Any]] = []

    for ci in range(DATA_COL_START, total_cols):
        name = txt(ROW_NAME, ci)
        if not name:
            continue

        period_raw = cell(ROW_PERIOD, ci)
        period = _excel_to_period(period_raw) if period_raw is not None else ""

        base_raw = cell(ROW_BASE, ci)
        try:
            base = int(float(base_raw)) if base_raw is not None else 0
        except (ValueError, TypeError):
            base = 0

        # Skip aggregator/service columns added inside the sheet
        # ("Верхний квартиль", "Нижний квартиль" и т.п.) — у них нет ни
        # продукта, ни кампании, ни базы респондентов.
        product_val = txt(ROW_PRODUCT, ci)
        campaign_val = txt(ROW_CAMPAIGN, ci)
        if not product_val and not campaign_val and base == 0:
            continue

        link = txt(ROW_LINK, ci) or None

        fmt_val = txt(ROW_DURATION, ci)
        prod_val = txt(ROW_PRODUCTION, ci)
        if fmt_val.lower() in PRODUCTION_TYPE_KEYWORDS:
            if not prod_val:
                prod_val = fmt_val
            fmt_val = ""

        dislikes = {k: flt(ri, ci) for k, ri in DISLIKE_ROWS}
        likes = {k: flt(ri, ci) for k, ri in LIKE_ROWS}
        brand_attrib = {k: flt(ri, ci) for k, ri in BRAND_ATTRIB_ROWS}
        emotional: dict[str, float | None] = {}
        for pk, pri, nk, nri in EMOTIONAL_PAIR_ROWS:
            emotional[pk] = flt(pri, ci)
            emotional[nk] = flt(nri, ci)

        creatives.append(
            {
                "id": ci - DATA_COL_START,
                "name": name,
                "task": txt(ROW_TASK, ci),
                "period": period,
                "product": txt(ROW_PRODUCT, ci),
                "campaign": txt(ROW_CAMPAIGN, ci),
                "base": base,
                "format": fmt_val,
                "productionType": prod_val,
                "competitorType": txt(ROW_COMPETITOR, ci),
                "rutubeUrl": link if link and link.startswith("http") else None,
                "metrics": {
                    "interesting": flt(ROW_INTERESTING, ci),
                    "like": flt(ROW_LIKE, ci),
                    "clarity": flt(ROW_CLARITY, ci),
                    "relevance": flt(ROW_RELEVANCE, ci),
                    "uniqueness": flt(ROW_UNIQUENESS, ci),
                    "brandRecognition": flt(ROW_BRAND_RECOG, ci),
                    "brandFit": flt(ROW_BRAND_FIT, ci),
                    "brandAttitude": flt(ROW_BRAND_ATTIT, ci),
                    "intent": flt(ROW_INTENT, ci),
                    "useMore": flt(ROW_USE_MORE, ci),
                    "startUsing": flt(ROW_START_USING, ci),
                    "correctFeatures": flt(ROW_CORRECT_FEAT, ci),
                    "incorrectFeatures": flt(ROW_INCORRECT_FEAT, ci),
                    "brandRecall": flt(ROW_BRAND_RECALL, ci),
                    "productRecall": flt(ROW_PROD_RECALL, ci),
                },
                "dislikes": dislikes,
                "likes": likes,
                "brandAttribution": brand_attrib,
                "emotional": emotional,
            }
        )

    metric_row_map = {
        "interesting": ROW_INTERESTING, "like": ROW_LIKE, "clarity": ROW_CLARITY,
        "relevance": ROW_RELEVANCE, "uniqueness": ROW_UNIQUENESS,
        "brandRecognition": ROW_BRAND_RECOG, "brandFit": ROW_BRAND_FIT,
        "brandAttitude": ROW_BRAND_ATTIT, "intent": ROW_INTENT,
        "useMore": ROW_USE_MORE, "startUsing": ROW_START_USING,
        "correctFeatures": ROW_CORRECT_FEAT, "incorrectFeatures": ROW_INCORRECT_FEAT,
        "brandRecall": ROW_BRAND_RECALL, "productRecall": ROW_PROD_RECALL,
    }

    metric_labels = {k: row_label(ri) for k, ri in metric_row_map.items()}
    metric_questions = {k: row_question(ri) for k, ri in metric_row_map.items()}
    periods = sorted({c["period"] for c in creatives if c["period"]})

    def sub_label(ri: int) -> str:
        r = rows[ri] if ri < len(rows) else []
        return str(r[1]).strip() if len(r) > 1 else ""

    dislike_labels = {k: sub_label(ri) for k, ri in DISLIKE_ROWS}
    like_labels = {k: sub_label(ri) for k, ri in LIKE_ROWS}
    brand_attrib_labels = {k: sub_label(ri) for k, ri in BRAND_ATTRIB_ROWS}
    emotional_pairs = [
        {
            "positiveKey": pk, "negativeKey": nk,
            "positiveLabel": sub_label(pri),
            "negativeLabel": sub_label(nri),
        }
        for pk, pri, nk, nri in EMOTIONAL_PAIR_ROWS
    ]

    return {
        "creatives": creatives,
        "periods": periods,
        "metricLabels": metric_labels,
        "metricQuestions": metric_questions,
        "dislikeLabels": dislike_labels,
        "likeLabels": like_labels,
        "brandAttributionLabels": brand_attrib_labels,
        "emotionalPairs": emotional_pairs,
    }


def _cors_headers(origin: str) -> dict[str, str]:
    allowed = origin if origin == ALLOWED_ORIGIN else ALLOWED_ORIGIN
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json; charset=utf-8",
        "Vary": "Origin",
    }


def _resp(status: int, body: Any, origin: str = ALLOWED_ORIGIN) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": _cors_headers(origin),
        "body": json.dumps(body, ensure_ascii=False),
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # noqa: ARG001
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin") or ""
    method = (event.get("httpMethod") or "GET").upper()

    if method == "OPTIONS":
        return _resp(204, {}, origin)
    if origin != ALLOWED_ORIGIN:
        return _resp(403, {"error": "Origin is not allowed"})

    try:
        rows = _fetch_sheet_rows()
        data = _parse_rows(rows)
    except RuntimeError as e:
        return _resp(503, {"error": str(e)}, origin)
    except Exception as e:
        log.exception("dashboard refresh failed")
        return _resp(502, {"error": f"dashboard refresh failed: {e}"}, origin)

    return _resp(200, data, origin)
