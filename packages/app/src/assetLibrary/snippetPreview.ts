/**
 * Play a Library sketch without touching the project (#2165).
 *
 * The sketch runs on an engine of its own, made on the first preview and kept:
 * evaluating it on the project's engine would replace the document loaded to
 * play. One sketch plays at a time; each preview gets a generation, and a
 * handle stops the engine only while its own sketch is the one playing, so a
 * late stop from an earlier row can't cut off the next one.
 */

import { StrudelEngine } from "@stave/editor";
import type { AssetPreviewHandle } from "./types";

let engine: StrudelEngine | null = null;
let generation = 0;
let notesPlayed = 0;

function previewEngine(): StrudelEngine {
  if (!engine) {
    // its sliders apart from the project's (same offsets, different files)
    engine = new StrudelEngine({ sliderScope: "library-preview:" });
    engine.on("hap", () => {
      notesPlayed++;
    });
  }
  return engine;
}

/** How many notes previews have triggered so far — what a test observes. */
export function previewNotesPlayed(): number {
  return notesPlayed;
}

/** Play `code`; resolves once it is playing. Rejects with the sketch's error. */
export async function playSnippet(code: string): Promise<AssetPreviewHandle> {
  const mine = ++generation;
  const e = previewEngine();
  await e.init();
  const { error } = await e.evaluate(code);
  if (error) throw error;
  // a newer preview, or a stop, came in while this one was loading
  if (mine !== generation) return { stop: () => {} };
  e.play();
  return {
    stop: () => {
      if (mine !== generation) return;
      generation++;
      e.stop();
    },
  };
}

/**
 * What a sketch does in the real engine (#2165's browser test): its error, if
 * it has one, and the sounds its events name over the first `cycles` cycles.
 * Evaluates on the preview engine, so it plays nothing and leaves the project
 * alone.
 */
export async function checkSnippet(
  code: string,
  cycles = 4,
): Promise<{ error: string | null; events: number; sounds: string[]; tracks: string[] }> {
  const e = previewEngine();
  await e.init();
  const { error } = await e.evaluate(code);
  if (error) return { error: error.message, events: 0, sounds: [], tracks: [] };
  const events = e.getTimelineEvents(cycles);
  const sounds = new Set<string>();
  // the tracks that made events, so a check can tell every named track plays
  const tracks = new Set<string>();
  for (const ev of events) {
    if (ev.trackId) tracks.add(ev.trackId);
    if (!ev.s) continue;
    // a drum-machine bank names its samples `<bank>_<sound>`, as superdough looks them up
    const bank = ev.params?.bank;
    sounds.add(typeof bank === "string" && bank ? `${bank}_${ev.s}` : ev.s);
  }
  return { error: null, events: events.length, sounds: [...sounds], tracks: [...tracks] };
}
