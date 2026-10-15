import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "../theme";
import { letters } from "../utils/letters";

export const EnglishTitle: React.FC = () => (
  <AbsoluteFill style={{ background: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
    <h1 style={theme.title}>{letters("Hello world").map((c, i) => <span key={i} style={{ display: "inline-block", whiteSpace: "pre" }}>{c}</span>)}</h1>
    <p style={theme.caption}>New episode every week</p>
  </AbsoluteFill>
);
