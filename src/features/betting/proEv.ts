type OddsOutcome = {
  name?: string;
  price?: number;
  point?: number;
};

type OddsMarket = {
  key?: string;
  outcomes?: OddsOutcome[];
};

type OddsBookmaker = {
  key?: string;
  title?: string;
  markets?: OddsMarket[];
};

type OddsResponse = {
  bookmakers?: OddsBookmaker[];
};

export type ComputedMarketRow = {
  book: string;
  bookKey: string;
  market: string;
  side: string;
  point?: number;
  price?: number;
  fairProb?: number;
  proEv?: number;
};

type CandidateRow = {
  book: string;
  bookKey: string;
  marketKey: string;
  market: string;
  side: string;
  point?: number;
  price: number;
  lineGroupKey: string;
  sideKey: string;
};

type ReferenceLine = {
  bookmaker: string;
  outcomes: Array<{
    sideKey: string;
    americanOdds: number;
  }>;
};

function americanToImpliedProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) {
    return 0;
  }
  if (odds < 0) {
    return -odds / (-odds + 100);
  }
  return 100 / (odds + 100);
}

function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) {
    return 0;
  }
  if (odds > 0) {
    return 1 + odds / 100;
  }
  return 1 + 100 / -odds;
}

function removeVigTwoWay(p1: number, p2: number) {
  const sum = p1 + p2;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { p1: 0.5, p2: 0.5 };
  }
  return {
    p1: p1 / sum,
    p2: p2 / sum,
  };
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function trimmedMean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  if (values.length < 5) {
    return mean(values);
  }
  return mean([...values].sort((a, b) => a - b).slice(1, -1));
}

function computeFairProb(referenceLines: ReferenceLine[], sideKey: string): number | null {
  const noVigValues: number[] = [];

  referenceLines.forEach((line) => {
    const side = line.outcomes.find((row) => row.sideKey === sideKey);
    const counterpart = line.outcomes.find((row) => row.sideKey !== sideKey);
    if (!side || !counterpart) {
      return;
    }

    const p1 = americanToImpliedProbability(side.americanOdds);
    const p2 = americanToImpliedProbability(counterpart.americanOdds);
    const noVig = removeVigTwoWay(p1, p2);
    noVigValues.push(noVig.p1);
  });

  if (noVigValues.length === 0) {
    return null;
  }

  return trimmedMean(noVigValues);
}

function computeEvPercent(fairProb: number, offeredOdds: number): number {
  const decimalOdds = americanToDecimal(offeredOdds);
  if (!decimalOdds || !Number.isFinite(fairProb)) {
    return 0;
  }
  return (fairProb * (decimalOdds - 1) - (1 - fairProb)) * 100;
}

function marketLabel(key: string): string {
  if (key === "h2h") return "Moneyline";
  if (key === "spreads") return "Spread";
  if (key === "totals") return "Total";
  return key;
}

function normalizeSideName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function resolveLineGroupKey(marketKey: string, outcomes: OddsOutcome[]): string {
  if (marketKey === "h2h") {
    return "h2h";
  }

  const points = outcomes
    .map((outcome) => (Number.isFinite(outcome.point) ? Number(outcome.point) : null))
    .filter((value): value is number => value !== null);

  if (points.length === 0) {
    return marketKey;
  }

  if (marketKey === "spreads") {
    const absPoint = Math.abs(points[0]);
    return `${marketKey}:${absPoint.toFixed(1)}`;
  }

  return `${marketKey}:${points[0].toFixed(1)}`;
}

export function buildComputedMarketRows(odds: OddsResponse | null): ComputedMarketRow[] {
  if (!odds?.bookmakers?.length) {
    return [];
  }

  const candidateRows: CandidateRow[] = [];
  const referenceGroups = new Map<string, ReferenceLine[]>();

  odds.bookmakers.forEach((book) => {
    const bookKey = book.key ?? book.title ?? "book";
    const bookTitle = book.title ?? book.key ?? "Book";

    (book.markets ?? [])
      .filter((market) => ["h2h", "spreads", "totals"].includes((market.key ?? "").toLowerCase()))
      .forEach((market) => {
        const marketKey = (market.key ?? "").toLowerCase();
        const outcomes = (market.outcomes ?? []).filter(
          (outcome) => Number.isFinite(outcome.price) && typeof outcome.name === "string",
        );

        if (outcomes.length < 2) {
          return;
        }

        const lineGroupKey = resolveLineGroupKey(marketKey, outcomes);
        const groupKey = `${marketKey}:${lineGroupKey}`;
        const referenceLine: ReferenceLine = {
          bookmaker: bookKey,
          outcomes: outcomes.map((outcome) => ({
            sideKey:
              marketKey === "h2h"
                ? normalizeSideName(outcome.name)
                : `${normalizeSideName(outcome.name)}|${Number(outcome.point ?? 0)}`,
            americanOdds: Number(outcome.price),
          })),
        };

        const existingGroup = referenceGroups.get(groupKey) ?? [];
        existingGroup.push(referenceLine);
        referenceGroups.set(groupKey, existingGroup);

        outcomes.forEach((outcome) => {
          candidateRows.push({
            book: bookTitle,
            bookKey,
            marketKey,
            market: marketLabel(marketKey),
            side: outcome.name ?? "-",
            point: Number.isFinite(outcome.point) ? Number(outcome.point) : undefined,
            price: Number(outcome.price),
            lineGroupKey: groupKey,
            sideKey:
              marketKey === "h2h"
                ? normalizeSideName(outcome.name)
                : `${normalizeSideName(outcome.name)}|${Number(outcome.point ?? 0)}`,
          });
        });
      });
  });

  return candidateRows.map((row) => {
    const group = referenceGroups.get(row.lineGroupKey) ?? [];
    const peerLines = group.filter((entry) => entry.bookmaker !== row.bookKey);
    const fairProb = computeFairProb(peerLines.length > 0 ? peerLines : group, row.sideKey);
    const proEv =
      fairProb !== null && Number.isFinite(row.price)
        ? computeEvPercent(fairProb, row.price)
        : undefined;

    return {
      book: row.book,
      bookKey: row.bookKey,
      market: row.market,
      side: row.side,
      point: row.point,
      price: row.price,
      fairProb: fairProb ?? undefined,
      proEv,
    };
  });
}
