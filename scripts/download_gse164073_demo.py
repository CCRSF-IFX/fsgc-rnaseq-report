#!/usr/bin/env python3
"""Create a public human multi-factor RNA-seq demo dataset.

The dataset is GEO GSE164073: response to SARS-CoV-2 infection in human
cornea, limbus, and sclera cells. It has two useful metadata factors for the
report UI: infection condition and tissue.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import re
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = REPO_ROOT / "assets/data/gse164073"

COUNT_URL = (
    "https://www.ncbi.nlm.nih.gov/geo/download/"
    "?type=rnaseq_counts&acc=GSE164073&format=file"
    "&file=GSE164073_raw_counts_GRCh38.p13_NCBI.tsv.gz"
)
SOFT_URL = "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE164nnn/GSE164073/soft/GSE164073_family.soft.gz"
GENE_INFO_URL = "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    samples = parse_geo_soft(download_gzip_text(SOFT_URL))
    gene_info = parse_gene_info(download_gzip_text(GENE_INFO_URL))
    counts_rows, sample_ids = parse_counts(download_gzip_text(COUNT_URL), gene_info)

    write_csv(OUTPUT_DIR / "counts.csv", counts_rows, ["gene_id", "gene_symbol", "gene_name", *sample_ids])
    write_csv(
        OUTPUT_DIR / "sample_manifest.csv",
        samples,
        ["sample_id", "title", "tissue", "condition", "infection", "time_point", "replicate", "organism"],
    )
    write_json(OUTPUT_DIR / "samples.json", samples)
    write_json(OUTPUT_DIR / "gene_annotation.json", [
        {
            "gene_id": row["gene_id"],
            "gene_symbol": row["gene_symbol"],
            "description": row["gene_name"],
        }
        for row in counts_rows
        if row["gene_symbol"] or row["gene_name"]
    ])
    write_json(OUTPUT_DIR / "logs/pipeline_provenance.json", {
        "dataset": "GSE164073",
        "title": "Response to SARS-CoV-2 infection in cornea, limbus and sclera from human donors",
        "organism": "Homo sapiens",
        "count_matrix_url": COUNT_URL,
        "metadata_url": SOFT_URL,
        "gene_info_url": GENE_INFO_URL,
        "notes": "Counts were downloaded from NCBI GEO RNA-seq counts and gene symbols were mapped from NCBI Homo_sapiens.gene_info.gz.",
    })
    write_json(OUTPUT_DIR / "logs/software_versions.json", {
        "demo_builder": Path(__file__).name,
        "count_source": "NCBI GEO RNA-seq counts",
        "gene_annotation_source": "NCBI Gene Homo_sapiens.gene_info.gz",
    })
    write_readme(OUTPUT_DIR / "README.md", len(counts_rows), len(samples))
    print(f"Wrote {len(counts_rows)} genes and {len(samples)} samples to {OUTPUT_DIR}")


def download_gzip_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        compressed = response.read()
    return gzip.decompress(compressed).decode("utf-8", "replace")


def parse_geo_soft(text: str) -> list[dict[str, str]]:
    samples: list[dict[str, str]] = []
    current: dict[str, str] | None = None

    for line in text.splitlines():
        if line.startswith("^SAMPLE = "):
            if current:
                samples.append(normalize_sample(current))
            current = {"sample_id": line.split("=", 1)[1].strip(), "organism": "Homo sapiens"}
            continue

        if current is None:
            continue

        if line.startswith("!Sample_title = "):
            current["title"] = line.split("=", 1)[1].strip()
        elif line.startswith("!Sample_characteristics_ch1 = "):
            value = line.split("=", 1)[1].strip()
            if ":" in value:
                key, raw = value.split(":", 1)
                current[key.strip().replace(" ", "_")] = raw.strip()

    if current:
        samples.append(normalize_sample(current))

    if not samples:
        raise RuntimeError("No samples were parsed from GEO SOFT metadata.")
    return samples


def normalize_sample(sample: dict[str, str]) -> dict[str, str]:
    title = sample.get("title", "")
    infection = sample.get("infection", "")
    condition = "mock" if infection.lower() == "mock" else "sars_cov_2"
    replicate_match = re.search(r"_(\d+)$", title)
    return {
        "sample_id": sample.get("sample_id", ""),
        "title": title,
        "tissue": sample.get("tissue", ""),
        "condition": condition,
        "infection": infection,
        "time_point": sample.get("time_point", ""),
        "replicate": replicate_match.group(1) if replicate_match else "",
        "organism": sample.get("organism", "Homo sapiens"),
    }


def parse_gene_info(text: str) -> dict[str, dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    out: dict[str, dict[str, str]] = {}
    for row in reader:
        gene_id = row.get("GeneID", "")
        if not gene_id:
            continue
        out[gene_id] = {
            "gene_symbol": row.get("Symbol", ""),
            "gene_name": row.get("description", ""),
        }
    return out


def parse_counts(text: str, gene_info: dict[str, dict[str, str]]) -> tuple[list[dict[str, str]], list[str]]:
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    if not reader.fieldnames or reader.fieldnames[0] != "GeneID":
        raise RuntimeError("Unexpected count matrix header; first column should be GeneID.")

    sample_ids = reader.fieldnames[1:]
    rows: list[dict[str, str]] = []
    for row in reader:
        gene_id = row.get("GeneID", "")
        annotation = gene_info.get(gene_id, {})
        rows.append({
            "gene_id": gene_id,
            "gene_symbol": annotation.get("gene_symbol", ""),
            "gene_name": annotation.get("gene_name", ""),
            **{sample_id: row.get(sample_id, "0") for sample_id in sample_ids},
        })

    if not rows:
        raise RuntimeError("No count rows were parsed.")
    return rows, sample_ids


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_readme(path: Path, gene_count: int, sample_count: int) -> None:
    path.write_text(
        f"""# GSE164073 Human SARS-CoV-2 Ocular Surface Demo

This folder contains a public human bulk RNA-seq demo dataset for the report app.

- GEO accession: GSE164073
- Organism: Homo sapiens
- Samples: {sample_count}
- Genes: {gene_count}
- Primary DE factor: `condition` (`sars_cov_2` vs `mock`)
- Useful blocking/covariate factor: `tissue` (`cornea`, `limbus`, `sclera`)

Source files:

- Counts: {COUNT_URL}
- Metadata: {SOFT_URL}
- Gene symbols: {GENE_INFO_URL}

Regenerate this fixture with:

```bash
python3 scripts/download_gse164073_demo.py
python3 scripts/validate_assets.py assets/data/gse164073
```

Build a single-file demo report with:

```bash
python3 scripts/build_standalone_report.py --data-root assets/data/gse164073 --output dist/gse164073-report.html
```
""",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
