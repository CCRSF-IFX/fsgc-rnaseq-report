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
from dataclasses import dataclass, field
from html import escape as html_escape
from pathlib import Path
from typing import Any

from qc_excel import load_summary_sheet


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = Path("dist/rnaseq-report.html")
PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js"
EMBEDDED_DATA_ROOT = "assets/data"
JS_ENTRYPOINT = "assets/js/app.js"
PROFILE_FSGC_RSEM = "fsgc-rsem"

QC_EXCEL_NAMES = {"qc_metrics.xlsx", "qc_metrics.xlsm"}
QC_EXCEL_MIME_TYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
}
LOGO_MIME_TYPES = {
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}


@dataclass(frozen=True)
class BuildOptions:
    output: Path
    plotly_url: str
    embed_plotly: bool = False
    plotly_file: Path | None = None
    data_root: Path | None = None
    project_title: str | None = None
    project_abbreviation: str | None = None
    project_logo: Path | None = None
    run_id: str | None = None
    report_author: str | None = None
    report_organization: str | None = None
    report_version: str | None = None
    profile: str | None = None
    include_qc_excel: bool = False


@dataclass
class BuildContext:
    repo_root: Path
    options: BuildOptions
    config: dict[str, Any]
    virtual_data_root: str
    data_dir: Path
    assets: dict[str, str] = field(default_factory=dict)


def build_standalone_report(options: BuildOptions, repo_root: Path = REPO_ROOT) -> str:
    context = create_build_context(options, repo_root)
    apply_config_overrides(context)
    collect_data_assets(context)
    apply_profile(context)
    finalize_config_asset(context)
    return render_html(context)


def create_build_context(options: BuildOptions, repo_root: Path) -> BuildContext:
    config_path = repo_root / "assets/report_config.json"
    config = json.loads(read_text(config_path))
    virtual_data_root = normalize_data_root(config.get("dataRoot") or EMBEDDED_DATA_ROOT)
    data_dir = repo_root / virtual_data_root

    if options.data_root:
        data_dir = resolve_repo_path(options.data_root, repo_root).resolve()
        if not data_dir.is_dir():
            raise FileNotFoundError(f"--data-root does not exist or is not a directory: {data_dir}")
        virtual_data_root = EMBEDDED_DATA_ROOT
        config["dataRoot"] = virtual_data_root

    return BuildContext(
        repo_root=repo_root,
        options=options,
        config=config,
        virtual_data_root=virtual_data_root,
        data_dir=data_dir,
    )


def apply_config_overrides(context: BuildContext) -> None:
    options = context.options
    config = context.config

    project_title = clean_optional_text(options.project_title)
    if project_title:
        config["projectTitle"] = project_title
        config["reportTitle"] = project_title

    project_abbreviation = clean_optional_text(options.project_abbreviation)
    if project_abbreviation:
        config["projectAbbreviation"] = project_abbreviation

    report_author = clean_optional_text(options.report_author)
    if report_author:
        config["reportAuthor"] = report_author

    report_organization = clean_optional_text(options.report_organization)
    if report_organization:
        config["reportOrganization"] = report_organization

    report_version = clean_optional_text(options.report_version)
    if report_version:
        config["reportVersion"] = report_version

    run_id = clean_optional_text(options.run_id)
    if run_id:
        config["runId"] = run_id

    logo_path = resolve_logo_path(context)
    if logo_path:
        config["projectLogo"] = image_data_uri(logo_path, context.repo_root)
        config["projectLogoName"] = resolve_repo_path(logo_path, context.repo_root).name


def resolve_logo_path(context: BuildContext) -> Path | None:
    if context.options.project_logo:
        return context.options.project_logo
    configured_logo = (
        context.config.get("projectLogo")
        or context.config.get("projectLogoDataUrl")
        or context.config.get("logoDataUrl")
    )
    return local_logo_path(configured_logo)


def collect_data_assets(context: BuildContext) -> None:
    if not context.data_dir.exists():
        if context.options.include_qc_excel:
            raise FileNotFoundError(
                f"--include-qc-excel requested, but data directory does not exist: {context.data_dir}"
            )
        return

    embedded_qc_excel: dict[str, str] | None = None
    for path in sorted(context.data_dir.rglob("*")):
        if not path.is_file():
            continue
        embedded_path = embedded_data_path(context, path)
        if path.name.lower() in QC_EXCEL_NAMES:
            embedded_qc_excel = handle_qc_excel_asset(context, path, embedded_path, embedded_qc_excel)
            continue
        if path.suffix.lower() in {".xlsx", ".xlsm"}:
            continue
        context.assets[embedded_path] = read_text(path)

    if context.options.include_qc_excel:
        if not embedded_qc_excel:
            raise FileNotFoundError(
                f"--include-qc-excel requested, but no qc_metrics.xlsx or qc_metrics.xlsm was found in {context.data_dir}"
            )
        context.config["qcExcelAsset"] = embedded_qc_excel


def embedded_data_path(context: BuildContext, path: Path) -> str:
    return (Path(context.virtual_data_root) / path.relative_to(context.data_dir)).as_posix()


def handle_qc_excel_asset(
    context: BuildContext,
    path: Path,
    embedded_path: str,
    embedded_qc_excel: dict[str, str] | None,
) -> dict[str, str] | None:
    embedded_qc_path = (Path(context.virtual_data_root) / "qc_metrics.json").as_posix()
    if context.options.include_qc_excel or embedded_qc_path not in context.assets:
        rows = load_summary_sheet(path, sheet_name="Summary")
        context.assets[embedded_qc_path] = json.dumps(rows, ensure_ascii=False, indent=2)

    if not context.options.include_qc_excel:
        return embedded_qc_excel

    mime_type = QC_EXCEL_MIME_TYPES.get(path.suffix.lower()) or "application/octet-stream"
    qc_excel_asset = {
        "path": embedded_path,
        "filename": path.name,
        "mimeType": mime_type,
    }
    context.assets[embedded_path] = file_data_uri(path, mime_type)
    return qc_excel_asset


def apply_profile(context: BuildContext) -> None:
    if context.options.profile == PROFILE_FSGC_RSEM:
        apply_fsgc_rsem_profile(context)
    elif context.options.profile:
        raise ValueError(f"Unknown build profile: {context.options.profile}")


def apply_fsgc_rsem_profile(context: BuildContext) -> None:
    context.config["countMatrixFormat"] = {
        "source": "FSGC",
        "quantifier": "RSEM",
        "countType": "expected counts",
        "geneIdentifierFormat": "ENSG.version_SYMBOL when gene_symbol is absent",
    }
    root = Path(context.virtual_data_root)
    merge_json_asset(context.assets, (root / "logs/pipeline_provenance.json").as_posix(), {
        "data_format": "FSGC RSEM count matrix",
        "count_source": "RSEM expected counts generated by FSGC",
        "count_matrix_format": "FSGC gene_id values may use ENSG.version_SYMBOL when gene_symbol is absent",
        "quantification_method": "RSEM",
        "quantification_units": "expected counts",
    })
    merge_json_asset(context.assets, (root / "logs/software_versions.json").as_posix(), {
        "count_matrix_format": "FSGC RSEM expected counts",
        "quantification": "RSEM",
    })


def finalize_config_asset(context: BuildContext) -> None:
    context.assets["assets/report_config.json"] = json.dumps(context.config, ensure_ascii=False, indent=2)


def render_html(context: BuildContext) -> str:
    html = read_text(context.repo_root / "index.html")
    html = inline_css(html, context.repo_root)
    html = apply_html_title(html, context.options.project_title)
    html = remove_plotly_script(html)
    html = inject_standalone_script(html, context)
    return html


def inline_css(html: str, repo_root: Path) -> str:
    css = read_text(repo_root / "assets/css/style.css")
    target = '  <link rel="stylesheet" href="assets/css/style.css" />'
    if target not in html:
        raise RuntimeError("Could not find stylesheet link in index.html")
    return html.replace(target, f"  <style>\n{css}\n  </style>", 1)


def apply_html_title(html: str, project_title: str | None) -> str:
    title = clean_optional_text(project_title)
    if not title:
        return html
    return re.sub(r"<title>.*?</title>", f"<title>{html_escape(title)}</title>", html, count=1)


def remove_plotly_script(html: str) -> str:
    return re.sub(
        r"\s*<script[^>]+src=\"https://cdn\.plot\.ly/plotly-2\.35\.2\.min\.js\"[^>]*></script>",
        "",
        html,
    )


def inject_standalone_script(html: str, context: BuildContext) -> str:
    script = bundled_app_script(context.repo_root, context.assets)
    replacement = f"\n  {plotly_tag(context.options, context.repo_root)}\n  <script>\n{script}  </script>"
    html, count = re.subn(
        r'\s*<script type="module" src="assets/js/app\.js(?:\?[^"]*)?"></script>',
        lambda _match: replacement,
        html,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Could not find module app script tag in index.html")
    return html


def bundled_app_script(repo_root: Path, assets: dict[str, str]) -> str:
    assets_json = json.dumps(assets, ensure_ascii=False, separators=(",", ":"))
    chunks = [
        "const REPORT_EMBEDDED_ASSETS = Object.freeze(" + assets_json + ");",
        "globalThis.REPORT_EMBEDDED_ASSETS = REPORT_EMBEDDED_ASSETS;",
    ]

    for relative_path in js_bundle_order(repo_root):
        source_path = repo_root / relative_path
        chunks.append(f"\n// ---- {relative_path} ----\n{strip_module_syntax(read_text(source_path))}")

    return "(function () {\n'use strict';\n" + "\n".join(chunks) + "\n})();\n"


def js_bundle_order(repo_root: Path, entrypoint: str = JS_ENTRYPOINT) -> list[str]:
    order: list[str] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(relative_path: str) -> None:
        if relative_path in visited:
            return
        if relative_path in visiting:
            raise RuntimeError(f"Circular JavaScript import detected at {relative_path}")
        source_path = repo_root / relative_path
        if not source_path.is_file():
            raise FileNotFoundError(f"JavaScript module not found: {relative_path}")

        visiting.add(relative_path)
        for imported_path in local_imports(read_text(source_path), source_path, repo_root):
            visit(imported_path)
        visiting.remove(relative_path)
        visited.add(relative_path)
        order.append(relative_path)

    visit(entrypoint)
    return order


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


def local_imports(source: str, source_path: Path, repo_root: Path) -> list[str]:
    imports = []
    for match in re.finditer(r"^\s*import\s+(?:[\s\S]*?\s+from\s+)?['\"](\.[^'\"]+)['\"]\s*;", source, flags=re.M):
        specifier = re.split(r"[?#]", match.group(1), maxsplit=1)[0]
        imported = (source_path.parent / specifier).resolve()
        try:
            imports.append(imported.relative_to(repo_root).as_posix())
        except ValueError:
            continue
    return imports


def plotly_tag(options: BuildOptions, repo_root: Path) -> str:
    if options.plotly_file:
        plotly_source = read_text(resolve_repo_path(options.plotly_file, repo_root).resolve())
        return f"<script>\n{plotly_source}\n</script>"

    if options.embed_plotly:
        plotly_source = download_text(options.plotly_url)
        return f"<script>\n{plotly_source}\n</script>"

    return f'<script src="{options.plotly_url}" async data-plotly onload="this.dataset.plotlyState=\'loaded\'" onerror="this.dataset.plotlyState=\'failed\'"></script>'


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def resolve_repo_path(path: Path, repo_root: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def normalize_data_root(data_root: object) -> str:
    return str(data_root or EMBEDDED_DATA_ROOT).strip("/") or EMBEDDED_DATA_ROOT


def image_data_uri(path: Path, repo_root: Path) -> str:
    resolved = resolve_repo_path(path, repo_root).resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"--project-logo does not exist or is not a file: {resolved}")
    mime_type = mimetypes.guess_type(resolved.name)[0] or LOGO_MIME_TYPES.get(resolved.suffix.lower())
    if not mime_type or not mime_type.startswith("image/"):
        raise ValueError(f"--project-logo must be an image file with a known type: {resolved}")
    return file_data_uri(resolved, mime_type)


def file_data_uri(path: Path, mime_type: str | None = None) -> str:
    resolved = path.resolve()
    inferred = mimetypes.guess_type(resolved.name)[0]
    content_type = mime_type or inferred or "application/octet-stream"
    encoded = base64.b64encode(resolved.read_bytes()).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def local_logo_path(value: object) -> Path | None:
    logo = str(value or "").strip()
    if not logo or logo.startswith("//") or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", logo):
        return None
    return Path(logo)


def merge_json_asset(assets: dict[str, str], path: str, updates: dict[str, str]) -> None:
    current: dict[str, object] = {}
    if path in assets and assets[path].strip():
        parsed = json.loads(assets[path])
        if isinstance(parsed, dict):
            current = parsed
    current.update(updates)
    assets[path] = json.dumps(current, ensure_ascii=False, indent=2)


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


def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def parse_args(argv: list[str] | None = None) -> BuildOptions:
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
        type=Path,
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
    parser.add_argument(
        "--profile",
        choices=[PROFILE_FSGC_RSEM],
        help="Apply a named build profile. Use fsgc-rsem for FSGC RSEM expected-count matrices.",
    )
    parser.add_argument(
        "--include-qc-excel",
        action="store_true",
        help="Embed qc_metrics.xlsx or qc_metrics.xlsm in the standalone HTML and show a QC Excel download button.",
    )
    args = parser.parse_args(argv)
    return BuildOptions(
        output=args.output,
        plotly_url=args.plotly_url,
        embed_plotly=args.embed_plotly,
        plotly_file=args.plotly_file,
        data_root=args.data_root,
        project_title=args.project_title,
        project_abbreviation=args.project_abbreviation,
        project_logo=args.project_logo,
        run_id=args.run_id,
        report_author=args.report_author,
        report_organization=args.report_organization,
        report_version=args.report_version,
        profile=args.profile,
        include_qc_excel=args.include_qc_excel,
    )


def main() -> None:
    options = parse_args()
    output_path = options.output if options.output.is_absolute() else REPO_ROOT / options.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(build_standalone_report(options, REPO_ROOT), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
