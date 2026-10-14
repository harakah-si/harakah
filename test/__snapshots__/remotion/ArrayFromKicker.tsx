import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { splitArabic } from "./harakah-arabic"; // harakah: joining-aware Arabic helpers
import { loadFont as loadArabicFont } from "@remotion/google-fonts/IBMPlexSansArabic"; // harakah: Arabic fallback font
loadArabicFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["arabic"] });

export const ArrayFromKicker: React.FC = () => {
  const frame = useCurrentFrame();
  const title = "الموسم الجديد";
  const spacing = interpolate(frame, [0, 60], [24, 6], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill dir="rtl" lang="ar" /* harakah: Arabic is RTL */ style={{ backgroundColor: "#f5f3ee", justifyContent: "center", alignItems: "center", gap: 24 }}>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 28, color: "#e8461f", letterSpacing: 0 /* harakah: letterSpacing removed for Arabic (was spacing) */, textTransform: "none" /* harakah: no case in Arabic */ }}>
        حصرياً على المنصة
      </div>
      <h1 style={{ margin: 0, fontFamily: "Montserrat, 'IBM Plex Sans Arabic', sans-serif" /* harakah: Arabic fallback */, fontSize: 120, fontWeight: 800, color: "#16171b", letterSpacing: 0 /* harakah: letterSpacing removed for Arabic (was 4) */ }}>
        {/* harakah: was Array.from(title) */ splitArabic(title).map((c, i) => (
          <span key={i} style={{ display: "inline-block", opacity: interpolate(frame - i * 3, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {c === " " ? "\u00A0" : c}
          </span>
        ))}
      </h1>
    </AbsoluteFill>
  );
};
