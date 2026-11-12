// #2303 — the flagged list's old address. #2331 moved it to
// /api/gallery/admin/reports (admins are signed-in accounts now, and the list is
// grouped by entry); this keeps the old URL answering the same, admin-only.
export { GET } from "../admin/reports/route";
