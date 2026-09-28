import { Image, StyleSheet, View } from "react-native";

// Shared "on fire" rule + visual (fire-ring image behind a player's photo),
// used by every in-game location that renders a player avatar: the Court tab
// leaderboard, court bubbles, the player modal, boxscore rows, the lineup
// dock, playbyplay cards, the team-stats streak card, and the Latest Play
// card. Centralized here so the threshold and the ring's look/behavior stay
// identical everywhere instead of drifting per-site.
export const MOMENTUM_HOT_THRESHOLD = 3.0;

// Momentum reflects a ROLLING recent window, not a permanent trait — once a
// player is off the court, their momentum stops updating, so continuing to
// show them "on fire" would just be a stale glow with no live basis. Gating
// on onCourt here means a bench player never shows the ring anywhere in the
// app, without every call site needing to remember to check it separately.
// `onCourt` is optional so callers that don't have it on hand aren't
// penalized (e.g. a partial shape without live on-court tracking) — only an
// explicit `false` suppresses the ring.
export function isPlayerOnFire(player: { momentum?: number | null; onCourt?: boolean }): boolean {
  if (player.onCourt === false) {
    return false;
  }
  return (player.momentum ?? 0) > MOMENTUM_HOT_THRESHOLD;
}

// Tiered version: three graduated ring sizes keyed purely to the momentum
// VALUE (never rank/position), so on any given poll zero, one, or several
// players can each independently show whichever tier their own value earns —
// there is no "only the #1 player glows" restriction anywhere in here.
export type MomentumFireTier = "small" | "medium" | "large";

export const MOMENTUM_FIRE_TIER_THRESHOLDS: Record<MomentumFireTier, number> = {
  large: 4.0,
  medium: 2.5,
  small: 1.0,
};

// "large" is bumped up in both size AND opacity for extra intensity — no new
// asset needed for that, since fire-ring.png already reads as vivid at full
// opacity/larger scale. If it still feels underwhelming in practice, a
// higher-contrast/brighter asset variant would be the next thing to try.
const MOMENTUM_FIRE_TIER_VISUALS: Record<MomentumFireTier, { ratio: number; opacity: number }> = {
  small: { ratio: 1.6, opacity: 0.85 },
  medium: { ratio: 2.1, opacity: 1 },
  large: { ratio: 2.7, opacity: 1 },
};

export function getMomentumFireTier(momentum: number | null | undefined): MomentumFireTier | null {
  const value = momentum ?? 0;
  if (value >= MOMENTUM_FIRE_TIER_THRESHOLDS.large) {
    return "large";
  }
  if (value >= MOMENTUM_FIRE_TIER_THRESHOLDS.medium) {
    return "medium";
  }
  if (value >= MOMENTUM_FIRE_TIER_THRESHOLDS.small) {
    return "small";
  }
  return null;
}

export function getMomentumFireTierVisual(tier: MomentumFireTier): { ratio: number; opacity: number } {
  return MOMENTUM_FIRE_TIER_VISUALS[tier];
}

// Player-aware counterpart to getMomentumFireTier, for the same reason
// isPlayerOnFire gates on onCourt above: a benched player's momentum is
// stale, so they should never earn a tier (small/medium/large) either.
export function getMomentumFireTierForPlayer(player: {
  momentum?: number | null;
  onCourt?: boolean;
}): MomentumFireTier | null {
  if (player.onCourt === false) {
    return null;
  }
  return getMomentumFireTier(player.momentum);
}

const fireRingImage = require("@/assets/images/fire-ring.png");
// Ratio is applied to `photoDiameter` (the actual circular photo, not any
// decorative outer ring around it) — see FireRingGlowProps below. 2.1 reads
// clearly as a ring extending well beyond the photo without swallowing
// neighboring UI at the sizes used across the app (34-104px photos).
const FIRE_RING_SIZE_RATIO = 2.1;
// Flip to true to render a bright, high-contrast box behind the fire-ring
// Image while debugging — if you see the colored box but no flames, the
// image itself is failing to load/decode; if you see flames but they look
// wrong, it's a sizing/positioning issue instead. Flip back to false once
// confirmed working. Applies everywhere this component is used.
const FIRE_RING_DEBUG_BORDER = false;

export type FireRingGlowProps = {
  /** Whether to render the ring at all — pass `isPlayerOnFire(player)`. */
  active: boolean;
  /** Diameter (px) of the actual circular photo the ring should frame. */
  photoDiameter: number;
  /**
   * Diameter (px) of the full visible circle at this call site, if it's
   * larger than the photo itself (e.g. a decorative outer ring/border like
   * TopPlayerRow's 44.5px avatarRing around its 40px photo). Used only to
   * keep the glow centered on that outer circle rather than the inner photo.
   * Defaults to `photoDiameter` when there's no separate outer ring.
   */
  visualDiameter?: number;
  ratio?: number;
  /** Image opacity, 0-1. Defaults to fully opaque; lower for a subtler tier. */
  opacity?: number;
  /**
   * Floor (px) for the ring's rendered size, regardless of how small
   * `photoDiameter * ratio` computes to. Without this, a small avatar (e.g.
   * a vertically-compressed court) can scale the ring down to the point of
   * being effectively invisible even when `active` is true and the asset
   * loaded correctly — the ring isn't missing, it's just too small to read.
   */
  minSize?: number;
  /** Short label included in dev logs so it's clear which site logged. */
  debugLabel?: string;
};

export default function FireRingGlow({
  active,
  photoDiameter,
  visualDiameter,
  ratio = FIRE_RING_SIZE_RATIO,
  opacity = 1,
  minSize,
  debugLabel = "fire-ring",
}: FireRingGlowProps) {
  if (!active) {
    return null;
  }

  const size = Math.max(minSize ?? 0, Math.round(photoDiameter * ratio));
  const baseDiameter = visualDiameter ?? photoDiameter;
  const offset = -(size - baseDiameter) / 2;

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, top: offset, left: offset },
        FIRE_RING_DEBUG_BORDER ? styles.debugBox : null,
      ]}
    >
      <Image
        source={fireRingImage}
        style={[styles.image, { opacity }]}
        onLoad={(event) => {
          if (__DEV__) {
            const { width, height } = event.nativeEvent.source ?? {};
            console.log(
              `[${debugLabel}] image loaded ok. source native size=${width}x${height} rendered box=${size}x${size}`,
            );
          }
        }}
        onError={(event) => {
          if (__DEV__) {
            console.log(`[${debugLabel}] image FAILED to load: ${event.nativeEvent.error}`);
          }
        }}
        onLayout={(event) => {
          if (__DEV__) {
            const { width, height } = event.nativeEvent.layout;
            console.log(
              `[${debugLabel}] laid out at ${width}x${height} (expected ${size}x${size})`,
            );
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // position:absolute + explicit zIndex:0 so this reliably paints BEHIND
  // whatever the caller renders after it (the photo, any outer ring, badges)
  // on every platform, as long as this is inserted as the FIRST child of a
  // position:'relative' wrapper around the avatar — matches every existing
  // avatar container in the app (avatarWrap/avatarStack/etc.), so call sites
  // don't need structural changes beyond adding this one element.
  wrap: {
    position: "absolute",
    zIndex: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  // TEMPORARY debug aid (see FIRE_RING_DEBUG_BORDER above): a loud, opaque
  // box so the ring's true bounding box is visible even if the PNG itself
  // fails to load or renders fully transparent.
  debugBox: {
    backgroundColor: "#FF00FF",
    borderWidth: 2,
    borderColor: "#00FFFF",
  },
});
