import { useRef, useState } from "react";
import type React from "react";
import { Clipboard, FileUp, Upload } from "lucide-react";

function normalizeFile(file: File, index: number): File {
  if (file.name) return file;
  const ext = file.type.split("/")[1] || "png";
  return new File([file], `pasted-image-${Date.now()}-${index}.${ext}`, {
    type: file.type || "image/png",
  });
}

function filesFromClipboard(event: React.ClipboardEvent<HTMLElement>): File[] {
  const files: File[] = [];
  Array.from(event.clipboardData.files ?? []).forEach((file, index) => {
    files.push(normalizeFile(file, index));
  });
  Array.from(event.clipboardData.items ?? []).forEach((item, index) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return;
    const file = item.getAsFile();
    if (file && !files.some((f) => f.name === file.name && f.size === file.size)) {
      files.push(normalizeFile(file, files.length + index));
    }
  });
  return files;
}

export function FileDropZone({
  title,
  help,
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  busyLabel = "Reading file...",
  onFiles,
  compact = false,
  icon = "upload",
}: {
  title: string;
  help?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  onFiles: (files: File[]) => void;
  compact?: boolean;
  icon?: "upload" | "ai" | "attachment";
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState(false);
  const Icon = icon === "ai" ? Upload : icon === "attachment" ? FileUp : Upload;

  function receive(files: File[]) {
    const next = multiple ? files : files.slice(0, 1);
    if (next.length === 0 || disabled || busy) return;
    onFiles(next);
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`rounded-lg border-2 border-dashed text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${
        compact ? "px-4 py-3" : "px-5 py-6"
      } ${
        dragging
          ? "border-gold-400 bg-gold-50"
          : "border-ink-200 bg-white hover:border-gold-300 hover:bg-ink-50/50"
      } ${disabled || busy ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
      onClick={() => {
        if (!disabled && !busy) inputRef.current?.click();
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled && !busy) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled && !busy) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !busy) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        receive(Array.from(event.dataTransfer.files ?? []));
      }}
      onPaste={(event) => {
        const files = filesFromClipboard(event);
        if (files.length === 0) return;
        event.preventDefault();
        setPasted(true);
        window.setTimeout(() => setPasted(false), 1800);
        receive(files);
      }}
      aria-disabled={disabled || busy}
    >
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        accept={accept}
        disabled={disabled || busy}
        onChange={(event) => {
          receive(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      {busy ? (
        <div className="text-sm font-medium text-ink-700">{busyLabel}</div>
      ) : (
        <>
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-ink-800">
            <Icon className="h-4 w-4 text-gold-700" />
            {title}
          </div>
          {help && <div className="mt-1 text-xs text-ink-500">{help}</div>}
          <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-ink-400">
            <span>Click</span>
            <span>Drag files here</span>
            <span className="inline-flex items-center gap-1">
              <Clipboard className="h-3 w-3" />
              {pasted ? "Image pasted" : "Paste image"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
