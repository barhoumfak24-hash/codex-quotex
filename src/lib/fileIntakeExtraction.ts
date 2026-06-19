const MAX_TEXT_CHARS = 24_000;
const MAX_DATA_URL_BYTES = 8_000_000;

export interface AiFileExtractionPayload {
  text?: string;
  dataUrl?: string;
  sources: string[];
}

function isTextLike(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    /\.(txt|csv|json|xml|html?|md|eml)$/i.test(name)
  );
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isOfficeLike(file: File): boolean {
  return /\.(docx?|rtf)$/i.test(file.name) || /word|rtf/i.test(file.type);
}

function isVisionReadable(file: File): boolean {
  return file.type.startsWith("image/") || isPdf(file);
}

function compactText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function printableTextFromBinary(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  let run = "";
  for (const byte of bytes) {
    const char = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " ";
    if (char === " ") {
      if (run.length >= 4) out += `${run}\n`;
      run = "";
    } else {
      run += char;
    }
    if (out.length >= MAX_TEXT_CHARS * 1.5) break;
  }
  if (run.length >= 4) out += `${run}\n`;
  return compactText(out);
}

function literalPdfText(buffer: ArrayBuffer): string {
  const raw = new TextDecoder("latin1").decode(buffer);
  const chunks: string[] = [];
  const literalPattern = /\((?:\\.|[^\\)]){2,}\)/g;
  for (const match of raw.matchAll(literalPattern)) {
    const value = match[0]
      .slice(1, -1)
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, " ");
    if (/[A-Za-z]{2,}/.test(value)) chunks.push(value);
    if (chunks.join("\n").length > MAX_TEXT_CHARS) break;
  }
  return compactText(chunks.join("\n") || printableTextFromBinary(buffer));
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export async function readAiFileForExtraction(file: File): Promise<AiFileExtractionPayload> {
  const sources: string[] = [];
  let text = "";

  if (isTextLike(file)) {
    text = compactText(await file.text());
    if (text) sources.push("Readable file text");
  } else if (isPdf(file)) {
    text = literalPdfText(await file.arrayBuffer());
    if (text) sources.push("PDF embedded text scan");
  } else if (isOfficeLike(file)) {
    text = printableTextFromBinary(await file.arrayBuffer());
    if (text) sources.push("Document binary text scan");
  }

  let dataUrl: string | undefined;
  if (isVisionReadable(file)) {
    if (file.size <= MAX_DATA_URL_BYTES) {
      dataUrl = await readAsDataUrl(file);
      sources.push(file.type.startsWith("image/") ? "Vision screenshot/image scan" : "Vision PDF scan");
    } else {
      sources.push("File too large for inline vision scan");
    }
  }

  return {
    text: text || undefined,
    dataUrl,
    sources,
  };
}
