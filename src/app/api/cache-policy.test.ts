import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeDirectoryRequest: vi.fn(),
  getProfileObject: vi.fn(),
  profileAssetFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  auditEventCreate: vi.fn(),
}));

vi.mock("@/lib/security/directory-auth", () => ({
  authorizeDirectoryRequest: mocks.authorizeDirectoryRequest,
}));
vi.mock("@/lib/object-storage", () => ({ getProfileObject: mocks.getProfileObject }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profileAsset: { findFirst: mocks.profileAssetFindFirst },
    user: { findUnique: mocks.userFindUnique },
    auditEvent: { create: mocks.auditEventCreate },
  },
}));

import { GET as getDirectoryUser } from "./directory/users/[userId]/route";
import { GET as getDirectoryStatus } from "./directory/users/[userId]/status/route";
import { GET as getAvatar } from "./profile/avatar/[userId]/route";

const validUserId = "00000000-0000-4000-8000-000000000001";
const privateNoStore = "private, no-store";

describe("API cache policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeDirectoryRequest.mockResolvedValue(null);
  });

  it("marks Directory authentication failures as private and non-cacheable", async () => {
    const context = { params: Promise.resolve({ userId: validUserId }) };
    const [full, status] = await Promise.all([
      getDirectoryUser(new Request(`https://auth.hsfz.live/api/directory/users/${validUserId}`), context),
      getDirectoryStatus(
        new Request(`https://auth.hsfz.live/api/directory/users/${validUserId}/status`),
        context,
      ),
    ]);

    for (const response of [full, status]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe(privateNoStore);
      expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    }
  });

  it("marks Directory not-found responses as private and non-cacheable", async () => {
    mocks.authorizeDirectoryRequest.mockResolvedValue({ clientId: "client-1" });
    mocks.userFindUnique.mockResolvedValue(null);
    const context = { params: Promise.resolve({ userId: validUserId }) };

    const [full, status] = await Promise.all([
      getDirectoryUser(new Request(`https://auth.hsfz.live/api/directory/users/${validUserId}`), context),
      getDirectoryStatus(
        new Request(`https://auth.hsfz.live/api/directory/users/${validUserId}/status`),
        context,
      ),
    ]);

    expect(full.status).toBe(404);
    expect(status.status).toBe(404);
    expect(full.headers.get("cache-control")).toBe(privateNoStore);
    expect(status.headers.get("cache-control")).toBe(privateNoStore);
  });

  it("rejects malformed avatar identifiers before querying PostgreSQL", async () => {
    const response = await getAvatar(
      new Request("https://auth.hsfz.live/api/profile/avatar/not-a-uuid?v=1"),
      { params: Promise.resolve({ userId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe(privateNoStore);
    expect(mocks.profileAssetFindFirst).not.toHaveBeenCalled();
  });

  it("does not cache avatar validation and not-found errors", async () => {
    const invalidVersion = await getAvatar(
      new Request(`https://auth.hsfz.live/api/profile/avatar/${validUserId}?v=invalid`),
      { params: Promise.resolve({ userId: validUserId }) },
    );
    mocks.profileAssetFindFirst.mockResolvedValue(null);
    const notFound = await getAvatar(
      new Request(`https://auth.hsfz.live/api/profile/avatar/${validUserId}?v=1`),
      { params: Promise.resolve({ userId: validUserId }) },
    );

    expect(invalidVersion.status).toBe(400);
    expect(notFound.status).toBe(404);
    expect(invalidVersion.headers.get("cache-control")).toBe(privateNoStore);
    expect(notFound.headers.get("cache-control")).toBe(privateNoStore);
  });

  it("keeps successful versioned avatars publicly immutable", async () => {
    mocks.profileAssetFindFirst.mockResolvedValue({
      objectKey: "avatars/user/avatar.webp",
      contentType: "image/webp",
      checksum: "avatar-checksum",
    });
    mocks.getProfileObject.mockResolvedValue({
      Body: { transformToWebStream: () => new Blob(["avatar"]).stream() },
    });

    const response = await getAvatar(
      new Request(`https://auth.hsfz.live/api/profile/avatar/${validUserId}?v=1`),
      { params: Promise.resolve({ userId: validUserId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("etag")).toBe('"sha256-avatar-checksum"');
  });
});
