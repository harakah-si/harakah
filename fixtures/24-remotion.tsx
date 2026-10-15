import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const text = "مرحبا بالعالم";
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: "Inter, sans-serif", letterSpacing: 4 }}>
      <h1>
        {text.split("").map((c, i) => (
          <span key={i} style={{ display: "inline-block", opacity: interpolate(frame - i * 3, [0, 10], [0, 1]) }}>{c}</span>
        ))}
      </h1>
    </AbsoluteFill>
  );
};
