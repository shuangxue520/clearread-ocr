# Privacy

Clearread runs locally by default and does not collect telemetry.

- Artifact inventory and extraction are restricted to the active Claude project.
- Tesseract, Poppler, Python PDF fallbacks, and Office parsing run locally.
- Remote vision is disabled unless the user explicitly configures
  `VISION_API_KEY`, `VISION_MODEL`, and `VISION_API_URL` or `VISION_BASE_URL`.
- API keys are read from the process environment and are never stored or
  returned in MCP output.
- Temporary PDF pages and embedded Office images are created below the operating
  system temporary directory and removed after extraction.

Do not enable remote vision for private images unless you trust the configured
provider and its data-handling policy.
