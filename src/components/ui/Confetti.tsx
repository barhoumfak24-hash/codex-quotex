import { useEffect, useState } from "react";

// =====================================================================
// Lightweight, dependency-free confetti burst. Renders a fixed
// full-screen layer of falling colored pieces, then unmounts itself
// after `durationMs`. Mount it conditionally to celebrate a moment
// (a goal achieved). Remount (via a changing `key`) to replay.
// =====================================================================

const COLORS = ["#E63946", "#a98532", "#10B981", "#6366F1", "#F59E0B", "#EC4899"];

export function Confetti({
  count = 90,
  durationMs = 2800,
}: {
  count?: number;
  durationMs?: number;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), durationMs);
    return () => window.clearTimeout(t);
  }, [durationMs]);
  if (done) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes confetti-fall { to { transform: translateY(110vh) rotate(720deg); opacity: 0; } }`}</style>
      {Array.from({ length: count }, (_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.4;
        const dur = 1.8 + Math.random() * 1.1;
        const color = COLORS[i % COLORS.length];
        const w = 6 + Math.random() * 6;
        const rotate = Math.random() * 360;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              top: "-12px",
              left: `${left}%`,
              width: `${w}px`,
              height: `${w * 0.42}px`,
              background: color,
              borderRadius: "1px",
              transform: `rotate(${rotate}deg)`,
              animation: `confetti-fall ${dur}s ${delay}s ease-in forwards`,
              opacity: 0.92,
            }}
          />
        );
      })}
    </div>
  );
}