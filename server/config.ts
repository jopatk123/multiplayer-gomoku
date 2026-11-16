export type GomokuConfig = {
  host: string;
  port: number;
  allowedOrigins: string[];
  allowedOriginHostSuffixes: string[];
  allowNoOrigin: boolean;
  allowLocalOrigins: boolean;
  reconnectGraceMs: number;
  maxRooms: number;
  maxConnections: number;
  maxMessageBytes: number;
  connectPerMinute: number;
  messagesPerSecond: number;
  createPerMinute: number;
  idleLobbyMs: number;
  idleFinishedMs: number;
  tickMs: number;
  now: () => number;
  rng: () => number;
  log: (event: string, fields?: Record<string, unknown>) => void;
};

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true" || value === "yes";
}

export const DEFAULT_RECONNECT_GRACE_MS = 20_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GomokuConfig {
  const production = env.NODE_ENV === "production";
  return {
    host: env.GOMOKU_HOST || "127.0.0.1",
    port: num(env.GOMOKU_WS_PORT, 18765),
    allowedOrigins: csv(env.GOMOKU_ALLOWED_ORIGINS),
    allowedOriginHostSuffixes: csv(
      env.GOMOKU_ALLOWED_ORIGIN_HOST_SUFFIXES ?? ".bilibili.com,.hdslb.com",
    ),
    allowNoOrigin: flag(env.GOMOKU_ALLOW_NO_ORIGIN, !production),
    allowLocalOrigins: flag(env.GOMOKU_ALLOW_LOCAL_ORIGINS, !production),
    reconnectGraceMs: num(env.GOMOKU_RECONNECT_GRACE_MS, DEFAULT_RECONNECT_GRACE_MS),
    maxRooms: num(env.GOMOKU_MAX_ROOMS, 200),
    maxConnections: num(env.GOMOKU_MAX_CONNECTIONS, 400),
    maxMessageBytes: num(env.GOMOKU_MAX_MESSAGE_BYTES, 4096),
    connectPerMinute: num(env.GOMOKU_CONNECT_PER_MIN, 30),
    messagesPerSecond: num(env.GOMOKU_MESSAGES_PER_SEC, 20),
    createPerMinute: num(env.GOMOKU_CREATE_PER_MIN, 8),
    idleLobbyMs: num(env.GOMOKU_IDLE_LOBBY_MS, 15 * 60_000),
    idleFinishedMs: num(env.GOMOKU_IDLE_FINISHED_MS, 20 * 60_000),
    tickMs: num(env.GOMOKU_TICK_MS, 50),
    now: Date.now,
    rng: Math.random,
    log: (event, fields) => {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event,
          ...fields,
        }),
      );
    },
  };
}
