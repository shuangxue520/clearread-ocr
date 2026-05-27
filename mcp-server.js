#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const SERVER_NAME = "clearread_ocr";
const SERVER_VERSION = "0.2.2";
const ROOT = path.resolve(process.env.CLEARREAD_OCR_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".html", ".htm",
  ".log", ".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue",
  ".svelte", ".css", ".scss", ".less", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go",
  ".rs", ".php", ".rb", ".swift", ".kt", ".kts", ".dart", ".scala", ".r", ".lua", ".pl",
  ".pm", ".ex", ".exs", ".erl", ".hrl", ".clj", ".cljs", ".fs", ".fsx", ".vb", ".sql",
  ".yaml", ".yml", ".toml", ".ini", ".env", ".ps1", ".bat", ".cmd", ".sh", ".gradle"
]);
const TEXT_FILENAMES = new Set(["dockerfile", "makefile", "cmakelists.txt", "requirements.txt", "license", "notice", "copying"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const OFFICE_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);
const OPEN_DOCUMENT_EXTENSIONS = new Set([".odt", ".ods", ".odp"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target"]);

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function ok(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolResult(id, text, isError = false) {
  ok(id, { content: [{ type: "text", text }], isError });
}

function intArg(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function insideRoot(input = ".") {
  const resolved = path.resolve(ROOT, String(input));
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path '${input}' resolves outside project root '${ROOT}'. Only files within the current Claude project can be read.`);
  }
  return resolved;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/") || ".";
}

function limitText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXml(xml) {
  return decodeXml(xml
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function xmlAttr(tag, name) {
  const re = new RegExp(`${name}="([^"]*)"`);
  const match = tag.match(re);
  return match ? decodeXml(match[1]) : "";
}

function readZip(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length > MAX_FILE_BYTES) throw new Error("file too large for local extraction");

  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 66000); i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip end-of-central-directory not found");

  const totalEntries = data.readUInt16LE(eocd + 10);
  const centralOffset = data.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid zip central directory");
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.slice(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (data.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.slice(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else continue;
    entries.set(name, content);
  }
  return entries;
}

function wordXmlToText(xml) {
  return stripXml(xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n"));
}

function extractDocx(filePath) {
  const zip = readZip(filePath);
  const parts = [];
  const names = [
    "word/document.xml",
    ...Array.from(zip.keys()).filter((name) => /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(name))
  ];
  for (const name of names) {
    if (!zip.has(name)) continue;
    const text = wordXmlToText(zip.get(name).toString("utf8"));
    if (text) parts.push(`## ${name}\n${text}`);
  }
  return parts.length ? parts.join("\n\n") : "(no text found in docx)";
}

function parseSharedStrings(zip) {
  const file = zip.get("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = file.toString("utf8");
  const strings = [];
  const re = /<si[\s\S]*?<\/si>/g;
  let match;
  while ((match = re.exec(xml))) {
    strings.push(stripXml(match[0].replace(/<\/t>/g, "")));
  }
  return strings;
}

function parseWorkbook(zip) {
  const workbook = zip.get("xl/workbook.xml");
  const rels = zip.get("xl/_rels/workbook.xml.rels");
  const relMap = new Map();
  if (rels) {
    const relXml = rels.toString("utf8");
    const relRe = /<Relationship\b[^>]*>/g;
    let relMatch;
    while ((relMatch = relRe.exec(relXml))) {
      const tag = relMatch[0];
      const id = xmlAttr(tag, "Id");
      let target = xmlAttr(tag, "Target");
      if (target && !target.startsWith("xl/")) target = `xl/${target.replace(/^\/?/, "")}`;
      if (id) relMap.set(id, target);
    }
  }

  if (!workbook) return [];
  const xml = workbook.toString("utf8");
  const sheetRe = /<sheet\b[^>]*>/g;
  const sheets = [];
  let match;
  while ((match = sheetRe.exec(xml))) {
    const tag = match[0];
    const name = xmlAttr(tag, "name") || `sheet${sheets.length + 1}`;
    const rid = xmlAttr(tag, "r:id");
    const sheetId = xmlAttr(tag, "sheetId");
    const target = relMap.get(rid) || `xl/worksheets/sheet${sheetId || sheets.length + 1}.xml`;
    sheets.push({ name, target });
  }
  return sheets;
}

function cellColumn(ref) {
  const match = String(ref || "").match(/[A-Z]+/);
  if (!match) return 0;
  let total = 0;
  for (const ch of match[0]) total = total * 26 + ch.charCodeAt(0) - 64;
  return total - 1;
}

function extractCellText(cellXml, sharedStrings) {
  const tag = cellXml.match(/<c\b[^>]*>/);
  const type = tag ? xmlAttr(tag[0], "t") : "";
  if (type === "inlineStr") {
    const inline = cellXml.match(/<is[\s\S]*?<\/is>/);
    return inline ? stripXml(inline[0]) : "";
  }
  const valueMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
  if (!valueMatch) return "";
  const value = decodeXml(valueMatch[1]);
  if (type === "s") return sharedStrings[Number.parseInt(value, 10)] || "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value;
}

function extractXlsx(filePath, maxRowsPerSheet = 30) {
  const zip = readZip(filePath);
  const sharedStrings = parseSharedStrings(zip);
  let sheets = parseWorkbook(zip);
  if (!sheets.length) {
    sheets = Array.from(zip.keys())
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .map((target, index) => ({ name: `sheet${index + 1}`, target }));
  }

  const output = [];
  for (const sheet of sheets) {
    const file = zip.get(sheet.target);
    if (!file) continue;
    const xml = file.toString("utf8");
    const rows = [];
    const rowRe = /<row\b[^>]*>[\s\S]*?<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(xml)) && rows.length < maxRowsPerSheet) {
      const rowXml = rowMatch[0];
      const cells = [];
      const cellRe = /<c\b[^>]*>[\s\S]*?<\/c>/g;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowXml))) {
        const cellXml = cellMatch[0];
        const tag = cellXml.match(/<c\b[^>]*>/);
        const ref = tag ? xmlAttr(tag[0], "r") : "";
        cells[cellColumn(ref)] = extractCellText(cellXml, sharedStrings);
      }
      rows.push(cells.map((value) => value || "").join("\t").replace(/\t+$/g, ""));
    }
    output.push(`## ${sheet.name}\n${rows.length ? rows.join("\n") : "(empty or unsupported sheet)"}`);
  }
  return output.length ? output.join("\n\n") : "(no readable sheets found in xlsx)";
}

function extractPptx(filePath) {
  const zip = readZip(filePath);
  const slideNames = Array.from(zip.keys())
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
  const slides = [];
  for (const name of slideNames) {
    const xml = zip.get(name).toString("utf8");
    const texts = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = re.exec(xml))) texts.push(decodeXml(match[1]));
    slides.push(`## ${name}\n${texts.join("\n").trim() || "(no text found)"}`);
  }
  return slides.length ? slides.join("\n\n") : "(no slides found in pptx)";
}

function extractOpenDocument(filePath) {
  const zip = readZip(filePath);
  const content = zip.get("content.xml");
  if (!content) return "(no content.xml found in OpenDocument file)";
  const xml = content.toString("utf8")
    .replace(/<text:tab[^>]*\/>/g, "\t")
    .replace(/<\/text:p>/g, "\n")
    .replace(/<\/text:h>/g, "\n")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<\/table:table-cell>/g, "\t");
  const text = stripXml(xml).replace(/\t+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text || "(no readable text found in OpenDocument file)";
}

function extractRtf(filePath, maxChars) {
  const raw = fs.readFileSync(filePath, "utf8");
  const text = raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return limitText(text || "(no readable text found in rtf)", maxChars);
}

function run(command, args, timeout = 15000) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    windowsHide: true
  });
  if (result.error) return { ok: false, output: result.error.message };
  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    status: result.status
  };
}

function extractPdf(filePath) {
  const pdftotext = run("pdftotext", [filePath, "-"], 20000);
  if (pdftotext.ok && pdftotext.output) return `PDF text via pdftotext:\n${pdftotext.output}`;

  const pyCode = [
    "import sys",
    "path=sys.argv[1]",
    "reader=None",
    "try:",
    "    from pypdf import PdfReader",
    "    reader=PdfReader(path)",
    "except Exception:",
    "    try:",
    "        from PyPDF2 import PdfReader",
    "        reader=PdfReader(path)",
    "    except Exception as e:",
    "        print('NO_PDF_LIBRARY:'+str(e))",
    "        sys.exit(2)",
    "for i,p in enumerate(reader.pages):",
    "    text=p.extract_text() or ''",
    "    print(f'## page {i+1}')",
    "    print(text)"
  ].join("\n");

  const candidates = [
    ...(process.env.PYTHON ? [[process.env.PYTHON, ["-c", pyCode, filePath]]] : []),
    ["python", ["-c", pyCode, filePath]],
    ["python3", ["-c", pyCode, filePath]],
    ["py", ["-3", "-c", pyCode, filePath]]
  ];
  const errors = [];
  for (const [cmd, args] of candidates) {
    const result = run(cmd, args, 20000);
    if (result.ok && result.output) return `PDF text via ${cmd}:\n${result.output}`;
    if (result.status === 2 && result.output.includes("NO_PDF_LIBRARY:")) {
      errors.push(`${cmd}: ${result.output}`);
      break;
    }
    if (result.output) errors.push(`${cmd}: ${result.output}`);
  }

  const stat = fs.statSync(filePath);
  return [
    "PDF text extraction unavailable.",
    `File: ${rel(filePath)}`,
    `Size: ${stat.size} bytes`,
    "Install pdftotext, pypdf, or PyPDF2 for text extraction.",
    "If this is a scanned or image-only PDF, export the relevant pages as images and read them with OCR or a configured vision model.",
    errors.length ? `Tried: ${errors.join(" | ")}` : ""
  ].join("\n");
}

function completionUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/\/chat\/completions\/?$/i.test(url)) return url;
  return `${url.replace(/\/+$/g, "")}/chat/completions`;
}

function visionProviderConfigs() {
  const configs = [];
  const genericUrl = process.env.VISION_API_URL || completionUrl(process.env.VISION_BASE_URL);
  if (genericUrl && process.env.VISION_MODEL && process.env.VISION_API_KEY) {
    configs.push({
      label: process.env.VISION_LABEL || process.env.VISION_MODEL || "configured vision model",
      url: genericUrl,
      model: process.env.VISION_MODEL,
      key: process.env.VISION_API_KEY
    });
  }

  return configs;
}

function callVisionProvider(config, filePath, timeout) {
  const prompt = process.env.VISION_PROMPT || [
    "Describe this image in detail.",
    "If it contains text, transcribe it as faithfully as possible.",
    "If it contains a chart, table, UI, form, screenshot, or diagram, describe the structure and important values."
  ].join(" ");
  const maxTokens = String(intArg(process.env.VISION_MAX_TOKENS, 2048, 256, 8192));

  const script = `
    const fs = require("fs");
    const filePath = process.argv[1];
    const ext = process.argv[2];
    const apiUrl = process.argv[3];
    const model = process.argv[4];
    const prompt = process.argv[5];
    const maxTokens = Number.parseInt(process.argv[6], 10) || 2048;
    const mime = ext === "jpg" ? "jpeg" : ext;
    const b64 = fs.readFileSync(filePath).toString("base64");
    let extraHeaders = {};
    if (process.env.VISION_EXTRA_HEADERS) {
      try { extraHeaders = JSON.parse(process.env.VISION_EXTRA_HEADERS); }
      catch (error) {
        process.stderr.write("VISION_EXTRA_HEADERS must be valid JSON");
        process.exit(2);
      }
    }
    const body = {
      model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/" + mime + ";base64," + b64 } },
          { type: "text", text: prompt }
        ]
      }],
      max_tokens: maxTokens
    };
    fetch(apiUrl, {
      method: "POST",
      headers: {
        ...extraHeaders,
        "Authorization": "Bearer " + process.env.VISION_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }).then(async (response) => {
      const raw = await response.text();
      if (!response.ok) {
        process.stderr.write("HTTP " + response.status + ": " + raw.slice(0, 1200));
        process.exit(2);
      }
      let data;
      try { data = JSON.parse(raw); }
      catch (error) {
        process.stderr.write("Vision response was not JSON: " + raw.slice(0, 1200));
        process.exit(2);
      }
      let content = "";
      const choice = data.choices && data.choices[0];
      if (choice && choice.message) content = choice.message.content || "";
      if (!content && data.output_text) content = data.output_text;
      if (Array.isArray(content)) {
        content = content.map((part) => {
          if (typeof part === "string") return part;
          return part.text || part.content || JSON.stringify(part);
        }).join("\\n");
      }
      if (content && typeof content !== "string") content = JSON.stringify(content);
      if (!content && data.error) {
        process.stderr.write(JSON.stringify(data.error));
        process.exit(2);
      }
      process.stdout.write(String(content || "").trim());
    }).catch((error) => {
      process.stderr.write(error.message);
      process.exit(2);
    });
  `;

  const result = spawnSync("node", [
    "-e",
    script,
    filePath,
    path.extname(filePath).slice(1).toLowerCase(),
    config.url,
    config.model,
    prompt,
    maxTokens
  ], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    env: { ...process.env, VISION_KEY: config.key }
  });

  if (result.error) return { ok: false, output: result.error.message };
  if (result.status !== 0) return { ok: false, output: result.stderr || `${config.label} call failed` };
  return { ok: true, output: result.stdout.trim() };
}

function callConfiguredVision(filePath) {
  const configs = visionProviderConfigs();
  if (!configs.length) return { ok: false, skipped: true, output: "no vision provider configured" };

  const timeout = intArg(process.env.VISION_TIMEOUT_MS, 30000, 5000, 180000);
  const errors = [];
  for (const config of configs) {
    const result = callVisionProvider(config, filePath, timeout);
    if (result.ok && result.output) return { ok: true, label: config.label, output: result.output };
    errors.push(`${config.label}: ${result.output || "empty response"}`);
  }
  return { ok: false, skipped: false, output: errors.join("\n") };
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return { width: null, height: null };
  }
  const signature = buffer.toString("ascii", 12, 16);
  if (signature === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (signature === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  if (signature === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    };
  }
  return { width: null, height: null };
}

function imageMetadata(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  let width = null;
  let height = null;
  let format = ext.slice(1).toUpperCase();

  if (ext === ".png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
    format = "PNG";
  } else if ((ext === ".jpg" || ext === ".jpeg") && buffer.length > 4) {
    format = "JPEG";
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        height = buffer.readUInt16BE(offset + 5);
        width = buffer.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + length;
    }
  } else if (ext === ".gif" && buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    width = buffer.readUInt16LE(6);
    height = buffer.readUInt16LE(8);
    format = "GIF";
  } else if (ext === ".webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF") {
    format = "WEBP";
    const dimensions = webpDimensions(buffer);
    width = dimensions.width;
    height = dimensions.height;
  }

  const parts = [
    `Image metadata: ${rel(filePath)}`,
    `Format: ${format || "unknown"}`,
    `Size: ${stat.size} bytes`,
    `Dimensions: ${width && height ? `${width}x${height}` : "unknown"}`,
  ];

  const tesseractExe = process.env.TESSERACT_PATH || "tesseract";
  const tesseractLang = process.env.TESSERACT_LANG || "eng";
  const tesseract = run(tesseractExe, [filePath, "stdout", "-l", tesseractLang], 60000);
  if (tesseract.ok && tesseract.output.trim()) {
    parts.push("", `--- OCR text (tesseract ${tesseractLang}) ---`, tesseract.output.trim());
  } else {
    parts.push("", `OCR: ${tesseract.ok ? "no text found" : tesseract.output || "tesseract unavailable"}`);
  }

  const vision = callConfiguredVision(filePath);
  if (vision.ok && vision.output) {
    parts.push("", `--- Vision (${vision.label}) ---`, vision.output);
  } else if (!vision.skipped && process.env.VISION_REPORT_ERRORS !== "0") {
    parts.push("", "--- Vision unavailable ---", vision.output);
  }

  return parts.join("\n");
}

function detectKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (OFFICE_EXTENSIONS.has(ext)) return ext.slice(1);
  if (OPEN_DOCUMENT_EXTENSIONS.has(ext)) return ext.slice(1);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (ext === ".rtf") return "rtf";
  if (TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(base)) return "text";
  return "other";
}

function scanFiles(startPath, maxFiles) {
  const start = insideRoot(startPath || ".");
  const files = [];
  function walk(current) {
    if (files.length >= maxFiles) return;
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      files.push(current);
      return;
    }
    if (!stat.isDirectory()) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(current, entry.name));
    }
  }
  walk(start);
  return files;
}

function artifactInventory(args = {}) {
  const maxFiles = intArg(args.maxFiles, 200, 1, 1000);
  const files = scanFiles(args.path || ".", maxFiles);
  const rows = files.map((file) => {
    const stat = fs.statSync(file);
    return `${detectKind(file).padEnd(6)} ${String(stat.size).padStart(9)} ${rel(file)}`;
  });
  return [
    `Root: ${ROOT}`,
    `Target: ${args.path || "."}`,
    `Files shown: ${files.length}`,
    "",
    "kind      bytes path",
    ...rows
  ].join("\n");
}

function decodeUtf16Be(buffer, start = 0) {
  const length = buffer.length - start;
  const swapped = Buffer.allocUnsafe(length);
  for (let i = 0; i < length - 1; i += 2) {
    swapped[i] = buffer[start + i + 1];
    swapped[i + 1] = buffer[start + i];
  }
  if (length % 2) swapped[length - 1] = buffer[buffer.length - 1];
  return swapped.toString("utf16le");
}

function guessUtf16(buffer) {
  const sampleLength = Math.min(buffer.length, 2000);
  if (sampleLength < 8) return "";
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sampleLength; i += 1) {
    if (buffer[i] !== 0) continue;
    if (i % 2 === 0) evenZeros += 1;
    else oddZeros += 1;
  }
  const pairs = Math.floor(sampleLength / 2);
  if (oddZeros > pairs * 0.25 && evenZeros < pairs * 0.05) return "utf-16le";
  if (evenZeros > pairs * 0.25 && oddZeros < pairs * 0.05) return "utf-16be";
  return "";
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: decodeUtf16Be(buffer, 2), encoding: "utf-16be" };
  }

  const guessed = guessUtf16(buffer);
  if (guessed === "utf-16le") return { text: buffer.toString("utf16le"), encoding: "utf-16le" };
  if (guessed === "utf-16be") return { text: decodeUtf16Be(buffer), encoding: "utf-16be" };

  const utf8 = buffer.toString("utf8");
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount === 0) return { text: utf8, encoding: "utf-8" };

  if (typeof TextDecoder !== "undefined") {
    try {
      const decoded = new TextDecoder("gb18030", { fatal: true }).decode(buffer);
      return { text: decoded, encoding: "gb18030" };
    } catch {
      // Fall back to UTF-8 below so extraction still returns something useful.
    }
  }
  return { text: utf8, encoding: "utf-8-with-replacement" };
}

function readTextFile(filePath, maxChars) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new Error("text file is too large");
  const decoded = decodeTextBuffer(fs.readFileSync(filePath));
  const prefix = decoded.encoding === "utf-8" ? "" : `[decoded as ${decoded.encoding}]\n\n`;
  return limitText(prefix + decoded.text, maxChars);
}

function extractArtifactText(args = {}) {
  if (!args.path) throw new Error("path is required");
  const file = insideRoot(args.path);
  const maxChars = intArg(args.maxChars, 20000, 1000, 200000);
  const maxRowsPerSheet = intArg(args.maxRowsPerSheet, 30, 1, 200);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("path must be a file");

  const ext = path.extname(file).toLowerCase();
  let body;
  if (ext === ".docx") body = extractDocx(file);
  else if (ext === ".xlsx") body = extractXlsx(file, maxRowsPerSheet);
  else if (ext === ".pptx") body = extractPptx(file);
  else if (OPEN_DOCUMENT_EXTENSIONS.has(ext)) body = extractOpenDocument(file);
  else if (ext === ".pdf") body = extractPdf(file);
  else if (ext === ".rtf") body = extractRtf(file, maxChars);
  else if (IMAGE_EXTENSIONS.has(ext)) body = imageMetadata(file);
  else if (TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(path.basename(file).toLowerCase())) body = readTextFile(file, maxChars);
  else body = `Unsupported file type for extraction: ${ext || "(none)"}\nFile: ${rel(file)}\nSize: ${stat.size} bytes`;

  return [
    `File: ${rel(file)}`,
    `Kind: ${detectKind(file)}`,
    `Bytes: ${stat.size}`,
    "",
    limitText(body, maxChars)
  ].join("\n");
}

function makeContextBundle(args = {}) {
  const maxFiles = intArg(args.maxFiles, 20, 1, 80);
  const maxCharsPerFile = intArg(args.maxCharsPerFile, 8000, 1000, 50000);
  let files = [];
  if (Array.isArray(args.files) && args.files.length) {
    files = args.files.slice(0, maxFiles).map((file) => insideRoot(file));
  } else {
    files = scanFiles(args.path || ".", maxFiles)
      .filter((file) => {
        const kind = detectKind(file);
        return kind !== "other";
      })
      .slice(0, maxFiles);
  }

  const chunks = [];
  for (const file of files) {
    try {
      const text = extractArtifactText({ path: rel(file), maxChars: maxCharsPerFile });
      chunks.push(`===== ${rel(file)} =====\n${text}`);
    } catch (error) {
      chunks.push(`===== ${rel(file)} =====\nError: ${error.message}`);
    }
  }
  return chunks.join("\n\n");
}

const tools = [
  {
    name: "artifact_inventory",
    description: "List local artifacts under a file or folder with type classification and sizes.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file or folder path." },
        maxFiles: { type: "integer", minimum: 1, maximum: 1000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "extract_artifact_text",
    description: "Extract text or metadata from Office/OpenDocument/RTF/PDF, text/CSV/JSON/source files, or images.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path." },
        maxChars: { type: "integer", minimum: 1000, maximum: 200000 },
        maxRowsPerSheet: { type: "integer", minimum: 1, maximum: 200 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "make_context_bundle",
    description: "Build a combined text bundle from selected files or a folder for handoff to a text-only model.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative folder to scan when files is omitted." },
        files: { type: "array", items: { type: "string" }, description: "Explicit project-relative files to include." },
        maxFiles: { type: "integer", minimum: 1, maximum: 80 },
        maxCharsPerFile: { type: "integer", minimum: 1000, maximum: 50000 }
      },
      additionalProperties: false
    }
  }
];

function handleTool(name, args) {
  if (name === "artifact_inventory") return artifactInventory(args);
  if (name === "extract_artifact_text") return extractArtifactText(args);
  if (name === "make_context_bundle") return makeContextBundle(args);
  throw new Error(`Unknown tool: ${name}`);
}

function zipDateParts(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(0, date.getFullYear() - 1980);
  const dosDate = (year << 9) | (month << 5) | day;
  return { time, dosDate };
}

function makeStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, dosDate } = zipDateParts();

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + content.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function officeSelfTest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-intake-"));
  try {
    const docx = path.join(tempDir, "sample.docx");
    const xlsx = path.join(tempDir, "sample.xlsx");
    const pptx = path.join(tempDir, "sample.pptx");

    fs.writeFileSync(docx, makeStoredZip({
      "word/document.xml": '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>'
    }));
    fs.writeFileSync(xlsx, makeStoredZip({
      "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="Sheet One" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": '<sst><si><t>Name</t></si><si><t>Ada</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>'
    }));
    fs.writeFileSync(pptx, makeStoredZip({
      "ppt/slides/slide1.xml": '<p:sld xmlns:a="a"><a:t>Hello PPTX</a:t></p:sld>'
    }));

    return {
      docx: extractDocx(docx).includes("Hello DOCX"),
      xlsx: extractXlsx(xlsx, 10).includes("Ada"),
      pptx: extractPptx(pptx).includes("Hello PPTX")
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function textDecodingSelfTest() {
  const utf16le = decodeTextBuffer(Buffer.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]));
  const gb18030 = decodeTextBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
  return {
    utf16le: utf16le.text === "\u4e2d\u6587",
    gb18030: gb18030.text === "\u4e2d\u6587"
  };
}

function handle(message) {
  const id = message.id;
  try {
    if (message.method === "initialize") {
      ok(id, {
        protocolVersion: message.params && message.params.protocolVersion ? message.params.protocolVersion : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
      return;
    }
    if (message.method === "notifications/initialized") return;
    if (message.method === "tools/list") {
      ok(id, { tools });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params && message.params.name;
      const args = message.params && message.params.arguments ? message.params.arguments : {};
      toolResult(id, handleTool(name, args));
      return;
    }
    if (id !== undefined) fail(id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    if (id !== undefined) toolResult(id, `Error: ${error.message}`, true);
  }
}

function selfTest() {
  const report = {
    server: `${SERVER_NAME}@${SERVER_VERSION}`,
    root: ROOT,
    tools: tools.map((tool) => tool.name),
    officeExtraction: officeSelfTest(),
    textDecoding: textDecodingSelfTest(),
    inventoryPreview: artifactInventory({ path: ".", maxFiles: 10 }).split("\n").slice(0, 12)
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

function printVersion() {
  process.stdout.write(`${SERVER_NAME}@${SERVER_VERSION}\n`);
}

function printHelp() {
  process.stdout.write([
    `${SERVER_NAME}@${SERVER_VERSION}`,
    "",
    "Local artifact reader MCP server for Claude Code.",
    "",
    "Usage:",
    "  node mcp-server.js              Start MCP stdio server",
    "  node mcp-server.js --self-test  Run built-in extraction checks",
    "  node mcp-server.js --version    Print server version",
    "  node mcp-server.js --help       Show this help",
    "",
    "Environment:",
    "  CLEARREAD_OCR_ROOT   Root directory allowed for reads",
    "  TESSERACT_PATH       Optional path to tesseract executable",
    "  TESSERACT_LANG       OCR languages, for example chi_sim+eng",
    "  VISION_API_KEY       Optional OpenAI-compatible vision API key",
    "  VISION_API_URL       Optional full /chat/completions endpoint",
    "  VISION_BASE_URL      Optional base URL used to build /chat/completions",
    "  VISION_MODEL         Optional vision model name"
  ].join("\n") + "\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else if (process.argv.includes("--version") || process.argv.includes("-v")) {
  printVersion();
} else if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
} else {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          handle(JSON.parse(line));
        } catch (error) {
          fail(null, -32700, `Parse error: ${error.message}`);
        }
      }
      index = buffer.indexOf("\n");
    }
  });
}
