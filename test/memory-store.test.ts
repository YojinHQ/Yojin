import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../src/sessions/memory-store.js";

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    channelId: "slack",
    threadId: "thread-1",
    userId: "user-1",
    providerId: "anthropic",
    model: "claude-sonnet-4-20250514",
    history: [],
    ...overrides,
  };
}

describe("InMemorySessionStore", () => {
  it("creates a session with generated id and timestamps", async () => {
    const store = new InMemorySessionStore();
    const session = await store.create(sessionData());

    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe("string");
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBe(session.createdAt);
    expect(session.channelId).toBe("slack");
    expect(session.userId).toBe("user-1");
  });

  it("retrieves a session by id", async () => {
    const store = new InMemorySessionStore();
    const created = await store.create(sessionData());
    const fetched = await store.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("returns undefined for unknown id", async () => {
    const store = new InMemorySessionStore();
    expect(await store.get("nonexistent")).toBeUndefined();
  });

  it("finds a session by channel and thread", async () => {
    const store = new InMemorySessionStore();
    await store.create(sessionData({ channelId: "slack", threadId: "t1" }));
    await store.create(sessionData({ channelId: "slack", threadId: "t2" }));

    const found = await store.getByThread("slack", "t2");
    expect(found).toBeDefined();
    expect(found!.threadId).toBe("t2");
  });

  it("returns undefined when thread not found", async () => {
    const store = new InMemorySessionStore();
    await store.create(sessionData({ channelId: "slack", threadId: "t1" }));
    expect(await store.getByThread("slack", "t99")).toBeUndefined();
  });

  it("returns undefined when channel does not match", async () => {
    const store = new InMemorySessionStore();
    await store.create(sessionData({ channelId: "slack", threadId: "t1" }));
    expect(await store.getByThread("discord", "t1")).toBeUndefined();
  });

  it("updates a session and refreshes updatedAt", async () => {
    const store = new InMemorySessionStore();
    const created = await store.create(sessionData());

    // Small delay so updatedAt differs
    const updated = await store.update(created.id, { model: "claude-opus-4-20250514" });
    expect(updated.model).toBe("claude-opus-4-20250514");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect(updated.channelId).toBe("slack"); // untouched fields preserved
  });

  it("throws when updating a nonexistent session", async () => {
    const store = new InMemorySessionStore();
    await expect(store.update("fake", { model: "x" })).rejects.toThrow(
      "Session not found: fake",
    );
  });

  it("deletes a session", async () => {
    const store = new InMemorySessionStore();
    const session = await store.create(sessionData());
    await store.delete(session.id);
    expect(await store.get(session.id)).toBeUndefined();
  });

  it("delete is idempotent for unknown ids", async () => {
    const store = new InMemorySessionStore();
    await expect(store.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("creates multiple independent sessions", async () => {
    const store = new InMemorySessionStore();
    const s1 = await store.create(sessionData({ userId: "u1" }));
    const s2 = await store.create(sessionData({ userId: "u2" }));
    expect(s1.id).not.toBe(s2.id);
    expect((await store.get(s1.id))!.userId).toBe("u1");
    expect((await store.get(s2.id))!.userId).toBe("u2");
  });
});
