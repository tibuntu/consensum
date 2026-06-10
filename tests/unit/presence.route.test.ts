import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));
vi.mock("@/lib/presence", () => ({ heartbeat: vi.fn(), leave: vi.fn() }));

import { POST } from "@/app/api/documents/[id]/presence/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import * as presence from "@/lib/presence";

function req(body?: unknown): Request {
  return new Request("http://test/api/documents/doc1/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "doc1" }) };

describe("POST /api/documents/[id]/presence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
  });

  it("404 when not a participant", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(false);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
  });

  it("heartbeats and returns 204 for a participant", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null);
    expect(presence.leave).not.toHaveBeenCalled();
  });

  it("leaves when body says leaving:true", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ leaving: true }), ctx);
    expect(res.status).toBe(204);
    expect(presence.leave).toHaveBeenCalledWith("doc1", "u1");
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });

  it("falls back to email then 'Someone' for a blank name", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "", email: "a@b.co" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    await POST(req(), ctx);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" }, null);
  });

  it("passes a valid selection through to heartbeat", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: { start: 2, end: 7, versionNumber: 3 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      { start: 2, end: 7, versionNumber: 3 },
    );
  });

  it("treats selection:null as clearing", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: null }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null);
  });

  it.each([
    { start: 5, end: 5, versionNumber: 1 }, // empty range
    { start: -1, end: 4, versionNumber: 1 }, // negative start
    { start: 0, end: 4, versionNumber: 0 }, // version < 1
    { start: 0.5, end: 4, versionNumber: 1 }, // non-integer
    { start: 0, end: 4 }, // missing versionNumber
    "nonsense", // wrong type
  ])("rejects malformed selection %j with 400", async (selection) => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });
});
