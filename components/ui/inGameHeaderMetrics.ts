import {
  STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  STICKY_HEADER_NAV_ROW_HEIGHT,
  STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM,
  STICKY_HEADER_TOP_PADDING,
  getStickyHeaderHeight as getSharedStickyHeaderHeight,
} from "@/src/ui/stickyHeaderMotion";

const EXPANDED_SECTION_HEIGHT = 84;
const TAB_ROW_MARGIN_TOP = 8;
const TAB_ROW_HEIGHT = 44;
const HEADER_TAB_EXTRA_LIFT = 20;

export const IN_GAME_HEADER_COLLAPSE_RANGE: [number, number] = [0, 90];
export const IN_GAME_HEADER_COLLAPSE_DISTANCE =
  EXPANDED_SECTION_HEIGHT + HEADER_TAB_EXTRA_LIFT;

export function getStickyHeaderExpandedHeight(insetTop: number): number {
  return getSharedStickyHeaderHeight({
    insetTop,
    expandedSectionHeight: EXPANDED_SECTION_HEIGHT,
    includeTabRow: true,
    tabRowMarginTop: TAB_ROW_MARGIN_TOP,
    tabRowHeight: TAB_ROW_HEIGHT,
    expandedBottomPadding: STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  });
}

export function getInGameContentStartOffset(
  scrollOffset: number,
  insetTop: number,
): number {
  "worklet";

  const expandedHeight =
    STICKY_HEADER_TOP_PADDING +
    STICKY_HEADER_NAV_ROW_HEIGHT +
    STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM +
    EXPANDED_SECTION_HEIGHT +
    TAB_ROW_MARGIN_TOP +
    TAB_ROW_HEIGHT +
    STICKY_HEADER_EXPANDED_BOTTOM_PADDING +
    Math.max(0, insetTop);
  const [rangeStart, rangeEnd] = IN_GAME_HEADER_COLLAPSE_RANGE;
  const rangeSize = Math.max(1, rangeEnd - rangeStart);
  const progress = Math.min(
    1,
    Math.max(0, (scrollOffset - rangeStart) / rangeSize),
  );
  const collapseClampedOffset = Math.min(Math.max(scrollOffset, rangeStart), rangeEnd);
  const lockedScreenOffset = Math.max(
    0,
    expandedHeight - IN_GAME_HEADER_COLLAPSE_DISTANCE * progress,
  );

  return Math.max(0, lockedScreenOffset + collapseClampedOffset);
}
