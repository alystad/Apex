import { API_SETUP_MESSAGE, getApiBaseUrl } from "@/src/config/api";

export const API_BASE_URL = getApiBaseUrl();

export function requireApiBaseUrl(): string {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error(API_SETUP_MESSAGE);
  }
  return baseUrl;
}