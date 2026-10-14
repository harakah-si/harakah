// AI-style reusable template: the Arabic only arrives through <Composition defaultProps> in Root.tsx,
// and the kicker is passed through to a child component in another file.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { Kicker } from "./Kicker";

const { fontFamily } = loadFont("normal", { weights: ["800"], subsets: ["latin"] });

export type PropsTitleProps = { title: string; kicker: string };

export const PropsTitle: React.FC<PropsTitleProps> = ({ title, kicker }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#0e0f12", justifyContent: "center", alignItems: "center", gap: 28 }}>
      <Kicker label={kicker} />
      <div style={{ display: "flex", fontFamily, fontSize: 112, fontWeight: 800, color: "#f3efe7" }}>
        {title.split("").map((ch, i) => (
          <span key={i} style={{ display: "inline-block", opacity: interpolate(frame - i * 2, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            {ch === " " ? "\u00A0" : ch}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
