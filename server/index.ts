import { randomBytes } from "node:crypto";
import { createGomokuServer } from "./app.ts";
import { loadConfig } from "./config.ts";

function cryptoRng(): number {
  return randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;
}

const config = loadConfig();
const server = createGomokuServer({
  ...config,
  rng: cryptoRng,
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  config.log("shutdown", { signal });
  try {
    await server.close();
    process.exit(0);
  } catch (err) {
    config.log("shutdown_error", { message: err instanceof Error ? err.message : "unknown" });
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await server.listen(config.port);
