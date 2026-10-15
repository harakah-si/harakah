import React from "react";
import styled from "styled-components";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import styles from "./Title.module.css";

const Kicker = styled.div`
  font-size: 30px;
  color: #e8461f;
  letter-spacing: 0.3em;
  text-transform: uppercase;
`;

export const StyledTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#f5f3ee", justifyContent: "center", alignItems: "center", opacity }}>
      <Kicker>تقرير خاص</Kicker>
      <h1 className={styles.title}>اقتصاد المنصات</h1>
    </AbsoluteFill>
  );
};
