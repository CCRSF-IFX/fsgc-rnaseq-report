# GSE164073 Human SARS-CoV-2 Ocular Surface Demo

This folder contains a public human bulk RNA-seq demo dataset for the report app.

- GEO accession: GSE164073
- Organism: Homo sapiens
- Samples: 18
- Genes: 39376
- Primary DE factor: `condition` (`sars_cov_2` vs `mock`)
- Useful blocking/covariate factor: `tissue` (`cornea`, `limbus`, `sclera`)

Source files:

- Counts: https://www.ncbi.nlm.nih.gov/geo/download/?type=rnaseq_counts&acc=GSE164073&format=file&file=GSE164073_raw_counts_GRCh38.p13_NCBI.tsv.gz
- Metadata: https://ftp.ncbi.nlm.nih.gov/geo/series/GSE164nnn/GSE164073/soft/GSE164073_family.soft.gz
- Gene symbols: https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz

Regenerate this fixture with:

```bash
python3 scripts/download_gse164073_demo.py
python3 scripts/validate_assets.py assets/data/gse164073
```

Build a single-file demo report with:

```bash
python3 scripts/build_standalone_report.py --data-root assets/data/gse164073 --output dist/gse164073-report.html
```
