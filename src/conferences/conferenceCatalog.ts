import {
  ALL_CONFERENCE_KEY,
  OTHER_CONFERENCE_KEY,
  type ConferenceOption,
} from "@/src/conferences/conferenceFilterTypes";

export type BasketballConference = ConferenceOption & {
  aliases: string[];
};

export const ALL_CONFERENCE_OPTION: ConferenceOption = {
  key: ALL_CONFERENCE_KEY,
  label: "All",
};

export const OTHER_CONFERENCE_OPTION: ConferenceOption = {
  key: OTHER_CONFERENCE_KEY,
  label: "Other",
};

export const COLLEGE_BASKETBALL_CONFERENCES: readonly BasketballConference[] = [
  {
    key: "conf:sec",
    label: "SEC",
    aliases: ["sec", "southeastern", "southeastern conference"],
  },
  {
    key: "conf:big-ten",
    label: "B1G",
    aliases: ["big ten", "big ten conference", "b1g"],
  },
  {
    key: "conf:acc",
    label: "ACC",
    aliases: ["acc", "atlantic coast", "atlantic coast conference"],
  },
  {
    key: "conf:american",
    label: "American",
    aliases: ["american", "aac", "american athletic", "american athletic conference"],
  },
  {
    key: "conf:america-east",
    label: "America East",
    aliases: ["america east", "america east conference"],
  },
  {
    key: "conf:asun",
    label: "ASUN",
    aliases: ["asun", "atlantic sun", "atlantic sun conference"],
  },
  {
    key: "conf:a10",
    label: "A-10",
    aliases: ["a-10", "a10", "atlantic 10", "atlantic 10 conference"],
  },
  {
    key: "conf:big-12",
    label: "Big 12",
    aliases: ["big 12", "big 12 conference"],
  },
  {
    key: "conf:big-east",
    label: "Big East",
    aliases: ["big east", "big east conference"],
  },
  {
    key: "conf:pac-12",
    label: "Pac-12",
    aliases: ["pac-12", "pac 12", "pac-12 conference", "pac 12 conference"],
  },
  {
    key: "conf:mountain-west",
    label: "MWC",
    aliases: ["mountain west", "mountain west conference", "mwc"],
  },
  {
    key: "conf:wcc",
    label: "WCC",
    aliases: ["wcc", "west coast", "west coast conference"],
  },
  {
    key: "conf:big-sky",
    label: "Big Sky",
    aliases: ["big sky", "big sky conference"],
  },
  {
    key: "conf:big-south",
    label: "Big South",
    aliases: ["big south", "big south conference"],
  },
  {
    key: "conf:big-west",
    label: "Big West",
    aliases: ["big west", "big west conference"],
  },
  {
    key: "conf:caa",
    label: "CAA",
    aliases: [
      "caa",
      "coastal athletic association",
      "colonial athletic association",
    ],
  },
  {
    key: "conf:conference-usa",
    label: "Conference USA",
    aliases: ["conference usa", "c-usa", "cusa"],
  },
  {
    key: "conf:horizon",
    label: "Horizon",
    aliases: ["horizon", "horizon league"],
  },
  {
    key: "conf:ivy",
    label: "Ivy",
    aliases: ["ivy", "ivy league"],
  },
  {
    key: "conf:maac",
    label: "MAAC",
    aliases: ["maac", "metro atlantic athletic", "metro atlantic athletic conference"],
  },
  {
    key: "conf:mac",
    label: "MAC",
    aliases: ["mac", "mid-american", "mid-american conference"],
  },
  {
    key: "conf:meac",
    label: "MEAC",
    aliases: ["meac", "mid-eastern athletic", "mid-eastern athletic conference"],
  },
  {
    key: "conf:mvc",
    label: "MVC",
    aliases: ["mvc", "missouri valley", "missouri valley conference"],
  },
  {
    key: "conf:nec",
    label: "NEC",
    aliases: ["nec", "northeast conference"],
  },
  {
    key: "conf:ovc",
    label: "OVC",
    aliases: ["ovc", "ohio valley", "ohio valley conference"],
  },
  {
    key: "conf:patriot",
    label: "Patriot",
    aliases: ["patriot", "patriot league"],
  },
  {
    key: "conf:socon",
    label: "SoCon",
    aliases: ["socon", "southern", "southern conference"],
  },
  {
    key: "conf:southland",
    label: "Southland",
    aliases: ["southland", "southland conference"],
  },
  {
    key: "conf:summit",
    label: "Summit",
    aliases: ["summit", "summit league"],
  },
  {
    key: "conf:sun-belt",
    label: "Sun Belt",
    aliases: ["sun belt", "sun belt conference"],
  },
  {
    key: "conf:swac",
    label: "SWAC",
    aliases: ["swac", "southwestern athletic", "southwestern athletic conference"],
  },
  {
    key: "conf:wac",
    label: "WAC",
    aliases: ["wac", "western athletic", "western athletic conference"],
  },
] as const;

export const NBA_CONFERENCES: readonly BasketballConference[] = [
  {
    key: "conf:eastern",
    label: "Eastern",
    aliases: ["eastern", "eastern conference", "east"],
  },
  {
    key: "conf:western",
    label: "Western",
    aliases: ["western", "western conference", "west"],
  },
] as const;

export const COLLEGE_FULL_CONFERENCE_OPTIONS: readonly ConferenceOption[] = [
  ALL_CONFERENCE_OPTION,
  ...COLLEGE_BASKETBALL_CONFERENCES.map(({ key, label }) => ({ key, label })),
  OTHER_CONFERENCE_OPTION,
];

export const NBA_FULL_CONFERENCE_OPTIONS: readonly ConferenceOption[] = [
  ALL_CONFERENCE_OPTION,
  ...NBA_CONFERENCES.map(({ key, label }) => ({ key, label })),
  OTHER_CONFERENCE_OPTION,
];
