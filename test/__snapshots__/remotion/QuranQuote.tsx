import React from "react";
import { AbsoluteFill } from "remotion";
import { loadFont as loadNotoNaskhArabic } from "@remotion/google-fonts/NotoNaskhArabic"; // harakah: font was referenced but never loaded
loadNotoNaskhArabic("normal", { subsets: ["arabic"] });

export const QuranQuote: React.FC = () => (
  <AbsoluteFill dir="rtl" lang="ar" /* harakah: Arabic is RTL */ style={{ backgroundColor: "#0c0d10", justifyContent: "center", alignItems: "center" }}>
    <div style={{ overflow: "hidden", height: 96 }}>
      <p style={{ margin: 0, fontFamily: "'Noto Naskh Arabic', serif", fontSize: 88, lineHeight: 1, color: "#f3efe7" }}>
        إِنَّ مَعَ الْعُسْرِ يُسْرًا
      </p>
    </div>
    <p style={{ width: 420, fontSize: 44, color: "#9a9ca6", wordBreak: "normal" /* harakah */, textAlign: "center" }}>
      الاستراتيجيات التسويقية المتكاملة
    </p>
  </AbsoluteFill>
);
