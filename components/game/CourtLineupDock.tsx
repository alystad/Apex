import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { CourtRatingMode } from "@/components/CourtOverlay";
import Card from "@/components/ui/Card";
import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import SectionHeader from "@/components/ui/SectionHeader";
import {
  getPeriodTimingForMode,
  parsePeriodClockToElapsedSeconds,
  useLiveGame,
  type LiveGamePlayer,
  type LiveGameSubstitution,
  type LiveGameTeam,
  type PeriodTimingConfig,
} from "@/hooks/useLiveGame";
import {
  computeTeamNilValues,
  formatNilValue,
  getNilValueColor,
  type NilPlayerInput,
} from "@/src/lib/ratings/nilValuation";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const POSITION_NAMES: Record<string, string> = {
  g: "Guard",
  f: "Forward",
  c: "Center",
  pg: "Point Guard",
  sg: "Shooting Guard",
  sf: "Small Forward",
  pf: "Power Forward",
  "g-f": "Guard-Forward",
  "f-g": "Forward-Guard",
  "f-c": "Forward-Center",
  "c-f": "Center-Forward",
};

// Spells out position abbreviations (G → Guard, etc.).
export function expandPosition(position: string | undefined | null): string {
  const key = (position ?? "").trim().toLowerCase();
  if (!key) {
    return "—";
  }
  return POSITION_NAMES[key] ?? (position ?? "").trim();
}

type CourtLineupDockProps = {
  teams: LiveGameTeam[];
  playersByTeam: Record<string, LiveGamePlayer[]>;
  // IDs of players currently pictured on the court — excluded from the bench.
  courtPlayerIds: Set<string>;
  ratingMode: CourtRatingMode;
  substitutions?: LiveGameSubstitution[];
  onPlayerPress: (player: LiveGamePlayer) => void;
};

function normalizeTeamColor(value: string | undefined | null, fallback: string): string {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

function normalize(value: string | undefined | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Best-effort "when did this player leave the game" from the play-by-play. A sub
// reads "A enters the game for B", so the outgoing player is the part after
// " for ". Returns the ELAPSED GAME SECONDS at that moment (not a formatted
// label) — the caller turns this into a live "how long they've been on the
// bench" duration, rather than the static game-clock snapshot this used to
// return directly (e.g. "7:08", which only ever meant "left with 7:08 left
// in the period," not "has been out for 7:08" — it never grew as the game
// continued past that point).
function findSubOutElapsedSec(
  player: LiveGamePlayer,
  substitutions: LiveGameSubstitution[],
  timing: PeriodTimingConfig,
): number | null {
  const last = normalize(player.lastName || player.shortName || player.name);
  if (!last) {
    return null;
  }
  let elapsedSec: number | null = null;
  for (const sub of substitutions) {
    if (sub.teamId && player.teamId && sub.teamId !== player.teamId) {
      continue;
    }
    const description = normalize(sub.description);
    if (!description.includes("enter") && !description.includes("checks in")) {
      continue;
    }
    const outgoing = description.split(" for ")[1] ?? "";
    if (outgoing.includes(last)) {
      // Keep the latest matching sub-out (substitutions are chronological).
      const parsed = parsePeriodClockToElapsedSeconds(sub.period, sub.clock, timing);
      if (parsed !== null) {
        elapsedSec = parsed;
      }
    }
  }
  return elapsedSec;
}

// "12:34" — minutes:seconds spent on the bench so far.
function formatBenchDuration(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function resolveRating(
  player: LiveGamePlayer,
  ratingMode: CourtRatingMode,
): number | null {
  if (ratingMode === "season") return player.seasonRating10 ?? player.inGameRating10;
  // No season-rating fallback here: `inGameRating10` is deliberately null
  // for a player who hasn't recorded any live activity yet (see
  // isEligibleForVisibleInGameRating in impactRating.ts) — falling back to
  // their season rating made an untouched bench player LOOK like they had a
  // live rating already, which is exactly what toggling to "Live" should
  // never show. Null renders as "-" downstream, same as CourtOverlay's own
  // resolveDisplayRating already does for the on-court bubbles.
  // Bench intentionally does NOT support the Momentum toggle mode — momentum
  // is only meaningful for players actually on the court right now (a
  // benched player's momentum is frozen from whenever they sat down), and
  // the toggle here is shared with the on-court view. Falling through to the
  // same Impact Rating "live" shows, rather than to null/"-", is the whole
  // point: Bench always reads as Impact Rating regardless of which mode the
  // toggle is on, never reflecting Momentum state.
  if (ratingMode === "live" || ratingMode === "momentum") return player.inGameRating10;
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

export default function CourtLineupDock({
  teams,
  playersByTeam,
  courtPlayerIds,
  ratingMode,
  substitutions = [],
  onPlayerPress,
}: CourtLineupDockProps) {
  const { tokens: theme } = useAppTheme();
  const { mode } = useLiveGame();
  const periodTiming = useMemo(() => getPeriodTimingForMode(mode), [mode]);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const away =
    teams.find((team) => team.homeAway === "away") ?? teams[0] ?? null;
  const home =
    teams.find((team) => team.homeAway === "home") ?? teams[1] ?? null;
  const columnTeams = useMemo(
    () => [away, home].filter((team): team is LiveGameTeam => Boolean(team)),
    [away, home],
  );

  // Computed once per roster (NIL shares are normalized across the whole
  // team, not per player), only when the toggle is actually in NIL mode.
  const nilValuesByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    if (ratingMode !== "nil") {
      return map;
    }
    columnTeams.forEach((team) => {
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
  }, [columnTeams, playersByTeam, ratingMode]);

  const resolveRatingWithNil = (player: LiveGamePlayer): number | null => {
    if (ratingMode === "nil") {
      return nilValuesByPlayerId.get(player.id) ?? null;
    }
    return resolveRating(player, ratingMode);
  };

  // "How long has this player been on the bench" — elapsed game time since
  // their last substitution-out, not the static clock snapshot of the
  // moment they left. `ratingTimelineDurationSec` is elapsed game seconds
  // as of the latest poll (same field the rating chart's "now" point uses),
  // so this grows every poll exactly like a real bench clock would.
  const benchDurationLabelFor = (player: LiveGamePlayer): string | null => {
    const subOutElapsedSec = findSubOutElapsedSec(player, substitutions, periodTiming);
    if (subOutElapsedSec === null) {
      return null;
    }
    const nowElapsedSec = player.ratingTimelineDurationSec ?? subOutElapsedSec;
    return formatBenchDuration(Math.max(0, nowElapsedSec - subOutElapsedSec));
  };

  const benchByTeam = useMemo(() => {
    const map = new Map<string, LiveGamePlayer[]>();
    columnTeams.forEach((team) => {
      const bench = (playersByTeam[team.id] ?? [])
        .filter((player) => !courtPlayerIds.has(player.id))
        .sort((a, b) => (resolveRatingWithNil(b) ?? -1) - (resolveRatingWithNil(a) ?? -1));
      map.set(team.id, bench);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnTeams, courtPlayerIds, playersByTeam, ratingMode, nilValuesByPlayerId]);

  if (columnTeams.length === 0) {
    return null;
  }

  return (
    <View style={styles.dock}>
      <Card>
        <View style={styles.cardInner}>
          <SectionHeader title="Bench" />
          <View style={styles.columns}>
            {columnTeams.map((team) => {
              const bench = benchByTeam.get(team.id) ?? [];
              return (
                <View key={team.id} style={styles.column}>
                  {bench.length === 0 ? (
                    <Text style={styles.emptyText}>No bench players.</Text>
                  ) : (
                    bench.map((player) => {
                      const nilValue =
                        ratingMode === "nil" ? nilValuesByPlayerId.get(player.id) ?? null : undefined;
                      return (
                        <PlayerUnit
                          key={player.id}
                          player={player}
                          rating={resolveRatingWithNil(player)}
                          pillText={nilValue !== undefined ? formatNilValue(nilValue) : undefined}
                          pillColor={nilValue !== undefined ? getNilValueColor(nilValue) : undefined}
                          benchLabel={
                            player.minutes > 0 ? benchDurationLabelFor(player) : null
                          }
                          showBenchTag={player.minutes > 0}
                          teamColor={team.color}
                          teamSecondaryColor={team.alternateColor}
                          styles={styles}
                          badgeTextColor={theme.colors.bg}
                          onPress={onPlayerPress}
                        />
                      );
                    })
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </Card>

      <Card>
        <View style={styles.cardInner}>
          <SectionHeader title="Coach" />
          <View style={styles.columns}>
            {columnTeams.map((team) => (
              <View key={team.id} style={styles.column}>
                <View style={styles.unit}>
                  <View style={styles.coachAvatar}>
                    <FontAwesome
                      name="user"
                      size={22}
                      color={theme.colors.textMuted}
                    />
                  </View>
                  <Text style={styles.unitName} numberOfLines={1}>
                    Head Coach
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </Card>
    </View>
  );
}

// Shared vertical player unit (headshot + rating badge + name + position) so the
// bench cells read consistently. The same badge colour scale + headshot shape
// are used on the court.
function PlayerUnit({
  player,
  rating,
  pillText,
  pillColor,
  benchLabel,
  showBenchTag,
  teamColor,
  teamSecondaryColor,
  styles,
  badgeTextColor,
  onPress,
}: {
  player: LiveGamePlayer;
  rating: number | null;
  /** Overrides the badge's text/color entirely (e.g. a formatted NIL value). */
  pillText?: string;
  pillColor?: string;
  benchLabel: string | null;
  showBenchTag: boolean;
  teamColor?: string;
  teamSecondaryColor?: string;
  styles: ReturnType<typeof makeStyles>;
  badgeTextColor: string;
  onPress: (player: LiveGamePlayer) => void;
}) {
  const ratingColor = pillColor !== undefined ? pillColor : getInGameRatingColor(rating);
  const ratingText =
    pillText !== undefined
      ? pillText
      : typeof rating === "number" && Number.isFinite(rating)
        ? rating.toFixed(1)
        : "-";
  // Same team-color ring AND fill the on-court nodes use (see PlayerBubble's
  // teamOutline/avatarBackground) — bench previously had no ring at all, and
  // its "fill" was a hardcoded neutral theme color instead of the team's
  // actual color, so it read as flat gray/black behind any photo with
  // transparent edges. Ring and fill deliberately read from DIFFERENT
  // sources (secondary-color-first vs. primary-color-first) so they can
  // differ, exactly like PlayerBubble.
  const ringColor = normalizeTeamColor(teamSecondaryColor || teamColor, "#d9e5f3");
  const fillColor = normalizeTeamColor(teamColor, "#93abc6");

  return (
    <Pressable style={styles.unit} onPress={() => onPress(player)}>
      <View style={styles.avatarWrap}>
        <FireRingGlow
          active={isPlayerOnFire(player)}
          photoDiameter={48}
          visualDiameter={52}
          debugLabel="fire-ring:lineup-dock"
        />
        <View style={[styles.teamRing, { borderColor: ringColor }]} />
        <Image
          source={{ uri: player.headshot || FALLBACK_IMAGE_URI }}
          style={[styles.headshot, { backgroundColor: fillColor }]}
        />
        <View style={[styles.ratingBadge, { backgroundColor: ratingColor }]}>
          <Text style={[styles.ratingBadgeText, { color: badgeTextColor }]}>
            {ratingText}
          </Text>
        </View>
        {showBenchTag ? (
          <View style={styles.benchTagWrap} pointerEvents="none">
            <View style={styles.benchTag}>
              <FontAwesome name="arrow-down" size={8} color="#FFFFFF" />
              <Text style={styles.benchTagText}>
                {benchLabel ? benchLabel : "Bench"}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.unitNameRow}>
        <Text style={styles.unitName} numberOfLines={1}>
          {player.shortName || player.name}
        </Text>
        {player.jersey ? (
          <Text style={styles.unitJerseyNum}>{player.jersey}</Text>
        ) : null}
      </View>
      <Text style={styles.unitPos} numberOfLines={1}>
        {expandPosition(player.position)}
      </Text>
    </Pressable>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    dock: {
      gap: theme.spacing[12],
    },
    cardInner: {
      gap: theme.spacing[14],
    },
    columns: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[12],
    },
    column: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[16],
    },
    unit: {
      alignItems: "center",
      gap: theme.spacing[4],
    },
    avatarWrap: {
      position: "relative",
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    headshot: {
      width: 48,
      height: 48,
      borderRadius: 24,
      // backgroundColor is set inline per-player (team fill color) — see
      // fillColor in PlayerUnit.
      // Explicit zIndex so the photo layers above FireRingGlow (zIndex 0) on
      // every platform now that a sibling in this stack sets one.
      zIndex: 2,
    },
    // Same ring treatment as the on-court PlayerBubble: a separate, slightly
    // larger ring behind the clipped photo instead of a border on the photo
    // itself, so it reads as a clean outline rather than eating into the image.
    teamRing: {
      position: "absolute",
      width: 54,
      height: 54,
      borderRadius: 27,
      borderWidth: 4,
      zIndex: 1,
    },
    ratingBadge: {
      position: "absolute",
      top: -2,
      right: -6,
      minWidth: 26,
      height: 18,
      paddingHorizontal: 5,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.bg,
      // Must be above headshot's zIndex (2) — without an explicit value here
      // this defaults to 0 and sinks behind the photo despite being declared
      // later in JSX.
      zIndex: 3,
    },
    ratingBadgeText: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "900",
    },
    benchTagWrap: {
      position: "absolute",
      bottom: -7,
      left: 0,
      right: 0,
      alignItems: "center",
      zIndex: 3,
    },
    benchTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingHorizontal: 4,
      height: 15,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.textMuted,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.bg,
    },
    benchTagText: {
      color: "#FFFFFF",
      fontSize: 9,
      lineHeight: 12,
      fontWeight: "800",
    },
    unitNameRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    unitName: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "700",
      textAlign: "center",
      flexShrink: 1,
    },
    unitJerseyNum: {
      color: theme.colors.textMuted,
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "600",
      flexShrink: 0,
    },
    unitPos: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      textAlign: "center",
    },
    coachAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.colors.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      textAlign: "center",
      paddingVertical: theme.spacing[4],
    },
  });
}
