import { beforeEach, describe, expect, it, vi } from "vitest";
import { joinPresence, listViewers, resetPresence, setPresenceCard, type PresenceConnection } from "@/lib/presence";
import { isConnId } from "@/lib/presence-conn";

function conn(connId: string, userId: string, notify = vi.fn()): PresenceConnection {
  return { connId, userId, name: userId.toUpperCase(), avatarUrl: null, cardId: null, notify };
}

describe("presence registry", () => {
  beforeEach(() => resetPresence());

  it("lists viewers per board and never leaks across boards", () => {
    joinPresence("b1", conn("c-ada-1", "ada"));
    joinPresence("b2", conn("c-ola-1", "ola"));
    expect(listViewers("b1").map((v) => v.id)).toEqual(["ada"]);
    expect(listViewers("b2").map((v) => v.id)).toEqual(["ola"]);
    expect(listViewers("b3")).toEqual([]);
  });

  it("counts several tabs of the same person once and merges their cards", () => {
    joinPresence("b1", conn("c-ada-1", "ada"));
    joinPresence("b1", conn("c-ada-2", "ada"));
    joinPresence("b1", conn("c-ola-1", "ola"));
    setPresenceCard("b1", "c-ada-1", "ada", "card1");
    setPresenceCard("b1", "c-ada-2", "ada", "card2");
    const viewers = listViewers("b1");
    expect(viewers).toHaveLength(2);
    expect(viewers[0]).toEqual({ id: "ada", name: "ADA", avatarUrl: null, cardIds: ["card1", "card2"] });
    expect(viewers[1].cardIds).toEqual([]);
  });

  it("broadcasts joins, card changes and leaves to everyone on the board", () => {
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    joinPresence("b1", conn("c-ada-1", "ada", a));
    joinPresence("b2", conn("c-tom-1", "tom", other));
    const leave = joinPresence("b1", conn("c-ola-1", "ola", b));
    expect(a).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "ada" }),
      expect.objectContaining({ id: "ola" }),
    ]);
    expect(b).toHaveBeenCalledTimes(1);

    setPresenceCard("b1", "c-ola-1", "ola", "card9");
    expect(a.mock.lastCall?.[0][1].cardIds).toEqual(["card9"]);

    leave();
    expect(a).toHaveBeenLastCalledWith([expect.objectContaining({ id: "ada" })]);
    expect(listViewers("b1").map((v) => v.id)).toEqual(["ada"]);
    // Board 2 heard only its own join.
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast when the card did not change", () => {
    const a = vi.fn();
    joinPresence("b1", conn("c-ada-1", "ada", a));
    setPresenceCard("b1", "c-ada-1", "ada", "card1");
    const calls = a.mock.calls.length;
    setPresenceCard("b1", "c-ada-1", "ada", "card1");
    expect(a.mock.calls.length).toBe(calls);
  });

  it("only lets the owner of a connection set its card", () => {
    joinPresence("b1", conn("c-ada-1", "ada"));
    expect(setPresenceCard("b1", "c-ada-1", "mallory", "card1")).toBe(false);
    expect(setPresenceCard("b2", "c-ada-1", "ada", "card1")).toBe(false);
    expect(setPresenceCard("b1", "unknown", "ada", "card1")).toBe(false);
    expect(listViewers("b1")[0].cardIds).toEqual([]);
  });

  it("drops the board entry when the last connection leaves", () => {
    const leave = joinPresence("b1", conn("c-ada-1", "ada"));
    leave();
    leave(); // idempotent
    expect(listViewers("b1")).toEqual([]);
  });

  it("a stale leave does not remove a reconnect that reused the connection id", () => {
    const leaveOld = joinPresence("b1", conn("c-ada-1", "ada"));
    joinPresence("b1", conn("c-ada-1", "ada"));
    leaveOld();
    expect(listViewers("b1").map((v) => v.id)).toEqual(["ada"]);
  });

  it("keeps going when one listener throws", () => {
    const ok = vi.fn();
    joinPresence("b1", conn("c-bad-1", "bad", vi.fn(() => { throw new Error("closed"); })));
    joinPresence("b1", conn("c-ok-1", "ok", ok));
    expect(ok).toHaveBeenCalled();
  });
});

describe("connection ids", () => {
  it("accepts uuids and rejects junk", () => {
    expect(isConnId("0b8f3c2e-4a1d-4e2a-9a55-3c1f1f0e9d11")).toBe(true);
    expect(isConnId("short")).toBe(false);
    expect(isConnId("../../etc")).toBe(false);
    expect(isConnId(42)).toBe(false);
  });
});
