# Clearread OCR

[![Version](https://img.shields.io/badge/version-0.3.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

Local-first OCR and artifact reading for Claude Code, especially useful with
text-only or limited-vision model backends.

Clearread exposes three compact MCP tools instead of a large format-specific
toolset. It extracts readable text locally first and only calls a remote vision
endpoint when the user explicitly configures one.

## Features

- Tesseract OCR for local images and screenshots.
- Text extraction from DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF, PDF, CSV, JSON,
  Markdown, logs, and common source files.
- Automatic bounded OCR for scanned or image-only PDFs: 3 pages by default,
  configurable up to 10.
- Automatic bounded OCR for supported images embedded in DOCX, XLSX, and PPTX:
  4 images by default, configurable up to 20.
- UTF-8, UTF-16, and GB18030/GBK-style text decoding.
- Compact multi-file context bundles.
- Optional OpenAI-compatible vision fallback for diagrams, charts, forms, and
  other content that OCR alone cannot explain.
- No npm dependencies; Office and OpenDocument parsing uses Node.js standard
  library APIs.

## Installation

In Claude Code:

```text
/plugin marketplace add shuangxue520/clearread-ocr
/plugin install clearread-ocr@clearread-ocr-marketplace
/reload-plugins
```

For local development:

```powershell
git clone https://github.com/shuangxue520/clearread-ocr.git
cd clearread-ocr
claude --plugin-dir .
```

## Requirements

- Node.js 18 or newer.
- Claude Code with plugin/MCP support.
- Tesseract on `PATH`, or `TESSERACT_PATH`, for local image OCR.
- Optional Poppler (`pdftotext` and `pdftoppm`) for the fastest PDF path.
- Optional Python PDF libraries (`pypdf` and PyMuPDF) as PDF fallbacks.

On Windows, Clearread can discover Poppler installed through WinGet even when
Claude Code uses a fixed `PATH`.

## Tools

### `artifact_inventory`

Lists files below a project path with compact type and size information.

### `extract_artifact_text`

Extracts one file. Useful optional arguments include:

- `ocrPdfPages`: enable or disable scan OCR; default `true`.
- `maxOcrPages`: scan at most 1-10 pages; default `3`.
- `includeEmbeddedImages`: OCR Office media; default `true`.
- `maxEmbeddedImages`: process at most 1-20 images; default `4`.
- `useVision`: use the explicitly configured vision endpoint when local OCR is
  insufficient.

### `make_context_bundle`

Combines bounded extraction results from several project files into one
text-first handoff.

## OCR Configuration

Tesseract defaults to English. Select installed language packs explicitly when
needed:

```powershell
$env:TESSERACT_LANG="chi_sim+eng"
```

You can also set an executable directly:

```powershell
$env:TESSERACT_PATH="<absolute-path-to-tesseract>"
```

## Optional Vision

Remote vision is disabled unless all required `VISION_*` values are configured.
Clearread does not infer a provider from unrelated API-key variables.

Set these environment variables in your shell or secret manager:

- `VISION_API_KEY`: the provider credential.
- `VISION_BASE_URL`: an OpenAI-compatible API base URL.
- `VISION_MODEL`: the vision-capable model name.

`VISION_API_URL` can be used instead of `VISION_BASE_URL` when you already have
the full `/chat/completions` endpoint. Optional tuning variables are
`VISION_MAX_TOKENS`, `VISION_TIMEOUT_MS`, `VISION_PROMPT`, and
`VISION_EXTRA_HEADERS`.

## Privacy

Files are read inside the active Claude project. Local extraction, Tesseract,
Poppler, and Python fallbacks do not upload file content. An image is sent to a
remote endpoint only when `VISION_API_KEY`, `VISION_MODEL`, and a vision URL or
base URL are explicitly configured and vision is used.

API keys are read from the process environment and are never written to the
repository or included in tool output. See [PRIVACY.md](PRIVACY.md).

## Known Limits

- OCR quality depends on scan clarity and installed Tesseract language data.
- PDF scan OCR is intentionally page-bounded to control latency and context.
- Office extraction does not fully reproduce SmartArt, macros, tracked changes,
  complex formulas, or document layout.
- Vision compatibility depends on the configured endpoint accepting
  OpenAI-compatible image URL content.

## Development

```powershell
node --check .\mcp-server.js
node .\mcp-server.js --self-test
claude plugin validate .
```

## License

MIT.
