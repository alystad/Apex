export type BettingGame = {
  eventId: string;
  sportKey: string;
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string;
};

export type FliffLine = {
  id: number;
  eventId: string;
  marketType: "moneyline" | "spread" | "total";
  side: string;
  americanOdds: number;
  linePoint?: number | null;
};

export type BettingSettings = {
  minEV: number;
  referenceBooks: string[];
};

export type EvItem = {
  fliffLineId: number;
  eventId: string;
  event?: string;
  marketType: "moneyline" | "spread" | "total";
  side: string;
  linePoint?: number | null;
  fliffOdds?: number;
  edgePct: number;
  impliedProb: number;
  fairProb: number;
  fairDecimal?: number;
  confidence?: number;
  commenceTime?: string;
};

export type TopMarketEvItem = {
  eventId: string;
  event: string;
  commenceTime?: string;
  sportKey?: string;
  homeTeam?: string;
  awayTeam?: string;
  book: string;
  marketLabel: string;
  side: string;
  linePoint?: number;
  offeredOdds?: number;
  fairProb?: number;
  edgePct: number;
  confidence?: number;
};
