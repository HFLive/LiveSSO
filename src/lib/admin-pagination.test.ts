import { describe, expect, it } from "vitest";
import { adminHref, adminPagination, adminSearchValue } from "./admin-pagination";

describe("admin list navigation", () => {
  it("bounds database offsets for invalid, empty and out-of-range page requests", () => {
    for (const value of ["", "-1", "0", "2.5", "1e6", "Infinity", "999999999999"]) {
      expect(adminPagination(value, 31).skip).toBe(0);
    }
    expect(adminPagination("999", 31)).toMatchObject({ page: 3, pages: 3, skip: 30, take: 15 });
    expect(adminPagination("3", 0)).toMatchObject({ page: 1, pages: 1, skip: 0, total: 0 });
    expect(adminPagination("2", 21, 20)).toMatchObject({ page: 2, skip: 20, take: 20 });
  });
  it("keeps search text and filters intact when generating next-page links", () => {
    const href = adminHref("/admin/invitations", { q: "name+one@example.invalid & team", state: "history", page: 2 });
    const url = new URL(href, "https://auth.example.invalid");
    expect(url.pathname).toBe("/admin/invitations");
    expect(url.searchParams.get("q")).toBe("name+one@example.invalid & team");
    expect(url.searchParams.get("state")).toBe("history");
    expect(url.searchParams.get("page")).toBe("2");
    expect(adminHref("/admin/members", { page: 1, q: "" })).toBe("/admin/members");
  });
  it("normalizes bounded scalar queries and rejects ambiguous repeated values", () => {
    expect(adminSearchValue({ q: ["one", "two"] }, "q")).toBe("");
    expect(adminSearchValue({ q: "  林予安  " }, "q")).toBe("林予安");
    expect(adminSearchValue({ q: "x".repeat(500) }, "q")).toHaveLength(120);
  });
});
