export type AdminSearchParams = Record<string, string | string[] | undefined>;

export function adminSearchValue(params: AdminSearchParams, key: string) {
  const value = params[key];
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function adminPagination(value: string, total: number, size = 15) {
  const requested = /^\d{1,8}$/.test(value) ? Number(value) : 1;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, requested));
  return { page, pages, total, take: size, skip: (page - 1) * size };
}

export function adminHref(path: string, values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "" && !(key === "page" && Number(value) === 1)) query.set(key, String(value));
  }
  return `${path}${query.size ? `?${query}` : ""}`;
}
