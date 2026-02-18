#!/usr/bin/env python3
"""Bundle all JS files inline into index.html to create a fully self-contained dashboard."""

import os
import re

DIR = os.path.dirname(os.path.abspath(__file__))

def read(name):
    with open(os.path.join(DIR, name), "r", encoding="utf-8") as f:
        return f.read()

html = read("index.html")

# Replace external script references with inline scripts
# chart.min.js
chart_js = read("chart.min.js")
html = html.replace(
    '<script src="chart.min.js"></script>',
    f'<script>{chart_js}</script>'
)

# chartjs-plugin-datalabels.min.js
datalabels_js = read("chartjs-plugin-datalabels.min.js")
html = html.replace(
    '<script src="chartjs-plugin-datalabels.min.js"></script>',
    f'<script>{datalabels_js}</script>'
)

# data.js
data_js = read("data.js")
html = html.replace(
    '<script src="data.js"></script>',
    f'<script>{data_js}</script>'
)

out_path = os.path.join(DIR, "dashboard.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)

size_kb = os.path.getsize(out_path) / 1024
print(f"Created dashboard.html ({size_kb:.0f} KB) — fully self-contained, no external dependencies")
