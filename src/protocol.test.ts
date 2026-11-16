import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol.ts";

describe("客户端消息校验", () => {
  it("拒绝非对象、未知类型与过大消息", () => {
    expect(() => parseClientMessage("[]")).toThrow(/无效消息/);
    expect(() => parseClientMessage('{"type":"hack"}')).toThrow(/未知消息/);
    expect(() => parseClientMessage("x".repeat(5000))).toThrow(/过大/);
  });

  it("只接受 3 或 5 人建房", () => {
    expect(parseClientMessage('{"type":"create","capacity":3}')).toEqual({
      type: "create",
      capacity: 3,
    });
    expect(() => parseClientMessage('{"type":"create","capacity":4}')).toThrow(/3 人或 5 人/);
    expect(() => parseClientMessage('{"type":"create","capacity":"3"}')).toThrow();
  });

  it("规范化并校验房间号", () => {
    expect(parseClientMessage('{"type":"join","roomId":"ab23cd"}')).toEqual({
      type: "join",
      roomId: "AB23CD",
    });
    expect(() => parseClientMessage('{"type":"join","roomId":"../x"}')).toThrow(/房间号无效/);
    expect(() => parseClientMessage('{"type":"join","roomId":"IIIIII"}')).toThrow(/房间号无效/);
  });

  it("校验会话、坐标与准备字段", () => {
    expect(() => parseClientMessage('{"type":"resume","sessionToken":"short"}')).toThrow(/会话无效/);
    expect(() => parseClientMessage('{"type":"place","x":1.5,"y":0}')).toThrow(/坐标无效/);
    expect(() => parseClientMessage('{"type":"place","x":19,"y":0}')).toThrow(/超出棋盘/);
    expect(parseClientMessage('{"type":"place","x":0,"y":18}')).toEqual({
      type: "place",
      x: 0,
      y: 18,
    });
    expect(parseClientMessage('{"type":"ready","ready":true}')).toEqual({
      type: "ready",
      ready: true,
    });
    expect(() => parseClientMessage('{"type":"ready","ready":"yes"}')).toThrow();
    expect(parseClientMessage('{"type":"start"}')).toEqual({ type: "start" });
    expect(parseClientMessage('{"type":"quit"}')).toEqual({ type: "quit" });
  });

  it("忽略声明身份字段，不把 playerId 当协议", () => {
    expect(parseClientMessage('{"type":"start","playerId":"attacker"}')).toEqual({ type: "start" });
  });
});
