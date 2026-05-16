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

SAMPLE_CANDIDATES = (
    ('samples.json', 'json'),
    ('sample_manifest.csv', 'csv'),
    ('sample_manifest.tsv', 'tsv'),
    ('samples.csv', 'csv'),
    ('samples.tsv', 'tsv'),
)

OPTIONAL_ROW_JSON = {
    'qc_metrics.json': ('sample_id',),
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

    samples, sample_source = load_samples(data_root, errors)

    for filename, required_fields in OPTIONAL_ROW_JSON.items():
        validate_optional_rows(data_root, filename, required_fields, errors)

    validate_optional_pca(data_root, errors)
    validate_optional_distance(data_root, errors)

    counts = data_root / 'counts.csv'
    if counts.exists():
        with counts.open(newline='') as handle:
            reader = csv.DictReader(handle)
            fieldnames = set(reader.fieldnames or [])
            if not fieldnames & {'gene_id', 'gene_symbol', 'gene_name'}:
                errors.append('counts.csv missing a gene identifier column: gene_id, gene_symbol, or gene_name')
            sample_ids = {str(row.get('sample_id', '')) for row in samples if isinstance(row, dict)}
            matched_samples = sorted(sample_ids & fieldnames)
            if len(matched_samples) < 2:
                errors.append(f'counts.csv must include at least two columns matching sample_id values in {sample_source or "sample metadata"}')
            if not any(True for _ in reader):
                errors.append('counts.csv must contain at least one gene row')
    else:
        errors.append('Missing counts.csv')

    if errors:
        print('Validation failed:')
        for err in errors:
            print(f'  - {err}')
        return 1
    print('Asset validation passed.')
    return 0


def load_samples(data_root: Path, errors: list[str]):
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

    expected = ', '.join(filename for filename, _ in SAMPLE_CANDIDATES)
    errors.append(f'Missing sample metadata file. Expected one of: {expected}')
    return [], None


def validate_optional_rows(data_root: Path, filename: str, required_fields, errors: list[str]) -> None:
    path = data_root / filename
    if not path.exists():
        return
    try:
        data = load_json(path)
        validate_rows(filename, data, required_fields)
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))


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
