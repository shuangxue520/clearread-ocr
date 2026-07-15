# Changelog

## 0.3.0

- Add bounded automatic OCR for scanned and image-only PDFs.
- Add bounded OCR for supported images embedded in DOCX, XLSX, and PPTX.
- Add Poppler rendering with a PyMuPDF fallback.
- Discover WinGet Poppler installations on Windows when Claude Code uses a
  fixed `PATH`.
- Keep remote vision explicitly opt-in through `VISION_*` configuration.
- Add a Claude Code marketplace manifest for direct installation.

## 0.2.2

- Add UTF-16 and GB18030/GBK-style text decoding.
- Improve Office/OpenDocument extraction and error diagnostics.
