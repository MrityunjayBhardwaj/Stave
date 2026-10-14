import { describe, expect, it } from "vitest";

import { collectAssets } from "../filter";
import { recordsToAssets } from "../samplesProvider";
import { createSoundsProvider, type SoundMapDict } from "../soundsProvider";

/**
 * #2062 — your own audio is listed under Sounds → User.
 *
 * A file you add or record is registered in the sound map (that is how `s()`
 * reaches it), and the map says nothing about who made a sound. Before, the
 * Sounds list stamped every map entry "built-in": Sounds → User was empty, and
 * your file sat among Stave's own sounds labelled as one of them.
 */

const noop = { startPreview: () => ({ stop: () => {} }), onInsert: () => {} };

// `my_kick` is in the map because it was registered; so are two shipped sounds
const DICT: SoundMapDict = {
  bd: { data: { type: "sample" } },
  sawtooth: { data: { type: "synth" } },
  my_kick: { data: { type: "sample" } },
};
const own = recordsToAssets(
  [{ id: "rec-1", name: "my_kick", blobHash: "h1", mime: "audio/wav", origin: "imported" }],
  noop,
);
const provider = createSoundsProvider({ readDict: () => DICT, ...noop, ownAudio: () => own });
const list = (source: "user" | "built-in" | null) =>
  collectAssets([provider], { query: "", type: "sound", source, category: null });

describe("#2062 — your audio under Sounds → User", () => {
  it("Sounds → User lists the file you added", () => {
    expect(list("user").map((a) => a.name)).toEqual(["my_kick"]);
  });

  it("Sounds → Built-in no longer lists your file as a built-in sound", () => {
    expect(list("built-in").map((a) => a.id).sort()).toEqual(["bd", "sawtooth"]);
  });

  it("your file is listed once under Sounds, not twice", () => {
    expect(list(null).filter((a) => (a.code ?? a.id) === "my_kick")).toHaveLength(1);
  });

  it("its row is the one with your audio's size and remove — the record's, not the map entry's", () => {
    expect(list("user")[0].id).toBe("rec-1");
  });
});
