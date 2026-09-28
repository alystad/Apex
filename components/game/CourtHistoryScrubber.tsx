import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { CourtHistoryIndex } from "@/src/features/court/courtHistory";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const THUMB_SIZE = 16;
const TRACK_HEIGHT = 4;

export type CourtHistoryScrubberProps = {
  index: CourtHistoryIndex;
  /** null = parked at the live/final actual state (not scrubbing). */
  elapsedSec: number | null;
  /** Fired continuously while dragging. */
  onScrub: (elapsedSec: number) => void;
  /** Fired once on release, with the final settled position. */
  onRelease: (elapsedSec: number) => void;
  onSnapToLive: () => void;
  /** "Final" once the game has ended (always true today — scrubbing is Final-only). */
  isFinal: boolean;
};

/**
 * Historical scrubber for a COMPLETED game's Court tab: drag anywhere in
 * game-clock time and the court/leaderboard/bench re-render at that instant
 * (see src/features/court/courtHistory.ts, which this only visualizes — all
 * the interpolation/on-court-reconstruction math lives there).
 *
 * Uses RN's built-in responder props (onStartShouldSetResponder/
 * onResponderMove/...), NOT react-native-gesture-handler — a Gesture.Pan
 * here loses the gesture arena to the tab pager's own native swipe (the
 * pager claims horizontal touches outside RNGH's arena entirely, same root
 * cause as the leftmost-tab swipe-back issue elsewhere in this app), so a
 * drag on the thumb was silently swiping to the next tab instead of
 * scrubbing. This mirrors PointDifferentialChart's/MomentumTopStatsCard's
 * scrub interaction exactly, including locking swipe/scroll via
 * useInGameTabNavigation for the duration of the drag.
 */
export default function CourtHistoryScrubber({
  index,
  elapsedSec,
  onScrub,
  onRelease,
  onSnapToLive,
  isFinal,
}: CourtHistoryScrubberProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { setSwipeEnabled, setContentScrollEnabled } = useInGameTabNavigation();
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastElapsedSecRef = useRef<number | null>(null);

  const isScrubbed = elapsedSec !== null;
  const displayElapsedSec = elapsedSec ?? index.totalDurationSec;
  const progress =
    index.totalDurationSec > 0
      ? Math.max(0, Math.min(1, displayElapsedSec / index.totalDurationSec))
      : 0;

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const scrubToX = useCallback(
    (x: number) => {
      if (trackWidth <= 0) {
        return;
      }
      const ratio = Math.max(0, Math.min(1, x / trackWidth));
      const next = Math.round(ratio * index.totalDurationSec);
      lastElapsedSecRef.current = next;
      onScrub(next);
    },
    [index.totalDurationSec, onScrub, trackWidth],
  );

  const beginScrub = useCallback(
    (event: GestureResponderEvent) => {
      setSwipeEnabled(false);
      setContentScrollEnabled(false);
      setIsDragging(true);
      scrubToX(event.nativeEvent.locationX);
    },
    [scrubToX, setContentScrollEnabled, setSwipeEnabled],
  );

  // Deliberately ignores event.nativeEvent.locationX here — on release, RN
  // Web's synthetic touch event can report a stale/reset locationX (observed
  // jumping back near 0 on the terminating event), which snapped the scrub
  // position back to the start of the game right as the user let go. The
  // last position already reported via onResponderMove/scrubToX is the true
  // "where the thumb actually is" — reuse it instead of re-deriving from a
  // potentially-unreliable coordinate on this specific event.
  const endScrub = useCallback(() => {
    setSwipeEnabled(true);
    setContentScrollEnabled(true);
    setIsDragging(false);
    if (lastElapsedSecRef.current !== null) {
      onRelease(lastElapsedSecRef.current);
    }
  }, [onRelease, setContentScrollEnabled, setSwipeEnabled]);

  useEffect(() => {
    return () => {
      setSwipeEnabled(true);
      setContentScrollEnabled(true);
    };
  }, [setContentScrollEnabled, setSwipeEnabled]);

  return (
    <View style={styles.container}>
      <View style={styles.trackRow}>
        <View
          style={styles.trackWrap}
          onLayout={onTrackLayout}
          onStartShouldSetResponder={() => trackWidth > 0}
          onMoveShouldSetResponder={() => trackWidth > 0}
          onResponderGrant={beginScrub}
          onResponderMove={(event) => scrubToX(event.nativeEvent.locationX)}
          onResponderRelease={endScrub}
          onResponderTerminate={endScrub}
        >
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            {index.periodMarkers.map((marker) => {
              const markerRatio =
                index.totalDurationSec > 0 ? marker.elapsedSec / index.totalDurationSec : 0;
              return (
                <View
                  key={marker.label}
                  pointerEvents="none"
                  style={[styles.periodTick, { left: `${markerRatio * 100}%` }]}
                />
              );
            })}
          </View>
          <View style={styles.periodLabelRow} pointerEvents="none">
            {index.periodMarkers.map((marker) => (
              <Text key={marker.label} style={styles.periodLabel}>
                {marker.label}
              </Text>
            ))}
          </View>
          {trackWidth > 0 ? (
            <View
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  left: progress * trackWidth - THUMB_SIZE / 2,
                  backgroundColor: isScrubbed ? theme.colors.accent : theme.colors.textMuted,
                  transform: [{ scale: isDragging ? 1.3 : 1 }],
                },
              ]}
            />
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Jump to ${isFinal ? "final" : "live"} game state`}
          onPress={onSnapToLive}
          style={({ pressed }) => [
            styles.snapButton,
            isScrubbed ? null : styles.snapButtonActive,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.snapButtonText, isScrubbed ? null : styles.snapButtonTextActive]}>
            {isFinal ? "Final" : "Live"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: theme.spacing[12],
      paddingTop: theme.spacing[6],
      paddingBottom: theme.spacing[2],
    },
    trackRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    trackWrap: {
      flex: 1,
      minWidth: 0,
      paddingVertical: THUMB_SIZE / 2,
    },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: theme.colors.surfaceAlt,
      overflow: "hidden",
    },
    trackFill: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: theme.colors.accent,
    },
    periodTick: {
      position: "absolute",
      top: -3,
      width: 1,
      height: TRACK_HEIGHT + 6,
      backgroundColor: theme.colors.borderSoft,
    },
    periodLabelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: theme.spacing[4],
    },
    periodLabel: {
      fontSize: 9,
      lineHeight: 12,
      fontWeight: "700",
      color: theme.colors.textMuted,
      letterSpacing: 0.3,
    },
    thumb: {
      position: "absolute",
      // RN positions an absolute child's `top` relative to the parent's
      // PADDED content box, same origin as the (first, normal-flow) track
      // child — so track's own vertical center is just TRACK_HEIGHT/2 from
      // that origin, and centering the thumb on it is a plain half-height
      // offset, independent of trackWrap's paddingVertical.
      top: TRACK_HEIGHT / 2 - THUMB_SIZE / 2,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      borderWidth: 2,
      borderColor: theme.colors.bg,
    },
    snapButton: {
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    snapButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    snapButtonText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textMuted,
    },
    snapButtonTextActive: {
      color: theme.colors.textPrimary,
    },
    pressed: {
      opacity: theme.opacity.pressed,
    },
  });
}
