import { ScrollView, StyleSheet, Text, View } from "react-native";

import RatingTimelineChart, {
  type RatingTimelinePoint,
} from "@/apps/mobile/src/components/player/RatingTimelineChart";
import { colors } from "@/theme/colors";

type PreviewSeries = {
  id: string;
  title: string;
  points: RatingTimelinePoint[];
  durationSec: number;
};

const previewSeries: PreviewSeries[] = [
  {
    id: "steady",
    title: "Steady Climb",
    durationSec: 1200,
    points: [
      { tSec: 0, rating: 5.0 },
      { tSec: 120, rating: 5.4, reason: "Made jumper" },
      { tSec: 260, rating: 5.9, reason: "Assist" },
      { tSec: 430, rating: 6.3, reason: "3PT make" },
      { tSec: 620, rating: 6.7, reason: "Steal" },
      { tSec: 840, rating: 7.1, reason: "And-1 finish" },
      { tSec: 1080, rating: 7.4, reason: "Clutch FTs" },
    ],
  },
  {
    id: "spiky",
    title: "Spiky",
    durationSec: 1200,
    points: [
      { tSec: 0, rating: 5.0 },
      { tSec: 80, rating: 6.2, reason: "Quick 3PT" },
      { tSec: 190, rating: 5.4, reason: "Turnover" },
      { tSec: 300, rating: 6.8, reason: "Steal + score" },
      { tSec: 420, rating: 5.9, reason: "Miss + foul" },
      { tSec: 660, rating: 7.5, reason: "Heat check 3" },
      { tSec: 830, rating: 6.4, reason: "2 missed shots" },
      { tSec: 1110, rating: 7.2, reason: "Clutch block" },
    ],
  },
  {
    id: "late-jump",
    title: "Flat Then Late Jump",
    durationSec: 1200,
    points: [
      { tSec: 0, rating: 5.0 },
      { tSec: 180, rating: 5.1, reason: "Def. rebound" },
      { tSec: 360, rating: 5.0, reason: "Missed jumper" },
      { tSec: 540, rating: 5.2, reason: "Assist" },
      { tSec: 780, rating: 5.1, reason: "Turnover" },
      { tSec: 960, rating: 6.3, reason: "Back-to-back makes" },
      { tSec: 1110, rating: 7.0, reason: "Steal + finish" },
    ],
  },
];

export default function RatingTimelinePreviewScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Rating Timeline Preview</Text>
      {previewSeries.map((series) => {
        const startRating = series.points[0]?.rating ?? 5;
        const endRating = series.points[series.points.length - 1]?.rating ?? startRating;
        return (
          <View key={series.id} style={styles.block}>
            <Text style={styles.blockTitle}>{series.title}</Text>
            <RatingTimelineChart
              points={series.points}
              durationSec={series.durationSec}
              startRating={startRating}
              endRating={endRating}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 12,
  },
  block: {
    marginBottom: 18,
  },
  blockTitle: {
    marginBottom: 6,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.25,
  },
});
