import { describe, it, expect } from "vitest";
import { TEMPLATES, getTemplateFiles, FULL_SONG_CODE } from "../templates";

describe("project templates", () => {
  // getTemplateFiles answers an id it does not know with the Starter files.
  // A template listed in the dialog without its own case would therefore open
  // as Starter and nothing would say so.
  it("every listed template has files of its own, not the Starter fallback", () => {
    const starter = JSON.stringify(getTemplateFiles("starter"));
    expect(JSON.stringify(getTemplateFiles("no-such-template"))).toBe(starter);
    for (const t of TEMPLATES) {
      if (t.id === "starter") continue;
      expect(JSON.stringify(getTemplateFiles(t.id)), t.id).not.toBe(starter);
    }
  });

  it("Full Song is one Strudel file holding the song", () => {
    expect(TEMPLATES.map((t) => t.id)).toContain("song");
    const files = getTemplateFiles("song");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "song.strudel", language: "strudel", content: FULL_SONG_CODE });
  });

  it("the song's five tracks each run 48 bars", () => {
    const tracks = [...FULL_SONG_CODE.matchAll(/^(\w+):\s+arrange\((.*)\)$/gm)];
    expect(tracks.map((m) => m[1])).toEqual(["drums", "bass", "keys", "lead", "voice"]);
    for (const [, name, sections] of tracks) {
      const bars = [...sections.matchAll(/\[(\d+),/g)].reduce((sum, m) => sum + Number(m[1]), 0);
      expect(bars, name).toBe(48);
    }
  });
});
