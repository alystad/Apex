import { Fragment } from "react";

import { SkeletonCard } from "@/components/loading/SkeletonPrimitives";

export type TabContentSkeletonProps = {
  /** Number of card-shaped placeholder blocks to stack. */
  cards?: number;
  /** Rows inside each card; the first card gets one extra row (hero emphasis). */
  rowsPerCard?: number;
};

/**
 * Generic per-tab "still loading" placeholder — a stack of card-shaped
 * pulsing blocks using the app's own Card/SkeletonCard primitives (dark
 * theme, real card radius/border), not a generic grey-bar skeleton. Used by
 * every in-game tab (Preview/Live/Recap, Court, Stats, Plays, Odds) for the
 * brief window before `data` (or the piece of it that tab needs) arrives —
 * each tab swaps this out for its real content independently, since they
 * mount lazily and each reads from the same shared `useLiveGame()` data.
 */
export default function TabContentSkeleton({
  cards = 3,
  rowsPerCard = 2,
}: TabContentSkeletonProps) {
  return (
    <Fragment>
      {Array.from({ length: cards }, (_, index) => (
        <SkeletonCard key={index} rows={index === 0 ? rowsPerCard + 1 : rowsPerCard} />
      ))}
    </Fragment>
  );
}
