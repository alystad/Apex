import { StyleSheet, Text, View } from "react-native";

import RatingTimelineChart from "@/apps/mobile/src/components/player/RatingTimelineChart";
import Card from "@/components/ui/Card";
import type { PlayerProfileGameLogEntry } from "@/src/features/basketball/playerApi";
import { useAppTheme } from "@/src/theme/useAppTheme";

type PlayerSeasonRatingChartProps = {
  games: PlayerProfileGameLogEntry[];
  seasonAverage: number | null;
  currentRating: number | null;
  onActiveGameIdChange?: (gameId: string | null) => void;
};

export default function PlayerSeasonRatingChart({
  games,
  seasonAverage,
  currentRating,
  onActiveGameIdChange,
}: PlayerSeasonRatingChartProps) {
  const { tokens: theme } = useAppTheme();
  const ratedGames = games.filter(
    (game) =>
      typeof game.dynamicRating === "number" && Number.isFinite(game.dynamicRating),
  );
  const points = ratedGames.map((game, index) => ({
    tSec: index + 1,
    rating: game.dynamicRating ?? 0,
    reason: `${game.location === "A" ? "@" : "vs"} ${game.opponent.abbreviation}`,
    stats: {
      minutesDisplay: game.minutesDisplay,
      pts: game.points,
      reb: game.rebounds,
      ast: game.assists,
      stl: game.steals,
      blk: game.blocks,
      tov: game.turnovers,
      fls: game.fouls,
      fg: game.fg,
      threePt: game.threePt,
      ft: game.ft,
    },
  }));

  const styles = StyleSheet.create({
    shell: {
      gap: theme.spacing[10],
    },
    header: {
      gap: theme.spacing[4],
    },
    title: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    subtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
  });

  return (
    <Card>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.title}>Season Dynamic Rating</Text>
          <Text style={styles.subtitle}>
            Avg {typeof seasonAverage === "number" ? seasonAverage.toFixed(1) : "-"} • Current{" "}
            {typeof currentRating === "number" ? currentRating.toFixed(1) : "-"}
          </Text>
        </View>
        <RatingTimelineChart
          points={points}
          durationSec={Math.max(1, points.length)}
          startRating={points[0]?.rating ?? seasonAverage ?? 5}
          endRating={points[points.length - 1]?.rating ?? currentRating ?? seasonAverage ?? 5}
          onActivePointChange={(point) => {
            if (!point) {
              onActiveGameIdChange?.(null);
              return;
            }
            const index = Math.max(0, Math.round(point.tSec) - 1);
            onActiveGameIdChange?.(ratedGames[index]?.gameId ?? null);
          }}
        />
      </View>
    </Card>
  );
}
