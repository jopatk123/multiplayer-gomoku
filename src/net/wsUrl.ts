export function resolveWsUrl(): string | null {
  const injected = import.meta.env.VITE_WS_URL?.trim();
  if (injected) return injected;
  return null;
}
