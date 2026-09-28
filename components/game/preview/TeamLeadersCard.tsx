import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { expandPosition } from "@/components/game/CourtLineupDock";
import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";
import { getInGameRatingColor } from "@/theme/colors";

import {
  normalizeImageUri,
  previewSectionTitleStyle,
  type PreviewTeam,
} from "./previewShared";

/** Season per-game stat line shown under each team leader's identity. */
export type LeaderStatLine = {
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  /** 0-100. */
  fgPct: number | null;
};

export type LeaderEntry = {
  name: string;
  /** Formatted season rating (kept for the AI-prompt text elsewhere). */
  value: string;
  photo?: string;
  jersey?: string;
  position?: string;
  /** Season rating (0-10) — the value that picked this player as their team's leader. */
  rating?: number | null;
  stats?: LeaderStatLine;
  /** Pre-built so tapping the card can open PlayerModal without a second mapping step. */
  modalPlayer?: LiveGamePlayer;
};

/** Each team's single top-rated player — no more per-category toggle. */
export type TeamLeadersData = {
  away: LeaderEntry;
  home: LeaderEntry;
};

export const EMPTY_LEADER: LeaderEntry = { name: "-", value: "-" };
export const EMPTY_LEADERS: TeamLeadersData = { away: EMPTY_LEADER, home: EMPTY_LEADER };

type TeamLeadersCardProps = {
  away: PreviewTeam | undefined;
  home: PreviewTeam | undefined;
  leaders: TeamLeadersData;
  onPlayerPress?: (player: LiveGamePlayer) => void;
};

const AVATAR_DIAMETER = 64;

function formatCount(value: number): string {
  return value.toFixed(1);
}

// FotMob-style "Top scorer" comparison rows: stat label centered, each
// player's season average on their own side. Sourced straight from
// LeaderStatLine — already season per-game data, no extra fetch needed.
const COMPARISON_STAT_ROWS: {
  label: string;
  key: keyof LeaderStatLine;
  format: (value: number) => string;
}[] = [
  { label: "PPG", key: "points", format: (value) => value.toFixed(1) },
  { label: "RPG", key: "rebounds", format: (value) => value.toFixed(1) },
  { label: "APG", key: "assists", format: (value) => value.toFixed(1) },
  { label: "FG%", key: "fgPct", format: (value) => `${value.toFixed(1)}%` },
];

function normalizeRingColor(value: string | undefined, fallback: string): string {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

export default function TeamLeadersCard({
  away,
  home,
  leaders,
  onPlayerPress,
}: TeamLeadersCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const columns: { team: PreviewTeam | undefined; leader: LeaderEntry; side: "away" | "home" }[] = [
    { team: away, leader: leaders.away, side: "away" },
    { team: home, leader: leaders.home, side: "home" },
  ];

  const hasComparisonStats = COMPARISON_STAT_ROWS.some(
    (row) =>
      typeof leaders.away.stats?.[row.key] === "number" ||
      typeof leaders.home.stats?.[row.key] === "number",
  );

  return (
    <Card elevated>
      <Text style={styles.cardTitle}>Team Leaders</Text>

      <View style={styles.identityRow}>
        {columns.map(({ team, leader }, index) => {
          const ringColor = normalizeRingColor(team?.color, theme.colors.borderSoft);
          // Same treatment as the Court tab's PlayerBubble: a small pill
          // pinned to the photo's top-right corner, overlapping the ring
          // edge, colored by rating value — instead of a separate row below.
          const ratingBg =
            leader.rating != null ? getInGameRatingColor(leader.rating) : theme.colors.surfaceAlt;
          const content = (
            <>
              <View style={styles.avatarStack}>
                <View style={[styles.teamRing, { borderColor: ringColor }]} />
                <View style={styles.avatarWrap}>
                  <Image source={{ uri: normalizeImageUri(leader.photo) }} style={styles.avatar} />
                </View>
                <View style={[styles.ratingBadge, { backgroundColor: ratingBg }]}>
                  <Text style={styles.ratingBadgeText}>
                    {leader.rating != null ? formatCount(leader.rating) : "-"}
                  </Text>
                </View>
              </View>
              <Text style={styles.leaderName} numberOfLines={1}>
                {leader.name}
              </Text>
              {leader.position ? (
                <Text style={styles.leaderPosition} numberOfLines={1}>
                  {expandPosition(leader.position)}
                </Text>
              ) : null}
            </>
          );

          if (!leader.modalPlayer || !onPlayerPress) {
            return (
              <View key={team?.id ?? index} style={styles.leaderColumn}>
                {content}
              </View>
            );
          }

          return (
            <Pressable
              key={team?.id ?? index}
              accessibilityRole="button"
              accessibilityLabel={`${leader.name}, open player profile`}
              onPress={() => onPlayerPress(leader.modalPlayer!)}
              style={({ pressed }) => [
                styles.leaderColumn,
                pressed ? styles.leaderColumnPressed : null,
              ]}
            >
              {content}
            </Pressable>
          );
        })}
      </View>

      {/* FotMob "Top scorer"-style comparison: one row per season stat, the
          label centered and each player's average on their own side. */}
      {hasComparisonStats ? (
        <View style={styles.statList}>
          {COMPARISON_STAT_ROWS.map((row) => {
            const awayValue = leaders.away.stats?.[row.key];
            const homeValue = leaders.home.stats?.[row.key];
            return (
              <View key={row.label} style={styles.statRow}>
                <Text style={styles.statValue}>
                  {typeof awayValue === "number" ? row.format(awayValue) : "-"}
                </Text>
                <Text style={styles.statLabel}>{row.label}</Text>
                <Text style={styles.statValue}>
                  {typeof homeValue === "number" ? row.format(homeValue) : "-"}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    cardTitle: previewSectionTitleStyle(theme),
    identityRow: {
      flexDirection: "row",
      gap: theme.spacing[12],
      marginTop: theme.spacing[14],
    },
    leaderColumn: {
      flex: 1,
      alignItems: "center",
      gap: theme.spacing[4],
    },
    leaderColumnPressed: {
      opacity: theme.opacity.pressed,
    },
    // Same ring treatment as the Court tab's player avatars (PlayerBubble):
    // a separate, slightly larger ring sits behind the clipped photo rather
    // than the photo carrying its own border, so the ring reads as a clean
    // outline instead of eating into the image.
    avatarStack: {
      width: AVATAR_DIAMETER,
      height: AVATAR_DIAMETER,
      position: "relative",
      overflow: "visible",
    },
    teamRing: {
      position: "absolute",
      left: -3.5,
      top: -3.5,
      width: AVATAR_DIAMETER + 7,
      height: AVATAR_DIAMETER + 7,
      borderRadius: (AVATAR_DIAMETER + 7) / 2,
      borderWidth: 5,
    },
    avatarWrap: {
      width: AVATAR_DIAMETER,
      height: AVATAR_DIAMETER,
      borderRadius: AVATAR_DIAMETER / 2,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceAlt,
      zIndex: 1,
    },
    avatar: {
      width: "100%",
      height: "100%",
    },
    // Same badge treatment as the Court tab's PlayerBubble rating pill:
    // pinned to the photo's top-right corner, overlapping the ring edge.
    ratingBadge: {
      position: "absolute",
      top: -7,
      right: -8,
      zIndex: 2,
      elevation: 2,
      minWidth: 32,
      height: 18,
      paddingHorizontal: 6,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    ratingBadgeText: {
      color: "#0b1220",
      fontSize: 10,
      fontWeight: "800",
    },
    leaderName: {
      ...theme.type.caption,
      marginTop: theme.spacing[4],
      color: theme.colors.textPrimary,
      fontWeight: "800",
      textAlign: "center",
    },
    leaderPosition: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    statList: {
      marginTop: theme.spacing[16],
      gap: theme.spacing[10],
    },
    statRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[10],
    },
    statValue: {
      ...theme.type.caption,
      flex: 1,
      color: theme.colors.textPrimary,
      fontWeight: "800",
      textAlign: "center",
    },
    statLabel: {
      ...theme.type.micro,
      flex: 1,
      color: theme.colors.textMuted,
      fontWeight: "700",
      textAlign: "center",
    },
  });
}
