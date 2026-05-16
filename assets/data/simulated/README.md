# Simulated Test Data

This folder is a minimal report input fixture for exercising browser-side
analysis from a count matrix plus a sample manifest.

- `sample_manifest.csv` contains eight samples split by `condition`, `batch`,
  and `sex`.
- `counts.csv` contains simulated gene counts with treated/control signal,
  batch signal, sex signal, stable genes, and low-count genes.

Validate it with:

```bash
python3 scripts/validate_assets.py assets/data/simulated
```
