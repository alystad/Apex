import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

export type TabItem = {
  key: string;
  label: string;
  secondaryLabel?: string;
  onPress: () => void;
};

type TabBarProps = {
  items: TabItem[];
  activeKey: string;
  variant?: "chip" | "flat" | "underline";
  textPreset?: "default" | "largeAccent";
};

export default function TabBar({
  items,
  activeKey,
  variant = "chip",
  textPreset = "default",
}: TabBarProps) {
  const { tokens: theme } = useAppTheme();
  const isLargeAccent = textPreset === "largeAccent";
  const scrollRef = useRef<ScrollView | null>(null);
  const hasCenteredOnceRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [tabLayouts, setTabLayouts] = useState<
    Record<string, { x: number; width: number }>
  >({});
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          overflow: "hidden",
        },
        wrapChip: {
          marginTop: theme.spacing[8],
        },
        wrapFlat: {
          marginTop: 0,
        },
        content: {
          gap: theme.spacing[6],
        },
        contentChip: {
          paddingHorizontal: 0,
          paddingVertical: 0,
          gap: theme.spacing[6],
        },
        contentFlat: {
          paddingHorizontal: 0,
          paddingVertical: 0,
          gap: theme.spacing[6],
        },
        tabChip: {
          flexShrink: 0,
          minHeight: variant === "flat" ? theme.controlHeights.md : theme.controlHeights.sm,
          paddingHorizontal: variant === "flat" ? theme.spacing[14] : theme.spacing[12],
          alignItems: "center",
          justifyContent: "center",
          borderRadius: theme.radius.pill,
        },
        // Matches the in-game tab bar (app/(tabs)/_layout.tsx screenOptions):
        // same label size/weight/colors, same per-item horizontal padding and
        // minHeight, and a bottom-border underline on the active tab instead
        // of a pill chip.
        tabUnderlineItem: {
          flexShrink: 0,
          minHeight: theme.controlHeights.md,
          paddingHorizontal: theme.spacing[14],
          alignItems: "center",
          justifyContent: "center",
          borderBottomWidth: 2,
          borderBottomColor: "transparent",
        },
        tabUnderlineItemActive: {
          borderBottomColor: theme.colors.textPrimary,
        },
        tabTextUnderline: {
          fontSize: 14,
        },
        tabText: {
          color: "rgba(255,255,255,0.6)",
          fontWeight: "700",
        },
        tabTextActive: {
          color: "#FFFFFF",
        },
        tabTextSecondary: {
          color: "rgba(255,255,255,0.45)",
          fontSize: 11,
          lineHeight: 13,
          fontWeight: "700",
          marginTop: theme.spacing[2],
        },
        tabTextSecondaryActive: {
          color: "rgba(255,255,255,0.8)",
        },
      }),
    [theme, variant],
  );

  useEffect(() => {
    const activeLayout = tabLayouts[activeKey];
    if (
      !activeLayout ||
      viewportWidth <= 0 ||
      contentWidth <= viewportWidth
    ) {
      return;
    }

    // Derive the active tab's x from cumulative widths in the CURRENT items
    // order, rather than trusting activeLayout.x directly. onLayout on web
    // is ResizeObserver-backed (see react-native-web's useElementLayout) and
    // only fires on a SIZE change — never on a pure position shift. When an
    // earlier tab is removed from `items` (e.g. a date rail entry confirmed
    // to have zero games), every later tab reflows leftward with no size
    // change of its own, so its cached `x` goes stale and this effect would
    // center on a target that no longer matches where the tab actually sits
    // (observed: the active "Today" pill scrolled hundreds of pixels off
    // the left edge). Each tab's cached WIDTH is still trustworthy — it
    // never changes after first layout — so summing widths (+ the same gap
    // used by contentChip/contentFlat) in the live `items` order reconstructs
    // the true x independent of any stale position cache.
    const gap = theme.spacing[6];
    let cursor = 0;
    let activeX: number | null = null;
    for (const item of items) {
      if (item.key === activeKey) {
        activeX = cursor;
        break;
      }
      const width = tabLayouts[item.key]?.width;
      if (typeof width !== "number") {
        activeX = null;
        break;
      }
      cursor += width + gap;
    }
    if (activeX === null) {
      return;
    }

    const labelCenterX = activeX + activeLayout.width / 2;
    const targetX = Math.max(
      0,
      Math.min(
        labelCenterX - viewportWidth / 2,
        contentWidth - viewportWidth,
      ),
    );

    scrollRef.current?.scrollTo({
      x: targetX,
      y: 0,
      animated: hasCenteredOnceRef.current,
    });

    hasCenteredOnceRef.current = true;
  }, [activeKey, contentWidth, items, tabLayouts, theme, viewportWidth]);

  const onWrapLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth !== viewportWidth) {
      setViewportWidth(nextWidth);
    }
  };

  const onTabLayout = (key: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setTabLayouts((current) => {
      const previous = current[key];
      if (previous && previous.x === x && previous.width === width) {
        return current;
      }
      return {
        ...current,
        [key]: { x, width },
      };
    });
  };

  const scrollContent = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={(width) => {
        if (width !== contentWidth) {
          setContentWidth(width);
        }
      }}
      contentContainerStyle={[
        styles.content,
        variant === "chip" ? styles.contentChip : styles.contentFlat,
      ]}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        const isStacked = Boolean(item.secondaryLabel);
        const isUnderline = variant === "underline";
        return (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            onLayout={(event) => onTabLayout(item.key, event)}
            style={[
              isUnderline ? styles.tabUnderlineItem : styles.tabChip,
              isUnderline && active ? styles.tabUnderlineItemActive : null,
              variant === "flat" && isLargeAccent ? { minWidth: 92 } : null,
              isStacked ? { minHeight: 56, paddingVertical: theme.spacing[8] } : null,
            ]}
          >
            <View style={{ alignItems: "center" }}>
              <Text
                style={[
                  styles.tabText,
                  isUnderline ? styles.tabTextUnderline : null,
                  active ? styles.tabTextActive : null,
                ]}
              >
                {item.label}
              </Text>
              {item.secondaryLabel ? (
                <Text
                  style={[
                    styles.tabTextSecondary,
                    active ? styles.tabTextSecondaryActive : null,
                  ]}
                >
                  {item.secondaryLabel}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View onLayout={onWrapLayout}>
      <View
        style={[
          styles.wrap,
          variant === "flat" ? styles.wrapFlat : styles.wrapChip,
          { paddingHorizontal: theme.spacing[6], paddingVertical: theme.spacing[6] },
        ]}
      >
        {scrollContent}
      </View>
    </View>
  );
}
