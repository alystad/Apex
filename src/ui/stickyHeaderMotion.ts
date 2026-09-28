import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

export const STICKY_HEADER_TOP_PADDING = 6;
export const STICKY_HEADER_NAV_ROW_HEIGHT = 48;
export const STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM = 8;
export const STICKY_HEADER_EXPANDED_BOTTOM_PADDING = 8;
export const STICKY_HEADER_COLLAPSED_BOTTOM_PADDING = 0;
export const STICKY_HEADER_DEFAULT_COLLAPSE_RANGE: [number, number] = [0, 156];
export const STICKY_HEADER_DEFAULT_COMPACT_FADE_RANGE: [number, number] = [
  24,
  132,
];

type StickyHeaderHeightOptions = {
  insetTop: number;
  expandedSectionHeight: number;
  includeTabRow?: boolean;
  tabRowMarginTop?: number;
  tabRowHeight?: number;
  expandedBottomPadding?: number;
  collapsedBottomPadding?: number;
};

type StickyHeaderMotionOptions = {
  scrollY: SharedValue<number>;
  expandedHeight: number;
  collapsedHeight: number;
  collapseRange?: readonly [number, number];
  compactFadeRange?: readonly [number, number];
  expandedTranslateY?: number;
  compactTranslateY?: number;
  expandedBottomPadding?: number;
  collapsedBottomPadding?: number;
};

export function getStickyHeaderHeight({
  insetTop,
  expandedSectionHeight,
  includeTabRow = false,
  tabRowMarginTop = 0,
  tabRowHeight = 0,
  expandedBottomPadding = STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
}: StickyHeaderHeightOptions): number {
  return (
    STICKY_HEADER_TOP_PADDING +
    STICKY_HEADER_NAV_ROW_HEIGHT +
    STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM +
    expandedSectionHeight +
    (includeTabRow ? tabRowMarginTop + tabRowHeight : 0) +
    expandedBottomPadding +
    Math.max(0, insetTop)
  );
}

export function getStickyHeaderCollapsedHeight({
  insetTop,
  includeTabRow = false,
  tabRowMarginTop = 0,
  tabRowHeight = 0,
  collapsedBottomPadding = STICKY_HEADER_COLLAPSED_BOTTOM_PADDING,
}: Omit<StickyHeaderHeightOptions, "expandedSectionHeight" | "expandedBottomPadding">): number {
  return (
    STICKY_HEADER_TOP_PADDING +
    STICKY_HEADER_NAV_ROW_HEIGHT +
    STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM +
    (includeTabRow ? tabRowMarginTop + tabRowHeight : 0) +
    collapsedBottomPadding +
    Math.max(0, insetTop)
  );
}

export function useStickyHeaderMotion({
  scrollY,
  expandedHeight,
  collapsedHeight,
  collapseRange = STICKY_HEADER_DEFAULT_COLLAPSE_RANGE,
  compactFadeRange = STICKY_HEADER_DEFAULT_COMPACT_FADE_RANGE,
  expandedTranslateY = 12,
  compactTranslateY = STICKY_HEADER_NAV_ROW_HEIGHT,
  expandedBottomPadding = STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  collapsedBottomPadding = STICKY_HEADER_COLLAPSED_BOTTOM_PADDING,
}: StickyHeaderMotionOptions) {
  const expandedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      collapseRange,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY: -expandedTranslateY * progress }],
    };
  });

  const compactStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      compactFadeRange,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY: (1 - progress) * -Math.abs(compactTranslateY) }],
    };
  });

  const headerHeightStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      collapseRange,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      height: expandedHeight - (expandedHeight - collapsedHeight) * progress,
    };
  });

  const barStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      collapseRange,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      borderBottomColor: `rgba(255,255,255,${0.08 + progress * 0.14})`,
    };
  });

  const bottomPaddingStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      collapseRange,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      paddingBottom:
        expandedBottomPadding -
        (expandedBottomPadding - collapsedBottomPadding) * progress,
    };
  });

  return {
    expandedStyle,
    compactStyle,
    headerHeightStyle,
    barStyle,
    bottomPaddingStyle,
  };
}

export { Animated };
