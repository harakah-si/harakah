// A reusable "kicker" label: tracked, uppercased Latin styling. No Arabic in this file; it gets Arabic via props.
import React from "react";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", { weights: ["600"], subsets: ["latin"] });

export const Kicker: React.FC<{ label: string }> = ({ label }) => (
  <div style={{ fontFamily, fontSize: 30, fontWeight: 600, letterSpacing: "0.3em", textTransform: "uppercase", color: "#ff5a36" }}>{label}</div>
);
