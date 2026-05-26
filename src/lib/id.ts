export function uid(prefix = "id"): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}