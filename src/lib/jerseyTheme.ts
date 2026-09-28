export type TeamColorInput = {
  id?: string;
  abbreviation?: string;
  color?: string | null;
  alternateColor?: string | null;
};

export type JerseyTheme = {
  homeJersey: string;
  awayJersey: string;
  homeAccent: string;
  awayAccent: string;
  lineColor: string;
  homeTint: string;
  awayTint: string;
  textOnHome: "#000000" | "#FFFFFF";
  textOnAway: "#000000" | "#FFFFFF";
  confidence: "low" | "medium" | "high";
  reason: string;
};

function normalizeHex(input?: string | null, fallback = "#111111"): string {
  if (!input) {
    return fallback;
  }
  const trimmed = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return fallback;
  }
  return `#${trimmed.toUpperCase()}`;
}

function toRgb(hex: string): [number, number, number] {
  const raw = normalizeHex(hex).replace("#", "");
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isLight(hex: string): boolean {
  return luminance(hex) > 0.58;
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getJerseyTheme(input: {
  eventId?: string;
  homeTeam?: TeamColorInput | null;
  awayTeam?: TeamColorInput | null;
  home?: TeamColorInput | null;
  away?: TeamColorInput | null;
}): JerseyTheme {
  const homeTeam = input.homeTeam ?? input.home ?? null;
  const awayTeam = input.awayTeam ?? input.away ?? null;

  const homePrimary = normalizeHex(homeTeam?.color, "#FFFFFF");
  const homeAlt = normalizeHex(homeTeam?.alternateColor, "#D6D6D6");
  const awayPrimary = normalizeHex(awayTeam?.color, "#111111");
  const awayAlt = normalizeHex(awayTeam?.alternateColor, "#2E2E2E");

  const awayJersey = isLight(awayPrimary) ? awayAlt : awayPrimary;
  const homeJersey = isLight(homePrimary) ? homePrimary : "#FFFFFF";

  return {
    homeJersey,
    awayJersey,
    homeAccent: homeAlt,
    awayAccent: awayAlt,
    lineColor: awayAlt,
    homeTint: withAlpha(homeJersey, 0.1),
    awayTint: withAlpha(awayJersey, 0.1),
    textOnHome: isLight(homeJersey) ? "#000000" : "#FFFFFF",
    textOnAway: isLight(awayJersey) ? "#000000" : "#FFFFFF",
    confidence: "medium",
    reason: "derived from team primary/alternate colors",
  };
}