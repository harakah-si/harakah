import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";
import { arabicHeadline } from "../styles";
import { letters } from "../utils/letters";

export const ArabicTitle: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: theme.colors.bg, justifyContent: "center", alignItems: "center", gap: 24 }}>
      <h1 style={theme.title}>
        {letters("مرحبا بالعالم").map((c, i) => (
          <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: interpolate(frame - i * 2, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {c}
          </span>
        ))}
      </h1>
      <p style={{ ...theme.caption, margin: 0 }}>حلقة جديدة كل أسبوع</p>
      <h2 style={arabicHeadline}>من دمشق</h2>
    </AbsoluteFill>
  );
};
