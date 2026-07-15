# Contributing

Focused fixes and format improvements are welcome.

Before opening a pull request:

```powershell
node --check .\mcp-server.js
node .\mcp-server.js --self-test
claude plugin validate .
```

Keep the three-tool interface compact. New extraction behavior should remain
bounded, project-root restricted, local-first, and covered by the built-in
self-test. Never commit API keys, private documents, personal paths, or generated
OCR output.
