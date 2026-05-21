# Publish Clearread OCR

This file is a quick copy-paste guide for publishing this plugin as a public GitHub repository.

## Repository Settings

Repository name:

```text
clearread-ocr
```

Short description:

```text
Local OCR and artifact-reading MCP plugin for Claude Code, with Tesseract OCR and optional self-configured vision fallback.
```

Suggested topics:

```text
claude-code
mcp
ocr
tesseract
document-extraction
local-tools
agent-tools
vision-fallback
```

Visibility:

```text
Public
```

License:

```text
MIT
```

## Publish Commands

Create an empty public GitHub repository named `clearread-ocr`, then run:

```powershell
cd <your-local-path>\clearread-ocr
git remote add origin https://github.com/<your-github-user>/clearread-ocr.git
git push -u origin main
```

If `origin` already exists, replace it:

```powershell
cd <your-local-path>\clearread-ocr
git remote set-url origin https://github.com/<your-github-user>/clearread-ocr.git
git push -u origin main
```

## What Is Included

- `.claude-plugin/plugin.json`: Claude Code plugin manifest.
- `.mcp.json`: local MCP server config.
- `mcp-server.js`: Node.js MCP server.
- `skills/read/SKILL.md`: skill instructions for text-only model backends.
- `README.md`: public project documentation.
- `LICENSE`: MIT License.
- `.gitignore` and `.gitattributes`: publish hygiene.

## Final Checks Before Pushing

```powershell
cd <your-local-path>\clearread-ocr
git status --short
git log --format=fuller -1
node --check .\mcp-server.js
node .\mcp-server.js --self-test
claude plugin validate .
```

Expected result:

- `git status --short` is empty.
- Latest commit author is generic, not personal.
- Node syntax check passes.
- Self-test shows `clearread_ocr@0.2.1`.
- Claude plugin validation passes.

## Privacy Notes

The repository should not include:

- personal usernames or email addresses
- local machine paths
- API keys or tokens
- default private vision model/provider names

Vision fallback is intentionally self-configured through:

```text
VISION_API_KEY
VISION_API_URL or VISION_BASE_URL
VISION_MODEL
```

No remote vision provider is enabled by default.
