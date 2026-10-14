import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/BebasNeue";

const { fontFamily: display } = loadFont();

export const SpreadStats: React.FC = () => {
  const frame = useCurrentFrame();
  const label = "مستمع";
  const listeners = Math.round(interpolate(frame, [0, 60], [0, 1250000], { extrapolateRight: "clamp" }));
  const episode = 48;
  return (
    <AbsoluteFill style={{ backgroundColor: "#101216", color: "#eceae4", padding: 100, justifyContent: "center" }}>
      <div style={{ fontFamily: display, fontSize: 140, textAlign: "left", direction: "ltr" }}>
        {listeners.toLocaleString("en-US")}{" "}
        <span style={{ display: "inline-flex" }}>
          {[...label].map((c, i) => (
            <span key={i} style={{ display: "inline-block", transform: `scale(${interpolate(frame - 50 - i * 2, [0, 10], [0.6, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})` }}>{c}</span>
          ))}
        </span>
      </div>
      <p style={{ fontSize: 40, textAlign: "left", fontFamily: "Inter, sans-serif" }}>{`الحلقة ${episode} متاحة الآن على Spotify و Apple Podcasts!`}</p>
    </AbsoluteFill>
  );
};
