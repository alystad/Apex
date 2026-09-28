import Constants from "expo-constants";
import { Platform } from "react-native";

export const API_SETUP_MESSAGE =
  "Start the API with npm run dev:api. For physical devices, set EXPO_PUBLIC_API_URL to your computer's reachable http://<LAN-IP>:4000 if auto-detection does not work.";

export const API_SETUP_COMMANDS = [
  "npm run dev:api",
  "npm run dev:mobile",
  "EXPO_PUBLIC_API_URL=http://<LAN-IP>:4000 npm run dev:mobile",
  "npm run dev:mobile:tunnel",
].join("\n");

// --- LOCAL vs TUNNEL switch ---------------------------------------------
// Controlled by one env var in .env: EXPO_PUBLIC_API_MODE.
//
//   EXPO_PUBLIC_API_MODE=local   -> hit this PC's LAN IP directly
//                                   (EXPO_PUBLIC_LOCAL_API_URL if set,
//                                   otherwise DEV_LAN_API_URL below).
//                                   No cloudflared tunnel needed — the
//                                   phone just needs to be on the same
//                                   Wi-Fi network as this machine.
//   EXPO_PUBLIC_API_MODE=tunnel  -> use EXPO_PUBLIC_API_URL as-is (the
//                                   Cloudflare quick-tunnel URL, kept in
//                                   sync by scripts/tunnel-and-update-env.js).
//   (unset)                     -> same as "tunnel", for backwards
//                                   compatibility with existing .env files.
//
// To switch: edit API_MODE in .env, then restart Expo with a cleared cache
// — EXPO_PUBLIC_* vars are inlined into the JS bundle at build time, so a
// plain reload won't pick up the change (see npx expo start --tunnel --clear
// or --lan --clear depending on which mode you're switching to).
//
// DEV_LAN_API_URL is this machine's LAN IP. It changes whenever this PC
// reconnects to Wi-Fi (new DHCP lease) or joins a different network — if
// LOCAL mode stops connecting, run `ipconfig` (Windows) and update this
// constant (or set EXPO_PUBLIC_LOCAL_API_URL in .env instead, which takes
// priority over this constant without needing a code change).
let loggedBaseOnce = false;
let loggedMissingOnce = false;
const DEV_LAN_API_URL = "http://100.110.144.132:4000";

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function parseHost(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const host = value
    .replace(/^[a-z]+:\/\//i, "")
    .split("/")[0]
    ?.split(":")[0]
    ?.trim();
  return host || null;
}

function getDevHostFromExpo(): string | null {
  const constantsAny = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    expoGoConfig?: { debuggerHost?: string };
    manifest?: { debuggerHost?: string };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
  };
  const candidates = [
    constantsAny.expoConfig?.hostUri,
    constantsAny.expoGoConfig?.debuggerHost,
    constantsAny.manifest?.debuggerHost,
    constantsAny.manifest2?.extra?.expoGo?.debuggerHost,
  ];
  for (const candidate of candidates) {
    const parsed = parseHost(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function isCarrierGradeNatHost(host?: string | null): boolean {
  if (!host) {
    return false;
  }
  return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
}

function urlHost(url?: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isAndroidEmulator(): boolean {
  if (Platform.OS !== "android") {
    return false;
  }
  const constants = Platform.constants as {
    Fingerprint?: string;
    Model?: string;
    Brand?: string;
    Manufacturer?: string;
  };
  const fingerprint = (constants.Fingerprint ?? "").toLowerCase();
  const model = (constants.Model ?? "").toLowerCase();
  const brand = (constants.Brand ?? "").toLowerCase();
  const manufacturer = (constants.Manufacturer ?? "").toLowerCase();
  return (
    fingerprint.includes("generic") ||
    fingerprint.includes("emulator") ||
    model.includes("sdk") ||
    model.includes("emulator") ||
    model.includes("android sdk built for x86") ||
    brand.startsWith("generic") ||
    manufacturer.includes("genymotion")
  );
}

function isIosSimulator(): boolean {
  if (Platform.OS !== "ios") {
    return false;
  }
  const hostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  if (!hostUri) {
    return true;
  }
  const host = hostUri.replace(/^[a-z]+:\/\//i, "").split("/")[0]?.split(":")[0] ?? "";
  return host === "localhost" || host === "127.0.0.1";
}

export function getApiBaseUrl(): string | null {
  const apiMode = (process.env.EXPO_PUBLIC_API_MODE ?? "tunnel").trim().toLowerCase();

  let resolved: string | null;
  if (apiMode === "local") {
    const localUrl = process.env.EXPO_PUBLIC_LOCAL_API_URL?.trim() || DEV_LAN_API_URL;
    resolved = trimTrailingSlash(localUrl);
  } else {
    const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
    resolved = envUrl ? trimTrailingSlash(envUrl) : null;
  }

  if (!resolved && __DEV__) {
    if (isAndroidEmulator()) {
      resolved = "http://10.0.2.2:4000";
    } else if (isIosSimulator()) {
      resolved = "http://localhost:4000";
    } else {
      resolved = DEV_LAN_API_URL;
    }
  }

  if (__DEV__) {
    if (resolved && !loggedBaseOnce) {
      loggedBaseOnce = true;
      console.log(`[api] API BASE (mode=${apiMode}): ${resolved}`);
    }
    if (!resolved && !loggedMissingOnce) {
      loggedMissingOnce = true;
      console.error(`[api] ${API_SETUP_MESSAGE}`);
    }
  }

  // TEMP DEBUG (remove after diagnosing the "Could not reach API" report) —
  // unconditional, unlike the loggedBaseOnce log above, so it fires on every
  // single call and can't be missed by connecting after the first one fired.
  console.log(
    `[api][TEMP DEBUG] EXPO_PUBLIC_API_MODE=${JSON.stringify(process.env.EXPO_PUBLIC_API_MODE)} apiMode=${apiMode} EXPO_PUBLIC_API_URL=${JSON.stringify(process.env.EXPO_PUBLIC_API_URL)} EXPO_PUBLIC_LOCAL_API_URL=${JSON.stringify(process.env.EXPO_PUBLIC_LOCAL_API_URL)} -> resolved=${resolved}`,
  );

  return resolved;
}

export const API_BASE_URL = getApiBaseUrl();

export function isLanHttpUrl(url?: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    const isPrivateV4 =
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    return parsed.protocol === "http:" && (isLocalHost || isPrivateV4 || isCarrierGradeNatHost(host));
  } catch {
    return false;
  }
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error(API_SETUP_MESSAGE);
  }
  return `${base}${normalizePath(path)}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = getApiUrl(path);
  return fetch(url, init);
}

export type ApiHealthCheckResult = {
  ok: boolean;
  baseUrl: string | null;
  url: string | null;
  status?: number;
  error?: string;
  body?: unknown;
};

export async function checkApiHealth(
  baseUrlOverride?: string | null,
  timeoutMs = 12000,
): Promise<ApiHealthCheckResult> {
  const baseUrl = baseUrlOverride ?? getApiBaseUrl();
  if (!baseUrl) {
    const error = API_SETUP_MESSAGE;
    console.error(`[api] health check failed. baseUrl=${String(baseUrl)} error=${error}`);
    return { ok: false, baseUrl, url: null, error };
  }

  const url = `${baseUrl}/health`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.clone().json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      const error = `HTTP ${response.status}`;
      console.error(`[api] health check failed. baseUrl=${baseUrl} url=${url} error=${error}`);
      return { ok: false, baseUrl, url, status: response.status, error, body };
    }

    return { ok: true, baseUrl, url, status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[api] health check failed. baseUrl=${baseUrl} url=${url} error=${message}`);
    return { ok: false, baseUrl, url, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}



