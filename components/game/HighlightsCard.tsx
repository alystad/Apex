import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGameData } from "@/hooks/useLiveGame";
import type { HighlightKind } from "@/src/features/recap/highlightReel";
import { useHighlightReel, type Highlight } from "@/src/features/recap/useHighlightReel";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { requestPlayHighlight } from "@/src/ui/inGamePlayHighlight";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const KIND_LABELS: Record<HighlightKind, string> = {
  run: "Run",
  "lead-change": "Lead change",
  "player-surge": "Player run",
  clutch: "Clutch",
};

export type HighlightsCardProps = {
  data: LiveGameData;
  /** "Highlights" when final, "Highlights So Far" while live. */
  title?: string;
};

/**
 * Narrated, chronological highlight reel, laid out as a two-column team
 * timeline — like a soccer match's event feed — rather than one interleaved
 * list. Each team's moments run down its own side (away left, home right)
 * but the whole reel still reads top-to-bottom in a single chronological
 * order shared by both columns, so a row's vertical position alone tells you
 * when it happened regardless of which side it's on.
 *
 * A highlight's team comes from HighlightCluster.teamId (see highlightReel.ts):
 * the scoring side for runs/lead-changes, the player's team for surges, and
 * for clutch moments a named player's team or, failing that, whichever side's
 * score actually moved on that play. That last "no attribution" case is rare
 * enough in practice that the render-time fallback below (default to away)
 * is just a deterministic safety net, not something a user should ever see.
 *
 * Entries are deliberately lightweight — a compact meta row
 * ("1st Quarter 8:33 · PLAYER RUN") over a single sentence — so the section
 * scans quickly and fits many moments on screen. Tapping one reuses the
 * existing `requestPlayHighlight` handoff — the Plays tab scrolls to the
 * anchor play and flashes it.
 */
export default function HighlightsCard({ data, title = "Highlights" }: HighlightsCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { goToTab } = useInGameTabNavigation();
  const { highlights, loading, unavailable } = useHighlightReel(data);

  const teams = data.teams ?? [];
  const awayTeam = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const homeTeam = teams.find((team) => team.homeAway === "home") ?? teams[1];

  const accentForKind = useCallback(
    (kind: HighlightKind): string => {
      switch (kind) {
        case "clutch":
          return theme.colors.danger;
        case "lead-change":
          return theme.colors.warning;
        case "player-surge":
          return theme.colors.success;
        default:
          return theme.colors.accent;
      }
    },
    [theme],
  );

  const handlePress = useCallback(
    (highlight: Highlight) => {
      // First play in the cluster is the anchor — the moment's starting beat.
      const anchor = highlight.playIds[0];
      if (anchor) {
        requestPlayHighlight(anchor);
      }
      goToTab("playbyplay");
    },
    [goToTab],
  );

  if (loading) {
    return (
      <Card>
        <SectionHeader title={title} />
        <View style={styles.stateRow}>
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
          <Text style={styles.stateText}>Building the highlight reel…</Text>
        </View>
      </Card>
    );
  }

  if (unavailable) {
    return (
      <Card>
        <SectionHeader title={title} />
        <Text style={styles.stateText}>Highlights unavailable right now.</Text>
      </Card>
    );
  }

  if (highlights.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title={title} />

      {/* Column header: each team's logo/abbreviation over its own side, so
          the two columns read as "away's moments" vs "home's moments" even
          before scanning any entry. */}
      <View style={styles.columnHeader}>
        <View style={[styles.columnHeaderSide, styles.columnHeaderSideAway]}>
          <Text style={styles.columnHeaderText} numberOfLines={1}>
            {awayTeam?.abbreviation || awayTeam?.shortDisplayName || "Away"}
          </Text>
          <Image
            source={{ uri: awayTeam?.logo || FALLBACK_IMAGE_URI }}
            style={styles.columnHeaderLogo}
          />
        </View>
        <View style={styles.spineGutter} />
        <View style={[styles.columnHeaderSide, styles.columnHeaderSideHome]}>
          <Image
            source={{ uri: homeTeam?.logo || FALLBACK_IMAGE_URI }}
            style={styles.columnHeaderLogo}
          />
          <Text style={styles.columnHeaderText} numberOfLines={1}>
            {homeTeam?.abbreviation || homeTeam?.shortDisplayName || "Home"}
          </Text>
        </View>
      </View>

      <View style={styles.timeline}>
        {highlights.map((highlight, index) => {
          const accent = accentForKind(highlight.kind);
          // Defaults to "away" only in the rare case teamId couldn't be
          // resolved at all (see the component doc above) — otherwise this
          // is an exact match against one of the two real team ids.
          const isHome = highlight.teamId != null && highlight.teamId === homeTeam?.id;
          const side: "away" | "home" = isHome ? "home" : "away";
          const entry = (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${highlight.period} ${highlight.clock}, ${KIND_LABELS[highlight.kind]}. ${highlight.text}. Open in plays.`}
              onPress={() => handlePress(highlight)}
              style={({ pressed }) => [
                styles.entry,
                side === "home" ? styles.entryHome : styles.entryAway,
                pressed ? styles.pressed : null,
              ]}
            >
              <View
                style={[
                  styles.metaRow,
                  side === "home" ? styles.metaRowHome : styles.metaRowAway,
                ]}
              >
                {side === "away" ? (
                  <FontAwesome name="chevron-left" size={9} color={theme.colors.textMuted} />
                ) : null}
                <Text
                  style={[styles.kindLabel, { color: accent }]}
                  numberOfLines={1}
                >
                  {KIND_LABELS[highlight.kind]}
                </Text>
                <Text style={styles.metaSeparator}>·</Text>
                <Text style={styles.timestamp} numberOfLines={1}>
                  {highlight.period || "Game"} {highlight.clock || "-"}
                </Text>
                {side === "home" ? (
                  <FontAwesome name="chevron-right" size={9} color={theme.colors.textMuted} />
                ) : null}
              </View>
              <Text
                style={[styles.narration, side === "home" ? styles.narrationHome : styles.narrationAway]}
              >
                {highlight.text}
              </Text>
            </Pressable>
          );

          return (
            <View
              key={highlight.id}
              style={[styles.row, index > 0 ? styles.rowDivided : null]}
            >
              <View style={styles.sideCol}>{side === "away" ? entry : null}</View>
              <View style={styles.spineGutter}>
                <View style={styles.spineLine} />
                <View style={[styles.spineDot, { backgroundColor: accent }]} />
              </View>
              <View style={styles.sideCol}>{side === "home" ? entry : null}</View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    stateRow: {
      marginTop: theme.spacing[10],
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    stateText: {
      marginTop: theme.spacing[2],
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    columnHeader: {
      marginTop: theme.spacing[10],
      flexDirection: "row",
      alignItems: "center",
    },
    columnHeaderSide: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    columnHeaderSideAway: {
      justifyContent: "flex-end",
    },
    columnHeaderSideHome: {
      justifyContent: "flex-start",
    },
    columnHeaderLogo: {
      width: 16,
      height: 16,
      borderRadius: theme.radius.pill,
    },
    columnHeaderText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    // Center spine the timeline hangs off — a thin vertical rule with a small
    // dot per row (colored by the entry's kind), matching a soccer match's
    // center-timeline event feed.
    spineGutter: {
      width: 16,
      alignItems: "center",
    },
    spineLine: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.borderSoft,
    },
    spineDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    timeline: {
      marginTop: theme.spacing[4],
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    rowDivided: {
      borderTopWidth: theme.borderWidth.hairline,
      borderTopColor: theme.colors.borderSoft,
    },
    sideCol: {
      flex: 1,
      minWidth: 0,
    },
    // No card chrome and no accent bar per entry — just a tight two-line
    // block (meta row + one sentence), so many more highlights fit on screen
    // than a stacked-card treatment would.
    entry: {
      paddingVertical: theme.spacing[8],
      gap: theme.spacing[2],
    },
    entryAway: {
      paddingRight: theme.spacing[8],
    },
    entryHome: {
      paddingLeft: theme.spacing[8],
    },
    pressed: {
      opacity: 0.85,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    // Away reads toward the spine (right-aligned, chevron pointing at it);
    // home reads away from the spine (left-aligned, chevron pointing at it)
    // — each column's meta row visually "faces" the timeline in the middle.
    metaRowAway: {
      justifyContent: "flex-end",
    },
    metaRowHome: {
      justifyContent: "flex-start",
    },
    timestamp: {
      flexShrink: 1,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    metaSeparator: {
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    kindLabel: {
      flexShrink: 0,
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    narration: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: theme.colors.textPrimary,
    },
    narrationAway: {
      textAlign: "right",
    },
    narrationHome: {
      textAlign: "left",
    },
  });
}
