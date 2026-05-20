---
description: Manually inspect local files, folders, screenshots, and documents through the clearread_ocr MCP server, especially when using a text-only model that cannot receive image/document prompt blocks.
disable-model-invocation: true
argument-hint: "[file-or-folder]"
---

# Clearread OCR

Inspect local artifacts for: `$ARGUMENTS`

Use this skill when the user asks Claude Code to understand project files, reports, spreadsheets, slide decks, PDFs, screenshots, logs, or folders while the active model cannot directly read image/document content blocks.

## Required Behavior

1. Call `mcp__clearread_ocr__artifact_inventory` when the target is a folder or unclear.
2. Call `mcp__clearread_ocr__extract_artifact_text` for each relevant file before making claims about file contents.
3. Call `mcp__clearread_ocr__make_context_bundle` when several files need to be carried into a later prompt or handoff.
4. For images, use the MCP result as ground truth: it may include metadata, Tesseract OCR text when `tesseract` is available on PATH or `TESSERACT_PATH`, and optional vision text when a provider is configured.
5. For PDFs, say whether text extraction succeeded or whether only metadata/fallback information was available.
6. Do not claim tests, parsing, OCR, or extraction succeeded unless the MCP tool result shows it.

## Model Notes

- Some text-only or Anthropic-compatible model backends do not support `image` or `document` content blocks.
- Claude Code local MCP tools can still provide extracted text results to the model.
- Keep the workflow text-first and tool-grounded.
- For OCR, prefer local Tesseract first. Vision API fallback is optional and only runs when the environment configures `VISION_API_KEY`, `VISION_API_URL` or `VISION_BASE_URL`, and `VISION_MODEL`.

## Output Shape

Start with a short status line:

`Read: <files>. Extraction: <good/partial/failed>.`

Then provide the useful content, missing pieces, and next action. Keep the answer concise unless the user asks for a full dump.
