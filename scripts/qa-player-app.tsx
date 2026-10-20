// The Remotion Player page for scripts/qa-player.mjs: plain-text reference and the Player with <ArabicText>, at ?font&text&mode&frame.
// Bundled from fixtures/remotion/src (its React, Remotion and the vendored harakah-arabic.tsx).
import React from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { AbsoluteFill } from "remotion";
import { ArabicText } from "./harakah-arabic";
const P = new URLSearchParams(location.search);
const font = P.get("font")!, text = P.get("text")!, mode = (P.get("mode") || "auto") as any, frame = Number(P.get("frame") || 89);
const Comp: React.FC = () => (
  <AbsoluteFill style={{ background: "#fff", color: "#000", alignItems: "center", justifyContent: "center" }}>
    <ArabicText as="div" text={text} preset="rise" stagger={2} joinMode={mode} style={{ font: "700 84px/1.5 T", whiteSpace: "nowrap" }} />
  </AbsoluteFill>
);
const App = () => (<>
  <div id="ref" style={{ width: 900, height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}><div dir="rtl" lang="ar" style={{ font: "700 84px/1.5 T", whiteSpace: "nowrap" }}>{text.split(" ").map((w, i) => <React.Fragment key={i}>{i ? " " : ""}<span style={{ display: "inline-block" }}>{w}</span></React.Fragment>)}</div></div>
  <div id="pl"><Player acknowledgeRemotionLicense component={Comp} durationInFrames={90} fps={30} compositionWidth={900} compositionHeight={300} initialFrame={frame} style={{ width: 900, height: 300 }} /></div>
</>);
const st = document.createElement("style"); st.textContent = `@font-face{font-family:T;src:url("/fonts/${font}")}body{margin:0}`; document.head.append(st);
(window as any).__ready = document.fonts.load("700 84px T").then(() => document.fonts.ready).then(() => new Promise((r) => setTimeout(r, 400)));
createRoot(document.getElementById("root")!).render(<App />);
