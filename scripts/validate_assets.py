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

REQUIRED_JSON = {
    'samples.json': ('sample_id',),
    'qc_metrics.json': ('sample_id',),
    'pca.json': (),
    'sample_distance_matrix.json': (),
}


def load_json(path: Path):
    with path.open() as handle:
        return json.load(handle)


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
    for filename, required_fields in REQUIRED_JSON.items():
        path = data_root / filename
        if not path.exists():
            errors.append(f'Missing {path}')
            continue
        try:
            data = load_json(path)
            if required_fields:
                validate_rows(filename, data, required_fields)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    counts = data_root / 'counts.csv'
    if counts.exists():
        with counts.open(newline='') as handle:
            reader = csv.DictReader(handle)
            required = {'gene_id', 'gene_symbol'}
            missing = required - set(reader.fieldnames or [])
            if missing:
                errors.append(f'counts.csv missing columns: {sorted(missing)}')
    else:
        errors.append('Missing counts.csv')

    if errors:
        print('Validation failed:')
        for err in errors:
            print(f'  - {err}')
        return 1
    print('Asset validation passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else 'assets/data'))
