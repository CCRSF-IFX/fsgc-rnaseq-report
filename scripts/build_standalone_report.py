#!/usr/bin/env python3
"""Build a double-clickable RNA-seq report HTML file."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = Path("dist/rnaseq-report.html")
PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js"

JS_ORDER = [
    "assets/js/state.js",
    "assets/js/tables.js",
    "assets/js/qc.js",
    "assets/js/dataLoader.js",
    "assets/js/plots.js",
    "assets/js/de.js",
    "assets/js/enrichment.js",
    "assets/js/geneSearch.js",
    "assets/js/webrManager.js",
    "assets/js/packageManager.js",
    "assets/js/downstreamPlugins.js",
    "assets/js/app.js",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_module_syntax(source: str) -> str:
    lines = []
    for line in source.splitlines():
        if re.match(r"^\s*import\s+", line):
            continue
        line = re.sub(
            r"^\s*export\s+(?=(async\s+)?function\b|const\b|let\b|var\b|class\b)",
            "",
            line,
        )
        if re.match(r"^\s*export\s*\{", line):
            continue
        lines.append(line)
    return "\n".join(lines)


def data_root_from_config(config_text: str) -> str:
    try:
        config = json.loads(config_text)
    except json.JSONDecodeError:
        return "assets/data"
    return str(config.get("dataRoot") or "assets/data").strip("/")


def embedded_assets(repo_root: Path) -> dict[str, str]:
    config_path = repo_root / "assets/report_config.json"
    config_text = read_text(config_path)
    assets = {"assets/report_config.json": config_text}

    data_root = data_root_from_config(config_text)
    data_dir = repo_root / data_root
    if not data_dir.exists():
        return assets

    for path in sorted(data_dir.rglob("*")):
        if path.is_file():
            assets[path.relative_to(repo_root).as_posix()] = read_text(path)
    return assets


def bundled_app_script(repo_root: Path) -> str:
    assets_json = json.dumps(embedded_assets(repo_root), ensure_ascii=False, separators=(",", ":"))
    chunks = [
        "const REPORT_EMBEDDED_ASSETS = Object.freeze(" + assets_json + ");",
        "globalThis.REPORT_EMBEDDED_ASSETS = REPORT_EMBEDDED_ASSETS;",
    ]

    for relative_path in JS_ORDER:
        source_path = repo_root / relative_path
        chunks.append(f"\n// ---- {relative_path} ----\n{strip_module_syntax(read_text(source_path))}")

    return "(function () {\n'use strict';\n" + "\n".join(chunks) + "\n})();\n"


def plotly_tag(args: argparse.Namespace, repo_root: Path) -> str:
    if args.plotly_file:
        plotly_source = read_text((repo_root / args.plotly_file).resolve())
        return f"<script>\n{plotly_source}\n</script>"

    if args.embed_plotly:
        plotly_source = download_text(args.plotly_url)
        return f"<script>\n{plotly_source}\n</script>"

    return f'<script src="{args.plotly_url}" defer data-plotly></script>'


def download_text(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.read().decode("utf-8")
    except urllib.error.URLError:
        result = subprocess.run(
            ["curl", "-L", "--fail", "--silent", "--show-error", url],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout


def standalone_html(args: argparse.Namespace, repo_root: Path) -> str:
    html = read_text(repo_root / "index.html")
    css = read_text(repo_root / "assets/css/style.css")
    script = bundled_app_script(repo_root)

    html = html.replace(
        '  <link rel="stylesheet" href="assets/css/style.css" />',
        f"  <style>\n{css}\n  </style>",
    )
    html = re.sub(
        r"\s*<script[^>]+src=\"https://cdn\.plot\.ly/plotly-2\.35\.2\.min\.js\"[^>]*></script>",
        "",
        html,
    )
    html = html.replace(
        '  <script type="module" src="assets/js/app.js"></script>',
        f"  {plotly_tag(args, repo_root)}\n  <script>\n{script}  </script>",
    )
    return html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output HTML path, relative to repo root by default. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--plotly-url",
        default=PLOTLY_CDN,
        help=f"Plotly URL for the standalone file. Default: {PLOTLY_CDN}",
    )
    parser.add_argument(
        "--embed-plotly",
        action="store_true",
        help="Inline Plotly too, producing a larger file that works without internet.",
    )
    parser.add_argument(
        "--plotly-file",
        help="Inline Plotly from a local JavaScript file instead of the CDN.",
    )
    args = parser.parse_args()

    output_path = args.output if args.output.is_absolute() else REPO_ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(standalone_html(args, REPO_ROOT), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
