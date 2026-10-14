import React from "react";
import { Composition } from "remotion";
import { CharSplitTitle } from "./broken/CharSplitTitle";
import { ArrayFromKicker } from "./broken/ArrayFromKicker";
import { SpreadStats } from "./broken/SpreadStats";
import { QuranQuote } from "./broken/QuranQuote";
import { StyledTitle } from "./broken/StyledTitle";
import { YearInReview } from "./broken/YearInReview";
import { CleanTitle } from "./clean/CleanTitle";
import { ArabicTextDemo } from "./clean/ArabicTextDemo";
import { LowerThird } from "./props/LowerThird";
import { PropsTitle } from "./props/PropsTitle";

const base = { width: 1280, height: 720, fps: 30 } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="CharSplitTitle" component={CharSplitTitle} durationInFrames={90} {...base} />
    <Composition id="ArrayFromKicker" component={ArrayFromKicker} durationInFrames={90} {...base} />
    <Composition id="SpreadStats" component={SpreadStats} durationInFrames={120} {...base} />
    <Composition id="QuranQuote" component={QuranQuote} durationInFrames={60} {...base} />
    <Composition id="StyledTitle" component={StyledTitle} durationInFrames={75} {...base} />
    <Composition id="YearInReview" component={YearInReview} durationInFrames={390} {...base} />
    <Composition id="CleanTitle" component={CleanTitle} durationInFrames={75} {...base} />
    <Composition id="ArabicTextDemo" component={ArabicTextDemo} durationInFrames={90} {...base} />
    <Composition id="PropsTitle" component={PropsTitle} durationInFrames={75} {...base} defaultProps={{ title: "حكايات من دمشق", kicker: "الحلقة الأولى" }} />
    {/* English defaults; Arabic arrives at render time via --props props.ar.json */}
    <Composition id="LowerThird" component={LowerThird} durationInFrames={60} {...base} defaultProps={{ name: "Guest name", role: "Producer" }} />
  </>
);
