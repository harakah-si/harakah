import React from "react";
import { Composition } from "remotion";
import { ArabicTitle } from "./scenes/ArabicTitle";
import { EnglishTitle } from "./scenes/EnglishTitle";
import { PromoCard } from "./scenes/PromoCard";

const base = { fps: 30, width: 1280, height: 720 };
export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="ArabicTitle" component={ArabicTitle} durationInFrames={60} {...base} />
    <Composition id="EnglishTitle" component={EnglishTitle} durationInFrames={60} {...base} />
    <Composition id="PromoCard" component={PromoCard} durationInFrames={60} {...base} defaultProps={{ headline: "عرض خاص" }} />
  </>
);
