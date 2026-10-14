"use client";

import { setTakesPhoneAudio } from "@stave/editor";

/**
 * Whether Play takes the phone's audio (#2015).
 *
 * On a phone, to be heard with the ring/silent switch on, Stave tells the browser it
 * PLAYS audio — and iOS then stops other apps' music for it. Someone playing along
 * to a track in another app wants the opposite: both at once, with the silent switch
 * muting Stave. On by default, because a silent Stave looks like a bug.
 *
 * The engine owns the decision (`setTakesPhoneAudio`); this store keeps the choice
 * (localStorage, like `menubarLcd`) and hands it over when the app mounts and on every change.
 */

const STORAGE_KEY = "stave:takesPhoneAudio";
const DEFAULT_ENABLED = true;

function read(): boolean {
  try {
    if (typeof window === "undefined") return DEFAULT_ENABLED;
    const saved = window.localStorage?.getItem(STORAGE_KEY);
    if (saved === null || saved === undefined) return DEFAULT_ENABLED;
    return saved === "1";
  } catch {
    return DEFAULT_ENABLED;
  }
}

function write(next: boolean): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* storage unavailable — in-session value still updates */
  }
}

let current = read();

/** Hand the stored choice to the engine; called once when the app mounts. */
export function applyStoredTakesPhoneAudio(): void {
  setTakesPhoneAudio(current);
}

export function getTakesPhoneAudio(): boolean {
  return current;
}

export function setTakesPhoneAudioSetting(next: boolean): void {
  if (next === current) return;
  current = next;
  write(next);
  setTakesPhoneAudio(next);
}
