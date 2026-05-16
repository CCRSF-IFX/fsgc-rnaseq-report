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

from qc_excel import load_summary_sheet


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = Path("dist/rnaseq-report.html")
PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js"
EMBEDDED_DATA_ROOT = "assets/data"
QC_EXCEL_NAMES = {"qc_metrics.xlsx", "qc_metrics.xlsm"}

JS_ORDER = [
    "assets/js/state.js",
    "assets/js/tables.js",
    "assets/js/qc.js",
    "assets/js/analysis.js",
    "assets/js/dataLoader.js",
    "assets/js/userData.js",
    "assets/js/plots.js",
    "assets/js/heatmap.js",
    "assets/js/de.js",
    "assets/js/enrichment.js",
    "assets/js/geneSearch.js",
    "assets/js/webrManager.js",
    "assets/js/packageManager.js",
    "assets/js/fgsea.js",
    "assets/js/downstreamPlugins.js",
    "assets/js/packageRepository.js",
    "assets/js/deseq2.js",
    "assets/js/app.js",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_module_syntax(source: str) -> str:
    lines = []
    skipping_import = False
    for line in source.splitlines():
        if skipping_import:
            if ";" in line:
                skipping_import = False
            continue
        if re.match(r"^\s*import\b", line):
            if ";" not in line:
                skipping_import = True
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
        return EMBEDDED_DATA_ROOT
    return normalize_data_root(config.get("dataRoot") or EMBEDDED_DATA_ROOT)


def normalize_data_root(data_root: object) -> str:
    return str(data_root or EMBEDDED_DATA_ROOT).strip("/") or EMBEDDED_DATA_ROOT


def resolve_repo_path(path: Path, repo_root: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def embedded_assets(repo_root: Path, data_root_override: Path | None = None) -> dict[str, str]:
    config_path = repo_root / "assets/report_config.json"
    config_text = read_text(config_path)
    virtual_data_root = data_root_from_config(config_text)
    data_dir = repo_root / virtual_data_root

    if data_root_override:
        data_dir = resolve_repo_path(data_root_override, repo_root).resolve()
        if not data_dir.is_dir():
            raise FileNotFoundError(f"--data-root does not exist or is not a directory: {data_dir}")

        config = json.loads(config_text)
        virtual_data_root = EMBEDDED_DATA_ROOT
        config["dataRoot"] = virtual_data_root
        config_text = json.dumps(config, ensure_ascii=False, indent=2)

    assets = {"assets/report_config.json": config_text}

    if not data_dir.exists():
        return assets

    for path in sorted(data_dir.rglob("*")):
        if path.is_file():
            embedded_path = Path(virtual_data_root) / path.relative_to(data_dir)
            if path.name.lower() in QC_EXCEL_NAMES:
                embedded_qc_path = (Path(virtual_data_root) / "qc_metrics.json").as_posix()
                if embedded_qc_path not in assets:
                    rows = load_summary_sheet(path, sheet_name="Summary")
                    assets[embedded_qc_path] = json.dumps(rows, ensure_ascii=False, indent=2)
                continue
            if path.suffix.lower() in {".xlsx", ".xlsm"}:
                continue
            assets[embedded_path.as_posix()] = read_text(path)
    return assets


def bundled_app_script(repo_root: Path, data_root_override: Path | None = None) -> str:
    assets_json = json.dumps(embedded_assets(repo_root, data_root_override), ensure_ascii=False, separators=(",", ":"))
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
    script = bundled_app_script(repo_root, args.data_root)

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
    parser.add_argument(
        "--data-root",
        type=Path,
        help="Data directory to embed instead of assets/report_config.json dataRoot. Relative paths resolve from the repo root.",
    )
    args = parser.parse_args()

    output_path = args.output if args.output.is_absolute() else REPO_ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(standalone_html(args, REPO_ROOT), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
