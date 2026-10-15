import React from "react";
import { AbsoluteFill } from "remotion";

export const QuranQuote: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#0c0d10", justifyContent: "center", alignItems: "center" }}>
    <div style={{ overflow: "hidden", height: 96 }}>
      <p style={{ margin: 0, fontFamily: "'Noto Naskh Arabic', serif", fontSize: 88, lineHeight: 1, color: "#f3efe7" }}>
        إِنَّ مَعَ الْعُسْرِ يُسْرًا
      </p>
    </div>
    <p style={{ width: 420, fontSize: 44, color: "#9a9ca6", wordBreak: "break-all", textAlign: "center" }}>
      الاستراتيجيات التسويقية المتكاملة
    </p>
  </AbsoluteFill>
);
