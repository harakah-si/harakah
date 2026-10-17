// Typical AI-generated "kinetic title": per-character spring stagger.
import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] });

export const CharSplitTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = "السلام عليكم";
  return (
    <AbsoluteFill style={{ backgroundColor: "#0e0f12", justifyContent: "center", alignItems: "center" }}>
      <div style={{ display: "flex", fontFamily, fontSize: 104, fontWeight: 800, color: "#f3efe7" }}>
        {text.split("").map((char, i) => {
          const s = spring({ frame: frame - i * 2, fps, config: { damping: 14 } });
          return (
            <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - s) * 60}px)`, opacity: s }}>
              {char === " " ? "\u00A0" : char}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
