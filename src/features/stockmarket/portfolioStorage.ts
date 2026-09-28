import AsyncStorage from "@react-native-async-storage/async-storage";

import { createInitialPortfolio } from "@/src/features/stockmarket/portfolioMath";
import { roundMoney, roundShares, STARTING_CASH } from "@/src/features/stockmarket/pricing";
import type {
  StockHolding,
  StockHoldingKind,
  StockPortfolioState,
  StockTransaction,
} from "@/src/features/stockmarket/types";

const STORAGE_VERSION = 1;
const STORAGE_KEY = "@boston-game/stock-portfolio";
/** History is capped so a heavy day-trader can't grow storage without bound. */
const MAX_TRANSACTIONS = 500;

type VersionedPayload<T> = {
  version: number;
  value: T;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalText(value: unknown): string | undefined {
  const parsed = text(value);
  return parsed.length > 0 ? parsed : undefined;
}

function money(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? roundMoney(value) : fallback;
}

function isHoldingKind(value: unknown): value is StockHoldingKind {
  return value === "game" || value === "season";
}

function sanitizeHolding(value: unknown): StockHolding | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<StockHolding>;
  const playerId = text(raw.playerId);
  const id = text(raw.id);
  const shares = typeof raw.shares === "number" ? roundShares(raw.shares) : 0;

  if (!playerId || !id || !isHoldingKind(raw.kind) || shares <= 0) {
    return null;
  }

  const timestamp = text(raw.updatedAt, new Date().toISOString());

  return {
    id,
    kind: raw.kind,
    playerId,
    playerName: text(raw.playerName, "Player"),
    playerHeadshot: text(raw.playerHeadshot),
    teamAbbreviation: text(raw.teamAbbreviation, "-"),
    gameId: raw.kind === "game" ? optionalText(raw.gameId) : undefined,
    gameLabel: raw.kind === "game" ? optionalText(raw.gameLabel) : undefined,
    shares,
    averageBuyPrice: money(raw.averageBuyPrice, 0),
    openedAt: text(raw.openedAt, timestamp),
    updatedAt: timestamp,
  };
}

function sanitizeTransaction(value: unknown): StockTransaction | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<StockTransaction>;
  const id = text(raw.id);
  const playerId = text(raw.playerId);
  const shares = typeof raw.shares === "number" ? roundShares(raw.shares) : 0;

  if (
    !id ||
    !playerId ||
    !isHoldingKind(raw.kind) ||
    (raw.type !== "buy" && raw.type !== "sell") ||
    shares <= 0
  ) {
    return null;
  }

  const price = money(raw.price, 0);

  return {
    id,
    type: raw.type,
    kind: raw.kind,
    playerId,
    playerName: text(raw.playerName, "Player"),
    teamAbbreviation: text(raw.teamAbbreviation, "-"),
    gameId: optionalText(raw.gameId),
    gameLabel: optionalText(raw.gameLabel),
    shares,
    price,
    amount: money(raw.amount, roundMoney(shares * price)),
    realizedGain:
      typeof raw.realizedGain === "number" && Number.isFinite(raw.realizedGain)
        ? roundMoney(raw.realizedGain)
        : null,
    realizedGainPct:
      typeof raw.realizedGainPct === "number" && Number.isFinite(raw.realizedGainPct)
        ? raw.realizedGainPct
        : null,
    autoClosed: raw.autoClosed === true ? true : undefined,
    createdAt: text(raw.createdAt, new Date().toISOString()),
  };
}

function sanitizePortfolio(value: unknown): StockPortfolioState {
  if (!value || typeof value !== "object") {
    return createInitialPortfolio();
  }
  const raw = value as Partial<StockPortfolioState>;

  return {
    cash: money(raw.cash, STARTING_CASH),
    holdings: Array.isArray(raw.holdings)
      ? raw.holdings
          .map((entry) => sanitizeHolding(entry))
          .filter((entry): entry is StockHolding => entry !== null)
      : [],
    transactions: Array.isArray(raw.transactions)
      ? raw.transactions
          .map((entry) => sanitizeTransaction(entry))
          .filter((entry): entry is StockTransaction => entry !== null)
          .slice(0, MAX_TRANSACTIONS)
      : [],
    initializedAt: optionalText(raw.initializedAt) ?? null,
    hasSeenDisclaimer: raw.hasSeenDisclaimer === true,
  };
}

/**
 * Returns null when the user has never opened the Stock Market — the caller
 * grants the starting balance on first entry rather than at install time.
 */
export async function loadStockPortfolio(): Promise<StockPortfolioState | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const payload = JSON.parse(stored) as VersionedPayload<StockPortfolioState>;
    if (payload.version !== STORAGE_VERSION) {
      return null;
    }
    return sanitizePortfolio(payload.value);
  } catch {
    return null;
  }
}

export async function saveStockPortfolio(state: StockPortfolioState): Promise<void> {
  const payload: VersionedPayload<StockPortfolioState> = {
    version: STORAGE_VERSION,
    value: {
      ...sanitizePortfolio(state),
      transactions: state.transactions.slice(0, MAX_TRANSACTIONS),
    },
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage failures are non-fatal — the in-memory portfolio keeps working
    // for this session.
  }
}
