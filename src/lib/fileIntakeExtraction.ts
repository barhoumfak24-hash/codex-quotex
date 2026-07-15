const MAX_TEXT_CHARS = 70_000;
const TEXT_SAMPLE_CHUNKS = 8;
const MAX_BINARY_SCAN_BYTES = 2_000_000;
const MAX_DATA_URL_CHARS = 7_500_000;
const MAX_INLINE_FILE_BYTES = Math.floor((MAX_DATA_URL_CHARS - 256) * 0.75);
const MAX_IMAGE_DIMENSION = 2_400;
const MAX_IMAGE_PIXELS = 5_000_000;

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

function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

function isVisionReadable(file: File): boolean {
  return isImage(file) || isPdf(file);
}

function normalizedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactText(value: string): { text: string; truncated: boolean } {
  const compacted = normalizedText(value);
  if (compacted.length <= MAX_TEXT_CHARS) return { text: compacted, truncated: false };

  const chunkCount = Math.min(TEXT_SAMPLE_CHUNKS, Math.max(2, Math.ceil(compacted.length / 10_000)));
  const chunkBudget = Math.floor((MAX_TEXT_CHARS - 1_200) / chunkCount);
  const excerpts: string[] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const segmentStart = Math.floor((compacted.length * index) / chunkCount);
    const segmentEnd = Math.floor((compacted.length * (index + 1)) / chunkCount);
    const segmentLength = segmentEnd - segmentStart;
    const start =
      segmentLength <= chunkBudget
        ? segmentStart
        : index === 0
          ? segmentStart
          : index === chunkCount - 1
            ? segmentEnd - chunkBudget
            : segmentStart + Math.floor((segmentLength - chunkBudget) / 2);
    const end = Math.min(segmentEnd, start + chunkBudget);
    excerpts.push(
      `[Document excerpt ${index + 1}/${chunkCount}; source characters ${start + 1}-${end}]\n${compacted.slice(start, end)}`
    );
  }

  return { text: excerpts.join("\n\n").slice(0, MAX_TEXT_CHARS), truncated: true };
}

function sampledByteRanges(length: number): { ranges: Array<{ start: number; end: number }>; sampled: boolean } {
  if (length <= MAX_BINARY_SCAN_BYTES) {
    return { ranges: [{ start: 0, end: length }], sampled: false };
  }
  const rangeSize = Math.floor(MAX_BINARY_SCAN_BYTES / TEXT_SAMPLE_CHUNKS);
  const ranges = Array.from({ length: TEXT_SAMPLE_CHUNKS }, (_, index) => {
    const segmentStart = Math.floor((length * index) / TEXT_SAMPLE_CHUNKS);
    const segmentEnd = Math.floor((length * (index + 1)) / TEXT_SAMPLE_CHUNKS);
    const start =
      index === 0
        ? segmentStart
        : index === TEXT_SAMPLE_CHUNKS - 1
          ? Math.max(segmentStart, segmentEnd - rangeSize)
          : segmentStart + Math.max(0, Math.floor((segmentEnd - segmentStart - rangeSize) / 2));
    return { start, end: Math.min(segmentEnd, start + rangeSize) };
  });
  return { ranges, sampled: true };
}

function printableTextFromBinary(buffer: ArrayBuffer): { text: string; truncated: boolean } {
  const bytes = new Uint8Array(buffer);
  const { ranges, sampled } = sampledByteRanges(bytes.length);
  const excerpts: string[] = [];
  const perRangeLimit = Math.ceil((MAX_TEXT_CHARS * 1.5) / ranges.length);

  ranges.forEach(({ start, end }, rangeIndex) => {
    let out = "";
    let run = "";
    for (let index = start; index < end; index += 1) {
      const byte = bytes[index];
      const char = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " ";
      if (char === " ") {
        if (run.length >= 4) out += `${run}\n`;
        run = "";
      } else {
        run += char;
      }
      if (out.length >= perRangeLimit) break;
    }
    if (run.length >= 4 && out.length < perRangeLimit) out += `${run}\n`;
    if (out) excerpts.push(`[Binary excerpt ${rangeIndex + 1}/${ranges.length}]\n${out}`);
  });

  const compacted = compactText(excerpts.join("\n\n"));
  return { text: compacted.text, truncated: sampled || compacted.truncated };
}

function literalPdfText(buffer: ArrayBuffer): { text: string; truncated: boolean } {
  const bytes = new Uint8Array(buffer);
  const { ranges, sampled } = sampledByteRanges(bytes.length);
  const decoder = new TextDecoder("latin1");
  const excerpts: string[] = [];
  const perRangeLimit = Math.ceil((MAX_TEXT_CHARS * 1.5) / ranges.length);

  ranges.forEach(({ start, end }, rangeIndex) => {
    const raw = decoder.decode(bytes.subarray(start, end));
    const chunks: string[] = [];
    let extractedChars = 0;
    const literalPattern = /\((?:\\.|[^\\)]){2,}\)/g;
    for (const match of raw.matchAll(literalPattern)) {
      const value = match[0]
        .slice(1, -1)
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, " ");
      if (/[A-Za-z]{2,}/.test(value)) {
        chunks.push(value);
        extractedChars += value.length + 1;
      }
      if (extractedChars >= perRangeLimit) break;
    }
    if (chunks.length > 0) excerpts.push(`[PDF excerpt ${rangeIndex + 1}/${ranges.length}]\n${chunks.join("\n")}`);
  });

  if (excerpts.length === 0) return printableTextFromBinary(buffer);
  const compacted = compactText(excerpts.join("\n\n"));
  return { text: compacted.text, truncated: sampled || compacted.truncated };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function downscaledImageDataUrl(file: File): Promise<string | undefined> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) return undefined;
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
      Math.sqrt(MAX_IMAGE_PIXELS / (bitmap.width * bitmap.height)),
      Math.sqrt(MAX_INLINE_FILE_BYTES / Math.max(file.size, 1))
    );
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    const qualitySteps = [0.86, 0.72, 0.58];

    for (const quality of qualitySteps) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= MAX_INLINE_FILE_BYTES) {
        const dataUrl = await readAsDataUrl(blob);
        if (dataUrl.length <= MAX_DATA_URL_CHARS) return dataUrl;
      }
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
    }
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
  return undefined;
}

export async function readAiFileForExtraction(file: File): Promise<AiFileExtractionPayload> {
  const sources: string[] = [];
  let text = "";
  let sampled = false;

  if (isTextLike(file)) {
    const result = compactText(await file.text());
    text = result.text;
    sampled = result.truncated;
    if (text) sources.push("Readable file text");
  } else if (isPdf(file)) {
    const result = literalPdfText(await file.arrayBuffer());
    text = result.text;
    sampled = result.truncated;
    if (text) sources.push("PDF embedded text scan");
  } else if (isOfficeLike(file)) {
    const result = printableTextFromBinary(await file.arrayBuffer());
    text = result.text;
    sampled = result.truncated;
    if (text) sources.push("Document binary text scan");
  }
  if (sampled) sources.push("Long document sampled in bounded excerpts across the full file");

  let dataUrl: string | undefined;
  if (isVisionReadable(file)) {
    if (file.size <= MAX_INLINE_FILE_BYTES) {
      const inline = await readAsDataUrl(file);
      if (inline.length <= MAX_DATA_URL_CHARS) dataUrl = inline;
    }
    if (!dataUrl && isImage(file)) {
      dataUrl = await downscaledImageDataUrl(file);
      sources.push(
        dataUrl
          ? "Downscaled image vision scan"
          : "Large image could not be downscaled within the safe AI request limit"
      );
    } else if (!dataUrl && isPdf(file)) {
      sources.push("Large PDF vision scan omitted; bounded embedded-text excerpts were retained when available");
    }
    if (dataUrl && !sources.includes("Downscaled image vision scan")) {
      sources.push(isImage(file) ? "Vision screenshot/image scan" : "Vision PDF scan");
    }
  }

  return {
    text: text || undefined,
    dataUrl,
    sources,
  };
}
