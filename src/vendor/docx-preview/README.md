# docx-preview (vendored)

- Source: https://github.com/VolodymyrBaydalka/docxjs
- Version: 0.4.1, `dist/docx-preview.mjs` at commit c533f383069008d4a1e05c6171ef8777fd078385
- License: Apache License 2.0 (see `LICENSE`), copyright Volodymyr Baydalka. The file is unmodified.

Vendored because the Stage 6 build environment could not reach the npm registry. It imports `jszip`, which is already a dependency. To switch to the npm package later: `npm install docx-preview@0.4.1`, change the import in `src/lib/docx/viewer.js` to `'docx-preview'`, and delete this folder.
