// No Arabic in this file: the Arabic arrives through defaultProps in Root.tsx. Uses the shared caption style
// through a prop, which Harakah can't rewrite (it reports it instead).
import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "../theme";

const Label: React.FC<{ text: string; look: React.CSSProperties }> = ({ text, look }) => <div style={look}>{text}</div>;

export const PromoCard: React.FC<{ headline: string }> = ({ headline }) => (
  <AbsoluteFill style={{ background: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
    <div style={{ ...theme.title, fontSize: 80 }}>{headline}</div>
    <Label text={headline} look={theme.caption} />
  </AbsoluteFill>
);
