import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import PlayerBubble from "@/components/PlayerBubble";
import type { FireLevel } from "@/components/PlayerFireRing";
import { formatMomentumValue } from "@/components/ui/TopPlayerRow";
import type { LiveGamePlayer, LiveGameTeam } from "@/hooks/useLiveGame";
import { type JerseyTheme } from "@/src/lib/jerseyTheme";
import {
  computeTeamNilValues,
  formatNilValue,
  getNilValueColor,
  type NilPlayerInput,
} from "@/src/lib/ratings/nilValuation";
import { colors } from "@/theme/colors";

export type CourtRatingMode = "live" | "season" | "nil" | "age" | "momentum";

/**
 * Momentum's pill color: same green/red/neutral direction as the Live
 * Rankings leaderboard's momentum badge (TopPlayerRow.tsx), using this
 * screen's own up/down constants instead of pulling in useAppTheme (this
 * file has no theme dependency today).
 */
function getMomentumPillColor(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return colors.textMuted;
  }
  return value > 0 ? colors.upColor : colors.downColor;
}

type CourtOverlayProps = {
  teams: LiveGameTeam[];
  playersByTeam: Record<string, LiveGamePlayer[]>;
  onPlayerPress: (player: LiveGamePlayer) => void;
  /**
   * Which rating value each player's pill shows. Driven by the toggle above
   * the court so all pills swap together. Defaults to the live in-game rating.
   */
  ratingMode?: CourtRatingMode;
  /**
   * Vertical scale for the court box (1 = natural aspect). Values < 1 keep the
   * full width but reduce the height (e.g. 0.75 = 25% shorter). Player markers
   * shrink proportionally so they don't look oversized on the shorter court.
   */
  heightScale?: number;
  highlightedPlayerId?: string | null;
  highlightTrend?: "up" | "down" | "neutral" | null;
  highestRatedPlayerId?: string | null;
  theme?: JerseyTheme;
  homeLogoUri?: string | null;
  onHomeLogoReadyChange?: (ready: boolean) => void;
  debug?: boolean;
  showSeating?: boolean;
  style?: StyleProp<ViewStyle>;
};

type Slot = "PG" | "SG" | "SF" | "PF" | "C";
type End = "TOP" | "BOTTOM";
type SlottedPlayer = { slot: Slot; player: LiveGamePlayer };
type BubblePlacement = {
  player: LiveGamePlayer;
  left: `${number}%`;
  top: `${number}%`;
};
type ConferenceCourtMark = {
  shortLabel: string;
  wordmark: string;
  badgeFill: string;
  badgeStroke: string;
  textColor: string;
};

type PlayerHeatScore = {
  player: LiveGamePlayer;
  score: number;
  rating: number;
  impact: number;
};

// NFHS high school court geometry (feet)
const COURT_L = 84;
const COURT_W = 50;
const CENTER_CIRCLE_R = 6; // NFHS court diagram
const RIM_FROM_BASELINE = 5.25; // 5'3"
const BACKBOARD_FROM_BASELINE = 4;
const BACKBOARD_W = 6; // NFHS diagram uses standard 6' backboard
const FT_LINE_FROM_BACKBOARD = 15;
const LANE_W = 12;
const LANE_L = 19;
const FT_CIRCLE_R = 6; // NFHS diagram
const RESTRICTED_R = 4; // NFHS diagram
const THREE_R = 19.75; // 19'9"
// Was 5.25 — exactly COURT_W/2 - THREE_R, which forces the corner line to
// meet the arc precisely at the hoop's own height, degenerating into a bare
// 180 deg semicircle with zero real curvature beyond a half-circle. 7.5 keeps
// the corner CLOSER to the hoop's centerline than the arc's own radius
// reaches, so the arc has to rise above the hoop's height before the straight
// lines take over — the real NBA/WNBA-style "D" shape, not a plain half-circle.
// At these constants that works out to a ~14.4ft straight corner segment,
// matching the well-known real-world "14 feet" NBA corner-three fact.
const CORNER_THREE_FROM_SIDELINE = 7.5;
const TOP_RESTRICTED_RADIUS_FT = 4; // NCAA restricted-area radius
// Lane-space / block hash marks.
// TODO(NFHS court diagram): verify exact lane-space mark offsets for every mark position.
const HASH_LEN_FT = 0.75;
const HASH_GAP_FROM_BASELINE_FT = 4;
const HASH_SPACING_FT = 3;
const HASH_COUNT = 4;
// Stroke sizing controls
const STROKE_SCALE = 0.2;
const MIN_STROKE = 1.6;
const MAX_STROKE = 3.4;
const DEBUG_COURT = false;
const COURT_BG_COLOR = "#D6B37A";
const COURT_LINE_COLOR = "#1f1f1f";
const HARDWOOD_TONES = ["#d6b37a", "#d1ae75", "#dcb982", "#cfac73", "#d8b57d"];
const HARDWOOD_RECT_COL_FT = 0.85;
const HARDWOOD_RECT_H_FT = 4.25;
const HARDWOOD_SHADE_JITTER = 5;
const HARDWOOD_GLOBAL_DARKEN = -24;
const HARDWOOD_SEAM_COLOR = "rgba(120, 84, 48, 0.2)";
const CENTER_LOGO_WIDTH_RATIO = 0.48;
const CENTER_LOGO_OPACITY = 0.96;
const PLAYER_ANCHOR_X_OFFSET_PX = 52;
const PLAYER_ANCHOR_Y_OFFSET_PX = 42;
// Minimum center-to-center distance the repulsion pass in
// resolveBubblePlacements enforces between any two same-team bubbles. Was
// tuned to the avatar CIRCLE's own footprint only — since the name label
// below each bubble can render wider than the avatar itself (and renders
// with overflow:visible, so it isn't clipped), this needs real margin beyond
// just "circles don't touch" or two labels can still overlap even when the
// avatars themselves technically clear each other.
const PLAYER_MIN_SEPARATION_PX = 138;
// The 1-2-2 formation's PG-row sits close to the center-logo exclusion zone
// (see keepOutOfCenterLogoZone below) with the wing row not far past it —
// tighter than the old 2-row formation ever needed to pack. At the full
// PLAYER_MIN_SEPARATION_PX, the repulsion pass in resolveBubblePlacements
// couldn't satisfy every pairwise minimum within that space and cascaded
// into shoving the wing row up against the same boundary as PG, collapsing
// two rows onto one line. Relaxing the threshold specifically for this
// denser packing (still comfortably above the avatars' own visual
// footprint) lets each row settle at its authored position instead.
const DENSE_FORMATION_SEPARATION_FACTOR = 0.6;
const BUBBLE_HALF_W_PX = 52;
const BUBBLE_HALF_H_PX = 42;
const LOGO_PROTECTION_BUFFER_PX = 12;
const DEBUG_GLOSS = false;
const COURT_SPOTLIGHT_OPACITY = 0.2;
const COURT_VIGNETTE_OPACITY = 0.14;
const GLOSS_GROUP_OPACITY = 0.35;
const GLOSS_RADIUS_SCALE = 2.9;
const GLOSS_STRETCH_X = 1.1;
const GLOSS_STRETCH_Y = 2.35;
const GLOSS_LIGHTS = [
  { x: 10, y: 20, r: 2.2 },
  { x: 19, y: 22, r: 2.0 },
  { x: 36, y: 21, r: 2.4 },
  { x: 8, y: 33, r: 1.7 },
  { x: 24, y: 34, r: 2.0 },
  { x: 33, y: 37, r: 2.5 },
  { x: 9, y: 48, r: 2.1 },
  { x: 26, y: 47, r: 2.0 },
  { x: 35, y: 49, r: 2.2 },
  { x: 11, y: 61, r: 2.0 },
  { x: 29, y: 60, r: 1.9 },
  { x: 37, y: 62, r: 2.2 },
  { x: 22, y: 75, r: 2.1 },
  { x: 39, y: 74, r: 2.3 },
] as const;
// Standard "1-2-2" basketball formation: PG alone at the top of the key
// (closest to half-court), SG/SF spread wide at the wings, PF/C tucked
// closer together on the low blocks near the rim — wide up top, narrowing
// toward the basket.
//
// Authored in a per-half LOCAL coordinate space (0% horizontal = left
// sideline, 100% = right sideline; 0% vertical = the half-court line side,
// 100% = the baseline side) and then converted into this file's existing
// whole-court screen-percent convention, where screen top% runs 0-50% for
// the TOP half (0% = the far baseline drawn at the very top of the image,
// 50% = the half-court line at the image's vertical center) and 50-100% for
// the BOTTOM half (50% = half-court line, 100% = the near baseline at the
// very bottom). That conversion is: TOP screen_top = 50 * (1 -
// local_vertical/100); BOTTOM screen_top = 50 + 50 * (local_vertical/100).
// Horizontal carries over unchanged (both conventions run left sideline ->
// right sideline as 0% -> 100%), and both halves reuse the SAME horizontal
// values — the two halves are only mirrored top-to-bottom, not flipped
// left-to-right, matching how this file has always drawn them.
//
//   Slot  local(h,v)   TOP screen(left,top)   BOTTOM screen(left,top)
//   PG    50%, 25%     50%,   37.5%           50%,   62.5%
//   SG    90%, 65%     90%,   17.5%           90%,   82.5%
//   SF    10%, 65%     10%,   17.5%           10%,   82.5%
//   PF    58%, 80%     58%,   10%             58%,   90%
//   C     42%, 85%     42%,    7.5%           42%,   92.5%
//
// These are pulled in from a more textbook 50/25, 80/45, 70/80, 30/85 by the
// center-court logo: it's drawn at ~48% of the court's own width (see
// CENTER_LOGO_WIDTH_RATIO below), so keepOutOfCenterLogoZone in
// resolveBubblePlacements reserves a keep-out rectangle that eats roughly
// the inner 40% of each half's vertical space around the half-court line.
// PG (by definition the slot closest to half-court) always ends up pinned
// to the edge of that rectangle regardless of its authored value; SG/SF
// were pulled further toward the baseline and further apart horizontally so
// their own target clears the same boundary without the repulsion pass
// dragging them into it too (which is what originally collapsed the wing
// row onto the same line as PG). PF/C were pulled a little closer to
// court-center to buy the wing row enough horizontal separation from them
// in turn. The RELATIVE order and shape — PG closest to half-court, wings
// next, low blocks nearest the rim, narrowing baseline-ward — is unchanged
// from the spec; only the exact percentages were adjusted to actually clear
// the logo's exclusion zone on this court's current (height-compressed,
// heightScale < 1) box.
//
// PG/SG/SF/PF/C are mirror-symmetric left/right around 50% by construction
// (SG+SF and PF+C each average to court-center) on both halves;
// resolveBubblePlacements' repulsion/row-redistribution pass (below) relies
// on that symmetry to keep the wing pair and low-block pair each evenly
// spaced and centered even after collision-avoidance nudges them.
const TOP_HALF_SLOTS: Record<Slot, { left: `${number}%`; top: `${number}%` }> =
  {
    PG: { left: "50%", top: "37.5%" },
    SG: { left: "90%", top: "17.5%" },
    SF: { left: "10%", top: "17.5%" },
    PF: { left: "58%", top: "10%" },
    C: { left: "42%", top: "7.5%" },
  };

const BOTTOM_HALF_SLOTS: Record<
  Slot,
  { left: `${number}%`; top: `${number}%` }
> = {
  PG: { left: "50%", top: "62.5%" },
  SG: { left: "90%", top: "82.5%" },
  SF: { left: "10%", top: "82.5%" },
  PF: { left: "58%", top: "90%" },
  C: { left: "42%", top: "92.5%" },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `rgba(0,0,0,${alpha})`;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function nudgeHex(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return hex;
  }
  const clampChannel = (value: number) => Math.max(0, Math.min(255, value));
  const r = clampChannel(Number.parseInt(raw.slice(0, 2), 16) + amount);
  const g = clampChannel(Number.parseInt(raw.slice(2, 4), 16) + amount);
  const b = clampChannel(Number.parseInt(raw.slice(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function pickTopFive(
  players: LiveGamePlayer[],
  prioritizedPlayerId?: string | null,
): LiveGamePlayer[] {
  const onCourt = players.filter((player) => player.onCourt);
  const byMinutes = [...players].sort(
    (a, b) => b.minutes - a.minutes || b.points - a.points,
  );

  if (onCourt.length >= 5) {
    return [...onCourt]
      .sort((a, b) => b.minutes - a.minutes || b.points - a.points)
      .slice(0, 5);
  }

  const picked = [...onCourt];
  const taken = new Set(picked.map((player) => player.id));
  byMinutes.forEach((player) => {
    if (picked.length >= 5) {
      return;
    }

    if (!taken.has(player.id)) {
      picked.push(player);
      taken.add(player.id);
    }
  });

  const topFive = picked.slice(0, 5);
  if (!prioritizedPlayerId) {
    return topFive;
  }

  const prioritizedPlayer =
    players.find((player) => player.id === prioritizedPlayerId) ?? null;
  if (!prioritizedPlayer) {
    return topFive;
  }
  if (topFive.some((player) => player.id === prioritizedPlayer.id)) {
    return topFive;
  }
  if (topFive.length === 0) {
    return [prioritizedPlayer];
  }

  return [...topFive.slice(0, Math.max(0, topFive.length - 1)), prioritizedPlayer];
}

function normalizeTeamColor(value: string | undefined | null, fallback: string): string {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

const CONFERENCE_STYLE_MAP: Record<
  string,
  { badgeFill: string; badgeStroke: string; textColor: string }
> = {
  ACC: { badgeFill: "#0b52c2", badgeStroke: "#1d6df0", textColor: "#f5f7fb" },
  SEC: { badgeFill: "#122347", badgeStroke: "#213d75", textColor: "#f5f7fb" },
  B1G: { badgeFill: "#14264f", badgeStroke: "#2b4f99", textColor: "#f5f7fb" },
  "BIG 12": { badgeFill: "#193155", badgeStroke: "#2d5c9f", textColor: "#f5f7fb" },
  "BIG EAST": { badgeFill: "#103f7a", badgeStroke: "#2668ba", textColor: "#f5f7fb" },
  "PAC-12": { badgeFill: "#0d6c89", badgeStroke: "#1ea0c7", textColor: "#f5f7fb" },
  MWC: { badgeFill: "#174590", badgeStroke: "#2b69c9", textColor: "#f5f7fb" },
  WCC: { badgeFill: "#173b78", badgeStroke: "#2d5ba7", textColor: "#f5f7fb" },
};

function normalizeConferenceShortLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized === "BIG TEN") return "B1G";
  if (normalized === "BIG TWELVE") return "BIG 12";
  if (normalized === "MOUNTAIN WEST") return "MWC";
  if (normalized === "WEST COAST") return "WCC";
  if (normalized === "PAC 12") return "PAC-12";
  return normalized;
}

function createConferenceCourtMark(
  teams: LiveGameTeam[],
): ConferenceCourtMark | null {
  const labels = teams
    .map((team) => team.conference?.shortName || team.conference?.name || "")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (labels.length === 0) {
    return null;
  }

  const sharedLabel = labels.every(
    (label) => normalizeConferenceShortLabel(label) === normalizeConferenceShortLabel(labels[0]),
  )
    ? labels[0]
    : labels[0];
  const shortLabel = normalizeConferenceShortLabel(sharedLabel);
  const style = CONFERENCE_STYLE_MAP[shortLabel] ?? {
    badgeFill: "#151515",
    badgeStroke: "#2c2c2c",
    textColor: "#f5f5f5",
  };

  return {
    shortLabel,
    wordmark: shortLabel,
    badgeFill: style.badgeFill,
    badgeStroke: style.badgeStroke,
    textColor: style.textColor,
  };
}

function buildConferenceBadgePath(
  cx: number,
  cy: number,
  width: number,
  height: number,
  skew: number,
): string {
  const left = cx - width / 2;
  const right = cx + width / 2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;

  return [
    `M ${left + skew} ${top}`,
    `L ${right} ${top}`,
    `L ${right - skew} ${bottom}`,
    `L ${left} ${bottom}`,
    "Z",
  ].join(" ");
}

type PositionRole = "pg" | "sg" | "sf" | "pf" | "center" | "guard" | "forward" | "unknown";

// Roster position strings vary by source: some feeds give the specific
// PG/SG/SF/PF/C abbreviation, others only the generic G/F/C bucket (see
// expandPosition's POSITION_NAMES in CourtLineupDock.tsx, which handles both
// shapes too). Specific tokens are checked first so real position data is
// always honored when available; assignSlots falls back to the generic
// guard/forward bucket (split by height, see below) only when the feed
// doesn't distinguish PG from SG or SF from PF.
function classifyPosition(rawPosition: string | undefined): PositionRole {
  const pos = (rawPosition || "").trim().toUpperCase();
  if (!pos) return "unknown";
  if (pos.includes("PG")) return "pg";
  if (pos.includes("SG")) return "sg";
  if (pos.includes("SF")) return "sf";
  if (pos.includes("PF")) return "pf";
  if (pos.includes("C")) return "center";
  if (pos.includes("G")) return "guard";
  if (pos.includes("F")) return "forward";
  return "unknown";
}

function compareByHeightAsc(a: LiveGamePlayer, b: LiveGamePlayer): number {
  const aHeight = typeof a.heightInches === "number" ? a.heightInches : Number.POSITIVE_INFINITY;
  const bHeight = typeof b.heightInches === "number" ? b.heightInches : Number.POSITIVE_INFINITY;
  if (aHeight !== bHeight) {
    return aHeight - bHeight;
  }
  return b.minutes - a.minutes || b.points - a.points || a.lastName.localeCompare(b.lastName);
}

function compareByHeightDesc(a: LiveGamePlayer, b: LiveGamePlayer): number {
  const aHeight = typeof a.heightInches === "number" ? a.heightInches : Number.NEGATIVE_INFINITY;
  const bHeight = typeof b.heightInches === "number" ? b.heightInches : Number.NEGATIVE_INFINITY;
  if (aHeight !== bHeight) {
    return bHeight - aHeight;
  }
  return b.minutes - a.minutes || b.points - a.points || a.lastName.localeCompare(b.lastName);
}

function assignSlots(
  players: LiveGamePlayer[],
  prioritizedPlayerId?: string | null,
): SlottedPlayer[] {
  const lineup = pickTopFive(players, prioritizedPlayerId);
  if (lineup.length === 0) {
    return [];
  }
  const remaining = [...lineup];
  const roleById = new Map(remaining.map((player) => [player.id, classifyPosition(player.position)]));
  const roleOf = (player: LiveGamePlayer) => roleById.get(player.id) ?? "unknown";

  const used = new Set<string>();
  const available = (): LiveGamePlayer[] => remaining.filter((player) => !used.has(player.id));
  const take = (player: LiveGamePlayer) => used.add(player.id);
  // Picks the best match for a slot: an explicit position token first (e.g.
  // "PG" for the point guard slot), then the shared generic bucket a more
  // specific token would also fall under ("guard" for PG/SG, "forward" for
  // SF/PF — used when the roster data only has the generic G/F/C label),
  // then whatever's left, so every slot is always filled as long as the
  // lineup has players remaining.
  const pick = (
    specific: PositionRole,
    generic?: PositionRole,
    order: "asc" | "desc" = "asc",
  ): LiveGamePlayer | undefined => {
    const compare = order === "asc" ? compareByHeightAsc : compareByHeightDesc;
    const bySpecific = available().filter((player) => roleOf(player) === specific).sort(compare);
    const byGeneric = generic
      ? available().filter((player) => roleOf(player) === generic).sort(compare)
      : [];
    const fallback = [...available()].sort(compare);
    const player = bySpecific[0] ?? byGeneric[0] ?? fallback[0];
    if (player) {
      take(player);
    }
    return player;
  };

  // Center first (least ambiguous pick): an explicit "C" if the roster data
  // has one, else the tallest player that ISN'T guard-flavored (a generic
  // "forward" or unlabeled big is a much more plausible center than a
  // guard), and only as an absolute last resort the tallest player overall.
  const trueCenters = available().filter((player) => roleOf(player) === "center").sort(compareByHeightDesc);
  const nonGuardBigs = available()
    .filter((player) => !["guard", "pg", "sg"].includes(roleOf(player)))
    .sort(compareByHeightDesc);
  const center = trueCenters[0] ?? nonGuardBigs[0] ?? [...available()].sort(compareByHeightDesc)[0];
  if (center) {
    take(center);
  }

  // Point guard and shooting guard from the guard pool (shorter -> PG,
  // taller -> SG when only a generic "guard" label is available — PG tends
  // to be the smaller of the two in practice), then small/power forward the
  // same way (shorter -> SF, taller -> PF), leaving whoever's left for
  // whichever slot didn't get an explicit or generic match.
  const pg = pick("pg", "guard", "asc");
  const sg = pick("sg", "guard", "asc");
  const sf = pick("sf", "forward", "asc");
  const pf = pick("pf", "forward", "desc");

  const slots: SlottedPlayer[] = [];
  if (pg) {
    slots.push({ slot: "PG", player: pg });
  }
  if (sg) {
    slots.push({ slot: "SG", player: sg });
  }
  if (sf) {
    slots.push({ slot: "SF", player: sf });
  }
  if (pf) {
    slots.push({ slot: "PF", player: pf });
  }
  if (center) {
    slots.push({ slot: "C", player: center });
  }

  return slots;
}

function toFiniteNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildTeamHeatLevels(players: LiveGamePlayer[]): Map<string, FireLevel> {
  const heat = new Map<string, FireLevel>();
  if (players.length === 0) {
    return heat;
  }

  const scored: PlayerHeatScore[] = players.map((player) => {
    const rating = toFiniteNumber(player.inGameRating10, 0);
    const ratingNorm = clamp((rating - 5.8) / 4.1, 0, 1);
    const impactRaw = Math.max(
      0,
      toFiniteNumber(
        player.lastMeaningfulImpact?.displayDelta ?? player.lastMeaningfulImpact?.delta,
        0,
      ),
    );
    const impactNorm = clamp(impactRaw / 0.75, 0, 1);
    const minutes = Math.max(1, toFiniteNumber(player.minutes, 0));
    const pointsPerMinute = toFiniteNumber(player.points, 0) / minutes;
    const scoringNorm = clamp(pointsPerMinute / 0.9, 0, 1);
    const minuteTrendBoost = player.minutesIncreasing ? 0.05 : 0;
    const score =
      ratingNorm * 0.62 + impactNorm * 0.26 + scoringNorm * 0.12 + minuteTrendBoost;

    return {
      player,
      score,
      rating,
      impact: impactRaw,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const eligible = scored.filter((entry) => entry.score >= 0.48).slice(0, 3);

  eligible.forEach((entry, index) => {
    let level: FireLevel = 1;
    if (entry.score >= 0.75) {
      level = 2;
    }
    if (
      index === 0 &&
      entry.score >= 0.92 &&
      entry.rating >= 9.1 &&
      entry.impact >= 0.35
    ) {
      level = 3;
    }
    heat.set(entry.player.id, level);
  });

  return heat;
}

function percentToNumber(value: `${number}%`): number {
  return Number.parseFloat(value.replace("%", ""));
}

function toPercent(value: number): `${number}%` {
  return `${value.toFixed(2)}%` as `${number}%`;
}

function resolveBubblePlacements(
  slotted: SlottedPlayer[],
  slotMap: Record<Slot, { left: `${number}%`; top: `${number}%` }>,
  end: End,
  layout: { width: number; height: number },
  centerLogoSizePx: number,
  // Edge/logo-protection buffers below are all modeling the avatar bubble's
  // OWN footprint (half-width/half-height + a little breathing room), so
  // they need to shrink in lockstep with the avatar itself — otherwise a
  // smaller avatar (e.g. from a vertically-compressed court) inherits
  // clearances sized for the full 56px avatar, eating more of the shrunken
  // court than necessary and crowding the formation toward the center.
  avatarScale: number,
): BubblePlacement[] {
  if (layout.width <= 0 || layout.height <= 0) {
    return slotted.map(({ slot, player }) => ({
      player,
      left: slotMap[slot].left,
      top: slotMap[slot].top,
    }));
  }

  const anchorXOffset = PLAYER_ANCHOR_X_OFFSET_PX * avatarScale;
  const anchorYOffset = PLAYER_ANCHOR_Y_OFFSET_PX * avatarScale;
  const bubbleHalfW = BUBBLE_HALF_W_PX * avatarScale;
  const bubbleHalfH = BUBBLE_HALF_H_PX * avatarScale;
  const logoProtectionBuffer = LOGO_PROTECTION_BUFFER_PX * avatarScale;
  // Like the clearances above, the minimum on-screen separation between two
  // players needs to shrink with the avatar itself — at a fixed 138px this
  // was already tuned for the full-size 56px avatar, so on a
  // height-compressed court (smaller avatarScale) it stayed just as
  // restrictive even though the avatars themselves got visibly smaller.
  // DENSE_FORMATION_SEPARATION_FACTOR further relaxes it for this
  // formation's tighter packing specifically — see that constant's comment.
  // Floored at the bubble's own pixel diameter (+ a small margin): the 0.6x
  // relaxation above was assumed to still clear the avatar's "own visual
  // footprint," but at this component's actual BUBBLE_HALF_W_PX/avatarScale
  // values that assumption doesn't hold — the relaxed value can land BELOW
  // the avatar's diameter, which is exactly what let the PF/C low-block pair
  // render with overlapping photos/labels on a heightScale-compressed court.
  const minSeparationPx = Math.max(
    PLAYER_MIN_SEPARATION_PX * avatarScale * DENSE_FORMATION_SEPARATION_FACTOR,
    bubbleHalfW * 2 + 6,
  );

  const minX = anchorXOffset + 4;
  const maxX = layout.width - anchorXOffset - 4;
  const minY = anchorYOffset + 4;
  const maxY = layout.height - anchorYOffset - 6;
  const minLogoSafeY = minY + 24;
  const maxLogoSafeY = maxY - 24;
  const centerY = layout.height / 2;
  const centerX = layout.width / 2;
  const protectedHalfW = centerLogoSizePx / 2 + bubbleHalfW + logoProtectionBuffer;
  const protectedHalfH = centerLogoSizePx / 2 + bubbleHalfH + logoProtectionBuffer;
  const protectedLeft = centerX - protectedHalfW;
  const protectedRight = centerX + protectedHalfW;
  const protectedTop = clamp(centerY - protectedHalfH, minLogoSafeY, maxLogoSafeY);
  const protectedBottom = clamp(centerY + protectedHalfH, minLogoSafeY, maxLogoSafeY);
  const logoSafeHalfHeight = Math.max(56, protectedHalfH);
  let protectionAdjustments = 0;

  let topMaxY = Math.min(maxY, centerY - logoSafeHalfHeight);
  let bottomMinY = Math.max(minY, centerY + logoSafeHalfHeight);

  // Keep a usable lane even on short screens.
  if (topMaxY < minY + 24) {
    topMaxY = Math.min(maxY, centerY - 56);
  }
  if (bottomMinY > maxY - 24) {
    bottomMinY = Math.max(minY, centerY + 56);
  }

  const clampX = (value: number) => clamp(value, minX, maxX);
  const clampY = (value: number) =>
    end === "TOP"
      ? clamp(value, minY, topMaxY)
      : clamp(value, bottomMinY, maxY);
  const keepOutOfCenterLogoZone = (x: number, y: number): { x: number; y: number } => {
    if (
      x >= protectedLeft &&
      x <= protectedRight &&
      y >= protectedTop &&
      y <= protectedBottom
    ) {
      protectionAdjustments += 1;
      return {
        x,
        y: end === "TOP" ? protectedTop - 1 : protectedBottom + 1,
      };
    }
    return { x, y };
  };

  const nodes = slotted.map(({ slot }, index) => ({
    index,
    ...(() => {
      const initial = {
        x: clampX((percentToNumber(slotMap[slot].left) / 100) * layout.width),
        y: clampY((percentToNumber(slotMap[slot].top) / 100) * layout.height),
      };
      return keepOutOfCenterLogoZone(initial.x, initial.y);
    })(),
  }));

  for (let iteration = 0; iteration < 40; iteration += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minSeparationPx) {
          continue;
        }

        moved = true;
        const overlap = (minSeparationPx - distance) / 2;
        const ux = distance > 0 ? dx / distance : j % 2 === 0 ? 1 : -1;
        const uy = distance > 0 ? dy / distance : 0;
        const yScale = 0.7;

        a.x = clampX(a.x - ux * overlap);
        b.x = clampX(b.x + ux * overlap);
        a.y = clampY(a.y - uy * overlap * yScale);
        b.y = clampY(b.y + uy * overlap * yScale);
        const nextA = keepOutOfCenterLogoZone(a.x, a.y);
        const nextB = keepOutOfCenterLogoZone(b.x, b.y);
        a.x = clampX(nextA.x);
        a.y = clampY(nextA.y);
        b.x = clampX(nextB.x);
        b.y = clampY(nextB.y);
      }
    }

    if (!moved) {
      break;
    }
  }

  // Final same-row pass: group nodes by their KNOWN slot role (wing row:
  // SG/SF, low-block row: PF/C — PG is alone at the top of the key and never
  // needs redistribution) rather than by dynamic Y-proximity. Proximity-based
  // grouping (clustering any nodes whose Y landed within some threshold of
  // each other post-repulsion) could pull PG into the wing row whenever the
  // repulsion loop's damped vertical push (yScale 0.7) happened to land it
  // close enough. Grouping by role guarantees the wing row is always exactly
  // SG/SF and the block row always exactly PF/C, regardless of where
  // repulsion nudged them.
  //
  // Each row's gap is sized from its OWN seed percentages (in slotMap)
  // rather than one shared constant — both rows have exactly 2 members, so a
  // shared gap would flatten the wings and low blocks to the identical
  // width and erase the formation's intended "wide up top, narrow at the
  // rim" shape. It's floored at the same minimum on-screen separation used
  // by the repulsion pass above, so it only ever widens (never
  // re-introduces overlap) on a cramped/short screen. (This used to be
  // discounted to 0.75x that minimum, which contradicted the comment above
  // and was the direct cause of the PF/C low-block pair rendering with
  // overlapping photos/labels — the seed gap for that row is narrow by
  // design, so the discounted floor was the only thing standing between it
  // and overlap, and it wasn't tight enough.)
  const rowMinGapPx = minSeparationPx;
  const rowSlotGroups: Slot[][] = [
    ["SG", "SF"],
    ["PF", "C"],
  ];
  // PG sits alone, pinned to court-center (x = centerX) and — on a
  // heightScale-compressed court — is also pinned vertically against the
  // center-logo exclusion zone with no room left to move further away (see
  // the dedicated PG pass below, which finds zero slack in exactly this
  // case). So a row's own mutual gap (sized only to clear its OWN two
  // members) can still land within minSeparationPx of PG, which is what let
  // the PG bubble overlap the low-block row's photos. Since each row is
  // symmetric around centerX by construction, a member's distance to PG (at
  // centerX, fixed y) is exactly sqrt((gapPx/2)^2 + dy^2); solving that
  // for minSeparationPx gives the gap this row actually needs to clear PG,
  // independent of the row's own seed spacing.
  const pgNodeForRowClearance = nodes.find(
    (node) => slotted[node.index].slot === "PG",
  );
  for (const groupSlots of rowSlotGroups) {
    const groupSlotSet = new Set(groupSlots);
    const row = nodes.filter((node) => groupSlotSet.has(slotted[node.index].slot));
    if (row.length < 2) {
      continue;
    }
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const n = sortedRow.length;
    const seedXs = groupSlots.map(
      (slot) => (percentToNumber(slotMap[slot].left) / 100) * layout.width,
    );
    const seedGapPx = Math.max(...seedXs) - Math.min(...seedXs);
    let gapPx = Math.max(seedGapPx / (n - 1), rowMinGapPx);
    if (pgNodeForRowClearance && n === 2) {
      const dy = Math.abs(pgNodeForRowClearance.y - row[0].y);
      if (dy < minSeparationPx) {
        const requiredGapPx =
          2 * Math.sqrt(minSeparationPx * minSeparationPx - dy * dy);
        gapPx = Math.max(gapPx, requiredGapPx);
      }
    }
    const span = gapPx * (n - 1);
    // Both the wing pair and the low-block pair are mirror-symmetric around
    // court-center by construction (see the TOP_HALF_SLOTS/BOTTOM_HALF_SLOTS
    // table above), so pinning the pivot to the court's actual horizontal
    // midpoint — rather than the row's own (possibly repulsion-skewed)
    // average X — keeps either pair centered even if one side got nudged
    // further than the other to avoid the center-logo zone.
    const pivot = centerX;
    // Shift the row as a whole to fit within bounds — never clamp a single
    // node's X independently here, since that's what caused the pileup.
    let startX = clamp(pivot - span / 2, minX, Math.max(minX, maxX - span));
    sortedRow.forEach((node, i) => {
      node.x = clampX(startX + i * gapPx);
      const adjusted = keepOutOfCenterLogoZone(node.x, node.y);
      node.x = clampX(adjusted.x);
      node.y = clampY(adjusted.y);
    });
  }

  // Row redistribution above only touches X, and specifically pulls each row
  // back toward court-center (pivot = centerX) — the same X neighborhood PG
  // sits in. That can shrink a row node's distance to PG below
  // minSeparationPx even though the repulsion pass earlier verified every
  // pair cleared it BEFORE redistribution moved them, which is what let the
  // PG bubble render overlapping the low-block (PF/C) row. Re-check PG
  // against every row node here and, if still too close, push PG itself
  // straight along Y (never X, which would break its authored top-of-key
  // centering, and never the row node, which would break the row's
  // now-fixed symmetric spacing).
  const pgNode = nodes.find((node) => slotted[node.index].slot === "PG");
  if (pgNode) {
    const otherNodes = nodes.filter((node) => node !== pgNode);
    const pushDir = end === "TOP" ? 1 : -1;
    for (let pass = 0; pass < 10; pass += 1) {
      let stillTooClose = false;
      for (const otherNode of otherNodes) {
        const dx = pgNode.x - otherNode.x;
        const dy = pgNode.y - otherNode.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minSeparationPx) {
          continue;
        }
        stillTooClose = true;
        const deficit = minSeparationPx - distance;
        pgNode.y = clampY(pgNode.y + pushDir * deficit);
      }
      if (!stillTooClose) {
        break;
      }
    }
  }

  if (__DEV__ && protectionAdjustments > 0) {
    console.log(
      `[CourtOverlay] adjusted ${protectionAdjustments} node(s) to protect center logo (${end}).`,
    );
  }

  const byIndex = [...nodes].sort((a, b) => a.index - b.index);
  return byIndex.map((node, index) => ({
    player: slotted[index].player,
    left: toPercent((node.x / layout.width) * 100),
    top: toPercent((node.y / layout.height) * 100),
  }));
}

function polar(
  cx: number,
  cy: number,
  r: number,
  degrees: number,
): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const delta = endDeg - startDeg;
  const largeArcFlag = Math.abs(delta) > 180 ? 1 : 0;
  const sweepFlag = delta >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

function arcPathWithSweep(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  sweepFlag: 0 | 1,
): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const delta = endDeg - startDeg;
  const largeArcFlag = Math.abs(delta) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

// Elliptical counterpart of arcPathWithSweep — required whenever the court's
// x/y pixel scale differ (heightScale !== 1, i.e. scaleX !== scaleY). A
// circle defined in feet-space (equal radius on both axes) renders as a true
// ELLIPSE once each axis is scaled independently, with rx = feet-radius *
// scaleX and ry = feet-radius * scaleY. Critically, the eccentric-anomaly
// angle (the "degrees" used to parametrize a point around the shape) is
// preserved by that per-axis scaling — cos(theta)/sin(theta) unchanged,
// only the radii multiplying them differ — so the SAME startDeg/endDeg
// computed in feet-space are reused here unmodified; only the point
// formula changes from cx + r*cos/sin to cx + rx*cos, cy + ry*sin. Using a
// single uniform radius (the old arcPathWithSweep) for this arc while its
// start/end anchor points were computed via independent-axis toPxX/toPxY
// caused the drawn curve to not actually pass through those anchor points,
// producing a visibly broken/disjointed arc whenever scaleX !== scaleY.
function ellipticalArcPathWithSweep(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  sweepFlag: 0 | 1,
): string {
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;
  const start = { x: cx + rx * Math.cos(startRad), y: cy + ry * Math.sin(startRad) };
  const end = { x: cx + rx * Math.cos(endRad), y: cy + ry * Math.sin(endRad) };
  const delta = endDeg - startDeg;
  const largeArcFlag = Math.abs(delta) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${rx} ${ry} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

function buildThreePointPath(
  end: End,
  t: CourtTransform,
): {
  path: string;
  cornerLeft: { x1: number; y1: number; x2: number; y2: number };
  cornerRight: { x1: number; y1: number; x2: number; y2: number };
  arcStart: { x: number; y: number };
  arcEnd: { x: number; y: number };
  hoop: { x: number; y: number };
} {
  const hoopX = COURT_W / 2;
  const hoopTopY = RIM_FROM_BASELINE;
  const hoopBottomY = COURT_L - RIM_FROM_BASELINE;
  const cornerLeftX = CORNER_THREE_FROM_SIDELINE;
  const cornerRightX = COURT_W - CORNER_THREE_FROM_SIDELINE;
  const hoopY = end === "TOP" ? hoopTopY : hoopBottomY;
  const baselineY = end === "TOP" ? 0 : COURT_L;

  // Real three-point line shape: a straight segment from the baseline up to
  // wherever the THREE_R-radius circle (centered on the hoop) crosses the
  // corner line, then the arc takes over for the rest. That crossing point
  // is generally ABOVE the hoop's own height (further from the baseline),
  // not at the same height as the hoop — using a fixed 180/0 sweep like a
  // plain semicircle was only "correct" for the one special-case set of
  // constants where the corner distance exactly equals COURT_W/2 - THREE_R.
  const deltaX = hoopX - cornerLeftX;
  const riseFromHoop = Math.sqrt(Math.max(0, THREE_R * THREE_R - deltaX * deltaX));
  const direction = end === "TOP" ? 1 : -1;
  const cornerEndY = hoopY + direction * riseFromHoop;

  const leftPoint = { x: cornerLeftX, y: cornerEndY };
  const rightPoint = { x: cornerRightX, y: cornerEndY };
  const startDeg = (Math.atan2(leftPoint.y - hoopY, leftPoint.x - hoopX) * 180) / Math.PI;
  const endDeg = (Math.atan2(rightPoint.y - hoopY, rightPoint.x - hoopX) * 180) / Math.PI;
  // Top arc bulges toward midcourt (downward in screen coords); bottom is mirrored (upward).
  const sweepFlag: 0 | 1 = end === "TOP" ? 0 : 1;

  // Per-axis radii (not toPxLen's uniform radius) — see ellipticalArcPathWithSweep
  // for why this is required whenever the court is non-uniformly scaled
  // (heightScale !== 1). This keeps the drawn curve passing exactly through
  // arcStart/arcEnd below, which are also computed via per-axis toPxX/toPxY.
  const path = ellipticalArcPathWithSweep(
    t.toPxX(hoopX),
    t.toPxY(hoopY),
    t.toPxW(THREE_R),
    t.toPxH(THREE_R),
    startDeg,
    endDeg,
    sweepFlag,
  );

  return {
    path,
    cornerLeft: {
      x1: t.toPxX(cornerLeftX),
      y1: t.toPxY(baselineY),
      x2: t.toPxX(cornerLeftX),
      y2: t.toPxY(cornerEndY),
    },
    cornerRight: {
      x1: t.toPxX(cornerRightX),
      y1: t.toPxY(baselineY),
      x2: t.toPxX(cornerRightX),
      y2: t.toPxY(cornerEndY),
    },
    arcStart: { x: t.toPxX(leftPoint.x), y: t.toPxY(leftPoint.y) },
    arcEnd: { x: t.toPxX(rightPoint.x), y: t.toPxY(rightPoint.y) },
    hoop: { x: t.toPxX(hoopX), y: t.toPxY(hoopY) },
  };
}

type CourtTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  courtPxW: number;
  courtPxH: number;
  toPxX: (feetX: number) => number;
  toPxY: (feetY: number) => number;
  // Uniform (min(scaleX, scaleY)) length mapping — use ONLY for things that
  // must stay round/undistorted (circle radii, stroke widths, font sizes).
  toPxLen: (feet: number) => number;
  // Independent-axis width/height mapping (scaleX / scaleY respectively) —
  // use for anything that must fill the container edge-to-edge along that
  // axis, e.g. background/floor fill rects. When the container is
  // non-uniformly scaled (scaleX !== scaleY, as with a height-only
  // heightScale), toPxLen alone undershoots the container's actual pixel
  // width/height and leaves a gap — the wood-floor seam bug.
  toPxW: (feet: number) => number;
  toPxH: (feet: number) => number;
};

type FreeThrowSemicircle = {
  path: string;
  transform?: string;
  center: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
  mid: { x: number; y: number };
};

function buildTransform(pxWidth: number, pxHeight: number): CourtTransform {
  // Fill the container on both axes independently. When the container keeps the
  // court's natural aspect ratio (COURT_W/COURT_L) scaleX === scaleY, so this is
  // identical to a uniform fit. When the container is deliberately shortened
  // (full width, reduced height) the court compresses vertically to match, and
  // the player markers — positioned as container-percentages — stay aligned.
  const scaleX = pxWidth / COURT_W;
  const scaleY = pxHeight / COURT_L;
  // Uniform reference for stroke widths / circular radii so they stay round.
  const scale = Math.min(scaleX, scaleY);

  const toPxX = (feetX: number) => feetX * scaleX;
  const toPxY = (feetY: number) => feetY * scaleY;
  const toPxLen = (feet: number) => feet * scale;
  const toPxW = (feet: number) => feet * scaleX;
  const toPxH = (feet: number) => feet * scaleY;

  return {
    scale,
    offsetX: 0,
    offsetY: 0,
    courtPxW: COURT_W * scaleX,
    courtPxH: COURT_L * scaleY,
    toPxX,
    toPxY,
    toPxLen,
    toPxW,
    toPxH,
  };
}

function buildTransformWithSeatPad(
  pxWidth: number,
  pxHeight: number,
  seatPadFeet: number,
): CourtTransform {
  if (seatPadFeet <= 0) {
    return buildTransform(pxWidth, pxHeight);
  }

  const worldW = COURT_W + seatPadFeet * 2;
  const worldH = COURT_L + seatPadFeet * 2;
  const scale = Math.min(pxWidth / worldW, pxHeight / worldH);
  const worldPxW = worldW * scale;
  const worldPxH = worldH * scale;
  const offsetX = (pxWidth - worldPxW) / 2;
  const offsetY = (pxHeight - worldPxH) / 2;

  const toPxX = (feetX: number) => offsetX + (feetX + seatPadFeet) * scale;
  const toPxY = (feetY: number) => offsetY + (feetY + seatPadFeet) * scale;
  const toPxLen = (feet: number) => feet * scale;

  return {
    scale,
    offsetX,
    offsetY,
    courtPxW: COURT_W * scale,
    courtPxH: COURT_L * scale,
    toPxX,
    toPxY,
    toPxLen,
    // This branch is a uniform letterboxed fit (seatPadFeet > 0), so there's
    // no separate X/Y scale to distinguish — same mapping as toPxLen.
    toPxW: toPxLen,
    toPxH: toPxLen,
  };
}

function devGeometryChecks(t: CourtTransform) {
  if (!__DEV__) {
    return;
  }

  const ratio = t.courtPxH / t.courtPxW;
  const expectedRatio = COURT_L / COURT_W;
  const ratioDiff = Math.abs(ratio - expectedRatio);

  const hoopY = t.toPxY(RIM_FROM_BASELINE);
  const threeStartX = t.toPxX(CORNER_THREE_FROM_SIDELINE);
  const hoopX = t.toPxX(COURT_W / 2);
  const computedThreeRFeet = Math.abs(threeStartX - hoopX) / t.scale;

  const laneWidthFeet = t.toPxLen(LANE_W) / t.scale;
  const ftFromBackboardFeet =
    Math.abs(
      t.toPxY(BACKBOARD_FROM_BASELINE + FT_LINE_FROM_BACKBOARD) -
        t.toPxY(BACKBOARD_FROM_BASELINE),
    ) / t.scale;

  const ok =
    ratioDiff < 0.001 &&
    Math.abs(computedThreeRFeet - THREE_R) < 0.05 &&
    Math.abs(laneWidthFeet - LANE_W) < 0.01 &&
    Math.abs(ftFromBackboardFeet - FT_LINE_FROM_BACKBOARD) < 0.01;

  if (!ok) {
    console.warn("[CourtOverlay] geometry check failed", {
      ratio,
      expectedRatio,
      computedThreeRFeet,
      laneWidthFeet,
      ftFromBackboardFeet,
    });
  }

  // reference to avoid unused local in dev check
  void hoopY;
}

function buildFreeThrowSemicircle(
  end: End,
  t: CourtTransform,
): FreeThrowSemicircle {
  const centerX = COURT_W / 2;
  const centerY = end === "TOP" ? LANE_L : COURT_L - LANE_L;
  const startDeg = 180;
  const endDeg = 0;
  // Build one canonical semicircle, then mirror with transform for BOTTOM.
  const sweepFlag: 0 | 1 = 0;
  const midDeg = end === "TOP" ? 90 : 270;
  const centerPxY = t.toPxY(centerY);

  return {
    path: arcPathWithSweep(
      t.toPxX(centerX),
      centerPxY,
      t.toPxLen(FT_CIRCLE_R),
      startDeg,
      endDeg,
      sweepFlag,
    ),
    transform:
      end === "BOTTOM" ? `matrix(1 0 0 -1 0 ${2 * centerPxY})` : undefined,
    center: { x: t.toPxX(centerX), y: t.toPxY(centerY) },
    left: { x: t.toPxX(centerX - FT_CIRCLE_R), y: t.toPxY(centerY) },
    right: { x: t.toPxX(centerX + FT_CIRCLE_R), y: t.toPxY(centerY) },
    mid: {
      x: t.toPxX(centerX + FT_CIRCLE_R * Math.cos((midDeg * Math.PI) / 180)),
      y: t.toPxY(centerY + FT_CIRCLE_R * Math.sin((midDeg * Math.PI) / 180)),
    },
  };
}

function resolveDisplayRating(
  player: LiveGamePlayer,
  ratingMode: CourtRatingMode,
): number | null {
  if (ratingMode === "season") return player.seasonRating10;
  if (ratingMode === "live") return player.inGameRating10;
  // "age" requires external data not yet in the player model.
  return null;
}

function toNilPlayerInput(player: LiveGamePlayer): NilPlayerInput {
  return {
    playerId: player.id,
    seasonRating10: player.seasonRating10,
    minutes: player.minutes,
    fga: player.fga,
    fta: player.fta,
    turnovers: player.turnovers,
    position: player.position,
  };
}

function CourtOverlay({
  teams,
  playersByTeam,
  onPlayerPress,
  ratingMode = "live",
  heightScale = 1,
  highlightedPlayerId = null,
  highlightTrend = null,
  highestRatedPlayerId = null,
  theme,
  homeLogoUri = null,
  onHomeLogoReadyChange,
  debug = false,
  showSeating = false,
  style,
}: CourtOverlayProps) {
  const renderStartRef = useRef(performance.now());
  renderStartRef.current = performance.now();
  useEffect(() => {
    if (__DEV__) {
      const now = performance.now();
      console.log(
        `[timing] CourtOverlay committed+painted @ ${now.toFixed(1)}ms (render body took ${(now - renderStartRef.current).toFixed(1)}ms)`,
      );
    }
  });

  const awayTeam =
    teams.find((team) => team.homeAway === "away") ?? teams[0] ?? null;
  const homeTeam =
    teams.find((team) => team.homeAway === "home") ?? teams[1] ?? null;

  // Computed once per roster (NIL shares are normalized team-wide, not per
  // player), only when the toggle is actually in NIL mode.
  const nilValuesByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    if (ratingMode !== "nil") {
      return map;
    }
    [awayTeam, homeTeam].forEach((team) => {
      if (!team) return;
      const roster = (playersByTeam[team.id] ?? []).map(toNilPlayerInput);
      const valuations = computeTeamNilValues(
        {
          teamId: team.id,
          displayName: team.displayName,
          conference: team.conference,
          exposureInputs: { seasonPower: team.ratings.seasonPower },
        },
        roster,
      );
      valuations.forEach((breakdown, playerId) => map.set(playerId, breakdown.totalValue));
    });
    return map;
  }, [awayTeam, homeTeam, playersByTeam, ratingMode]);

  const awayBubbleColor = normalizeTeamColor(
    awayTeam?.color || awayTeam?.alternateColor,
    "#93abc6",
  );
  const homeBubbleColor = normalizeTeamColor(
    homeTeam?.color || homeTeam?.alternateColor,
    "#93abc6",
  );
  const awayBubbleRingColor = normalizeTeamColor(
    awayTeam?.alternateColor || awayTeam?.color,
    "#93abc6",
  );
  const homeBubbleRingColor = normalizeTeamColor(
    homeTeam?.alternateColor || homeTeam?.color,
    "#93abc6",
  );

  const [layout, setLayout] = useState({ width: 0, height: 0 });

  // Container aspect ratio: full width, height reduced by heightScale. Player
  // avatars shrink LINEARLY with heightScale (not the old damped 0.6+0.4x
  // formula, which barely shrank avatars while the court got much shorter —
  // that mismatch is what caused avatars/rings to crowd each other on a
  // compressed court) so avatar footprint stays proportional to the
  // available vertical space at any heightScale.
  const safeHeightScale = heightScale > 0 ? heightScale : 1;
  const containerAspectRatio = COURT_W / (COURT_L * safeHeightScale);
  // Base avatar diameter at heightScale=1: 56 * 1.2 (~20% bump for legibility
  // on the court). resolveBubblePlacements' edge/logo-protection buffers were
  // tuned against the original 56px baseline, so they're passed this same
  // avatarScale (not just safeHeightScale) to grow proportionally with the
  // bigger avatar instead of leaving it a clearance sized for the old one.
  const bubbleAvatarSize = Math.round(56 * 1.2 * safeHeightScale);
  const avatarScale = bubbleAvatarSize / 56;

  const awaySlotted = useMemo(() => {
    if (!awayTeam) {
      return [];
    }
    const awayPlayers = playersByTeam[awayTeam.id] ?? [];
    const prioritizedPlayerId = awayPlayers.some(
      (player) => player.id === highlightedPlayerId,
    )
      ? highlightedPlayerId
      : null;
    return assignSlots(awayPlayers, prioritizedPlayerId);
  }, [awayTeam, highlightedPlayerId, playersByTeam]);

  const homeSlotted = useMemo(() => {
    if (!homeTeam) {
      return [];
    }
    const homePlayers = playersByTeam[homeTeam.id] ?? [];
    const prioritizedPlayerId = homePlayers.some(
      (player) => player.id === highlightedPlayerId,
    )
      ? highlightedPlayerId
      : null;
    return assignSlots(homePlayers, prioritizedPlayerId);
  }, [highlightedPlayerId, homeTeam, playersByTeam]);
  const awayOnCourtCount = awayTeam
    ? (playersByTeam[awayTeam.id] ?? []).filter((player) => player.onCourt).length
    : 0;
  const homeOnCourtCount = homeTeam
    ? (playersByTeam[homeTeam.id] ?? []).filter((player) => player.onCourt).length
    : 0;

  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    if (awayTeam && awayOnCourtCount < 5) {
      console.warn(
        `[CourtOverlay] Away team ${awayTeam.shortDisplayName} has ${awayOnCourtCount} players flagged on-court; overlay will fallback by minutes.`,
      );
    }
    if (homeTeam && homeOnCourtCount < 5) {
      console.warn(
        `[CourtOverlay] Home team ${homeTeam.shortDisplayName} has ${homeOnCourtCount} players flagged on-court; overlay will fallback by minutes.`,
      );
    }
  }, [
    awayOnCourtCount,
    awayTeam?.id,
    awayTeam?.shortDisplayName,
    homeOnCourtCount,
    homeTeam?.id,
    homeTeam?.shortDisplayName,
  ]);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    const printSlots = (entries: SlottedPlayer[]) =>
      entries
        .map(({ slot, player }) => `${slot}:${player.shortName || player.name}(${player.position || "—"},${player.heightDisplay ?? "—"})`)
        .join(" | ");
    if (awayTeam) {
      console.log(
        `[CourtOverlay] ${awayTeam.shortDisplayName} formation -> ${printSlots(awaySlotted)}`,
      );
    }
    if (homeTeam) {
      console.log(
        `[CourtOverlay] ${homeTeam.shortDisplayName} formation -> ${printSlots(homeSlotted)}`,
      );
    }
  }, [
    awaySlotted,
    awayTeam?.id,
    awayTeam?.shortDisplayName,
    homeSlotted,
    homeTeam?.id,
    homeTeam?.shortDisplayName,
  ]);

  const leaderId = useMemo(() => {
    const combined = [...awaySlotted, ...homeSlotted];
    if (combined.length === 0) {
      return "";
    }

    const leader = [...combined].sort(
      (a, b) => b.player.points - a.player.points,
    )[0];
    return leader?.player.id ?? "";
  }, [awaySlotted, homeSlotted]);

  const conferenceMark = useMemo(() => null, []);
  const sharedLineColor = COURT_LINE_COLOR;
  const logoUri =
    typeof homeLogoUri === "string" && homeLogoUri.trim().length > 0
      ? homeLogoUri
      : null;
  const [logoReady, setLogoReady] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const lastGoodLogoUriRef = useRef<string | null>(null);
  const idPrefixRef = useRef(`court_${Math.random().toString(36).slice(2)}`);
  const idPrefix = idPrefixRef.current;
  const centerLogoSizePx = Math.round(
    Math.max(layout.width, 1) * CENTER_LOGO_WIDTH_RATIO,
  );
  const awayPlacements = useMemo(
    () =>
      resolveBubblePlacements(
        awaySlotted,
        TOP_HALF_SLOTS,
        "TOP",
        layout,
        centerLogoSizePx,
        avatarScale,
      ),
    [avatarScale, awaySlotted, centerLogoSizePx, layout],
  );
  const homePlacements = useMemo(
    () =>
      resolveBubblePlacements(
        homeSlotted,
        BOTTOM_HALF_SLOTS,
        "BOTTOM",
        layout,
        centerLogoSizePx,
        avatarScale,
      ),
    [avatarScale, centerLogoSizePx, homeSlotted, layout],
  );
  const awayHeatLevels = useMemo(
    () => buildTeamHeatLevels(awaySlotted.map((entry) => entry.player)),
    [awaySlotted],
  );
  const homeHeatLevels = useMemo(
    () => buildTeamHeatLevels(homeSlotted.map((entry) => entry.player)),
    [homeSlotted],
  );

  const transform = useMemo(
    () =>
      buildTransformWithSeatPad(
        Math.max(layout.width, 1),
        Math.max(layout.height, 1),
        0,
      ),
    [layout.height, layout.width],
  );

  useEffect(() => {
    devGeometryChecks(transform);
  }, [transform]);

  useEffect(() => {
    if (__DEV__) {
      console.log(
        "homeTeam",
        homeTeam?.shortDisplayName,
        homeTeam?.logo,
        homeTeam?.id,
      );
      console.log("CENTER LOGO URI", logoUri);
    }
  }, [logoUri, homeTeam?.id, homeTeam?.logo, homeTeam?.shortDisplayName]);

  useEffect(() => {
    onHomeLogoReadyChange?.(logoReady && !logoFailed);
  }, [logoFailed, logoReady, onHomeLogoReadyChange]);

  useEffect(() => {
    let cancelled = false;
    setLogoReady(false);
    setLogoFailed(false);

    if (!logoUri) {
      return () => {
        cancelled = true;
      };
    }

    if (logoUri.startsWith("data:")) {
      setLogoReady(true);
      return () => {
        cancelled = true;
      };
    }

    Image.prefetch(logoUri)
      .then(() => {
        if (cancelled) {
          return;
        }
        lastGoodLogoUriRef.current = logoUri;
        setLogoReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setLogoFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [logoUri]);

  const baseStroke = useMemo(
    () => clamp(transform.scale * STROKE_SCALE, MIN_STROKE, MAX_STROKE),
    [transform.scale],
  );
  const keyStroke = useMemo(() => baseStroke * 1.05, [baseStroke]);

  const laneLeft = (COURT_W - LANE_W) / 2;
  const laneRight = laneLeft + LANE_W;

  const hoopX = COURT_W / 2;
  const hoopTopY = RIM_FROM_BASELINE;
  const hoopBottomY = COURT_L - RIM_FROM_BASELINE;

  const ftTopY = BACKBOARD_FROM_BASELINE + FT_LINE_FROM_BACKBOARD;
  const ftBottomY = COURT_L - ftTopY;
  const topRestrictedPath = useMemo(
    () =>
      arcPathWithSweep(
        transform.toPxX(hoopX),
        transform.toPxY(hoopTopY),
        transform.toPxLen(RESTRICTED_R),
        180,
        0,
        1,
      ),
    [transform, hoopTopY, hoopX],
  );
  const bottomRestrictedPath = useMemo(
    () =>
      arcPathWithSweep(
        transform.toPxX(hoopX),
        transform.toPxY(hoopBottomY),
        transform.toPxLen(RESTRICTED_R),
        180,
        0,
        0,
      ),
    [transform, hoopBottomY, hoopX],
  );

  const onCourtLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  };

  const topThree = useMemo(
    () => buildThreePointPath("TOP", transform),
    [transform],
  );
  const bottomThree = useMemo(
    () => buildThreePointPath("BOTTOM", transform),
    [transform],
  );
  const topFreeThrowSemicircle = useMemo(
    () => buildFreeThrowSemicircle("TOP", transform),
    [transform],
  );
  const bottomFreeThrowSemicircle = useMemo(
    () => buildFreeThrowSemicircle("BOTTOM", transform),
    [transform],
  );

  const topLaneHashes = useMemo(() => {
    const rows: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const yStart = HASH_GAP_FROM_BASELINE_FT;
    for (let i = 0; i < HASH_COUNT; i += 1) {
      const y = yStart + i * HASH_SPACING_FT;
      if (y >= LANE_L - 0.5) {
        continue;
      }
      rows.push({ x1: laneLeft, y1: y, x2: laneLeft - HASH_LEN_FT, y2: y });
      rows.push({ x1: laneRight, y1: y, x2: laneRight + HASH_LEN_FT, y2: y });
    }
    return rows;
  }, [laneLeft, laneRight]);

  const bottomLaneHashes = useMemo(
    () =>
      topLaneHashes.map((row) => ({
        x1: row.x1,
        y1: COURT_L - row.y1,
        x2: row.x2,
        y2: COURT_L - row.y2,
      })),
    [topLaneHashes],
  );

  const hardwoodFloor = useMemo(() => {
    const tiles: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }> = [];
    let x = 0;
    let col = 0;

    while (x < COURT_W) {
      const colW = Math.min(HARDWOOD_RECT_COL_FT, COURT_W - x);
      const colOffsetSeed = (col * 41 + 11) % 29;
      let y = -((colOffsetSeed / 28) * (HARDWOOD_RECT_H_FT * 1.45));
      let row = 0;

      while (y < COURT_L) {
        const rawH = HARDWOOD_RECT_H_FT;
        const nextY = y + rawH;
        const drawY = Math.max(0, y);
        const drawH = Math.min(COURT_L, nextY) - drawY;

        if (drawH > 0.15) {
          const toneIndex = (col * 5 + row * 3) % HARDWOOD_TONES.length;
          const baseTone = HARDWOOD_TONES[toneIndex] ?? COURT_BG_COLOR;
          const shadeSeed = (col * 17 + row * 11) % 7;
          const shadeNudge = (shadeSeed - 3) * HARDWOOD_SHADE_JITTER * 0.35;
          tiles.push({
            x,
            y: drawY,
            w: colW,
            h: drawH,
            color: nudgeHex(
              baseTone,
              HARDWOOD_GLOBAL_DARKEN + Math.round(shadeNudge),
            ),
          });
        }

        y = nextY;
        row += 1;
      }

      x += colW;
      col += 1;
    }

    return { tiles };
  }, []);

  const centerLogoSource =
    !logoFailed && logoUri
      ? { uri: logoUri }
      : lastGoodLogoUriRef.current
        ? { uri: lastGoodLogoUriRef.current }
        : null;

  return (
    <View style={[styles.card, style]}>
      <View style={styles.courtWrap}>
        <View style={[styles.courtFrame, { aspectRatio: containerAspectRatio }]}>
          <View
            style={[styles.courtContainer, { aspectRatio: containerAspectRatio }]}
            onLayout={onCourtLayout}
          >
            <View pointerEvents="none" style={styles.centerCourtLogo}>
              {centerLogoSource ? (
                <Image
                  source={centerLogoSource}
                  resizeMode="contain"
                  fadeDuration={0}
                  onLoad={() => {
                    if (__DEV__) {
                      console.log("center logo loaded");
                    }
                    if (logoUri) {
                      lastGoodLogoUriRef.current = logoUri;
                      setLogoReady(true);
                      setLogoFailed(false);
                      onHomeLogoReadyChange?.(true);
                    }
                  }}
                  onError={(event) => {
                    if (__DEV__) {
                      console.log("center logo error", event.nativeEvent);
                    }
                    setLogoFailed(true);
                    onHomeLogoReadyChange?.(false);
                  }}
                  style={[
                    styles.centerLogoImage,
                    {
                      width: centerLogoSizePx,
                      height: centerLogoSizePx,
                    },
                  ]}
                />
              ) : null}
            </View>
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
              style={styles.svgLinesLayer}
            >
              <Defs>
                <RadialGradient
                  id={`${idPrefix}_courtSpotlight`}
                  cx={transform.toPxX(COURT_W / 2)}
                  cy={transform.toPxY(COURT_L / 2)}
                  r={transform.toPxLen(30)}
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop
                    offset="0%"
                    stopColor="#FFFFFF"
                    stopOpacity={COURT_SPOTLIGHT_OPACITY}
                  />
                  <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
                </RadialGradient>
                <RadialGradient
                  id={`${idPrefix}_courtVignette`}
                  cx={transform.toPxX(COURT_W / 2)}
                  cy={transform.toPxY(COURT_L / 2)}
                  r={transform.toPxLen(46)}
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="60%" stopColor="#000000" stopOpacity={0} />
                  <Stop
                    offset="100%"
                    stopColor="#000000"
                    stopOpacity={COURT_VIGNETTE_OPACITY}
                  />
                </RadialGradient>
                <RadialGradient
                  id={`${idPrefix}_glow`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <Stop
                    offset="0%"
                    stopColor={DEBUG_GLOSS ? "#00ffff" : "#FFFFFF"}
                    stopOpacity={DEBUG_GLOSS ? 0.6 : 0.36}
                  />
                  <Stop
                    offset="78%"
                    stopColor={DEBUG_GLOSS ? "#00ffff" : "#FFFFFF"}
                    stopOpacity={DEBUG_GLOSS ? 0.28 : 0.13}
                  />
                  <Stop
                    offset="100%"
                    stopColor={DEBUG_GLOSS ? "#00ffff" : "#FFFFFF"}
                    stopOpacity={0}
                  />
                </RadialGradient>
                <ClipPath id={`${idPrefix}_clipCourt`}>
                  <Rect
                    x={transform.toPxX(0)}
                    y={transform.toPxY(0)}
                    width={transform.toPxW(COURT_W)}
                    height={transform.toPxH(COURT_L)}
                  />
                </ClipPath>
              </Defs>
              <G clipPath={`url(#${idPrefix}_clipCourt)`}>
                {hardwoodFloor.tiles.map((tile, index) => (
                  <Rect
                    key={`tile-${index}`}
                    x={transform.toPxX(tile.x)}
                    y={transform.toPxY(tile.y)}
                    width={transform.toPxW(tile.w)}
                    height={transform.toPxH(tile.h)}
                    fill={tile.color}
                    fillOpacity={0.35}
                    stroke={HARDWOOD_SEAM_COLOR}
                    strokeOpacity={0.28}
                    strokeWidth={Math.max(0.25, transform.toPxLen(0.015))}
                  />
                ))}
                <Rect
                  x={transform.toPxX(0)}
                  y={transform.toPxY(0)}
                  width={transform.toPxW(COURT_W)}
                  height={transform.toPxH(COURT_L)}
                  fill={`url(#${idPrefix}_courtSpotlight)`}
                />
                <Rect
                  x={transform.toPxX(0)}
                  y={transform.toPxY(0)}
                  width={transform.toPxW(COURT_W)}
                  height={transform.toPxH(COURT_L)}
                  fill={`url(#${idPrefix}_courtVignette)`}
                />
                {conferenceMark ? (
                  <>
                    <Path
                      d={buildConferenceBadgePath(
                        transform.toPxX(8.6),
                        transform.toPxY(15.4),
                        transform.toPxLen(8.2),
                        transform.toPxLen(3.15),
                        transform.toPxLen(1),
                      )}
                      fill={conferenceMark.badgeFill}
                      fillOpacity={0.92}
                      stroke={conferenceMark.badgeStroke}
                      strokeWidth={Math.max(1, baseStroke * 0.65)}
                    />
                    <SvgText
                      x={transform.toPxX(8.6)}
                      y={transform.toPxY(15.4) + transform.toPxLen(0.35)}
                      fill={conferenceMark.textColor}
                      fontSize={transform.toPxLen(1.6)}
                      fontWeight="800"
                      letterSpacing={transform.toPxLen(0.08)}
                      textAnchor="middle"
                    >
                      {conferenceMark.shortLabel}
                    </SvgText>
                    <Path
                      d={buildConferenceBadgePath(
                        transform.toPxX(COURT_W - 8.6),
                        transform.toPxY(COURT_L - 15.4),
                        transform.toPxLen(8.2),
                        transform.toPxLen(3.15),
                        transform.toPxLen(1),
                      )}
                      fill={conferenceMark.badgeFill}
                      fillOpacity={0.92}
                      stroke={conferenceMark.badgeStroke}
                      strokeWidth={Math.max(1, baseStroke * 0.65)}
                    />
                    <SvgText
                      x={transform.toPxX(COURT_W - 8.6)}
                      y={transform.toPxY(COURT_L - 15.4) + transform.toPxLen(0.35)}
                      fill={conferenceMark.textColor}
                      fontSize={transform.toPxLen(1.6)}
                      fontWeight="800"
                      letterSpacing={transform.toPxLen(0.08)}
                      textAnchor="middle"
                    >
                      {conferenceMark.shortLabel}
                    </SvgText>
                    <SvgText
                      x={transform.toPxX(COURT_W - 2.6)}
                      y={transform.toPxY(16)}
                      fill={withAlpha(conferenceMark.badgeFill, 0.92)}
                      fontSize={transform.toPxLen(1.85)}
                      fontWeight="800"
                      letterSpacing={transform.toPxLen(0.1)}
                      textAnchor="middle"
                      transform={`rotate(90 ${transform.toPxX(COURT_W - 2.6)} ${transform.toPxY(16)})`}
                    >
                      {conferenceMark.wordmark}
                    </SvgText>
                    <SvgText
                      x={transform.toPxX(2.6)}
                      y={transform.toPxY(COURT_L - 16)}
                      fill={withAlpha(conferenceMark.badgeFill, 0.92)}
                      fontSize={transform.toPxLen(1.85)}
                      fontWeight="800"
                      letterSpacing={transform.toPxLen(0.1)}
                      textAnchor="middle"
                      transform={`rotate(-90 ${transform.toPxX(2.6)} ${transform.toPxY(COURT_L - 16)})`}
                    >
                      {conferenceMark.wordmark}
                    </SvgText>
                  </>
                ) : null}
              </G>
              <G
                clipPath={`url(#${idPrefix}_clipCourt)`}
                opacity={DEBUG_GLOSS ? 0.8 : GLOSS_GROUP_OPACITY}
              >
                {GLOSS_LIGHTS.map((light, index) => (
                  <Circle
                    key={`gloss-${index}`}
                    cx={transform.toPxX(light.x)}
                    cy={transform.toPxY(light.y)}
                    r={transform.toPxLen(light.r * GLOSS_RADIUS_SCALE)}
                    fill={`url(#${idPrefix}_glow)`}
                    transform={`translate(${transform.toPxX(light.x)} ${transform.toPxY(light.y)}) scale(${GLOSS_STRETCH_X} ${GLOSS_STRETCH_Y}) translate(${-transform.toPxX(light.x)} ${-transform.toPxY(light.y)})`}
                  />
                ))}
              </G>
              <Line
                x1={transform.toPxX(0)}
                y1={transform.toPxY(0)}
                x2={transform.toPxX(COURT_W)}
                y2={transform.toPxY(0)}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                x1={transform.toPxX(0)}
                y1={transform.toPxY(COURT_L)}
                x2={transform.toPxX(COURT_W)}
                y2={transform.toPxY(COURT_L)}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                x1={transform.toPxX(0)}
                y1={transform.toPxY(0)}
                x2={transform.toPxX(0)}
                y2={transform.toPxY(COURT_L)}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                x2={transform.toPxX(COURT_W)}
                y1={transform.toPxY(0)}
                x1={transform.toPxX(COURT_W)}
                y2={transform.toPxY(COURT_L)}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                x1={transform.toPxX(laneLeft)}
                y1={transform.toPxY(0)}
                x2={transform.toPxX(laneLeft)}
                y2={transform.toPxY(ftTopY)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(laneRight)}
                y1={transform.toPxY(0)}
                x2={transform.toPxX(laneRight)}
                y2={transform.toPxY(ftTopY)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(laneLeft)}
                y1={transform.toPxY(ftTopY)}
                x2={transform.toPxX(laneRight)}
                y2={transform.toPxY(ftTopY)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(laneLeft)}
                y1={transform.toPxY(COURT_L)}
                x2={transform.toPxX(laneLeft)}
                y2={transform.toPxY(ftBottomY)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(laneRight)}
                y1={transform.toPxY(COURT_L)}
                x2={transform.toPxX(laneRight)}
                y2={transform.toPxY(ftBottomY)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(laneLeft)}
                y1={transform.toPxY(ftBottomY)}
                x2={transform.toPxX(laneRight)}
                y2={transform.toPxY(ftBottomY)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(0)}
                y1={transform.toPxY(COURT_L / 2)}
                x2={transform.toPxX(COURT_W)}
                y2={transform.toPxY(COURT_L / 2)}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Circle
                cx={transform.toPxX(COURT_W / 2)}
                cy={transform.toPxY(COURT_L / 2)}
                r={transform.toPxLen(CENTER_CIRCLE_R)}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Circle
                cx={transform.toPxX(COURT_W / 2)}
                cy={transform.toPxY(COURT_L / 2)}
                r={Math.max(1, baseStroke * 0.7)}
                fill={sharedLineColor}
              />
              <Line
                x1={transform.toPxX(hoopX - BACKBOARD_W / 2)}
                y1={transform.toPxY(BACKBOARD_FROM_BASELINE)}
                x2={transform.toPxX(hoopX + BACKBOARD_W / 2)}
                y2={transform.toPxY(BACKBOARD_FROM_BASELINE)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Line
                x1={transform.toPxX(hoopX - BACKBOARD_W / 2)}
                y1={transform.toPxY(COURT_L - BACKBOARD_FROM_BASELINE)}
                x2={transform.toPxX(hoopX + BACKBOARD_W / 2)}
                y2={transform.toPxY(COURT_L - BACKBOARD_FROM_BASELINE)}
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Circle
                cx={transform.toPxX(hoopX)}
                cy={transform.toPxY(hoopTopY)}
                r={transform.toPxLen(0.75)}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Circle
                cx={transform.toPxX(hoopX)}
                cy={transform.toPxY(hoopBottomY)}
                r={transform.toPxLen(0.75)}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Path
                d={topThree.path}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Path
                d={bottomThree.path}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                {...topThree.cornerLeft}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                {...topThree.cornerRight}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                {...bottomThree.cornerLeft}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Line
                {...bottomThree.cornerRight}
                stroke={sharedLineColor}
                strokeWidth={keyStroke}
              />
              <Path
                d={topFreeThrowSemicircle.path}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Path
                d={bottomFreeThrowSemicircle.path}
                transform={bottomFreeThrowSemicircle.transform}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Path
                d={topRestrictedPath}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              <Path
                d={bottomRestrictedPath}
                fill="none"
                stroke={sharedLineColor}
                strokeWidth={baseStroke}
              />
              {topLaneHashes.map((row, index) => (
                <Line
                  key={`top-hash-${index}`}
                  x1={transform.toPxX(row.x1)}
                  y1={transform.toPxY(row.y1)}
                  x2={transform.toPxX(row.x2)}
                  y2={transform.toPxY(row.y2)}
                  stroke={sharedLineColor}
                  strokeWidth={baseStroke}
                />
              ))}
              {bottomLaneHashes.map((row, index) => (
                <Line
                  key={`bottom-hash-${index}`}
                  x1={transform.toPxX(row.x1)}
                  y1={transform.toPxY(row.y1)}
                  x2={transform.toPxX(row.x2)}
                  y2={transform.toPxY(row.y2)}
                  stroke={sharedLineColor}
                  strokeWidth={baseStroke}
                />
              ))}
            </Svg>
          </View>
          <View style={styles.playersLayer} pointerEvents="box-none">
            {awayPlacements.map(({ player, left, top }) => {
              const nilValue =
                ratingMode === "nil" ? nilValuesByPlayerId.get(player.id) ?? null : undefined;
              // Momentum uses player.momentum straight off the SAME live-game
              // data the Live Rankings "Momentum" tab already reads — no new
              // fetch. Rendered via pillText/pillColor (like NIL above)
              // rather than through resolveDisplayRating, since it's a
              // signed -5..+5 value, not a 0-10 rating.
              const momentumValue = ratingMode === "momentum" ? player.momentum ?? 0 : undefined;
              return (
                <PlayerBubble
                  key={player.id}
                  player={player}
                  left={left}
                  top={top}
                  teamColor={awayBubbleColor}
                  teamSecondaryColor={awayBubbleRingColor}
                  displayRating={resolveDisplayRating(player, ratingMode)}
                  pillText={
                    nilValue !== undefined
                      ? formatNilValue(nilValue)
                      : momentumValue !== undefined
                        ? formatMomentumValue(momentumValue)
                        : undefined
                  }
                  pillColor={
                    nilValue !== undefined
                      ? getNilValueColor(nilValue)
                      : momentumValue !== undefined
                        ? getMomentumPillColor(momentumValue)
                        : undefined
                  }
                  avatarSize={bubbleAvatarSize}
                  leadingScorer={player.id === leaderId}
                  highlighted={player.id === highlightedPlayerId}
                  highlightTrend={player.id === highlightedPlayerId ? highlightTrend : null}
                  isHighestRated={player.id === highestRatedPlayerId}
                  heatLevel={0}
                  onPress={onPlayerPress}
                />
              );
            })}
            {homePlacements.map(({ player, left, top }) => {
              const nilValue =
                ratingMode === "nil" ? nilValuesByPlayerId.get(player.id) ?? null : undefined;
              const momentumValue = ratingMode === "momentum" ? player.momentum ?? 0 : undefined;
              return (
                <PlayerBubble
                  key={player.id}
                  player={player}
                  left={left}
                  top={top}
                  teamColor={homeBubbleColor}
                  teamSecondaryColor={homeBubbleRingColor}
                  displayRating={resolveDisplayRating(player, ratingMode)}
                  pillText={
                    nilValue !== undefined
                      ? formatNilValue(nilValue)
                      : momentumValue !== undefined
                        ? formatMomentumValue(momentumValue)
                        : undefined
                  }
                  pillColor={
                    nilValue !== undefined
                      ? getNilValueColor(nilValue)
                      : momentumValue !== undefined
                        ? getMomentumPillColor(momentumValue)
                        : undefined
                  }
                  avatarSize={bubbleAvatarSize}
                  leadingScorer={player.id === leaderId}
                  highlighted={player.id === highlightedPlayerId}
                  highlightTrend={player.id === highlightedPlayerId ? highlightTrend : null}
                  isHighestRated={player.id === highestRatedPlayerId}
                  heatLevel={0}
                  onPress={onPlayerPress}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

// Memoized: this component is expensive (SVG court geometry, a repulsion
// simulation for player placement, ~1200 hardwood floor tiles) and the
// screens that render it keep unrelated state (e.g. the player modal's
// open/closed flag) in the same component tree. Without this, every such
// unrelated state change forced a full re-render here too — measured at
// 80-540ms per pass — which could stack on top of a tap's own render and
// turn what should be an instant modal-open into a visible stall.
export default memo(CourtOverlay);

const styles = StyleSheet.create({
  card: {
    backgroundColor: "transparent",
    borderRadius: 22,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  courtWrap: {
    borderRadius: 14,
    overflow: "hidden",
    width: "100%",
    backgroundColor: "transparent",
  },
  courtFrame: {
    width: "100%",
    aspectRatio: 50 / 84,
    position: "relative",
    backgroundColor: "transparent",
  },
  courtContainer: {
    width: "100%",
    aspectRatio: 50 / 84,
    backgroundColor: "#d5b988",
    borderRadius: 12,
    overflow: "hidden",
  },
  centerCourtLogo: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  svgLinesLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  playersLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
  centerLogoImage: {
    backgroundColor: "transparent",
    transform: [{ rotate: "90deg" }],
    opacity: CENTER_LOGO_OPACITY,
  },
});
