import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/authz", () => ({ isParticipant: vi.fn() }));

import { GET } from "@/app/api/documents/[id]/stream/route";
import * as api from "@/lib/api";
import * as authz from "@/lib/authz";
import { startSession, endSession } from "@/lib/review-session";

const ctx = { params: Promise.resolve({ id: "stream-sess-1" }) };

async function firstChunks(res: Response, n = 3): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (let i = 0; i < n; i++) buf += dec.decode((await reader.read()).value ?? new Uint8Array());
  await reader.cancel();
  return buf;
}

describe("GET /api/documents/[id]/stream session snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replays an active session as session.started on connect", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "viewer" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    startSession("stream-sess-1", { userId: "lead", name: "Ada" });

    const res = await GET(new Request("http://test"), ctx);
    const buf = await firstChunks(res);
    expect(buf).toContain("session.started");
    expect(buf).toContain('"leaderId":"lead"');
    endSession("stream-sess-1", "lead");
  });

  it("emits no session.started when no session is active", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "viewer" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await GET(new Request("http://test"), { params: Promise.resolve({ id: "stream-sess-2" }) });
    const buf = await firstChunks(res, 2);
    expect(buf).not.toContain("session.started");
  });
});
