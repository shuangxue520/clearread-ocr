# Clearread OCR

Local OCR and artifact-reading plugin for Claude Code.

This plugin gives text-only or limited-vision model backends a practical way to inspect local screenshots, images, PDFs, Office files, CSV files, logs, and source files through MCP tools.

## Features

- Read local images and screenshots with metadata plus Tesseract OCR.
- Extract text from DOCX, XLSX, PPTX, OpenDocument, RTF, PDF, CSV, JSON, Markdown, logs, and source files.
- Decode common text encodings including UTF-8, UTF-16, and GB18030/GBK-style Chinese text when possible.
- Build compact context bundles from multiple local files.
- Keep files local by default. Nothing is sent to a remote API unless you configure a vision fallback.
- Use a self-configured OpenAI-compatible vision model by setting `VISION_API_KEY`, `VISION_API_URL` or `VISION_BASE_URL`, and `VISION_MODEL`.

## Requirements

- Claude Code with plugin/MCP support.
- Node.js 18 or newer on `PATH`.
- Optional: Tesseract OCR on `PATH`, or set `TESSERACT_PATH`.
- Optional: `pdftotext`, `pypdf`, or `PyPDF2` for stronger PDF text extraction.

## Installation

Clone the repository, then load it as a local Claude Code plugin:

```powershell
git clone <your-repo-url> clearread-ocr
cd clearread-ocr
claude --plugin-dir .
```

Inside Claude Code, check that the MCP server is connected:

```text
/mcp
```

## Usage

Ask Claude Code to inspect a local file:

```text
Use the OCR plugin to read screenshots/login-error.png
```

Or ask for an inventory before reading:

```text
Use the OCR plugin to list the files under ./docs, then read the likely assignment files.
```

The plugin exposes three MCP tools:

- `artifact_inventory`: list local files with rough type classification and sizes.
- `extract_artifact_text`: extract text, metadata, OCR, or vision output from one file.
- `make_context_bundle`: combine extracted content from several files for a text-only model.

## Command Line Checks

The MCP server is normally started by Claude Code, but these commands are useful when debugging:

```powershell
node mcp-server.js --version
node mcp-server.js --help
node mcp-server.js --self-test
```

## Vision Fallback

The plugin always tries local extraction first. For images, it tries Tesseract OCR before remote vision.

Tesseract defaults to English OCR. Configure additional languages with `TESSERACT_LANG`:

```powershell
$env:TESSERACT_LANG="chi_sim+eng"
```

Remote vision only runs when configured through environment variables.

Configure your own OpenAI-compatible vision endpoint:

```powershell
$env:VISION_API_KEY="your-api-key"
$env:VISION_API_URL="https://example.com/v1/chat/completions"
$env:VISION_MODEL="your-vision-model"
```

You can also provide a base URL instead of the full chat completions URL:

```powershell
$env:VISION_BASE_URL="https://example.com/v1"
$env:VISION_MODEL="your-vision-model"
```

Optional tuning:

```powershell
$env:VISION_MAX_TOKENS="2048"
$env:VISION_TIMEOUT_MS="30000"
$env:VISION_PROMPT="Describe the image and transcribe all visible text."
$env:VISION_EXTRA_HEADERS='{"HTTP-Referer":"https://example.com"}'
```

## Privacy

By default, this plugin reads files locally and returns text to Claude Code through MCP.

Images are sent to a remote vision API only when you configure a vision provider with environment variables. Do not configure remote vision for private images unless you trust that provider.

API keys are never stored in this repository. Keep them in your shell, user environment, or secret manager.

## Known Limits

- Scanned or image-only PDFs may not contain extractable text. Export the relevant pages as images and use OCR or a configured vision model.
- Office extraction focuses on text. Embedded images, SmartArt, charts, macros, comments, tracked changes, and complex formulas may be omitted or flattened.
- OCR quality depends on the installed Tesseract language data and the clarity of the screenshot or scan.
- Vision fallback is intentionally opt-in because it sends image content to the provider you configure.

## Troubleshooting

If OCR says Tesseract is unavailable, install Tesseract and make sure `tesseract` is on `PATH`, or set:

```powershell
$env:TESSERACT_PATH="<absolute-path-to-tesseract.exe>"
```

For non-English OCR, install the relevant Tesseract language data and set `TESSERACT_LANG`, for example:

```powershell
$env:TESSERACT_LANG="chi_sim+eng"
```

If a generic vision provider fails, confirm that the endpoint supports OpenAI-compatible `chat/completions` requests with `image_url` data URLs.

If PDF extraction is weak, install `pdftotext` or a Python PDF library such as `pypdf`. If the PDF is a scanned document, export pages as images and read those images with OCR or a configured vision model.

## License

MIT.
