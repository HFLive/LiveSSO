import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), update: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/security/admin", () => ({ requirePlatformAdmin: mocks.authorize }));
vi.mock("@/lib/security/client-service", () => ({ setUserAccountStatus: mocks.status }));
vi.mock("@/lib/security/username-service", async (original) => ({ ...await original<object>(), updateUsername: mocks.update }));
import { PATCH } from "./route";
import { UsernameUpdateError } from "@/lib/security/username-service";
const userId = "a097e9c4-1bb0-42d9-9bba-c94d272f3c24";
function patch(body: unknown, origin = "http://localhost:3000") {
  return PATCH(new Request(`http://localhost:3000/api/admin/users/${userId}`, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ userId }) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue({ actor: { id: userId } }); });
describe("admin user PATCH", () => {
  it("rejects unauthenticated and non-admin requests before mutation", async () => {
    for (const status of [401, 403]) {
      mocks.authorize.mockResolvedValue({ error: "DENIED", status });
      expect((await patch({ username: "valid_name" })).status).toBe(status);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects untrusted origins, malformed and mixed operations", async () => {
    expect((await patch({ username: "valid_name" }, "https://foreign.invalid")).status).toBe(403);
    for (const body of [{ username: "ab" }, { username: "valid_name", platformRole: "ADMIN" }, { username: "valid_name", accountStatus: "ACTIVE" }, {}]) expect((await patch(body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns normalized username and reports conflicts", async () => {
    mocks.update.mockResolvedValue({ id: userId, username: "new_name", changed: true });
    expect(await (await patch({ username: "New_Name" })).json()).toEqual({ id: userId, username: "new_name", changed: true });
    mocks.update.mockRejectedValue(new UsernameUpdateError("USERNAME_TAKEN"));
    expect((await patch({ username: "new_name" })).status).toBe(409);
  });
  it("retains the self-disable guard", async () => {
    expect((await patch({ accountStatus: "DISABLED" })).status).toBe(409);
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
