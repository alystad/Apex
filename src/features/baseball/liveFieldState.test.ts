import {
  mapEspnAthleteToOverlayPlayer,
  parseBaseballOnFieldState,
} from "@/src/features/baseball/liveFieldState";
import { placeOverlaysAtSpot } from "@/src/features/baseball/fieldLayout";

type FieldStateTestResult = {
  name: string;
  passed: boolean;
  details: string;
};

const SAMPLE_SUMMARY = {
  header: {
    competitions: [
      {
        status: {
          period: 6,
          periodPrefix: "Top",
          type: { state: "in", shortDetail: "Top 6th" },
        },
        competitors: [
          { homeAway: "home", team: { id: "H1" } },
          { homeAway: "away", team: { id: "A1" } },
        ],
      },
    ],
  },
  situation: {
    outs: 1,
    balls: 2,
    strikes: 1,
    batter: { playerId: "b1" },
    pitcher: { playerId: "p1" },
    onFirst: { playerId: "r1" },
    onSecond: true,
    onThird: { playerId: "r3" },
  },
  rosters: [
    {
      homeAway: "home",
      team: { id: "H1" },
      roster: [
        { active: true, starter: true, athlete: { id: "p1", displayName: "Pitch One", shortName: "P. One", jersey: "12" }, position: { abbreviation: "P" } },
        { active: true, starter: true, athlete: { id: "c1", displayName: "Catch One", shortName: "C. One", jersey: "4" }, position: { abbreviation: "C" } },
        { active: true, starter: true, athlete: { id: "f1", displayName: "First One", shortName: "F. One", jersey: "8" }, position: { abbreviation: "1B" } },
        { active: true, starter: true, athlete: { id: "f2", displayName: "Second One", shortName: "S. One", jersey: "10" }, position: { abbreviation: "2B" } },
        { active: true, starter: true, athlete: { id: "f3", displayName: "Third One", shortName: "T. One", jersey: "2" }, position: { abbreviation: "3B" } },
        { active: true, starter: true, athlete: { id: "f4", displayName: "Short One", shortName: "SS. One", jersey: "6" }, position: { abbreviation: "SS" } },
        { active: true, starter: true, athlete: { id: "f5", displayName: "Left One", shortName: "L. One", jersey: "21" }, position: { abbreviation: "LF" } },
        { active: true, starter: true, athlete: { id: "f6", displayName: "Center One", shortName: "CF. One", jersey: "15" }, position: { abbreviation: "CF" } },
        { active: true, starter: true, athlete: { id: "f7", displayName: "Right One", shortName: "R. One", jersey: "5" }, position: { abbreviation: "RF" } },
      ],
    },
    {
      homeAway: "away",
      team: { id: "A1" },
      roster: [
        { active: true, starter: true, athlete: { id: "b1", displayName: "Batter One", shortName: "B. One", jersey: "7" }, position: { abbreviation: "CF" } },
        { active: true, starter: true, athlete: { id: "r1", displayName: "Runner One", shortName: "R. One", jersey: "18" }, position: { abbreviation: "LF" } },
        { active: true, starter: true, athlete: { id: "r3", displayName: "Runner Three", shortName: "R. Three", jersey: "22" }, position: { abbreviation: "RF" } },
      ],
    },
  ],
} as const;

export function runBaseballFieldStateUnitTests(): FieldStateTestResult[] {
  const parsed = parseBaseballOnFieldState(SAMPLE_SUMMARY);
  const mappedBatter = parsed.batter
    ? mapEspnAthleteToOverlayPlayer(parsed.batter)
    : null;
  const mappedWithFallbacks = mapEspnAthleteToOverlayPlayer(
    {
      id: "fallback-1",
      teamId: "A1",
      name: "Fallback Player",
      shortName: "F. Player",
      lastName: "Player",
      jersey: "�",
      position: "CF",
      headshot: "http://example.com/fallback.png",
      starter: true,
      active: true,
      didNotPlay: false,
    },
    {
      id: "fallback-1",
      teamId: "A1",
      name: "Fallback Player",
      shortName: "F. Player",
      lastName: "Player",
      jersey: "9",
      position: "CF",
      heightInches: null,
      heightDisplay: "-",
      headshot: "https://cdn.example.com/headshot.png",
      starter: true,
      active: true,
      didNotPlay: false,
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
    },
  );
  const oneBaseCollision = placeOverlaysAtSpot("BASE1", [{ id: "runner" }, { id: "fielder" }], {
    containerWidth: 360,
    containerHeight: 620,
  });

  return [
    {
      name: "top inning resolves home defense",
      passed: parsed.meta.defenseTeamId === "H1",
      details: `defense=${parsed.meta.defenseTeamId ?? "-"}`,
    },
    {
      name: "batter resolves from situation",
      passed: parsed.batter?.id === "b1",
      details: `batter=${parsed.batter?.id ?? "-"}`,
    },
    {
      name: "boolean second base occupancy yields placeholder runner",
      passed: Boolean(parsed.runners.second?.id.startsWith("runner-")),
      details: `runner2=${parsed.runners.second?.id ?? "-"}`,
    },
    {
      name: "defense core positions are assigned",
      passed: Boolean(parsed.defense.P && parsed.defense.C && parsed.defense["1B"]),
      details: `P=${parsed.defense.P?.id ?? "-"} C=${parsed.defense.C?.id ?? "-"} 1B=${parsed.defense["1B"]?.id ?? "-"}`,
    },
    {
      name: "overlay mapper outputs baseball player object",
      passed: mappedBatter?.sport === "baseball" && mappedBatter?.id === "b1",
      details: `sport=${mappedBatter?.sport ?? "-"} id=${mappedBatter?.id ?? "-"}`,
    },
    {
      name: "collision helper separates same-spot overlays",
      passed:
        oneBaseCollision.length === 2 &&
        oneBaseCollision[0].leftPct !== oneBaseCollision[1].leftPct,
      details: `lefts=${oneBaseCollision.map((row) => row.leftPct).join(",")}`,
    },
    {
      name: "overlay mapper sanitizes headshot and jersey",
      passed:
        mappedWithFallbacks.jersey === "9" &&
        mappedWithFallbacks.headshot === "https://example.com/fallback.png",
      details: `jersey=${mappedWithFallbacks.jersey} headshot=${mappedWithFallbacks.headshot}`,
    },
  ];
}
