export const MULTI_VIEW_LAYOUT = {
  screenPadding: 8,
  gridGap: 10,
  tileRadius: 18,
  tileBorderWidth: 1,
  tileHeaderHeight: 44,
  minTileHeight: 220,
} as const;

export type MultiViewDensity = "full" | "medium" | "compact";

export type MultiViewTileRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveMultiViewDensity(tileHeight: number): MultiViewDensity {
  if (tileHeight >= 320) {
    return "full";
  }
  if (tileHeight >= 260) {
    return "medium";
  }
  return "compact";
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function makeRect(x: number, y: number, width: number, height: number): MultiViewTileRect {
  return {
    x: clampNonNegative(x),
    y: clampNonNegative(y),
    width: clampNonNegative(width),
    height: clampNonNegative(height),
  };
}

type ComputeMultiViewRectsInput = {
  count: number;
  availableWidth: number;
  availableHeight: number;
};

export function computeMultiViewRects({
  count,
  availableWidth,
  availableHeight,
}: ComputeMultiViewRectsInput): MultiViewTileRect[] {
  const n = Math.max(0, Math.min(4, Math.floor(count)));
  if (n === 0) {
    return [];
  }

  const width = clampNonNegative(availableWidth);
  const height = clampNonNegative(availableHeight);
  const gap = MULTI_VIEW_LAYOUT.gridGap;
  const minTileHeight = MULTI_VIEW_LAYOUT.minTileHeight;
  const aspect = width > 0 ? height / width : 0;
  const isTallPortrait = aspect >= 1.9;

  if (n === 1) {
    return [makeRect(0, 0, width, height)];
  }

  if (n === 2) {
    const stackedHeight = (height - gap) / 2;
    if (isTallPortrait) {
      return [
        makeRect(0, 0, width, stackedHeight),
        makeRect(0, stackedHeight + gap, width, stackedHeight),
      ];
    }

    const sideBySideWidth = (width - gap) / 2;
    const sideBySideHeight = height;
    if (sideBySideHeight >= minTileHeight) {
      return [
        makeRect(0, 0, sideBySideWidth, sideBySideHeight),
        makeRect(sideBySideWidth + gap, 0, sideBySideWidth, sideBySideHeight),
      ];
    }

    return [
      makeRect(0, 0, width, stackedHeight),
      makeRect(0, stackedHeight + gap, width, stackedHeight),
    ];
  }

  if (n === 3) {
    const row1Height = (height - gap) * 0.48;
    const row2Height = (height - gap) * 0.52;
    const rowWidth = (width - gap) / 2;
    const stackHeight = (height - gap * 2) / 3;

    if (row1Height < minTileHeight && stackHeight >= minTileHeight) {
      return [
        makeRect(0, 0, width, stackHeight),
        makeRect(0, stackHeight + gap, width, stackHeight),
        makeRect(0, stackHeight * 2 + gap * 2, width, stackHeight),
      ];
    }

    return [
      makeRect(0, 0, rowWidth, row1Height),
      makeRect(rowWidth + gap, 0, rowWidth, row1Height),
      makeRect(0, row1Height + gap, width, row2Height),
    ];
  }

  const tileWidth = (width - gap) / 2;
  const tileHeight = (height - gap) / 2;
  return [
    makeRect(0, 0, tileWidth, tileHeight),
    makeRect(tileWidth + gap, 0, tileWidth, tileHeight),
    makeRect(0, tileHeight + gap, tileWidth, tileHeight),
    makeRect(tileWidth + gap, tileHeight + gap, tileWidth, tileHeight),
  ];
}
