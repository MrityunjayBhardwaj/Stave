import { describe, it, expect } from "vitest";
import type { ProjectMeta } from "@stave/editor";
import { recentProjectEntries, OPEN_RECENT_LIMIT } from "../recentProjects";

const project = (id: string, lastOpenedAt: number): ProjectMeta =>
  ({ id, name: `Project ${id}`, createdAt: 0, lastOpenedAt }) as ProjectMeta;

describe("File → Open Recent (#2020)", () => {
  it("lists the most recently opened first, whatever order they arrive in", () => {
    const got = recentProjectEntries([project("a", 10), project("c", 30), project("b", 20)], "c");
    expect(got.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("marks the project that is open now, and only that one", () => {
    const got = recentProjectEntries([project("a", 10), project("b", 20)], "a");
    expect(got).toEqual([
      { id: "b", name: "Project b", current: false },
      { id: "a", name: "Project a", current: true },
    ]);
  });

  it("stops at the limit, keeping the newest", () => {
    const many = Array.from({ length: OPEN_RECENT_LIMIT + 5 }, (_, i) => project(String(i), i));
    const got = recentProjectEntries(many, "0");
    expect(got).toHaveLength(OPEN_RECENT_LIMIT);
    expect(got[0].id).toBe(String(OPEN_RECENT_LIMIT + 4));
  });

  it("does not reorder the list it was given", () => {
    const given = [project("a", 10), project("b", 20)];
    recentProjectEntries(given, "a");
    expect(given.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
