import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const ArrayFromKicker: React.FC = () => {
  const frame = useCurrentFrame();
  const title = "الموسم الجديد";
  const spacing = interpolate(frame, [0, 60], [24, 6], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#f5f3ee", justifyContent: "center", alignItems: "center", gap: 24 }}>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 28, color: "#e8461f", letterSpacing: spacing, textTransform: "uppercase" }}>
        حصرياً على المنصة
      </div>
      <h1 style={{ margin: 0, fontFamily: "Montserrat, sans-serif", fontSize: 120, fontWeight: 800, color: "#16171b", letterSpacing: 4 }}>
        {Array.from(title).map((c, i) => (
          <span key={i} style={{ display: "inline-block", opacity: interpolate(frame - i * 3, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {c === " " ? "\u00A0" : c}
          </span>
        ))}
      </h1>
    </AbsoluteFill>
  );
};
