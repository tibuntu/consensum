import { describe, expect, test, vi, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/readyz/route";

afterEach(() => vi.restoreAllMocks());

describe("GET /readyz", () => {
  test("200 when DB responds", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("503 when DB query throws", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });
});
