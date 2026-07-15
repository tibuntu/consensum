import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ resolveAccess: vi.fn() }));
vi.mock("@/lib/review-session", () => ({
  startSession: vi.fn(), joinSession: vi.fn(), leaveSession: vi.fn(), endSession: vi.fn(),
}));

import { POST } from "@/app/api/documents/[id]/session/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import * as session from "@/lib/review-session";

function req(body?: unknown): Request {
  return new Request("http://test/api/documents/doc1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "doc1" }) };
const user = { id: "u1", name: "Ada", email: "a@b.co" };
const fakeSession = { sessionId: "s1", documentId: "doc1", leaderId: "u1", leaderName: "Ada", participants: [], startedAt: 1 };

function auth(ok = true) {
  vi.mocked(api.requireUser).mockResolvedValueOnce(user as never);
  vi.mocked(authz.resolveAccess).mockResolvedValueOnce(ok ? { role: "REVIEWER", canView: true, canReview: true, canManage: false, visibility: "LINK", archived: false } : null);
}

describe("POST /api/documents/[id]/session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    expect((await POST(req({ action: "start" }), ctx)).status).toBe(401);
  });

  it("404 when not a participant", async () => {
    auth(false);
    expect((await POST(req({ action: "start" }), ctx)).status).toBe(404);
  });

  it("400 for an unknown action", async () => {
    auth();
    expect((await POST(req({ action: "frobnicate" }), ctx)).status).toBe(400);
  });

  it("start returns 200 with the session", async () => {
    auth();
    vi.mocked(session.startSession).mockReturnValueOnce(fakeSession as never);
    const res = await POST(req({ action: "start" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: fakeSession });
    expect(session.startSession).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" });
  });

  it("start returns 409 when a session already exists", async () => {
    auth();
    vi.mocked(session.startSession).mockReturnValueOnce(null);
    expect((await POST(req({ action: "start" }), ctx)).status).toBe(409);
  });

  it("join returns 200 with the session", async () => {
    auth();
    vi.mocked(session.joinSession).mockReturnValueOnce(fakeSession as never);
    expect((await POST(req({ action: "join" }), ctx)).status).toBe(200);
  });

  it("join returns 409 when no session exists", async () => {
    auth();
    vi.mocked(session.joinSession).mockReturnValueOnce(null);
    expect((await POST(req({ action: "join" }), ctx)).status).toBe(409);
  });

  it("leave returns 204", async () => {
    auth();
    const res = await POST(req({ action: "leave" }), ctx);
    expect(res.status).toBe(204);
    expect(session.leaveSession).toHaveBeenCalledWith("doc1", "u1");
  });

  it("end returns 204 for the leader", async () => {
    auth();
    vi.mocked(session.endSession).mockReturnValueOnce(true);
    expect((await POST(req({ action: "end" }), ctx)).status).toBe(204);
  });

  it("end returns 403 for a non-leader", async () => {
    auth();
    vi.mocked(session.endSession).mockReturnValueOnce(false);
    expect((await POST(req({ action: "end" }), ctx)).status).toBe(403);
  });

  it("falls back to email for a blank name", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "", email: "a@b.co" } as never);
    vi.mocked(authz.resolveAccess).mockResolvedValueOnce({ role: "REVIEWER", canView: true, canReview: true, canManage: false, visibility: "LINK", archived: false });
    vi.mocked(session.startSession).mockReturnValueOnce(fakeSession as never);
    await POST(req({ action: "start" }), ctx);
    expect(session.startSession).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" });
  });
});
