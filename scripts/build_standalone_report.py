#!/usr/bin/env python3
"""Build a double-clickable RNA-seq report HTML file."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import re
import subprocess
import urllib.error
import urllib.request
from html import escape as html_escape
from pathlib import Path

from qc_excel import load_summary_sheet


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = Path("dist/rnaseq-report.html")
PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js"
EMBEDDED_DATA_ROOT = "assets/data"
QC_EXCEL_NAMES = {"qc_metrics.xlsx", "qc_metrics.xlsm"}
LOGO_MIME_TYPES = {
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}

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
    "assets/js/webrManager.js",
    "assets/js/packageManager.js",
    "assets/js/analysisCache.js",
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


def image_data_uri(path: Path, repo_root: Path) -> str:
    resolved = resolve_repo_path(path, repo_root).resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"--project-logo does not exist or is not a file: {resolved}")
    mime_type = mimetypes.guess_type(resolved.name)[0] or LOGO_MIME_TYPES.get(resolved.suffix.lower())
    if not mime_type or not mime_type.startswith("image/"):
        raise ValueError(f"--project-logo must be an image file with a known type: {resolved}")
    encoded = base64.b64encode(resolved.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def local_logo_path(value: object) -> Path | None:
    logo = str(value or "").strip()
    if not logo or logo.startswith("//") or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", logo):
        return None
    return Path(logo)


def embedded_assets(
    repo_root: Path,
    data_root_override: Path | None = None,
    project_title: str | None = None,
    project_abbreviation: str | None = None,
    project_logo: Path | None = None,
    report_author: str | None = None,
    report_organization: str | None = None,
    report_version: str | None = None,
    run_id: str | None = None,
) -> dict[str, str]:
    config_path = repo_root / "assets/report_config.json"
    config_text = read_text(config_path)
    virtual_data_root = data_root_from_config(config_text)
    data_dir = repo_root / virtual_data_root
    config = json.loads(config_text)
    config_modified = False

    if data_root_override:
        data_dir = resolve_repo_path(data_root_override, repo_root).resolve()
        if not data_dir.is_dir():
            raise FileNotFoundError(f"--data-root does not exist or is not a directory: {data_dir}")

        virtual_data_root = EMBEDDED_DATA_ROOT
        config["dataRoot"] = virtual_data_root
        config_modified = True

    configured_logo = config.get("projectLogo") or config.get("projectLogoDataUrl") or config.get("logoDataUrl")
    configured_logo_path = None if project_logo else local_logo_path(configured_logo)

    if (
        project_title
        or project_abbreviation
        or project_logo
        or configured_logo_path
        or report_author
        or report_organization
        or report_version
        or run_id
    ):
        if project_title:
            config["projectTitle"] = project_title
            config["reportTitle"] = project_title
        if project_abbreviation:
            config["projectAbbreviation"] = project_abbreviation
        logo_path = project_logo or configured_logo_path
        if logo_path:
            config["projectLogo"] = image_data_uri(logo_path, repo_root)
            config["projectLogoName"] = resolve_repo_path(logo_path, repo_root).name
        if report_author:
            config["reportAuthor"] = report_author
        if report_organization:
            config["reportOrganization"] = report_organization
        if report_version:
            config["reportVersion"] = report_version
        if run_id:
            config["runId"] = run_id
        config_modified = True

    if config_modified:
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


def bundled_app_script(repo_root: Path, args: argparse.Namespace) -> str:
    assets_json = json.dumps(
        embedded_assets(
            repo_root,
            data_root_override=args.data_root,
            project_title=clean_optional_text(args.project_title),
            project_abbreviation=clean_optional_text(args.project_abbreviation),
            project_logo=args.project_logo,
            report_author=clean_optional_text(args.report_author),
            report_organization=clean_optional_text(args.report_organization),
            report_version=clean_optional_text(args.report_version),
            run_id=clean_optional_text(args.run_id),
        ),
        ensure_ascii=False,
        separators=(",", ":"),
    )
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
    script = bundled_app_script(repo_root, args)
    project_title = clean_optional_text(args.project_title)

    html = html.replace(
        '  <link rel="stylesheet" href="assets/css/style.css" />',
        f"  <style>\n{css}\n  </style>",
    )
    if project_title:
        html = re.sub(r"<title>.*?</title>", f"<title>{html_escape(project_title)}</title>", html, count=1)
    html = re.sub(
        r"\s*<script[^>]+src=\"https://cdn\.plot\.ly/plotly-2\.35\.2\.min\.js\"[^>]*></script>",
        "",
        html,
    )
    html = re.sub(
        r'\s*<script type="module" src="assets/js/app\.js(?:\?[^"]*)?"></script>',
        lambda _match: f"\n  {plotly_tag(args, repo_root)}\n  <script>\n{script}  </script>",
        html,
        count=1,
    )
    return html


def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


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
    parser.add_argument(
        "--project-title",
        help="Override the project/report title embedded in the standalone HTML.",
    )
    parser.add_argument(
        "--project-abbreviation",
        "--project-abbr",
        "--project-abbreviations",
        "--project-abbriviation",
        "--project-abbriviations",
        dest="project_abbreviation",
        help="Override the short project label shown in the sidebar brand mark.",
    )
    parser.add_argument(
        "--project-logo",
        "--report-logo",
        "--logo",
        type=Path,
        dest="project_logo",
        help="Embed a local image file as the sidebar logo. Supports common image formats such as PNG, SVG, JPG, GIF, and WebP. Relative paths resolve from the repo root.",
    )
    parser.add_argument(
        "--run-id",
        "--run-name",
        dest="run_id",
        help="Override the run identifier shown under the project title in the sidebar.",
    )
    parser.add_argument(
        "--report-author",
        "--prepared-by",
        dest="report_author",
        help="Override the person or group shown as the report preparer.",
    )
    parser.add_argument(
        "--report-organization",
        "--organization",
        dest="report_organization",
        help="Override the organization shown in the report attribution.",
    )
    parser.add_argument(
        "--report-version",
        help="Override the report template/version label shown in the header and provenance table.",
    )
    args = parser.parse_args()

    output_path = args.output if args.output.is_absolute() else REPO_ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(standalone_html(args, REPO_ROOT), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
