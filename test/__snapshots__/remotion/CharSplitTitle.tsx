// Typical AI-generated "kinetic title": per-character spring stagger.
import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/IBMPlexSansArabic"; // harakah: was Inter (no Arabic glyphs)
import { splitArabic } from "./harakah-arabic"; // harakah: joining-aware Arabic helpers

const { fontFamily } = loadFont("normal", { weights: ["700"], subsets: ["arabic", "latin"] });

export const CharSplitTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = "السلام عليكم";
  return (
    <AbsoluteFill dir="rtl" lang="ar" /* harakah: Arabic is RTL */ style={{ backgroundColor: "#0e0f12", justifyContent: "center", alignItems: "center" }}>
      <div style={{ display: "flex", fontFamily, fontSize: 104, fontWeight: 800, color: "#f3efe7" }}>
        {/* harakah: was text.split("") */ splitArabic(text).map((char, i) => {
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
