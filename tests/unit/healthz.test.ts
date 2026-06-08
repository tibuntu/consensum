import { describe, expect, test } from "vitest";
import { GET } from "@/app/healthz/route";

describe("GET /healthz", () => {
  test("returns 200 ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
