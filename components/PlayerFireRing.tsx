import { memo, useMemo } from "react";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";

export type FireLevel = 0 | 1 | 2 | 3;

type FireRingConfig = {
  outerOffset: number;
  thickness: number;
  tipAmplitude: number;
  peakCount: number;
};

const LEVEL_CONFIG: Record<Exclude<FireLevel, 0>, FireRingConfig> = {
  1: { outerOffset: 3, thickness: 3.2, tipAmplitude: 3.2, peakCount: 10 },
  2: { outerOffset: 5, thickness: 4.6, tipAmplitude: 5, peakCount: 12 },
  3: { outerOffset: 7, thickness: 6, tipAmplitude: 6.8, peakCount: 14 },
};

type PlayerFireRingProps = {
  level: FireLevel;
  avatarSize?: number;
};

export function getPlayerFireRingSize(level: FireLevel, avatarSize = 56): number {
  if (level === 0) {
    return 0;
  }
  const cfg = LEVEL_CONFIG[level];
  const avatarRadius = avatarSize * 0.5;
  const outermostRadius = avatarRadius + cfg.outerOffset + cfg.tipAmplitude + 2;
  return outermostRadius * 2;
}

function polar(cx: number, cy: number, radius: number, radians: number): { x: number; y: number } {
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function buildOuterFlamePath(
  cx: number,
  cy: number,
  baseOuterRadius: number,
  tipAmplitude: number,
  peakCount: number,
): string {
  let d = "";
  for (let i = 0; i < peakCount; i += 1) {
    const startAngle = (i / peakCount) * Math.PI * 2 - Math.PI / 2;
    const tipAngle = ((i + 0.5) / peakCount) * Math.PI * 2 - Math.PI / 2;
    const endAngle = ((i + 1) / peakCount) * Math.PI * 2 - Math.PI / 2;

    const start = polar(cx, cy, baseOuterRadius - tipAmplitude * 0.2, startAngle);
    const tip = polar(cx, cy, baseOuterRadius + tipAmplitude, tipAngle);
    const end = polar(cx, cy, baseOuterRadius - tipAmplitude * 0.2, endAngle);

    if (i === 0) {
      d += `M ${start.x} ${start.y}`;
    }
    d += ` Q ${tip.x} ${tip.y} ${end.x} ${end.y}`;
  }
  d += " Z";
  return d;
}

function circlePath(cx: number, cy: number, radius: number): string {
  return [
    `M ${cx - radius} ${cy}`,
    `A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy}`,
    `A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy}`,
    "Z",
  ].join(" ");
}

function PlayerFireRingComponent({ level, avatarSize = 56 }: PlayerFireRingProps) {
  if (level === 0) {
    return null;
  }

  const cfg = LEVEL_CONFIG[level];
  const avatarRadius = avatarSize * 0.5;
  const baseOuterRadius = avatarRadius + cfg.outerOffset;
  const size = getPlayerFireRingSize(level, avatarSize);
  const outermostRadius = size * 0.5;
  const center = outermostRadius;
  const innerRadius = avatarRadius + 0.8;

  const { outerPath, midPath } = useMemo(() => {
    const outerContour = buildOuterFlamePath(
      center,
      center,
      baseOuterRadius,
      cfg.tipAmplitude,
      cfg.peakCount,
    );
    const midContour = buildOuterFlamePath(
      center,
      center,
      baseOuterRadius - 0.8,
      cfg.tipAmplitude * 0.62,
      cfg.peakCount,
    );

    const mainInner = circlePath(center, center, innerRadius);
    const midInner = circlePath(center, center, innerRadius + cfg.thickness * 0.45);

    return {
      outerPath: `${outerContour} ${mainInner}`,
      midPath: `${midContour} ${midInner}`,
    };
  }, [baseOuterRadius, center, cfg.peakCount, cfg.tipAmplitude, cfg.thickness, innerRadius]);

  const outerGradientId = `fire_outer_${level}_${Math.round(avatarSize)}`;
  const innerGradientId = `fire_inner_${level}_${Math.round(avatarSize)}`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <RadialGradient id={outerGradientId} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#D93812" />
          <Stop offset="52%" stopColor="#FF5A1F" />
          <Stop offset="82%" stopColor="#FF9E2C" />
          <Stop offset="100%" stopColor="#FFD54A" />
        </RadialGradient>
        <RadialGradient id={innerGradientId} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#FF5A1F" />
          <Stop offset="70%" stopColor="#FF9E2C" />
          <Stop offset="100%" stopColor="#FFD54A" />
        </RadialGradient>
      </Defs>
      <Path d={outerPath} fill={`url(#${outerGradientId})`} fillRule="evenodd" />
      <Path d={midPath} fill={`url(#${innerGradientId})`} fillRule="evenodd" opacity={0.78} />
    </Svg>
  );
}

const PlayerFireRing = memo(PlayerFireRingComponent);

export default PlayerFireRing;
