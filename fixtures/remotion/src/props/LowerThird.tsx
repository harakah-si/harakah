// A lower-third name strap: per-letter reveal, tracked uppercase role. Its defaultProps are English, so it looks
// fine in Studio; the Arabic only arrives at render time: `remotion render LowerThird --props props.ar.json`.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const LowerThird: React.FC<{ name: string; role: string }> = ({ name, role }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: 80, background: "#0b0b0f" }}>
      <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 84, fontWeight: 800, color: "#fff", letterSpacing: "0.04em" }}>
        {name.split("").map((ch, i) => (
          <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: interpolate(frame - i * 2, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {ch}
          </span>
        ))}
      </div>
      <div style={{ fontFamily: "Montserrat, sans-serif", fontSize: 34, color: "#ff5a36", textTransform: "uppercase", letterSpacing: "0.3em" }}>{role}</div>
    </AbsoluteFill>
  );
};
