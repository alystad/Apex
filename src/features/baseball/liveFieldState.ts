import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import type { BaseballHalfInning } from "@/src/features/baseball/baseballTypes";

export type BaseballDefensivePosition =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

export const BASEBALL_DEFENSIVE_POSITIONS: readonly BaseballDefensivePosition[] = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
] as const;

export type BaseballOverlayPlayerLite = {
  id: string;
  teamId: string;
  name: string;
  shortName: string;
  lastName: string;
  jersey: string;
  position: string;
  headshot: string;
  starter: boolean;
  active: boolean;
  didNotPlay: boolean;
};

export type BaseballOnFieldMeta = {
  inning: number | null;
  half: BaseballHalfInning;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  onBaseCount: number;
  possessionTeamId: string | null;
  battingTeamId: string | null;
  defenseTeamId: string | null;
  isLive: boolean;
};

export type BaseballOnFieldState<TPlayer = BaseballOverlayPlayerLite> = {
  defense: Record<BaseballDefensivePosition, TPlayer | null>;
  batter: TPlayer | null;
  runners: {
    first: TPlayer | null;
    second: TPlayer | null;
    third: TPlayer | null;
  };
  meta: BaseballOnFieldMeta;
};

type HomeAway = "home" | "away" | "unknown";

type InternalPlayer = BaseballOverlayPlayerLite & {
  homeAway: HomeAway;
  subbedIn: boolean;
  subbedOut: boolean;
  sourcePriority: number;
};

type LooseObject = Record<string, unknown>;

const INVALID_TEXT_TOKENS = new Set(["ï¿½", "�", "N/A", "NA", "NULL", "NONE", "--"]);

function asObject(value: unknown): LooseObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as LooseObject;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || INVALID_TEXT_TOKENS.has(trimmed.toUpperCase())) {
    return fallback;
  }
  return trimmed;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)}`;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "";
}

function normalizeHeadshotUri(value: string): string {
  const trimmed = toText(value, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("http://") ? `https://${trimmed.slice(7)}` : trimmed;
}

function normalizeJersey(value: string): string {
  const trimmed = toText(value, "");
  if (!trimmed) {
    return "-";
  }
  // Jersey values are normally short numeric/alphanumeric values.
  return /^[0-9A-Za-z]{1,4}$/.test(trimmed) ? trimmed : "-";
}

function toHomeAway(value: unknown): HomeAway {
  const normalized = toText(value).toLowerCase();
  if (normalized === "home") {
    return "home";
  }
  if (normalized === "away") {
    return "away";
  }
  return "unknown";
}

function deriveLastName(name: string, shortName: string): string {
  const shortParts = shortName.split(".");
  if (shortParts.length >= 2) {
    const candidate = shortParts[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }
  const nameParts = name.trim().split(/\s+/);
  return nameParts[nameParts.length - 1] ?? name;
}

function normalizeDefensivePosition(rawValue: unknown): BaseballDefensivePosition | null {
  const raw = toText(rawValue).toUpperCase();
  if (!raw) {
    return null;
  }
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  switch (compact) {
    case "P":
    case "SP":
    case "RP":
    case "RHP":
    case "LHP":
    case "CL":
      return "P";
    case "C":
    case "CATCHER":
      return "C";
    case "1B":
    case "FIRSTBASE":
      return "1B";
    case "2B":
    case "SECONDBASE":
      return "2B";
    case "3B":
    case "THIRDBASE":
      return "3B";
    case "SS":
    case "SHORTSTOP":
      return "SS";
    case "LF":
    case "LEFTFIELD":
      return "LF";
    case "CF":
    case "CENTERFIELD":
      return "CF";
    case "RF":
    case "RIGHTFIELD":
      return "RF";
    default:
      return null;
  }
}

function createEmptyDefenseRecord<TPlayer>(): Record<BaseballDefensivePosition, TPlayer | null> {
  return {
    P: null,
    C: null,
    "1B": null,
    "2B": null,
    "3B": null,
    SS: null,
    LF: null,
    CF: null,
    RF: null,
  };
}

function parseHalfInning(inputs: Array<unknown>): BaseballHalfInning {
  for (const value of inputs) {
    const text = toText(value).toLowerCase();
    if (!text) {
      continue;
    }
    if (text.includes("top")) return "top";
    if (text.includes("bottom") || text.includes("bot")) return "bottom";
    if (text.includes("middle") || text.startsWith("mid")) return "middle";
    if (text.includes("end")) return "end";
    if (text.includes("pre")) return "pregame";
    if (text.includes("final") || text.includes("post")) return "final";
  }
  return "unknown";
}

function findParticipantPlayerId(plays: unknown[], participantType: "batter" | "pitcher"): string {
  for (let index = plays.length - 1; index >= 0; index -= 1) {
    const play = asObject(plays[index]);
    if (!play) {
      continue;
    }
    const participants = asArray(play.participants);
    for (const participantRaw of participants) {
      const participant = asObject(participantRaw);
      if (!participant) {
        continue;
      }
      const type = toText(participant.type).toLowerCase();
      if (type !== participantType) {
        continue;
      }
      const athlete = asObject(participant.athlete);
      const athleteId = toId(athlete?.id);
      if (athleteId) {
        return athleteId;
      }
    }
  }
  return "";
}

function extractPlayerIdFromBaseOccupant(value: unknown): string {
  if (value === true) {
    return "__placeholder__";
  }
  const objectValue = asObject(value);
  if (!objectValue) {
    return "";
  }
  const direct = toId(objectValue.playerId);
  if (direct) {
    return direct;
  }
  const athlete = asObject(objectValue.athlete);
  const athleteId = toId(athlete?.id);
  if (athleteId) {
    return athleteId;
  }
  return "";
}

function createRunnerPlaceholder(base: "first" | "second" | "third", battingTeamId: string): BaseballOverlayPlayerLite {
  const baseLabel = base === "first" ? "1B" : base === "second" ? "2B" : "3B";
  return {
    id: `runner-${battingTeamId || "unknown"}-${base}`,
    teamId: battingTeamId,
    name: `Runner ${baseLabel}`,
    shortName: `Runner ${baseLabel}`,
    lastName: `Runner ${baseLabel}`,
    jersey: "-",
    position: "RUN",
    headshot: "",
    starter: false,
    active: true,
    didNotPlay: false,
  };
}

function buildInternalPlayer(params: {
  athlete: LooseObject | null;
  teamId: string;
  homeAway: HomeAway;
  positionRaw: unknown;
  starter: boolean;
  active: boolean;
  didNotPlay: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  sourcePriority: number;
}): InternalPlayer | null {
  const athleteId = toId(params.athlete?.id);
  if (!athleteId) {
    return null;
  }
  const displayName =
    toText(params.athlete?.displayName) ||
    toText(params.athlete?.fullName) ||
    toText(params.athlete?.shortName) ||
    `Player ${athleteId}`;
  const shortName = toText(params.athlete?.shortName, displayName);
  const lastName = deriveLastName(displayName, shortName);
  const headshotObject = asObject(params.athlete?.headshot);
  const position = toText(params.positionRaw, "UN").toUpperCase();

  return {
    id: athleteId,
    teamId: params.teamId,
    name: displayName,
    shortName,
    lastName,
    jersey: normalizeJersey(toText(params.athlete?.jersey, "")),
    position,
    headshot: normalizeHeadshotUri(toText(headshotObject?.href)),
    starter: params.starter,
    active: params.active,
    didNotPlay: params.didNotPlay,
    homeAway: params.homeAway,
    subbedIn: params.subbedIn,
    subbedOut: params.subbedOut,
    sourcePriority: params.sourcePriority,
  };
}

function candidateScore(
  player: InternalPlayer,
  targetPosition: BaseballDefensivePosition,
  batterId: string,
  pitcherId: string,
): number {
  let score = 0;
  if (player.active) score += 100;
  if (player.starter) score += 28;
  if (!player.didNotPlay) score += 16;
  if (!player.subbedOut) score += 14;
  if (player.subbedIn) score += 8;
  if (player.id === pitcherId && targetPosition === "P") score += 200;
  if (player.id === batterId) score -= 250;
  score += player.sourcePriority;
  return score;
}

function chooseDefenderForPosition(params: {
  candidates: InternalPlayer[];
  targetPosition: BaseballDefensivePosition;
  batterId: string;
  pitcherId: string;
}): InternalPlayer | null {
  const normalizedCandidates = params.candidates.filter((candidate) => {
    const normalized = normalizeDefensivePosition(candidate.position);
    return normalized === params.targetPosition;
  });

  if (normalizedCandidates.length === 0) {
    return null;
  }

  return [...normalizedCandidates].sort((left, right) => {
    return (
      candidateScore(right, params.targetPosition, params.batterId, params.pitcherId) -
        candidateScore(left, params.targetPosition, params.batterId, params.pitcherId) ||
      left.name.localeCompare(right.name)
    );
  })[0];
}

function toOverlayPercent(value: number): `${number}%` {
  return `${Math.max(0, Math.min(100, Number(value.toFixed(3))))}%`;
}

export function mapEspnAthleteToOverlayPlayer(
  athlete: BaseballOverlayPlayerLite,
  existingPlayer?: LiveGamePlayer | null,
): LiveGamePlayer {
  const resolvedJersey = normalizeJersey(athlete.jersey);
  const resolvedHeadshot = normalizeHeadshotUri(athlete.headshot);
  if (existingPlayer) {
    const existingJersey = normalizeJersey(existingPlayer.jersey);
    const existingHeadshot = normalizeHeadshotUri(existingPlayer.headshot);
    return {
      ...existingPlayer,
      id: athlete.id || existingPlayer.id,
      teamId: athlete.teamId || existingPlayer.teamId,
      name: athlete.name || existingPlayer.name,
      shortName: athlete.shortName || existingPlayer.shortName,
      lastName: athlete.lastName || existingPlayer.lastName,
      jersey: resolvedJersey !== "-" ? resolvedJersey : existingJersey,
      position: athlete.position || existingPlayer.position,
      headshot: resolvedHeadshot || existingHeadshot,
      starter: athlete.starter,
      active: athlete.active,
      didNotPlay: athlete.didNotPlay,
      sport: "baseball",
    };
  }

  return {
    id: athlete.id,
    teamId: athlete.teamId,
    name: athlete.name,
    shortName: athlete.shortName || athlete.name,
    lastName: athlete.lastName || deriveLastName(athlete.name, athlete.shortName || athlete.name),
    jersey: resolvedJersey,
    position: athlete.position || "UN",
    heightInches: null,
    heightDisplay: "-",
    headshot: resolvedHeadshot,
    starter: athlete.starter,
    active: athlete.active,
    didNotPlay: athlete.didNotPlay,
    minutes: 0,
    minutesDisplay: "0",
    points: 0,
    rebounds: 0,
    assists: 0,
    turnovers: 0,
    steals: 0,
    blocks: 0,
    fouls: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    fg: "0-0",
    threePt: "0-0",
    ft: "0-0",
    plusMinus: "-",
    plusMinusValue: 0,
    liveEffPerMin: 0,
    seasonEffPerMin: null,
    seasonImpactRaw: null,
    inGameImpactRaw: null,
    liveRawBase: null,
    liveRaw: null,
    liveDisplay: "-",
    seasonRating10: null,
    inGameRating10: null,
    lowSample: false,
    gameRating: null,
    seasonRating: null,
    gameRank: null,
    seasonRank: null,
    minutesIncreasing: false,
    onCourt: false,
    minuteDelta: 0,
    fgm: 0,
    fga: 0,
    ftm: 0,
    fta: 0,
    sport: "baseball",
    baseball: null,
  };
}

export function parseBaseballOnFieldState(summaryJson: unknown): BaseballOnFieldState {
  const emptyDefense = createEmptyDefenseRecord<BaseballOverlayPlayerLite>();
  const summary = asObject(summaryJson);
  if (!summary) {
    return {
      defense: emptyDefense,
      batter: null,
      runners: { first: null, second: null, third: null },
      meta: {
        inning: null,
        half: "unknown",
        outs: null,
        balls: null,
        strikes: null,
        onBaseCount: 0,
        possessionTeamId: null,
        battingTeamId: null,
        defenseTeamId: null,
        isLive: false,
      },
    };
  }

  const header = asObject(summary.header);
  const competitions = asArray(header?.competitions);
  const competition = asObject(competitions[0]);
  const competitionStatus = asObject(competition?.status);
  const competitionStatusType = asObject(competitionStatus?.type);
  const competitors = asArray(competition?.competitors);

  let homeTeamId = "";
  let awayTeamId = "";
  competitors.forEach((competitorRaw) => {
    const competitor = asObject(competitorRaw);
    if (!competitor) {
      return;
    }
    const team = asObject(competitor.team);
    const teamId = toId(team?.id);
    if (!teamId) {
      return;
    }
    const homeAway = toHomeAway(competitor.homeAway);
    if (homeAway === "home") {
      homeTeamId = teamId;
    }
    if (homeAway === "away") {
      awayTeamId = teamId;
    }
  });

  const allPlayersById = new Map<string, InternalPlayer>();
  const playersByTeamId = new Map<string, InternalPlayer[]>();
  const pushTeamPlayer = (teamId: string, player: InternalPlayer) => {
    if (!teamId) {
      return;
    }
    const existing = playersByTeamId.get(teamId) ?? [];
    existing.push(player);
    playersByTeamId.set(teamId, existing);
  };
  const upsertGlobalPlayer = (player: InternalPlayer) => {
    const existing = allPlayersById.get(player.id);
    if (!existing) {
      allPlayersById.set(player.id, player);
      return;
    }

    const existingScore = candidateScore(existing, "P", "", "");
    const nextScore = candidateScore(player, "P", "", "");
    if (nextScore > existingScore) {
      allPlayersById.set(player.id, player);
      return;
    }

    allPlayersById.set(player.id, {
      ...existing,
      teamId: existing.teamId || player.teamId,
      position: existing.position !== "UN" ? existing.position : player.position,
      headshot: existing.headshot || player.headshot,
      jersey: existing.jersey !== "-" ? existing.jersey : player.jersey,
      active: existing.active || player.active,
      starter: existing.starter || player.starter,
      didNotPlay: existing.didNotPlay && player.didNotPlay,
      sourcePriority: Math.max(existing.sourcePriority, player.sourcePriority),
    });
  };

  const rosters = asArray(summary.rosters);
  rosters.forEach((rosterSectionRaw) => {
    const rosterSection = asObject(rosterSectionRaw);
    if (!rosterSection) {
      return;
    }
    const team = asObject(rosterSection.team);
    const homeAway = toHomeAway(rosterSection.homeAway);
    const inferredTeamId =
      toId(team?.id) ||
      (homeAway === "home" ? homeTeamId : homeAway === "away" ? awayTeamId : "");
    if (homeAway === "home" && inferredTeamId) {
      homeTeamId = homeTeamId || inferredTeamId;
    }
    if (homeAway === "away" && inferredTeamId) {
      awayTeamId = awayTeamId || inferredTeamId;
    }

    const rosterEntries = asArray(rosterSection.roster);
    rosterEntries.forEach((entryRaw) => {
      const entry = asObject(entryRaw);
      if (!entry) {
        return;
      }
      const athlete = asObject(entry.athlete);
      const position = asObject(entry.position);
      const positions = asArray(entry.positions);
      const fallbackPosition = asObject(positions[0])?.abbreviation;
      const player = buildInternalPlayer({
        athlete,
        teamId: inferredTeamId,
        homeAway,
        positionRaw: position?.abbreviation ?? fallbackPosition,
        starter: toBoolean(entry.starter),
        active: toBoolean(entry.active),
        didNotPlay: toBoolean(entry.didNotPlay),
        subbedIn: toBoolean(entry.subbedIn),
        subbedOut: toBoolean(entry.subbedOut),
        sourcePriority: 30,
      });
      if (!player) {
        return;
      }
      pushTeamPlayer(player.teamId, player);
      upsertGlobalPlayer(player);
    });
  });

  const boxscore = asObject(summary.boxscore);
  const boxscorePlayersSections = asArray(boxscore?.players);
  boxscorePlayersSections.forEach((sectionRaw) => {
    const section = asObject(sectionRaw);
    if (!section) {
      return;
    }
    const sectionTeam = asObject(section.team);
    const teamId = toId(sectionTeam?.id);
    const statistics = asArray(section.statistics);
    statistics.forEach((tableRaw) => {
      const table = asObject(tableRaw);
      if (!table) {
        return;
      }
      const athletes = asArray(table.athletes);
      athletes.forEach((athleteRowRaw) => {
        const athleteRow = asObject(athleteRowRaw);
        if (!athleteRow) {
          return;
        }
        const athlete = asObject(athleteRow.athlete);
        const rowPosition = asObject(athleteRow.position);
        const athletePosition = asObject(athlete?.position);
        const player = buildInternalPlayer({
          athlete,
          teamId,
          homeAway: "unknown",
          positionRaw: rowPosition?.abbreviation ?? athletePosition?.abbreviation,
          starter: toBoolean(athleteRow.starter),
          active: athleteRow.active !== false,
          didNotPlay: toBoolean(athleteRow.didNotPlay),
          subbedIn: false,
          subbedOut: false,
          sourcePriority: 20,
        });
        if (!player) {
          return;
        }
        pushTeamPlayer(player.teamId, player);
        upsertGlobalPlayer(player);
      });
    });
  });

  const plays = asArray(summary.plays);
  const lastPlay = asObject(plays.length > 0 ? plays[plays.length - 1] : null);
  const lastPlayPeriod = asObject(lastPlay?.period);
  const lastPlayPitchCount = asObject(lastPlay?.pitchCount);
  const lastPlayResultCount = asObject(lastPlay?.resultCount);
  const situation = asObject(summary.situation);
  const situationPitcher = asObject(situation?.pitcher);
  const situationBatter = asObject(situation?.batter);

  const half = parseHalfInning([
    competitionStatus?.periodPrefix,
    competitionStatusType?.shortDetail,
    competitionStatusType?.detail,
    competitionStatusType?.description,
    lastPlayPeriod?.type,
    lastPlayPeriod?.displayValue,
  ]);

  const inning = toNumber(competitionStatus?.period) ?? toNumber(lastPlayPeriod?.number);
  const batterId =
    toId(situationBatter?.playerId) || findParticipantPlayerId(plays, "batter");
  const pitcherId =
    toId(situationPitcher?.playerId) || findParticipantPlayerId(plays, "pitcher");

  const batterPlayer = batterId ? allPlayersById.get(batterId) ?? null : null;
  const pitcherPlayer = pitcherId ? allPlayersById.get(pitcherId) ?? null : null;

  const lastPlayTeam = asObject(lastPlay?.team);
  const lastPlayTeamId = toId(lastPlayTeam?.id);
  let battingTeamId = batterPlayer?.teamId || "";
  if (!battingTeamId) {
    battingTeamId = lastPlayTeamId;
  }
  if (!battingTeamId) {
    if (half === "top") {
      battingTeamId = awayTeamId;
    } else if (half === "bottom") {
      battingTeamId = homeTeamId;
    }
  }

  let defenseTeamId = pitcherPlayer?.teamId || "";
  if (!defenseTeamId && battingTeamId) {
    if (homeTeamId && awayTeamId) {
      defenseTeamId = battingTeamId === homeTeamId ? awayTeamId : homeTeamId;
    }
  }
  if (!defenseTeamId) {
    if (half === "top") {
      defenseTeamId = homeTeamId;
    } else if (half === "bottom") {
      defenseTeamId = awayTeamId;
    }
  }
  if (!defenseTeamId && battingTeamId) {
    const teams = [homeTeamId, awayTeamId].filter(Boolean);
    defenseTeamId = teams.find((teamId) => teamId !== battingTeamId) ?? "";
  }

  const defensePlayers = defenseTeamId ? playersByTeamId.get(defenseTeamId) ?? [] : [];
  const defense = createEmptyDefenseRecord<BaseballOverlayPlayerLite>();

  BASEBALL_DEFENSIVE_POSITIONS.forEach((position) => {
    const selected = chooseDefenderForPosition({
      candidates: defensePlayers,
      targetPosition: position,
      batterId,
      pitcherId,
    });
    defense[position] = selected
      ? {
          id: selected.id,
          teamId: selected.teamId,
          name: selected.name,
          shortName: selected.shortName,
          lastName: selected.lastName,
          jersey: selected.jersey,
          position: selected.position,
          headshot: selected.headshot,
          starter: selected.starter,
          active: selected.active,
          didNotPlay: selected.didNotPlay,
        }
      : null;
  });

  if (pitcherId && defenseTeamId) {
    const selectedPitcher = allPlayersById.get(pitcherId);
    if (selectedPitcher && selectedPitcher.teamId === defenseTeamId) {
      defense.P = {
        id: selectedPitcher.id,
        teamId: selectedPitcher.teamId,
        name: selectedPitcher.name,
        shortName: selectedPitcher.shortName,
        lastName: selectedPitcher.lastName,
        jersey: selectedPitcher.jersey,
        position: selectedPitcher.position || "P",
        headshot: selectedPitcher.headshot,
        starter: selectedPitcher.starter,
        active: selectedPitcher.active,
        didNotPlay: selectedPitcher.didNotPlay,
      };
    }
  }

  const batter =
    batterPlayer &&
    (batterPlayer.teamId === battingTeamId || !battingTeamId || battingTeamId === "")
      ? {
          id: batterPlayer.id,
          teamId: batterPlayer.teamId,
          name: batterPlayer.name,
          shortName: batterPlayer.shortName,
          lastName: batterPlayer.lastName,
          jersey: batterPlayer.jersey,
          position: batterPlayer.position,
          headshot: batterPlayer.headshot,
          starter: batterPlayer.starter,
          active: batterPlayer.active,
          didNotPlay: batterPlayer.didNotPlay,
        }
      : batterId
        ? {
            id: batterId,
            teamId: battingTeamId,
            name: "Batter",
            shortName: "Batter",
            lastName: "Batter",
            jersey: "-",
            position: "BAT",
            headshot: "",
            starter: false,
            active: true,
            didNotPlay: false,
          }
        : null;

  const runnerFromBase = (
    rawBaseValue: unknown,
    base: "first" | "second" | "third",
  ): BaseballOverlayPlayerLite | null => {
    if (!rawBaseValue) {
      return null;
    }
    const runnerId = extractPlayerIdFromBaseOccupant(rawBaseValue);
    if (!runnerId) {
      return null;
    }
    if (runnerId === "__placeholder__") {
      return createRunnerPlaceholder(base, battingTeamId);
    }
    const resolved = allPlayersById.get(runnerId);
    if (!resolved) {
      return {
        ...createRunnerPlaceholder(base, battingTeamId),
        id: runnerId,
      };
    }
    return {
      id: resolved.id,
      teamId: resolved.teamId,
      name: resolved.name,
      shortName: resolved.shortName,
      lastName: resolved.lastName,
      jersey: resolved.jersey,
      position: resolved.position,
      headshot: resolved.headshot,
      starter: resolved.starter,
      active: resolved.active,
      didNotPlay: resolved.didNotPlay,
    };
  };

  const firstRaw = situation?.onFirst ?? lastPlay?.onFirst;
  const secondRaw = situation?.onSecond ?? lastPlay?.onSecond;
  const thirdRaw = situation?.onThird ?? lastPlay?.onThird;

  const runners = {
    first: runnerFromBase(firstRaw, "first"),
    second: runnerFromBase(secondRaw, "second"),
    third: runnerFromBase(thirdRaw, "third"),
  };

  const balls =
    toNumber(situation?.balls) ??
    toNumber(lastPlayResultCount?.balls) ??
    toNumber(lastPlayPitchCount?.balls);
  const strikes =
    toNumber(situation?.strikes) ??
    toNumber(lastPlayResultCount?.strikes) ??
    toNumber(lastPlayPitchCount?.strikes);
  const outs = toNumber(situation?.outs) ?? toNumber(lastPlay?.outs);
  const onBaseCount = [runners.first, runners.second, runners.third].filter(Boolean).length;
  const statusState = toText(competitionStatusType?.state).toLowerCase();

  return {
    defense,
    batter,
    runners,
    meta: {
      inning,
      half,
      outs,
      balls,
      strikes,
      onBaseCount,
      possessionTeamId: battingTeamId || null,
      battingTeamId: battingTeamId || null,
      defenseTeamId: defenseTeamId || null,
      isLive: statusState === "in",
    },
  };
}

export function formatOverlayPosition(position: number): `${number}%` {
  return toOverlayPercent(position);
}
