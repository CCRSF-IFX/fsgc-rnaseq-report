# Reference

## Project Files

- `README.md`: concise entry point linking to the user and developer guides.
- `assets/report_config.json`: report configuration, analysis defaults, webR
  settings, and hosted-site links.
- `scripts/build_report_bundle.py`: standalone report builder.
- `scripts/validate_assets.py`: data validator.
- `scripts/qc_excel.py`: QC Excel parser for supported summary workbooks.
- `.github/workflows/deploy-pages.yml`: report demo and webR snapshot deployer.
- `.github/workflows/ci_mkdocs.yaml`: documentation build validation.
- `docs/user-guide/`: recipient-facing report documentation.
- `docs/developer-guide/`: build, deployment, and maintenance documentation.

## External Documentation

- [webR documentation](https://docs.r-wasm.org/webr/)
- [r-wasm/actions](https://github.com/r-wasm/actions)
- [DESeq2](https://bioconductor.org/packages/DESeq2/)
- [DESeq2 experimental design and interpretation](https://rstudio-pubs-static.s3.amazonaws.com/329027_593046fb6d7a427da6b2c538caf601e1.html)
- [fgsea](https://bioconductor.org/packages/fgsea/)
- [Plotly JavaScript](https://plotly.com/javascript/)
- [MkDocs](https://www.mkdocs.org/)
- [GitHub Pages with Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Related Repository

The documentation layout and MkDocs workflow were adapted from the local
`SF_biocontainer` documentation template.
