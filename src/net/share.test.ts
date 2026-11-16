import { describe, expect, it } from "vitest";
import { roomIdFromHash, roomShareUrl } from "./share.ts";

describe("房间分享链接", () => {
  it("从 hash 解析房间号", () => {
    expect(roomIdFromHash("#/r/Ab12Cd")).toBe("AB12CD");
    expect(roomIdFromHash("/r/xyz")).toBe("XYZ");
    expect(roomIdFromHash("#/online")).toBeNull();
    expect(roomIdFromHash("#/")).toBeNull();
  });

  it("用当前页面地址生成 hash 进房链接，不改成联机主机", () => {
    const local = roomShareUrl("d5ltck", "http://127.0.0.1:5173/#/");
    expect(local).toBe("http://127.0.0.1:5173/#/r/D5LTCK");

    const toy = roomShareUrl(
      "room01",
      "https://www.bilibili.com/toy/gomoku/index.html",
    );
    expect(toy).toBe("https://www.bilibili.com/toy/gomoku/index.html#/r/ROOM01");
  });
});
