export type FieldSpotKey =
  | "BATTER"
  | "C"
  | "P"
  | "BASE1"
  | "BASE2"
  | "BASE3"
  | "2B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

export const FIELD_SPOTS: Record<FieldSpotKey, { xPct: number; yPct: number }> = {
  BATTER: { xPct: 50, yPct: 90 },
  C: { xPct: 50, yPct: 94 },
  P: { xPct: 50, yPct: 63 },
  BASE1: { xPct: 75, yPct: 66 },
  BASE2: { xPct: 50, yPct: 43 },
  BASE3: { xPct: 25, yPct: 66 },
  "2B": { xPct: 60, yPct: 55 },
  SS: { xPct: 40, yPct: 55 },
  LF: { xPct: 22, yPct: 24 },
  CF: { xPct: 50, yPct: 14 },
  RF: { xPct: 78, yPct: 24 },
};

const DEFAULT_WIDTH_PX = 360;
const DEFAULT_HEIGHT_PX = 620;

type OverlayOffset = {
  x: number;
  y: number;
};

const DEFAULT_OFFSET_PATTERNS: Record<number, OverlayOffset[]> = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -18, y: 0 },
    { x: 18, y: 0 },
  ],
  3: [
    { x: -18, y: 8 },
    { x: 18, y: 8 },
    { x: 0, y: -14 },
  ],
  4: [
    { x: -18, y: -10 },
    { x: 18, y: -10 },
    { x: -18, y: 12 },
    { x: 18, y: 12 },
  ],
};

function toPercentShift(deltaPx: number, spanPx: number): number {
  const safeSpan = spanPx > 0 ? spanPx : 1;
  return (deltaPx / safeSpan) * 100;
}

function buildOverflowOffsets(count: number): OverlayOffset[] {
  const offsets: OverlayOffset[] = [];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const xStep = 16;
  const yStep = 14;
  const xOrigin = ((columns - 1) * xStep) / 2;
  const yOrigin = ((rows - 1) * yStep) / 2;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (offsets.length >= count) {
        break;
      }
      const x = col * xStep - xOrigin;
      const y = row * yStep - yOrigin;
      const radius = Math.sqrt(x * x + y * y);
      if (radius > 60) {
        const scale = 60 / radius;
        offsets.push({ x: x * scale, y: y * scale });
      } else {
        offsets.push({ x, y });
      }
    }
  }

  return offsets;
}

export function placeOverlaysAtSpot<TItem>(
  spotKey: FieldSpotKey,
  overlays: TItem[],
  options?: { containerWidth?: number; containerHeight?: number },
): Array<{ item: TItem; leftPct: number; topPct: number; index: number; total: number }> {
  const total = overlays.length;
  if (total === 0) {
    return [];
  }
  const spot = FIELD_SPOTS[spotKey];
  const width = options?.containerWidth ?? DEFAULT_WIDTH_PX;
  const height = options?.containerHeight ?? DEFAULT_HEIGHT_PX;

  const offsets = DEFAULT_OFFSET_PATTERNS[total] ?? buildOverflowOffsets(total);
  return overlays.map((item, index) => {
    const offset = offsets[index] ?? { x: 0, y: 0 };
    const leftPct = spot.xPct + toPercentShift(offset.x, width);
    const topPct = spot.yPct + toPercentShift(offset.y, height);
    return {
      item,
      leftPct: Number(leftPct.toFixed(3)),
      topPct: Number(topPct.toFixed(3)),
      index,
      total,
    };
  });
}
