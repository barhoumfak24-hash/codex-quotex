import type { User } from "@/types";

export const ELECTRONIC_SIGNATURE_FONTS = [
  { label: "Classic script", value: '"Brush Script MT", "Segoe Script", cursive' },
  { label: "Formal script", value: '"Lucida Handwriting", "Segoe Script", cursive' },
  { label: "Modern script", value: '"Segoe Script", "Brush Script MT", cursive' },
  { label: "Editorial serif", value: "Georgia, serif" },
];

export const DEFAULT_ELECTRONIC_SIGNATURE_FONT =
  ELECTRONIC_SIGNATURE_FONTS[0].value;

export function electronicSignaturePreviewStyle(
  signature?: User["electronicSignature"]
) {
  return {
    fontFamily: signature?.fontFamily ?? DEFAULT_ELECTRONIC_SIGNATURE_FONT,
    fontSize: `${signature?.fontSize ?? 34}px`,
    lineHeight: 1.05,
  };
}

export function electronicSignatureMarker(user: User): string | null {
  const signature = user.electronicSignature;
  if (!signature?.name?.trim()) return null;
  const font =
    ELECTRONIC_SIGNATURE_FONTS.find((f) => f.value === signature.fontFamily)
      ?.label ?? "Custom script";
  return `[Electronic signature: ${signature.name.trim()} | ${font} | ${signature.fontSize}px]`;
}
