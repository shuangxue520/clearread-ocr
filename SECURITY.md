# Security

## Trust Boundary

Clearread reads files only within the active Claude project root. Path traversal
outside that root is rejected. The MCP server does not execute file contents.

Optional external programs such as Tesseract, Poppler, and Python run with the
current user's permissions. Install them only from sources you trust.

Remote vision receives image content only after explicit `VISION_*`
configuration. Keep API keys in the process environment or a secret manager.

## Reporting A Vulnerability

Open a GitHub issue with a minimal reproduction that contains no credentials,
private documents, personal paths, or private provider configuration. For a
report that cannot be safely public, contact the repository owner through
GitHub.
