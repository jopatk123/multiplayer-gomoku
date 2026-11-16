import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGomokuServer, type GomokuServer } from "./app.ts";
import type { ServerMessage } from "../src/protocol.ts";

const keepOrder = () => 0.999999;

async function listenServer(overrides: Parameters<typeof createGomokuServer>[0] = {}): Promise<{
  server: GomokuServer;
  port: number;
}> {
  const server = createGomokuServer({
    host: "127.0.0.1",
    allowNoOrigin: true,
    allowLocalOrigins: true,
    allowedOrigins: ["https://gomoku.jopatk.top"],
    allowedOriginHostSuffixes: [".bilibili.com", ".hdslb.com"],
    reconnectGraceMs: 120,
    tickMs: 60_000,
    idleLobbyMs: 60_000,
    idleFinishedMs: 60_000,
    rng: keepOrder,
    log: () => {},
    ...overrides,
  });
  const port = await server.listen(0);
  return { server, port };
}

function openWs(port: number, origin?: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : undefined);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

type Inbox = {
  next: (predicate: (msg: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
};

function collect(ws: WebSocket): Inbox {
  const queue: ServerMessage[] = [];
  ws.on("message", (raw) => {
    queue.push(JSON.parse(String(raw)) as ServerMessage);
  });
  return {
    async next(predicate, timeoutMs = 2000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const index = queue.findIndex(predicate);
        if (index >= 0) {
          return queue.splice(index, 1)[0]!;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`timeout waiting for message: ${JSON.stringify(queue)}`);
    },
  };
}

async function request(
  ws: WebSocket,
  inbox: Inbox,
  msg: object,
  predicate: (m: ServerMessage) => boolean = (m) => m.type === "state" || m.type === "error",
): Promise<ServerMessage> {
  ws.send(JSON.stringify(msg));
  return inbox.next(predicate);
}

describe("联机服务", () => {
  let server: GomokuServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("healthcheck 返回 200", async () => {
    const started = await listenServer();
    server = started.server;
    const res = await fetch(`http://127.0.0.1:${started.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("拒绝不在白名单的 Origin", async () => {
    const started = await listenServer({ allowNoOrigin: false, allowLocalOrigins: false });
    server = started.server;
    await expect(openWs(started.port, "https://evil.example")).rejects.toBeTruthy();
    const ok = await openWs(started.port, "https://www.bilibili.com");
    expect(ok.readyState).toBe(WebSocket.OPEN);
    ok.close();
  });

  it("校验消息并把座位绑到连接，不接受客户端冒充他人落子", async () => {
    const started = await listenServer();
    server = started.server;
    const a = await openWs(started.port);
    const aInbox = collect(a);
    const created = await request(a, aInbox, { type: "create", capacity: 3 });
    expect(created.type).toBe("state");
    if (created.type !== "state") return;
    const b = await openWs(started.port);
    const bInbox = collect(b);
    const joinedB = await request(b, bInbox, { type: "join", roomId: created.roomId });
    if (joinedB.type !== "state") throw new Error("expected state");
    const c = await openWs(started.port);
    const cInbox = collect(c);
    const full = await request(c, cInbox, { type: "join", roomId: created.roomId });
    expect(full.type).toBe("state");

    await request(a, aInbox, { type: "start" }, (m) => m.type === "state" && m.match.status === "playing");
    const err = await request(
      b,
      bInbox,
      { type: "place", x: 0, y: 0, playerId: created.playerId },
      (m) => m.type === "error",
    );
    expect(err.type).toBe("error");
    if (err.type === "error") expect(err.message).toMatch(/还没轮到/);

    const placed = await request(
      a,
      aInbox,
      { type: "place", x: 0, y: 0 },
      (m) => m.type === "state" && m.match.lastMove?.x === 0,
    );
    expect(placed.type).toBe("state");
    if (placed.type === "state") {
      expect(placed.match.board[0]![0]).toBe(1);
      expect(placed.match.currentPlayerId).toBe(joinedB.playerId);
    }
    a.close();
    b.close();
    c.close();
  });

  it("刷新断线可凭会话恢复，主动退出立即结束", async () => {
    const started = await listenServer({ reconnectGraceMs: 400 });
    server = started.server;
    const a = await openWs(started.port);
    const aInbox = collect(a);
    const created = await request(a, aInbox, { type: "create", capacity: 3 });
    if (created.type !== "state") throw new Error("expected state");
    const b = await openWs(started.port);
    const bInbox = collect(b);
    await request(b, bInbox, { type: "join", roomId: created.roomId });
    const c = await openWs(started.port);
    const cInbox = collect(c);
    await request(c, cInbox, { type: "join", roomId: created.roomId });
    await request(a, aInbox, { type: "start" }, (m) => m.type === "state" && m.match.status === "playing");

    a.close();
    await new Promise((r) => setTimeout(r, 40));
    const resumed = await openWs(started.port);
    const resumedInbox = collect(resumed);
    const state = await request(resumed, resumedInbox, {
      type: "resume",
      sessionToken: created.sessionToken,
    });
    expect(state.type).toBe("state");
    if (state.type === "state") {
      expect(state.playerId).toBe(created.playerId);
      expect(state.match.status).toBe("playing");
    }

    resumed.send(JSON.stringify({ type: "quit" }));
    const ended = await bInbox.next((m) => m.type === "state" && m.match.status === "aborted");
    expect(ended.type).toBe("state");
    if (ended.type === "state") {
      expect(ended.match.endReason).toBe("player_quit");
      expect(ended.match.winnerId).toBeNull();
    }
    b.close();
    c.close();
  });

  it("宽限内超时跳过仍生效，宽限耗尽才中止且不计胜负", async () => {
    let now = 1_000_000;
    const started = await listenServer({
      now: () => now,
      reconnectGraceMs: 1_000,
      tickMs: 60_000,
    });
    server = started.server;
    const a = await openWs(started.port);
    const aInbox = collect(a);
    const created = await request(a, aInbox, { type: "create", capacity: 3 });
    if (created.type !== "state") throw new Error("expected state");
    const b = await openWs(started.port);
    const bInbox = collect(b);
    await request(b, bInbox, { type: "join", roomId: created.roomId });
    const c = await openWs(started.port);
    const cInbox = collect(c);
    await request(c, cInbox, { type: "join", roomId: created.roomId });
    await request(a, aInbox, { type: "start" }, (m) => m.type === "state" && m.match.status === "playing");

    a.close();
    await bInbox.next((m) => m.type === "state" && m.presence.some((p) => !p.online));
    now += 5_000;
    started.server.tickOnce();
    const afterSkip = await bInbox.next(
      (m) => m.type === "state" && m.match.consecutiveTimeouts === 1,
    );
    expect(afterSkip.type).toBe("state");
    if (afterSkip.type === "state") {
      expect(afterSkip.match.status).toBe("playing");
      expect(afterSkip.match.pendingColor).toBe(1);
    }

    now += 1_000;
    started.server.tickOnce();
    const aborted = await bInbox.next(
      (m) => m.type === "state" && m.match.endReason === "reconnect_timeout",
    );
    expect(aborted.type).toBe("state");
    if (aborted.type === "state") {
      expect(aborted.match.status).toBe("aborted");
      expect(aborted.match.winnerId).toBeNull();
    }
    b.close();
    c.close();
  });

  it("结算后原房全员准备再开一局并重新随机轮次", async () => {
    const started = await listenServer();
    server = started.server;
    const clients = [await openWs(started.port), await openWs(started.port), await openWs(started.port)];
    const inboxes = clients.map((ws) => collect(ws));
    const created = await request(clients[0]!, inboxes[0]!, { type: "create", capacity: 3 });
    if (created.type !== "state") throw new Error("expected state");
    await request(clients[1]!, inboxes[1]!, { type: "join", roomId: created.roomId });
    await request(clients[2]!, inboxes[2]!, { type: "join", roomId: created.roomId });
    await request(
      clients[0]!,
      inboxes[0]!,
      { type: "start" },
      (m) => m.type === "state" && m.match.status === "playing",
    );

    clients[0]!.send(JSON.stringify({ type: "quit" }));
    const ended = await inboxes[1]!.next((m) => m.type === "state" && m.match.status === "aborted");
    expect(ended.type).toBe("state");

    const joiner = await openWs(started.port);
    const joinerInbox = collect(joiner);
    await request(joiner, joinerInbox, { type: "join", roomId: created.roomId });
    await request(clients[1]!, inboxes[1]!, { type: "ready", ready: true });
    await request(clients[2]!, inboxes[2]!, { type: "ready", ready: true });
    const rematch = await request(
      joiner,
      joinerInbox,
      { type: "ready", ready: true },
      (m) => m.type === "state" && m.match.status === "playing" && m.match.readyIds.length === 0,
    );
    expect(rematch.type).toBe("state");
    if (rematch.type === "state") {
      expect(rematch.match.status).toBe("playing");
      expect(rematch.match.capacity).toBe(3);
      expect(rematch.match.players).toHaveLength(3);
      expect(rematch.match.consecutiveTimeouts).toBe(0);
      expect(rematch.match.board[0]![0]).toBe(0);
      expect(rematch.match.pendingColor).toBe(1);
    }
    for (const ws of [...clients, joiner]) ws.close();
  });

  it("建房速率与房间上限", async () => {
    const started = await listenServer({ maxRooms: 1, createPerMinute: 1 });
    server = started.server;
    const a = await openWs(started.port);
    const aInbox = collect(a);
    const first = await request(a, aInbox, { type: "create", capacity: 3 });
    expect(first.type).toBe("state");
    const b = await openWs(started.port);
    const bInbox = collect(b);
    const limited = await request(b, bInbox, { type: "create", capacity: 3 });
    expect(limited.type).toBe("error");
    a.close();
    b.close();
  });

  it("闲置大厅会被清理", async () => {
    let now = 5_000;
    const started = await listenServer({
      now: () => now,
      idleLobbyMs: 100,
      reconnectGraceMs: 10,
    });
    server = started.server;
    const a = await openWs(started.port);
    const aInbox = collect(a);
    await request(a, aInbox, { type: "create", capacity: 3 });
    expect(started.server.roomCount()).toBe(1);
    now += 200;
    started.server.tickOnce();
    expect(started.server.roomCount()).toBe(0);
    a.close();
  });

  it("拒绝伪造会话", async () => {
    const started = await listenServer();
    server = started.server;
    const a = await openWs(started.port);
    const aInbox = collect(a);
    const err = await request(a, aInbox, { type: "resume", sessionToken: "ab".repeat(32) });
    expect(err.type).toBe("error");
    a.close();
  });
});
