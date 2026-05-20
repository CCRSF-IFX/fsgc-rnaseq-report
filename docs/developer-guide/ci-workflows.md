# CI Workflows

The repository uses GitHub Actions for hosted deployment, documentation
validation, and optional browser smoke tests.

## Pages Deployment

`.github/workflows/deploy-pages.yml` publishes the hosted report through GitHub
Pages. It also:

- builds versioned MkDocs documentation under `_site/docs/<version>/`
- updates `_site/docs/latest/`
- writes `_site/docs/versions.json`
- restores preserved webR package snapshots
- builds a new webR package snapshot when needed
- uploads webR package and library bundle release assets

Repository Pages must use **GitHub Actions** as the source.

## MkDocs CI

`.github/workflows/ci_mkdocs.yaml` validates documentation on pull requests,
pushes, and manual runs. It builds the same versioned documentation layout used
by Pages deployment, but only uploads it as a CI artifact.

## Manual Inputs

The Pages workflow supports:

- `force_overwrite`: rebuild and replace an existing webR package snapshot when
  set to `true`
- `docs_version`: override only the documentation path for a manual run

Use `force_overwrite=true` sparingly. Package snapshots are intended to be
immutable.

## Local Validation

Useful checks before pushing workflow or documentation changes:

```bash
mkdocs build --strict
```

```bash
git diff --check
```

For report and asset changes, run the relevant subset of:

```bash
python3 scripts/validate_assets.py assets/data
python3 -m json.tool assets/report_config.json >/dev/null
python3 -m py_compile \
  scripts/build_report_bundle.py \
  scripts/validate_assets.py \
  scripts/qc_excel.py
node --check assets/js/app.js
node --check assets/js/analysis.js
node --check assets/js/dataLoader.js
node --check assets/js/downstreamPlugins.js
node --check assets/js/deseq2.js
node --check assets/js/fgsea.js
node --check assets/js/heatmap.js
node --check assets/js/packageRepository.js
node --check assets/js/plots.js
node --check assets/js/userData.js
python3 scripts/build_report_bundle.py
```

Validate workflow YAML with:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy-pages.yml"); puts "yaml ok"'
```

Check the package parser output with:

```bash
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); if ($0 == "" || substr($0, 1, 1) == "#") next; if (!seen[$0]++) { if (out != "") out = out ","; out = out $0 } } END { print out }' webr-packages/packages
```

If available, also run:

```bash
actionlint .github/workflows/*.yml .github/workflows/*.yaml
```
