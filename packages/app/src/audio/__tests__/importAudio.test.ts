/**
 * Bringing audio in, and the order the join has to happen in (#1541).
 *
 * The fake supplies only the I/O — a blob store and the project's record list.
 * Naming and dedup come from the REAL `planAssetImport`, imported from the
 * editor's source rather than re-implemented here: an instrument that rewrites
 * a production predicate differs from it on exactly the inputs the measurement
 * is about, and the uniqueness rule is precisely what one of these arms is for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planAssetImport, type AssetRecord } from "@stave/editor";

const store = {
  records: [] as AssetRecord[],
  blobs: [] as { hash: string; blob: Blob }[],
  registered: [] as string[],
  /** Bumped by the fake measurer so an arm can count decodes. */
  measures: 0,
};

let nextId = 0;

vi.mock("@stave/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stave/editor")>()),
  // #1785 — the lock only orders the door against a collection; none runs here.
  withSoundRefsLock: <T>(fn: () => Promise<T>) => fn(),
  listAssetRecords: () => store.records,
  addAssetRecord: (r: AssetRecord) => {
    store.records.push(r);
  },
  registerAsset: async (r: AssetRecord) => {
    store.registered.push(r.name);
    return true;
  },
  importAsset: async (
    blob: Blob,
    filename: string,
    existing: readonly AssetRecord[],
    deps: { measureDuration?: (b: Blob) => Promise<number | undefined> },
    origin?: "recorded" | "imported",
  ) => {
    // Content hash stands in for sha256 — a pure function of the bytes is all
    // the dedup rule needs, and `crypto.subtle` wants a secure context.
    const hash = `h${blob.size}_${blob.type}`;
    if (!store.blobs.some((b) => b.hash === hash)) store.blobs.push({ hash, blob });
    let duration: number | undefined;
    try {
      duration = await deps.measureDuration?.(blob);
    } catch {
      duration = undefined;
    }
    const plan = planAssetImport(
      { blobHash: hash, filename, mime: blob.type, duration, origin },
      existing,
      () => `id${++nextId}`,
    );
    return { ...plan, put: { hash, written: true } };
  },
}));

const { StorageFullError } = await import("@stave/editor");
const {
  importAudioFile,
  importAudioFiles,
  saveTake,
  UnsupportedAudioError,
} = await import("../saveTake");

function audioFile(name: string, type = "audio/wav", bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A measurer that answers for audio and gives up on anything else. */
const measureDuration = async (blob: Blob): Promise<number | undefined> => {
  store.measures += 1;
  return blob.type.startsWith("audio/") && blob.size > 0 ? 1.25 : undefined;
};

beforeEach(() => {
  store.records = [];
  store.blobs = [];
  store.registered = [];
  store.measures = 0;
  nextId = 0;
});

describe("#1541 — a file the user brought in", () => {
  it("takes its name from the file and is marked imported", async () => {
    const { record, playable } = await importAudioFile(
      audioFile("My Vocal.wav"),
      { measureDuration },
    );
    expect(record.name).toBe("my_vocal");
    expect(record.origin).toBe("imported");
    expect(record.duration).toBe(1.25);
    expect(playable).toBe(true);
    expect(store.records).toHaveLength(1);
    expect(store.registered).toEqual(["my_vocal"]);
  });

  it("CONTROL — a recording is marked recorded, so origin is not one constant", async () => {
    const { record } = await saveTake(new Blob([new Uint8Array(4)]), {
      measureDuration,
    });
    expect(record.origin).toBe("recorded");
    expect(record.name).toBe("take_1");
  });

  it("refuses a file that neither decodes nor claims to be audio, storing nothing", async () => {
    const notAudio = new File([new Uint8Array(8)], "notes.pdf", {
      type: "application/pdf",
    });
    await expect(importAudioFile(notAudio, { measureDuration })).rejects.toThrow(
      UnsupportedAudioError,
    );
    // The point of refusing BEFORE the store: no orphan blob, no record.
    expect(store.blobs).toHaveLength(0);
    expect(store.records).toHaveLength(0);
  });

  it("accepts audio this browser cannot decode, with no duration rather than a refusal", async () => {
    // Claims audio, will not decode here — a codec this browser lacks is real,
    // and the bytes may well play elsewhere.
    const exotic = audioFile("track.opus", "audio/opus", 0);
    const { record } = await importAudioFile(exotic, { measureDuration });
    expect(record.name).toBe("track");
    expect(record.duration).toBeUndefined();
    expect(store.blobs).toHaveLength(1);
  });

  it("decodes once per file, not once to screen and again to measure", async () => {
    await importAudioFile(audioFile("one.wav"), { measureDuration });
    expect(store.measures).toBe(1);
  });
});

describe("#1541 — several files at once", () => {
  it("gives two files of the same name two different addresses", async () => {
    // The arm the sequencing exists for. Run in parallel, both reads of the
    // existing names see an empty project and both mint `vocal`.
    const summary = await importAudioFiles(
      [audioFile("vocal.wav", "audio/wav", 10), audioFile("vocal.wav", "audio/wav", 20)],
      { measureDuration },
    );
    expect(summary.saved).toHaveLength(2);
    const names = summary.saved.map((s) => s.record.name);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toBe("vocal");
  });

  it("keeps the good files when one is not audio", async () => {
    const summary = await importAudioFiles(
      [
        audioFile("good.wav", "audio/wav", 10),
        new File([new Uint8Array(3)], "readme.txt", { type: "text/plain" }),
        audioFile("also_good.wav", "audio/wav", 20),
      ],
      { measureDuration },
    );
    expect(summary.saved.map((s) => s.record.name)).toEqual([
      "good",
      "also_good",
    ]);
    expect(summary.rejected).toEqual(["readme.txt"]);
    expect(summary.failed).toEqual([]);
  });

  it("separates a refusal from a failure, because they need different sentences", async () => {
    const exploding = audioFile("boom.wav", "audio/wav", 10);
    const summary = await importAudioFiles(
      [exploding, new File([new Uint8Array(3)], "readme.txt", { type: "text/plain" })],
      {
        measureDuration: async (blob) => {
          if (blob.size === 10) throw new Error("store is on fire");
          return undefined;
        },
      },
    );
    expect(summary.saved).toEqual([]);
    expect(summary.failed).toEqual(["boom.wav"]);
    expect(summary.rejected).toEqual(["readme.txt"]);
  });

  it("#1779 a file the disk had no room for is its own outcome, not a failure", async () => {
    const summary = await importAudioFiles([audioFile("big.wav", "audio/wav", 10)], {
      measureDuration: async (blob) => {
        if (blob.size === 10) {
          // The error the store really throws (#1779); a plain Error renamed to
          // look like it is NOT a refusal for space, and the real predicate knows it.
          throw new StorageFullError(new Error("full"));
        }
        return undefined;
      },
    });
    expect({ full: summary.full, failed: summary.failed }).toEqual({
      full: ["big.wav"],
      failed: [],
    });
  });

  it("does nothing, and says nothing, for an empty drop", async () => {
    const summary = await importAudioFiles([], { measureDuration });
    expect(summary).toEqual({ saved: [], rejected: [], full: [], failed: [] });
    expect(store.records).toHaveLength(0);
  });
});
