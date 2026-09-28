import { memo, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import PlayerFireRing, {
  getPlayerFireRingSize,
  type FireLevel,
} from "@/components/PlayerFireRing";
import CrownPinBadge from "@/components/ui/CrownPinBadge";
import FireRingGlow, {
  getMomentumFireTierForPlayer,
  getMomentumFireTierVisual,
} from "@/components/ui/FireRingGlow";
import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { colors, getInGameRatingColor } from "@/theme/colors";

type HighlightTrend = "up" | "down" | "neutral";

type PlayerBubbleProps = {
  player: LiveGamePlayer;
  left: `${number}%`;
  top: `${number}%`;
  teamColor?: string | null;
  teamSecondaryColor?: string | null;
  leadingScorer?: boolean;
  highlighted?: boolean;
  highlightTrend?: HighlightTrend | null;
  isHighestRated?: boolean;
  heatLevel?: FireLevel;
  showName?: boolean;
  avatarSize?: number;
  /**
   * Value shown in the rating pill. When provided (including `null`), it
   * overrides the default in-game rating so a court-level toggle can swap
   * every player's pill (e.g. live vs. season rating) at once. `null` renders
   * as "-". When omitted entirely, falls back to the player's in-game rating.
   */
  displayRating?: number | null;
  /**
   * Overrides the pill's text/color entirely (e.g. a formatted NIL dollar
   * value like "$1.2M" instead of a 0-10 rating). When provided, takes
   * precedence over `displayRating`'s numeric formatting.
   */
  pillText?: string;
  pillColor?: string;
  onPress: (player: LiveGamePlayer) => void;
};

const AVATAR_SIZE = 56;

function normalizeTeamColor(value: string | null | undefined, fallback: string): string {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

function PlayerBubble({
  player,
  left,
  top,
  teamColor,
  teamSecondaryColor,
  leadingScorer = false,
  highlighted = false,
  highlightTrend = null,
  isHighestRated = false,
  heatLevel = 0,
  showName = true,
  avatarSize = AVATAR_SIZE,
  displayRating,
  pillText,
  pillColor,
  onPress,
}: PlayerBubbleProps) {
  const { tokens: theme } = useAppTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedJersey = useMemo(() => {
    const raw = typeof player.jersey === "string" ? player.jersey.trim() : "";
    return /^[0-9A-Za-z]{1,4}$/.test(raw) ? raw : "-";
  }, [player.jersey]);

  useEffect(() => {
    setImageFailed(false);
  }, [player.headshot]);

  const headshotUri =
    typeof player.headshot === "string" ? player.headshot.trim() : "";
  const shouldRenderHeadshot = headshotUri.length > 0 && !imageFailed;
  const avatarBackground = normalizeTeamColor(teamColor, "#93abc6");
  const teamOutline = normalizeTeamColor(
    teamSecondaryColor || teamColor,
    "#d9e5f3",
  );

  const ratingValue =
    displayRating !== undefined ? displayRating : player.inGameRating10;
  const inGameRating =
    pillText !== undefined
      ? pillText
      : typeof ratingValue === "number"
        ? ratingValue.toFixed(1)
        : "-";
  const ratingBg = pillColor !== undefined ? pillColor : getInGameRatingColor(ratingValue);
  const resolvedTrend: HighlightTrend = highlightTrend ?? "neutral";
  const glow = resolvedTrend === "up"
    ? {
        halo: "rgba(79, 211, 142, 0.34)",
        outer: "#58d898",
        inner: "#96f3c1",
        shadow: "#4fd38e",
      }
    : resolvedTrend === "down"
      ? {
          halo: "rgba(242, 154, 154, 0.34)",
          outer: "#e88484",
          inner: "#f4b4b4",
          shadow: "#e87979",
        }
      : {
          halo: "rgba(155, 178, 204, 0.34)",
          outer: "#93abc6",
          inner: "#c0d0df",
          shadow: "#8fa7c2",
        };
  // Momentum-based "on fire" glow takes precedence over the older heat-level
  // ring below when both would apply — two literal flame rings stacked on the
  // same avatar would look broken, and momentum is the more current signal.
  // Tiered purely by VALUE (same thresholds as the leaderboard, not a
  // separate/looser boolean check) — previously this used a fixed ratio and
  // the old single MOMENTUM_HOT_THRESHOLD boolean, which is why a player
  // showing a tier on the leaderboard could show nothing at all on the court.
  const fireTier = getMomentumFireTierForPlayer(player);
  const onFire = fireTier !== null;
  const fireTierVisual = fireTier ? getMomentumFireTierVisual(fireTier) : null;
  // Crown and rating-pill badge sizes are fixed constants tuned for the
  // default 56px avatar — without scaling them down too, they'd look
  // increasingly oversized/misaligned as avatarSize shrinks (e.g. on a
  // vertically-compressed court).
  const sizeRatio = avatarSize / AVATAR_SIZE;
  const ratingBadgeDynamicStyle = useMemo(
    () => ({
      minWidth: Math.round(32 * sizeRatio),
      height: Math.round(18 * sizeRatio),
      paddingHorizontal: Math.round(6 * sizeRatio),
      borderRadius: Math.round(10 * sizeRatio),
    }),
    [sizeRatio],
  );
  const ratingTextDynamicStyle = useMemo(
    () => ({ fontSize: Math.max(8, Math.round(10 * sizeRatio)) }),
    [sizeRatio],
  );
  const fireRingSize = useMemo(
    () => getPlayerFireRingSize(heatLevel, avatarSize),
    [avatarSize, heatLevel],
  );
  const fireRingOffset = useMemo(
    () => (avatarSize - fireRingSize) / 2,
    [avatarSize, fireRingSize],
  );
  const avatarDynamicStyle = useMemo(
    () => ({
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarSize / 2,
    }),
    [avatarSize],
  );
  // Plain size, deliberately WITHOUT borderRadius — unlike avatarWrap (the
  // actual photo, which needs rounding), this sizes the fire-ring layer and
  // has no background/border of its own, so a border-radius here serves no
  // visual purpose and only risks an engine/platform clipping the ring to a
  // circular boundary it doesn't need to respect.
  //
  // fireRingLayer is position:absolute (removed from normal flow) while
  // avatarStack stays position:relative, centered horizontally within `wrap`
  // via alignItems:'center' — so to land on the exact same center point,
  // this computes that same centering offset explicitly (`wrap`'s width
  // minus avatarSize, halved) rather than relying on flex centering, which
  // doesn't apply to absolutely-positioned siblings.
  const fireRingLayerStyle = useMemo(() => {
    const wrapWidth = Math.round(92 * sizeRatio);
    const centerOffset = (wrapWidth - avatarSize) / 2;
    return { width: avatarSize, height: avatarSize, left: centerOffset };
  }, [avatarSize, sizeRatio]);
  const teamRingDynamicStyle = useMemo(
    () => ({
      width: avatarSize + 6,
      height: avatarSize + 6,
      borderRadius: (avatarSize + 6) / 2,
    }),
    [avatarSize],
  );
  const glowHaloDynamicStyle = useMemo(
    () => ({
      width: avatarSize + 16,
      height: avatarSize + 16,
      borderRadius: (avatarSize + 16) / 2,
    }),
    [avatarSize],
  );
  const glowRingOuterDynamicStyle = useMemo(
    () => ({
      width: avatarSize + 10,
      height: avatarSize + 10,
      borderRadius: (avatarSize + 10) / 2,
    }),
    [avatarSize],
  );
  const glowRingInnerDynamicStyle = useMemo(
    () => ({
      width: avatarSize + 4,
      height: avatarSize + 4,
      borderRadius: (avatarSize + 4) / 2,
    }),
    [avatarSize],
  );
  // The name label's own bounding box (below the avatar) was a static 92px,
  // tuned for the original 56px avatar. It scales with avatarSize now too —
  // otherwise a bigger avatar (see the ~20% court bump) has the SAME name
  // box as before, ellipsizing/overflowing sooner relative to its own size.
  const wrapDynamicStyle = useMemo(() => {
    const width = Math.round(92 * sizeRatio);
    return { width, marginLeft: -Math.round(width / 2) };
  }, [sizeRatio]);

  return (
    <Pressable
      style={[
        styles.wrap,
        wrapDynamicStyle,
        { left, top, marginTop: -(avatarSize / 2 + 8) },
        leadingScorer && styles.leading,
      ]}
      onPressIn={() => {
        if (__DEV__) {
          console.log(`[timing] PlayerBubble onPressIn ${player.id} @ ${performance.now().toFixed(1)}ms`);
        }
      }}
      onPress={() => {
        if (__DEV__) {
          console.log(`[timing] PlayerBubble onPress ${player.id} @ ${performance.now().toFixed(1)}ms`);
        }
        onPress(player);
      }}
    >
      {/* Fire ring lives in its OWN unclipped layer, a SIBLING of avatarStack
          rather than a child of it — both are absolutely positioned at the
          same (top:0, left:0) origin within `wrap` and the same avatarSize
          box, so they stay perfectly co-centered, but the ring is no longer
          nested inside any container sized/clipped to the photo itself. This
          also puts it under avatarStack in a completely separate stacking
          context, so there's no ambiguity about it painting behind the
          photo: it's not competing for z-order within the same parent at
          all, it's a lower layer underneath. */}
      {onFire ? (
        <View pointerEvents="none" style={[styles.fireRingLayer, fireRingLayerStyle]}>
          <FireRingGlow
            active
            photoDiameter={avatarSize}
            // NOT avatarSize + 6 (the team-ring outer diameter) — FireRingGlow
            // centers its ring by assuming the box it renders into is exactly
            // `visualDiameter` wide, anchored at the same (0,0) origin as this
            // component's own container. That container (fireRingLayer, just
            // below) is sized to avatarSize, not avatarSize+6, so passing the
            // larger value here was making FireRingGlow center itself on a
            // point 3px down-right of the photo's true center — a consistent
            // diagonal offset on every player. Omitting it defaults to
            // photoDiameter, matching the real container exactly.
            // Use the SAME undamped tier ratios as the leaderboard (see
            // getMomentumFireTierVisual) — an earlier 0.75x dampening here
            // (reasoned as avoiding overlap in the court's tighter formation)
            // instead made the ring barely peek past the photo edge at the
            // court's smaller avatar size, especially for the "small" tier
            // and at low heightScale values. minSize is a floor relative to
            // avatarSize (not a fixed px value) so it keeps scaling
            // correctly across every heightScale instead of becoming a
            // smaller and smaller fraction of the photo as avatarSize shrinks.
            ratio={fireTierVisual ? fireTierVisual.ratio : 1.6}
            opacity={fireTierVisual?.opacity}
            minSize={Math.round(avatarSize * 1.5)}
            debugLabel={`fire-ring:court-bubble:${fireTier ?? "none"}`}
          />
        </View>
      ) : null}
      <View style={[styles.avatarStack, avatarDynamicStyle]}>
        {!onFire && heatLevel > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.fireRingWrap,
              {
                width: fireRingSize,
                height: fireRingSize,
                left: fireRingOffset,
                top: fireRingOffset,
              },
            ]}
          >
            <PlayerFireRing level={heatLevel} avatarSize={avatarSize} />
          </View>
        ) : null}
        {isHighestRated ? <CrownPinBadge photoDiameter={avatarSize} /> : null}
        {highlighted ? (
          <>
            <View style={[styles.glowHalo, glowHaloDynamicStyle, { backgroundColor: glow.halo, shadowColor: glow.shadow }]} />
            <View style={[styles.glowRingOuter, glowRingOuterDynamicStyle, { borderColor: glow.outer }]} />
            <View style={[styles.glowRingInner, glowRingInnerDynamicStyle, { borderColor: glow.inner }]} />
          </>
        ) : null}
        <View style={[styles.teamRing, teamRingDynamicStyle, { borderColor: teamOutline }]} />
        <View
          style={[
            styles.avatarWrap,
            avatarDynamicStyle,
            { backgroundColor: avatarBackground },
          ]}
        >
          {shouldRenderHeadshot ? (
            <Image
              source={{ uri: headshotUri }}
              style={styles.avatar}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={styles.dotFallback}>
              <Text style={styles.jersey}>{normalizedJersey}</Text>
            </View>
          )}
        </View>
        <View style={[styles.ratingBadge, ratingBadgeDynamicStyle, { backgroundColor: ratingBg }]}>
          <Text style={[styles.ratingText, ratingTextDynamicStyle]}>{inGameRating}</Text>
        </View>
      </View>

      <View style={styles.jerseyBadge}>
        <Text style={styles.jerseyBadgeText}>#{normalizedJersey}</Text>
      </View>

      {showName ? (
        <Text style={styles.name} numberOfLines={1}>
          {player.lastName || player.name}
        </Text>
      ) : null}
    </Pressable>
  );
}

// Memoized for the same reason as CourtOverlay (which renders one of these
// per on-court player): the parent screen's unrelated state changes (e.g.
// opening the player modal) shouldn't force every bubble to re-render too.
export default memo(PlayerBubble);

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    width: 92,
    marginLeft: -46,
    marginTop: -36,
    alignItems: "center",
    overflow: "visible",
  },
  avatarStack: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    position: "relative",
    overflow: "visible",
    // Explicit (not left to default/auto) so it's unambiguous on every
    // platform that this — the photo, badges, rating pill — paints ABOVE
    // fireRingLayer (zIndex 0), which is now a separate sibling layer rather
    // than a nested child, specifically to rule out any container/clipping
    // ambiguity for the fire ring.
    zIndex: 1,
  },
  // Separate, unclipped layer behind avatarStack — see the comment at its
  // JSX usage. position:absolute, no overflow/border-radius of its own, so
  // nothing here can clip the ring image to the photo's circular bounds.
  fireRingLayer: {
    position: "absolute",
    top: 0,
    zIndex: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  fireRingWrap: {
    position: "absolute",
    zIndex: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  glowHalo: {
    position: "absolute",
    left: -8,
    top: -8,
    width: 72,
    height: 72,
    borderRadius: 36,
    zIndex: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 14,
    elevation: 14,
  },
  glowRingOuter: {
    position: "absolute",
    left: -5,
    top: -5,
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1.5,
    zIndex: 1,
  },
  glowRingInner: {
    position: "absolute",
    left: -2,
    top: -2,
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    zIndex: 1,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 0,
    zIndex: 3,
  },
  teamRing: {
    position: "absolute",
    left: -3,
    top: -3,
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 4.5,
    zIndex: 2,
  },
  ratingBadge: {
    position: "absolute",
    top: -7,
    right: -8,
    zIndex: 14,
    elevation: 14,
    minWidth: 32,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 10,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingText: {
    color: "#0b1220",
    fontSize: 10,
    fontWeight: "800",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  dotFallback: {
    width: "100%",
    height: "100%",
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  leading: {
    zIndex: 5,
  },
  jersey: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  jerseyBadge: {
    marginTop: -10,
    minHeight: 20,
    borderRadius: 10,
    backgroundColor: "#000000",
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1f1f1f",
    zIndex: 10,
    elevation: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  jerseyBadgeText: {
    color: "#f4f8ff",
    fontSize: 10,
    fontWeight: "800",
  },
  name: {
    marginTop: -2,
    color: "#f0f6ff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    position: "relative",
    zIndex: 11,
  },
});
