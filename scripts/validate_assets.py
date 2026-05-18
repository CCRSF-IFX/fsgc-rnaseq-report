#!/usr/bin/env python3
"""Validate minimum RNA-seq report assets.

Usage:
  python scripts/validate_assets.py assets/data
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from qc_excel import load_summary_sheet

SAMPLE_CANDIDATES = (
    ('samples.json', 'json'),
    ('sample_manifest.csv', 'csv'),
    ('sample_manifest.tsv', 'tsv'),
    ('samples.csv', 'csv'),
    ('samples.tsv', 'tsv'),
)

QC_CANDIDATES = (
    ('qc_metrics.json', 'json'),
    ('qc_metrics.csv', 'csv'),
    ('qc_metrics.tsv', 'tsv'),
    ('qc_metrics.xlsx', 'xlsx'),
    ('qc_metrics.xlsm', 'xlsx'),
)

COUNT_CANDIDATES = (
    ('counts.csv', ','),
    ('counts.tsv', '\t'),
)

QC_SAMPLE_ID_ALIASES = {'sample_id', 'sample_id_', 'sample', 'sampleid'}

COUNT_METADATA_COLUMNS = {
    'gene_id',
    'gene_symbol',
    'gene_name',
    'description',
    'gene_description',
    'chromosome',
    'chr',
    'start',
    'end',
    'strand',
    'length',
    'gene_biotype',
    'biotype',
}


def load_json(path: Path):
    with path.open() as handle:
        return json.load(handle)


def load_table(path: Path, delimiter: str):
    with path.open(newline='') as handle:
        return list(csv.DictReader(handle, delimiter=delimiter))


def validate_rows(name: str, rows, required_fields):
    if not isinstance(rows, list) or not rows:
        raise ValueError(f'{name} must be a non-empty JSON array')
    for i, row in enumerate(rows, 1):
        for field in required_fields:
            if field not in row:
                raise ValueError(f'{name} row {i} missing {field}')


def main(root: str) -> int:
    data_root = Path(root)
    errors = []
    count_fieldnames = []
    count_rows = []

    validate_optional_qc(data_root, errors)

    validate_optional_pca(data_root, errors)
    validate_optional_distance(data_root, errors)

    count_source = ''
    counts, count_delimiter = find_count_matrix(data_root)
    if counts:
        with counts.open(newline='') as handle:
            reader = csv.DictReader(handle, delimiter=count_delimiter)
            count_source = counts.name
            count_fieldnames = reader.fieldnames or []
            count_fieldset = set(count_fieldnames)
            count_rows = list(reader)
            if not count_fieldset & {'gene_id', 'gene_symbol', 'gene_name'}:
                errors.append(f'{count_source} missing a gene identifier column: gene_id, gene_symbol, or gene_name')
            if not count_rows:
                errors.append(f'{count_source} must contain at least one gene row')
    else:
        errors.append('Missing count matrix: expected counts.csv or counts.tsv')

    samples, sample_source = load_samples(data_root, errors, count_fieldnames, count_rows)
    if counts and samples:
        fieldnames = set(count_fieldnames)
        sample_ids = {str(row.get('sample_id', '')) for row in samples if isinstance(row, dict)}
        matched_samples = sorted(sample_ids & fieldnames)
        if len(matched_samples) < 2:
            errors.append(f'{count_source or "count matrix"} must include at least two columns matching sample_id values in {sample_source or "sample metadata"}')

    if errors:
        print('Validation failed:')
        for err in errors:
            print(f'  - {err}')
        return 1
    if sample_source and sample_source.endswith('inferred sample columns'):
        print(f'Asset validation passed. No sample manifest found; inferred {len(samples)} samples from {count_source or "count matrix"}.')
    else:
        print('Asset validation passed.')
    return 0


def find_count_matrix(data_root: Path):
    for filename, delimiter in COUNT_CANDIDATES:
        path = data_root / filename
        if path.exists():
            return path, delimiter
    return None, ','


def load_samples(data_root: Path, errors: list[str], count_fieldnames: list[str], count_rows: list[dict[str, str]]):
    for filename, kind in SAMPLE_CANDIDATES:
        path = data_root / filename
        if not path.exists():
            continue
        try:
            if kind == 'json':
                samples = load_json(path)
            elif kind == 'tsv':
                samples = load_table(path, '\t')
            else:
                samples = load_table(path, ',')
            validate_rows(filename, samples, ('sample_id',))
            return samples, filename
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            return [], filename

    inferred = infer_samples_from_counts(count_fieldnames, count_rows)
    if inferred:
        return inferred, 'count matrix inferred sample columns'
    if count_fieldnames:
        errors.append('No sample manifest was found, and the count matrix did not include at least two numeric sample columns.')
    return [], None


def infer_samples_from_counts(fieldnames: list[str], rows: list[dict[str, str]]):
    sample_ids = [field for field in fieldnames if is_likely_count_column(field, rows)]
    if len(sample_ids) < 2:
        return []
    return [{'sample_id': sample_id} for sample_id in sample_ids]


def is_likely_count_column(field: str, rows: list[dict[str, str]]) -> bool:
    if field.strip().lower() in COUNT_METADATA_COLUMNS:
        return False
    observed = False
    for row in rows[:50]:
        value = (row.get(field) or '').strip()
        if value == '':
            continue
        observed = True
        try:
            float(value)
        except ValueError:
            return False
    return observed


def validate_optional_rows(data_root: Path, filename: str, required_fields, errors: list[str]) -> None:
    path = data_root / filename
    if not path.exists():
        return
    try:
        data = load_json(path)
        validate_rows(filename, data, required_fields)
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))


def validate_optional_qc(data_root: Path, errors: list[str]) -> None:
    for filename, kind in QC_CANDIDATES:
        path = data_root / filename
        if not path.exists():
            continue
        try:
            if kind == 'json':
                rows = load_json(path)
            elif kind == 'tsv':
                rows = load_table(path, '\t')
            elif kind == 'xlsx':
                rows = load_summary_sheet(path, sheet_name='Summary')
            else:
                rows = load_table(path, ',')
            validate_qc_rows(filename, rows)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
        return


def validate_qc_rows(name: str, rows) -> None:
    if not isinstance(rows, list) or not rows:
        raise ValueError(f'{name} must contain a non-empty QC table')
    for i, row in enumerate(rows, 1):
        keys = {normalize_header(key) for key in row.keys()}
        if not keys & QC_SAMPLE_ID_ALIASES:
            raise ValueError(f'{name} row {i} missing sample_id or Sample ID')


def normalize_header(header: str) -> str:
    normalized = header.strip().replace('>=', ' gte ').lower()
    out = []
    previous_was_sep = False
    for ch in normalized:
        if ch.isalnum():
            out.append(ch)
            previous_was_sep = False
        elif not previous_was_sep:
            out.append('_')
            previous_was_sep = True
    return ''.join(out).strip('_')


def validate_optional_pca(data_root: Path, errors: list[str]) -> None:
    path = data_root / 'pca.json'
    if not path.exists():
        return
    try:
        data = load_json(path)
        if not isinstance(data, dict) or not isinstance(data.get('samples'), list):
            raise ValueError('pca.json must include samples array')
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))


def validate_optional_distance(data_root: Path, errors: list[str]) -> None:
    path = data_root / 'sample_distance_matrix.json'
    if not path.exists():
        return
    try:
        data = load_json(path)
        if not isinstance(data, dict) or not isinstance(data.get('sample_ids'), list) or not isinstance(data.get('matrix'), list):
            raise ValueError('sample_distance_matrix.json must include sample_ids and matrix arrays')
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else 'assets/data'))
