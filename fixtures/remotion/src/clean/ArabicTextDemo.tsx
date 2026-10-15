// Clean composition built with the drop-in <ArabicText> component: per-letter motion that stays joined.
import React from "react";
import { AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/Alexandria";
import { loadFont as loadPlex } from "@remotion/google-fonts/IBMPlexSansArabic";
import { ArabicText, formatDigits } from "../harakah-arabic";

const { fontFamily: display } = loadFont("normal", { weights: ["700"], subsets: ["arabic", "latin"] });
const { fontFamily: text } = loadPlex("normal", { weights: ["400"], subsets: ["arabic", "latin"] });

export const ArabicTextDemo: React.FC = () => (
  <AbsoluteFill dir="rtl" lang="ar" style={{ backgroundColor: "#0e0f12", color: "#f3efe7", justifyContent: "center", padding: 120, gap: 28 }}>
    <ArabicText as="h1" text="قصص تستحق أن تُروى" preset="rise" stagger={2} style={{ margin: 0, fontFamily: display, fontSize: 104 }} />
    <ArabicText as="p" by="word" text={`أكثر من ${formatDigits(250000)} مستمع كل شهر`} preset="fade" delay={30} stagger={4} style={{ margin: 0, fontFamily: text, fontSize: 36, color: "#a7a196" }} />
  </AbsoluteFill>
);
