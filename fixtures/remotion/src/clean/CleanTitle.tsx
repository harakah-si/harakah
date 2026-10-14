// Already-correct Arabic composition: the codemod must not change anything here.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/IBMPlexSansArabic";

const { fontFamily } = loadFont("normal", { weights: ["700"], subsets: ["arabic", "latin"] });

export const CleanTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const words = "حكايات من الخليج والشام".split(" ");
  return (
    <AbsoluteFill dir="rtl" lang="ar" style={{ backgroundColor: "#0e0f12", justifyContent: "center", alignItems: "center", fontFamily }}>
      <h1 style={{ margin: 0, fontSize: 96, color: "#f3efe7", lineHeight: 1.4 }}>
        {words.map((w, i) => (
          <span key={i} style={{ display: "inline-block", marginInlineEnd: "0.25em", opacity: interpolate(frame - i * 6, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {w}
          </span>
        ))}
      </h1>
      <p style={{ fontSize: 36, color: "#9a9ca6" }}>
        الحلقة ١٢ على <bdi>Spotify</bdi>
      </p>
    </AbsoluteFill>
  );
};
