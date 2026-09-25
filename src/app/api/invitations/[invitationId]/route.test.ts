import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/security/admin", () => ({ requirePlatformAdmin: mocks.authorize }));
vi.mock("@/lib/security/invitation-management", async (original) => ({ ...await original<object>(), revokeInvitation: mocks.revoke }));
import { DELETE } from "./route";

const invitationId = "a097e9c4-1bb0-42d9-9bba-c94d272f3c24";
function remove(id = invitationId, origin = "http://localhost:3000") {
  return DELETE(new Request(`http://localhost:3000/api/invitations/${id}`, { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ invitationId: id }) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue({ actor: { id: invitationId } }); });
describe("invitation DELETE", () => {
  it("rejects unauthenticated, cross-origin, and malformed requests before writing", async () => {
    mocks.authorize.mockResolvedValueOnce({ error: "UNAUTHORIZED", status: 401 });
    expect((await remove()).status).toBe(401);
    expect((await remove(invitationId, "https://other.invalid")).status).toBe(403);
    expect((await remove("not-a-uuid")).status).toBe(400);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("returns the terminal state and a clear conflict for stale records", async () => {
    mocks.revoke.mockResolvedValueOnce({ id: invitationId, status: "REVOKED" });
    expect(await (await remove()).json()).toMatchObject({ id: invitationId, status: "REVOKED" });
    const { InvitationManagementError } = await import("@/lib/security/invitation-management");
    mocks.revoke.mockRejectedValueOnce(new InvitationManagementError("INVITATION_NOT_PENDING"));
    expect((await remove()).status).toBe(409);
  });
});
