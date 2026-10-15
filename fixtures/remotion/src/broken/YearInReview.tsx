// Demo: a "year in review" card as an AI assistant would typically write it from a Latin template.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: displayFont } = loadFont("normal", { weights: ["800"], subsets: ["latin"] });
const { fontFamily: bodyFont } = loadInter("normal", { weights: ["400", "600"], subsets: ["latin"] });

const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const YearInReview: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const title = "سنة من الحكايات";
  const exit = interpolate(frame, [340, 372], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const bar = interpolate(frame, [6, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const listeners = Math.round(interpolate(frame, [96, 186], [0, 1250000], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }));
  const episodes = Math.round(interpolate(frame, [110, 186], [0, 48], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }));
  const fadeIn = (start: number) => interpolate(frame, [start, start + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const rise = (start: number) => (1 - fadeIn(start)) * 24;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0d", color: "#f3efe7", fontFamily: bodyFont, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "radial-gradient(40% 55% at 80% 35%, rgba(255,90,54,0.22), transparent 70%), radial-gradient(35% 45% at 15% 85%, rgba(110,130,255,0.12), transparent 70%)", transform: `scale(${1.06 - 0.06 * fadeIn(0)})` }} />
      <AbsoluteFill style={{ padding: "96px 112px", justifyContent: "center", gap: 26, opacity: 1 - exit, transform: `translateY(${-exit * 30}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: fadeIn(10) }}>
          <div style={{ width: 64 * bar, height: 3, background: "#ff5a36" }} />
          <span style={{ fontSize: 24, fontWeight: 600, color: "#ff7a5c", letterSpacing: 6, textTransform: "uppercase" }}>حصاد مساحة 2026</span>
        </div>
        <h1 style={{ margin: 0, display: "flex", fontFamily: displayFont, fontWeight: 800, fontSize: 120, lineHeight: 1.2 }}>
          {title.split("").map((ch, i) => {
            const s = spring({ frame: frame - 24 - i * 2, fps, config: { damping: 18, mass: 0.6 } });
            return (
              <span key={i} style={{ display: "inline-block", opacity: s, transform: `translateY(${(1 - s) * 70}px)` }}>
                {ch === " " ? "\u00A0" : ch}
              </span>
            );
          })}
        </h1>
        <div style={{ display: "flex", gap: 72, marginTop: 18, textAlign: "left" }}>
          <div style={{ opacity: fadeIn(90), transform: `translateY(${rise(90)}px)` }}>
            <div style={{ fontFamily: displayFont, fontSize: 72, fontWeight: 800 }}>{listeners.toLocaleString("en-US")}</div>
            <div style={{ fontSize: 26, color: "#a7a196" }}>مستمع هذا العام</div>
          </div>
          <div style={{ opacity: fadeIn(104), transform: `translateY(${rise(104)}px)` }}>
            <div style={{ fontFamily: displayFont, fontSize: 72, fontWeight: 800 }}>{episodes}</div>
            <div style={{ fontSize: 26, color: "#a7a196" }}>حلقة جديدة</div>
          </div>
        </div>
        <p style={{ margin: 0, marginTop: 10, fontSize: 26, color: "#a7a196", textAlign: "left", opacity: fadeIn(200) }}>
          استمع الآن على Spotify و Apple Podcasts و YouTube
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
