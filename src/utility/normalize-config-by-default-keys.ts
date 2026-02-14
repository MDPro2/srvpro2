import { normalizeConfigValue } from './normalize-config-value';

function toCamelCaseKey(key: string): string {
  const lower = key.toLowerCase();
  return lower.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

export function normalizeConfigByDefaultKeys<T extends Record<string, string>>(
  readConfig: Record<string, unknown>,
  defaultConfig: T,
): Partial<T> {
  const normalizedConfig: Partial<T> = {};
  for (const key of Object.keys(defaultConfig) as Array<keyof T>) {
    const rawKey = key as string;
    const camelKey = toCamelCaseKey(rawKey);
    const value =
      readConfig[camelKey] !== undefined
        ? readConfig[camelKey]
        : readConfig[rawKey];
    const normalized = normalizeConfigValue(value);
    if (normalized !== undefined) {
      normalizedConfig[key] = normalized as T[typeof key];
    }
  }
  return normalizedConfig;
}
