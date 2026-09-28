export const NBA_CONFERENCE_BY_TEAM_ID: Record<string, "Eastern" | "Western"> = {
  "1": "Eastern",
  "2": "Eastern",
  "3": "Western",
  "4": "Eastern",
  "5": "Eastern",
  "6": "Western",
  "7": "Western",
  "8": "Eastern",
  "9": "Western",
  "10": "Western",
  "11": "Eastern",
  "12": "Western",
  "13": "Western",
  "14": "Eastern",
  "15": "Eastern",
  "16": "Western",
  "17": "Eastern",
  "18": "Eastern",
  "19": "Eastern",
  "20": "Eastern",
  "21": "Western",
  "22": "Western",
  "23": "Western",
  "24": "Western",
  "25": "Western",
  "26": "Western",
  "27": "Eastern",
  "28": "Eastern",
  "29": "Western",
  "30": "Eastern",
};

export function getNbaConferenceForTeamId(
  teamId?: string | null,
): "Eastern" | "Western" | null {
  if (!teamId) {
    return null;
  }
  return NBA_CONFERENCE_BY_TEAM_ID[teamId] ?? null;
}

