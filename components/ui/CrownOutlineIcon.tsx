import Svg, { Path } from "react-native-svg";

type CrownOutlineIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export default function CrownOutlineIcon({
  size = 22,
  color = "#D69E2E",
  strokeWidth = 1.9,
}: CrownOutlineIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 17.8L5.3 7L9.8 12L12 4.6L14.2 12L18.7 7L21 17.8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.2 17.8C7.6 16.1 16.4 16.1 18.8 17.8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M6.3 20C8.7 18.9 15.3 18.9 17.7 20"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M7.2 15.6L9.8 12"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M16.8 15.6L14.2 12"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
