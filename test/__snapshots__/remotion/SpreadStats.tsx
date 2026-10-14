import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Alexandria"; // harakah: was BebasNeue (no Arabic glyphs)
import { formatDigits, splitArabic, withArabicSeparators } from "./harakah-arabic"; // harakah: joining-aware Arabic helpers
import { loadFont as loadArabicFont } from "@remotion/google-fonts/IBMPlexSansArabic"; // harakah: Arabic fallback font
loadArabicFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["arabic"] });

const { fontFamily: display } = withArabicSeparators(loadFont("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["arabic", "latin"] }));

export const SpreadStats: React.FC = () => {
  const frame = useCurrentFrame();
  const label = "مستمع";
  const listeners = Math.round(interpolate(frame, [0, 60], [0, 1250000], { extrapolateRight: "clamp" }));
  const episode = 48;
  return (
    <AbsoluteFill dir="rtl" lang="ar" /* harakah: Arabic is RTL */ style={{ backgroundColor: "#101216", color: "#eceae4", padding: 100, justifyContent: "center" }}>
      <div style={{ fontFamily: display, fontSize: 140, textAlign: "start" /* harakah: follows dir=rtl */, direction: "rtl" /* harakah */ }}>
        {formatDigits(listeners)}{" "}
        <span style={{ display: "inline-flex" }}>
          {/* harakah: was [...label] */ splitArabic(label).map((c, i) => (
            <span key={i} style={{ display: "inline-block", transform: `scale(${interpolate(frame - 50 - i * 2, [0, 10], [0.6, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})` }}>{c}</span>
          ))}
        </span>
      </div>
      <p style={{ fontSize: 40, textAlign: "start" /* harakah: follows dir=rtl */, fontFamily: "Inter, 'IBM Plex Sans Arabic', sans-serif" /* harakah: Arabic fallback */ }}>{`الحلقة ${formatDigits(episode)} متاحة الآن على \u2068Spotify\u2069 و \u2068Apple Podcasts\u2069!`}</p>
    </AbsoluteFill>
  );
};
