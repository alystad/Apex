/**
 * Stock Market — VIRTUAL / PRACTICE CURRENCY ONLY.
 *
 * Nothing in this feature touches real money, real accounts, or any payment
 * system. Balances, prices, and gains are a simulation layered on top of the
 * app's existing Impact Rating (see `pricing.ts` for the single conversion
 * from rating -> price).
 */

/**
 * "game"   — a position tied to one specific game. Price follows that player's
 *            LIVE in-game Impact Rating and force-closes at the final buzzer.
 * "season" — a longer-term hold. Price follows the player's rolling
 *            season-average Impact Rating and never force-closes.
 */
export type StockHoldingKind = "game" | "season";

export type StockGameState = "pre" | "in" | "post";

/** Identity + visual metadata for one tradeable WNBA player. */
export type StockPlayer = {
  playerId: string;
  name: string;
  shortName: string;
  headshot: string;
  jersey: string;
  position: string;
  teamId: string;
  teamName: string;
  teamAbbreviation: string;
  teamLogo: string;
  teamColor: string | null;
  teamAlternateColor: string | null;
};

/** One point on a price history line (season trend or in-game). */
export type StockPricePoint = {
  /** Sequential x-position; the chart component spaces points by this. */
  index: number;
  price: number;
  /** Short axis/tooltip label, e.g. "@ LV". */
  label: string;
  /** ISO date of the underlying game, when there is one. */
  date?: string;
};

/** The game a player is involved in on the current slate, if any. */
export type StockPlayerGame = {
  gameId: string;
  state: StockGameState;
  statusText: string;
  /** e.g. "SEA @ LV" — shown on game positions so they're identifiable later. */
  label: string;
};

/**
 * Everything the UI needs to price and trade one player right now.
 *
 * `seasonPrice` and `livePrice` are the two independent streams described in
 * the feature spec; `price` is whichever one a *game* position would trade at
 * this instant (live once the game tips, the day's opening price before that).
 */
export type StockQuote = {
  playerId: string;
  /** Rolling season-average Impact Rating; drives season holdings. */
  seasonRating: number | null;
  seasonPrice: number | null;
  /** Live in-game Impact Rating; drives game holdings once a game is live. */
  liveRating: number | null;
  livePrice: number | null;
  /**
   * The day's opening price: the season-trend price, per the spec's pregame
   * rule. Movement (gainers/losers) is measured against this.
   */
  openPrice: number | null;
  /** Tradeable price for a single-game position right now. */
  price: number | null;
  changeAbs: number | null;
  changePct: number | null;
  game: StockPlayerGame | null;
  /** Season price history (rolling season average after each game). */
  seasonHistory: StockPricePoint[];
  /** In-game price history for the current/most recent game, when live. */
  liveHistory: StockPricePoint[];
  /** True once season pricing has resolved (vs. still loading). */
  hasSeasonPrice: boolean;
};

export type StockHolding = {
  /** Stable key: `${kind}:${playerId}` or `game:${playerId}:${gameId}`. */
  id: string;
  kind: StockHoldingKind;
  playerId: string;
  playerName: string;
  playerHeadshot: string;
  teamAbbreviation: string;
  /** Present only on `kind === "game"` positions. */
  gameId?: string;
  gameLabel?: string;
  shares: number;
  averageBuyPrice: number;
  openedAt: string;
  updatedAt: string;
};

export type StockTransaction = {
  id: string;
  type: "buy" | "sell";
  kind: StockHoldingKind;
  playerId: string;
  playerName: string;
  teamAbbreviation: string;
  gameId?: string;
  gameLabel?: string;
  shares: number;
  price: number;
  /** shares * price */
  amount: number;
  /** Sells only: realized dollar gain/loss vs. average buy price. */
  realizedGain: number | null;
  realizedGainPct: number | null;
  /** True when the final buzzer closed a game position automatically. */
  autoClosed?: boolean;
  createdAt: string;
};

export type StockPortfolioState = {
  cash: number;
  holdings: StockHolding[];
  transactions: StockTransaction[];
  /** ISO timestamp of first entry into the section (when cash was granted). */
  initializedAt: string | null;
  /** Whether the one-time "virtual currency only" notice has been dismissed. */
  hasSeenDisclaimer: boolean;
};

/** A valued position: a holding joined with its current price. */
export type StockPosition = {
  holding: StockHolding;
  currentPrice: number | null;
  marketValue: number;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPct: number;
};

export type StockPortfolioValuation = {
  cash: number;
  holdingsValue: number;
  totalValue: number;
  positions: StockPosition[];
  totalUnrealizedGain: number;
  totalRealizedGain: number;
};

export type StockLeaderboardEntry = {
  id: string;
  name: string;
  totalValue: number;
  /** Change vs. the starting balance, in dollars. */
  netGain: number;
  netGainPct: number;
  isCurrentUser: boolean;
};
