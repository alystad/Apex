import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type TrainingRow = {
  box: {
    points: number;
    fga: number;
    fgm: number;
    fta: number;
    ftm: number;
    oreb: number;
    dreb: number;
    ast: number;
    stl: number;
    blk: number;
    tov: number;
    pf: number;
    minutes: number;
  };
  context?: {
    closeGame?: boolean;
    clutch?: boolean;
    leadChange?: boolean;
  };
  targetWinImpact: number;
};

type FitOptions = {
  learningRate: number;
  epochs: number;
  l2: number;
};

type Coeff = Record<string, number>;

const DEFAULT_OUT = path.resolve("apps/mobile/src/ratings/winImpactWeights.json");
const DEFAULT_OPTIONS: FitOptions = {
  learningRate: 0.015,
  epochs: 4500,
  l2: 0.0015,
};

function argValue(flag: string): string | null {
  const idx = process.argv.findIndex((arg) => arg === flag);
  if (idx < 0 || idx + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[idx + 1] ?? null;
}

function toNum(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function possessions(row: TrainingRow["box"]): number {
  return Math.max(1, row.fga + 0.44 * row.fta + row.tov - row.oreb);
}

function featureVector(row: TrainingRow): Coeff {
  const poss = possessions(row.box);
  const missedFG = Math.max(0, row.box.fga - row.box.fgm);
  const missedFT = Math.max(0, row.box.fta - row.box.ftm);
  const fgPct = row.box.fga > 0 ? row.box.fgm / row.box.fga : 0.5;
  const ftPct = row.box.fta > 0 ? row.box.ftm / row.box.fta : 0.75;
  const close = row.context?.closeGame ? 1 : 0;
  const clutch = row.context?.clutch ? 1 : 0;
  const lead = row.context?.leadChange ? 1 : 0;
  const defenseSignal = (row.box.stl + row.box.blk + row.box.dreb) / poss;
  const reliability = Math.max(0.2, Math.min(1, 1 - Math.exp(-Math.max(0, row.box.minutes) / 12)));

  return {
    intercept: 1,
    pointsPerPoss: row.box.points / poss,
    assistPerPoss: row.box.ast / poss,
    orebPerPoss: row.box.oreb / poss,
    drebPerPoss: row.box.dreb / poss,
    stealPerPoss: row.box.stl / poss,
    blockPerPoss: row.box.blk / poss,
    turnoverPerPoss: row.box.tov / poss,
    foulPerPoss: row.box.pf / poss,
    missedFgPerPoss: missedFG / poss,
    missedFtPerPoss: missedFT / poss,
    fgPct,
    ftPct,
    closeGameBonus: close,
    clutchBonus: clutch,
    leadChangeBonus: lead,
    defenseCloseInteraction: defenseSignal * close,
    defenseClutchInteraction: defenseSignal * clutch,
    defenseLeadInteraction: defenseSignal * lead,
    reliabilityWeight: reliability,
  };
}

function dot(a: Coeff, b: Coeff): number {
  let sum = 0;
  for (const key of Object.keys(a)) {
    sum += (a[key] ?? 0) * (b[key] ?? 0);
  }
  return sum;
}

function trainCoefficients(rows: TrainingRow[], options: FitOptions): Coeff {
  const vectors = rows.map(featureVector);
  const coeff: Coeff = {};
  for (const key of Object.keys(vectors[0] ?? {})) {
    coeff[key] = 0;
  }

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const grad: Coeff = {};
    for (const key of Object.keys(coeff)) {
      grad[key] = 0;
    }

    for (let i = 0; i < rows.length; i += 1) {
      const x = vectors[i] as Coeff;
      const target = toNum(rows[i]?.targetWinImpact, 0);
      const pred = dot(coeff, x);
      const error = pred - target;
      for (const key of Object.keys(coeff)) {
        grad[key] = (grad[key] ?? 0) + error * (x[key] ?? 0);
      }
    }

    const n = Math.max(1, rows.length);
    for (const key of Object.keys(coeff)) {
      const l2 = key === "intercept" ? 0 : options.l2 * (coeff[key] ?? 0);
      const step = ((grad[key] ?? 0) / n) + l2;
      coeff[key] = (coeff[key] ?? 0) - options.learningRate * step;
    }
  }

  return coeff;
}

function rmse(rows: TrainingRow[], coeff: Coeff): number {
  const vectors = rows.map(featureVector);
  let sumSq = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const pred = dot(coeff, vectors[i] as Coeff);
    const target = toNum(rows[i]?.targetWinImpact, 0);
    const err = pred - target;
    sumSq += err * err;
  }
  return Math.sqrt(sumSq / Math.max(1, rows.length));
}

function splitTrainHoldout(rows: TrainingRow[]): { train: TrainingRow[]; holdout: TrainingRow[] } {
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j] as TrainingRow;
    shuffled[j] = tmp as TrainingRow;
  }
  const cut = Math.floor(shuffled.length * 0.85);
  return {
    train: shuffled.slice(0, Math.max(1, cut)),
    holdout: shuffled.slice(Math.max(1, cut)),
  };
}

async function main(): Promise<void> {
  const inputPath = argValue("--in");
  if (!inputPath) {
    throw new Error("Missing --in <historical-samples.json>.");
  }

  const outPath = argValue("--out") ?? DEFAULT_OUT;
  const raw = await readFile(path.resolve(inputPath), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Input must be a JSON array of training rows.");
  }
  const rows = parsed as TrainingRow[];
  if (rows.length < 200) {
    throw new Error(`Need at least 200 rows to fit stable weights, got ${rows.length}.`);
  }

  const { train, holdout } = splitTrainHoldout(rows);
  const learned = trainCoefficients(train, DEFAULT_OPTIONS);
  const trainRmse = rmse(train, learned);
  const holdoutRmse = holdout.length > 0 ? rmse(holdout, learned) : trainRmse;

  const nowIso = new Date().toISOString().slice(0, 10);
  const output = {
    schemaVersion: "win-impact-v1",
    trainedAt: nowIso,
    trainingWindow: "current_plus_last_season",
    refreshCadence: "monthly_in_season",
    fitDiagnostics: {
      trainRows: train.length,
      holdoutRows: holdout.length,
      trainRmse: Number(trainRmse.toFixed(5)),
      holdoutRmse: Number(holdoutRmse.toFixed(5)),
    },
    coefficients: {
      intercept: Number((learned.intercept ?? 0).toFixed(6)),
      pointsPerPoss: Number(Math.max(2.75, learned.pointsPerPoss ?? 0).toFixed(6)),
      assistPerPoss: Number(Math.min(0.55, learned.assistPerPoss ?? 0.35).toFixed(6)),
      orebPerPoss: Number(Math.min(0.8, learned.orebPerPoss ?? 0.62).toFixed(6)),
      drebPerPoss: Number(Math.min(0.35, learned.drebPerPoss ?? 0.28).toFixed(6)),
      stealPerPoss: Number(Math.min(1.0, learned.stealPerPoss ?? 0.95).toFixed(6)),
      blockPerPoss: Number(Math.min(0.75, learned.blockPerPoss ?? 0.65).toFixed(6)),
      turnoverPerPoss: Number((learned.turnoverPerPoss ?? 0).toFixed(6)),
      foulPerPoss: Number((learned.foulPerPoss ?? 0).toFixed(6)),
      missedFgPerPoss: Number(Math.min(-2.15, learned.missedFgPerPoss ?? -2.15).toFixed(6)),
      missedFtPerPoss: Number(Math.min(-0.82, learned.missedFtPerPoss ?? -0.82).toFixed(6)),
      fgPct: Number(Math.max(0.95, learned.fgPct ?? 0).toFixed(6)),
      ftPct: Number((learned.ftPct ?? 0).toFixed(6)),
      fgVolumePenaltyWeight: 1.55,
      fgVolumePenaltyBaseline: 0.52,
      closeGameBonus: Number((learned.closeGameBonus ?? 0).toFixed(6)),
      clutchBonus: Number((learned.clutchBonus ?? 0).toFixed(6)),
      leadChangeBonus: Number((learned.leadChangeBonus ?? 0).toFixed(6)),
      defenseCloseInteraction: Number((learned.defenseCloseInteraction ?? 0).toFixed(6)),
      defenseClutchInteraction: Number((learned.defenseClutchInteraction ?? 0).toFixed(6)),
      defenseLeadInteraction: Number((learned.defenseLeadInteraction ?? 0).toFixed(6)),
      turnoverClosePenalty: -0.22,
      turnoverClutchPenalty: -0.36,
      foulClutchPenalty: -0.14,
      reliabilityMinutesScale: 12,
      reliabilityFloor: 0.35,
      ratingCenter: 92,
      ratingScale: 50,
      topEndPressure: 2.2,
      topEndStart: 7.0,
      excellenceBoostMax: 0.14,
      excellenceBoostCenter: 100,
      excellenceBoostScale: 16,
    },
  };

  await writeFile(path.resolve(outPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`[fit-win-impact] wrote ${outPath}`);
  console.log(`[fit-win-impact] trainRMSE=${output.fitDiagnostics.trainRmse} holdoutRMSE=${output.fitDiagnostics.holdoutRmse}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fit-win-impact] failed: ${message}`);
  process.exitCode = 1;
});

