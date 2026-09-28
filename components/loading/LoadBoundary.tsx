import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  SkeletonCard,
  SkeletonRow,
  SkeletonText,
} from "@/components/loading/SkeletonPrimitives";
import { useSectionLoading } from "@/src/loading/LoadingContext";
import { useAppTheme } from "@/src/theme/useAppTheme";

const DEFAULT_NON_CRITICAL_TIMEOUT_MS = 8000;

type LoadBoundaryProps = {
  screenKey: string;
  sectionKey: string;
  tier: "critical" | "non_critical";
  fallbackType?: "skeleton" | "spinnerOverlay" | "none";
  minDelayMs?: number;
  minShowMs?: number;
  timeoutMs?: number;
  onRetry?: () => void;
  children: ReactNode;
};

function SectionTimedOutState({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.card,
          paddingHorizontal: theme.spacing[14],
          paddingVertical: theme.spacing[12],
          gap: theme.spacing[10],
        },
        title: {
          fontSize: 14,
          lineHeight: 18,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        message: {
          fontSize: 12,
          lineHeight: 17,
          fontWeight: "600",
          color: theme.colors.textSecondary,
        },
        button: {
          alignSelf: "flex-start",
          minHeight: 36,
          borderRadius: theme.radius.md,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[12],
          alignItems: "center",
          justifyContent: "center",
        },
        buttonText: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Still loading</Text>
      <Text style={styles.message}>
        This section is taking longer than expected.
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Tap to retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SkeletonFallback() {
  return (
    <View>
      <SkeletonCard rows={2} />
    </View>
  );
}

export default function LoadBoundary({
  screenKey,
  sectionKey,
  tier,
  fallbackType = "skeleton",
  minDelayMs = 120,
  minShowMs = 220,
  timeoutMs = DEFAULT_NON_CRITICAL_TIMEOUT_MS,
  onRetry,
  children,
}: LoadBoundaryProps) {
  const { tokens: theme } = useAppTheme();
  const sectionLoading = useSectionLoading(screenKey, sectionKey);
  const isLoading =
    tier === "critical"
      ? sectionLoading.hasCritical
      : sectionLoading.hasNonCritical;
  const opacity = useRef(new Animated.Value(isLoading ? 0 : 1)).current;
  const [shouldShowFallback, setShouldShowFallback] = useState(isLoading);
  const [timedOut, setTimedOut] = useState(false);
  const visibleSinceRef = useRef<number | null>(isLoading ? Date.now() : null);

  useEffect(() => {
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    if (isLoading) {
      setTimedOut(false);
      timeoutTimer = setTimeout(() => {
        if (tier === "non_critical") {
          setTimedOut(true);
        }
      }, timeoutMs);

      if (!shouldShowFallback) {
        delayTimer = setTimeout(() => {
          visibleSinceRef.current = Date.now();
          setShouldShowFallback(true);
        }, minDelayMs);
      } else if (!visibleSinceRef.current) {
        visibleSinceRef.current = Date.now();
      }
    } else if (shouldShowFallback) {
      const shownFor = visibleSinceRef.current
        ? Date.now() - visibleSinceRef.current
        : 0;
      const remaining = Math.max(0, minShowMs - shownFor);
      hideTimer = setTimeout(() => {
        setShouldShowFallback(false);
        setTimedOut(false);
        visibleSinceRef.current = null;
      }, remaining);
    } else {
      setTimedOut(false);
    }

    return () => {
      if (delayTimer) clearTimeout(delayTimer);
      if (hideTimer) clearTimeout(hideTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
  }, [
    isLoading,
    minDelayMs,
    minShowMs,
    shouldShowFallback,
    tier,
    timeoutMs,
  ]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: shouldShowFallback ? 0 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [opacity, shouldShowFallback]);

  const overlayStyles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          position: "relative",
        },
        overlay: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: theme.radius.lg,
          backgroundColor: "rgba(0,0,0,0.36)",
          alignItems: "center",
          justifyContent: "center",
        },
        overlayCard: {
          gap: theme.spacing[8],
          alignItems: "center",
        },
        overlayText: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        },
      }),
    [theme],
  );

  if (timedOut && tier === "non_critical") {
    return <SectionTimedOutState onRetry={onRetry} />;
  }

  if (shouldShowFallback && fallbackType === "skeleton") {
    return <SkeletonFallback />;
  }

  if (fallbackType === "spinnerOverlay") {
    return (
      <View style={overlayStyles.wrap}>
        <Animated.View style={{ opacity }}>{children}</Animated.View>
        {shouldShowFallback ? (
          <View style={overlayStyles.overlay}>
            <View style={overlayStyles.overlayCard}>
              <ActivityIndicator color={theme.colors.accentStrong} />
              <Text style={overlayStyles.overlayText}>Loading</Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
