import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

// "King of the Court" indicator, shared by every avatar that shows it
// (leaderboard rows, court bubbles, boxscore rows): a small circular pin
// badge sitting on the top-left edge of the player's photo, like a verified
// badge/notification dot — replacing the old floating, tilted crown that sat
// loose above the photo with no background of its own.
const crownBadgeIcon = require("@/assets/images/crown-badge-icon.png");

// Fraction of the badge's own diameter the icon occupies inside it, leaving
// a border of solid background around the icon so it reads clearly.
const ICON_FILL_FRACTION = 0.62;

export type CrownPinBadgeProps = {
  /** Diameter (px) of the player's circular photo this badge pins to. */
  photoDiameter: number;
  /** Diameter (px) of the badge circle itself. Defaults to ~52% of the photo
   *  — bumped up from an earlier ~40% so it reads as a proper emblem/pin
   *  (like a verified badge) rather than a small floating icon. */
  size?: number;
};

function CrownPinBadge({ photoDiameter, size }: CrownPinBadgeProps) {
  const { tokens: theme } = useAppTheme();
  const diameter = size ?? Math.round(photoDiameter * 0.52);
  // Center the badge exactly on the photo's own circular edge at the
  // top-left 45° point (radius * (1 - cos45°) from the bounding box's
  // top-left corner) so it overlaps the boundary evenly instead of floating
  // above it or sitting fully outside the circle.
  const edgeOffset = (photoDiameter / 2) * (1 - Math.SQRT1_2);
  const offset = edgeOffset - diameter / 2;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          top: offset,
          left: offset,
          borderWidth: Math.max(1.5, diameter * 0.08),
          borderColor: theme.colors.bg,
          // Solid black backing (not the gold/warning tint used previously)
          // so the badge reads as a proper emblem/pin sitting on the photo —
          // matching how a verified badge sits on a profile photo — rather
          // than a same-tone icon that blends into its own background.
          backgroundColor: "#000000",
        },
      ]}
    >
      <Image
        source={crownBadgeIcon}
        style={{
          width: diameter * ICON_FILL_FRACTION,
          height: diameter * ICON_FILL_FRACTION,
          resizeMode: "contain",
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    zIndex: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default memo(CrownPinBadge);
