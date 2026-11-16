import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { originAllowed } from "./origin.ts";

describe("Origin 白名单", () => {
  const cfg = loadConfig({
    NODE_ENV: "production",
    GOMOKU_ALLOWED_ORIGINS: "https://gomoku.jopatk.top,https://www.bilibili.com",
    GOMOKU_ALLOWED_ORIGIN_HOST_SUFFIXES: ".bilibili.com,.hdslb.com",
    GOMOKU_ALLOW_NO_ORIGIN: "0",
    GOMOKU_ALLOW_LOCAL_ORIGINS: "0",
  });

  it("放行配置的精确 Origin 与 B 站后缀，不把 Origin 当身份", () => {
    expect(originAllowed("https://gomoku.jopatk.top", cfg)).toBe(true);
    expect(originAllowed("https://www.bilibili.com", cfg)).toBe(true);
    expect(originAllowed("https://m.bilibili.com", cfg)).toBe(true);
    expect(originAllowed("https://preview.hdslb.com", cfg)).toBe(true);
  });

  it("拒绝无关站点、缺 Origin 和本地来源（生产默认）", () => {
    expect(originAllowed("https://evil.example", cfg)).toBe(false);
    expect(originAllowed(undefined, cfg)).toBe(false);
    expect(originAllowed("http://127.0.0.1:5173", cfg)).toBe(false);
  });

  it("开发配置可放行本机 Origin 与缺 Origin", () => {
    const dev = loadConfig({
      NODE_ENV: "development",
      GOMOKU_ALLOWED_ORIGINS: "",
      GOMOKU_ALLOWED_ORIGIN_HOST_SUFFIXES: "",
    });
    expect(originAllowed(undefined, dev)).toBe(true);
    expect(originAllowed("http://127.0.0.1:5173", dev)).toBe(true);
    expect(originAllowed("http://localhost:4173", dev)).toBe(true);
  });
});
