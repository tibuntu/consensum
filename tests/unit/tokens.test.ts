import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { generateToken, verifyToken, listTokens, revokeToken } from "@/lib/tokens";

async function makeUser() {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: "U", email: `u-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("tokens service", () => {
  it("generates, verifies, lists, revokes", async () => {
    const user = await makeUser();
    const { id, token } = await generateToken(user.id, "ci");
    expect(token.startsWith("qai_")).toBe(true);

    const verified = await verifyToken(`Bearer ${token}`);
    expect(verified?.user.id).toBe(user.id);
    expect(verified?.scopes).toContain("plans:write");

    expect(await verifyToken("Bearer nonsense")).toBeNull();
    expect(await verifyToken(null)).toBeNull();
    expect(await verifyToken(token)).toBeNull(); // missing "Bearer " prefix

    const list = await listTokens(user.id);
    expect(list.find((t) => t.id === id)).toBeTruthy();
    expect((list[0] as Record<string, unknown>).tokenHash).toBeUndefined();

    await revokeToken(user.id, id);
    expect(await verifyToken(`Bearer ${token}`)).toBeNull();
  });

  it("rejects expired tokens and honours scopes", async () => {
    const user = await makeUser();
    const expired = await generateToken(user.id, "old", { expiresAt: new Date(Date.now() - 1000), scopes: "plans:write,feedback:read" });
    expect(await verifyToken(`Bearer ${expired.token}`)).toBeNull();

    const readOnly = await generateToken(user.id, "ro", { scopes: "feedback:read" });
    const v = await verifyToken(`Bearer ${readOnly.token}`);
    expect(v?.scopes).toEqual(["feedback:read"]);
  });
});
