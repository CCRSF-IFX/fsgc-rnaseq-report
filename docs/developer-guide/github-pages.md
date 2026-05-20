# GitHub Pages And Versioning

The repository includes a GitHub Actions workflow that publishes the hosted
report and builds the webR package snapshot used by optional browser analysis.

## Hosted Report Deployment

`.github/workflows/deploy-pages.yml` runs on pushes to `main` or `master`, or
manually through `workflow_dispatch`.

The workflow:

1. Reads the configured webR package snapshot version.
2. Reads the documentation version from `assets/report_config.json`
   `reportVersion`.
3. Prepares a static `_site/` directory for GitHub Pages.
4. Builds MkDocs documentation into versioned paths under `_site/docs/`.
5. Restores preserved historical webR package snapshots.
6. Builds the current webR package repository with `r-wasm/actions`.
7. Uploads release assets for package and library snapshots.
8. Publishes `_site/` through GitHub Pages.

Repository Pages should be configured to use GitHub Actions as the source.

## Hosted Documentation

The report demo and documentation are published by the same Pages workflow so
they do not compete for the repository's single GitHub Pages deployment.

MkDocs is hosted under:

```text
https://omicsreporthub.github.io/rnaseq-report/docs/latest/
```

The same build is also published under a versioned path:

```text
https://omicsreporthub.github.io/rnaseq-report/docs/v0.1.0/
```

The version is derived from `assets/report_config.json` `reportVersion` and is
prefixed with `v` when needed. Manual workflow runs can override only the
documentation path through the `docs_version` input; manual values are used as
typed after validation.

The workflow also writes:

```text
https://omicsreporthub.github.io/rnaseq-report/docs/versions.json
```

That file records the current version and the `latest` alias for tools or links
that need to discover the hosted documentation location.

## webR Package Snapshot

The package snapshot is defined by:

- `webr-packages/VERSION`
- `webr-packages/packages`
- `webr-packages/published_versions`
- `webr-packages/patches/`

The current report configuration points webR package installation at:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

The package repository must match the webR runtime configured in
`assets/report_config.json`.

## Versioning Rules

Treat package snapshots as immutable. When package contents change:

1. Choose a new `webr-packages/VERSION`.
2. Update `assets/report_config.json`.
3. Preserve old versions in `webr-packages/published_versions` when older
   reports still point to them.
4. Let the Pages workflow publish the new snapshot and release assets.

The deployment workflow refuses to overwrite an existing package snapshot by
default. If the configured package snapshot already exists, the workflow
preserves that hosted snapshot and can still publish report or documentation
changes. Manual runs can opt into `force_overwrite=true` when an intentional
package replacement is needed.

## Documentation Workflow

`.github/workflows/ci_mkdocs.yaml` validates this documentation with MkDocs
using the same versioned directory layout as the Pages deployment. It uploads
the built documentation as a CI artifact. The actual hosted documentation is
published by `.github/workflows/deploy-pages.yml`.
