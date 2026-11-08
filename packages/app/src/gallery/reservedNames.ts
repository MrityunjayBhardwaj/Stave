/**
 * #2368 — names a profile can't take, because they read as Stave itself or as
 * someone who runs it. The trust question before gallery code runs says "This
 * code was written by <name>" (safeRun.ts galleryTrustMessage), and that name is
 * chosen by the person, so it must not be able to borrow Stave's trust.
 *
 * The one check. Every door that sets a profile's name goes through it:
 *   PUT /api/gallery/authors/<id>   validate.ts checkAuthorUpdate (refuses; an
 *                                   unchanged existing name is left alone)
 *   the first gallery use           session.ts startingName (skips to the next
 *                                   fallback, never refuses the sign-in)
 *   a key-held profile              authors.ts createAuthor (no real route calls
 *                                   it any more)
 * The profile form asks the same function first (profileModel.ts), as it does
 * with the other limits. #2450 — each door also refuses a name with nothing
 * visible in it (hasVisibleCharacter, below), and the trust question reads such
 * a name, already stored, as "someone else".
 *
 * ── How far it goes ─────────────────────────────────────────────────────────
 *
 * A name is reduced to a skeleton of its letters, then the WHOLE skeleton must
 * be a reserved phrase. A reserved word inside a longer name is fine, which is
 * what lets Stavros, Staveley, Adam and Modest Mouse through.
 *
 * Folded: case, spacing, punctuation and separators; Unicode width and
 * compatibility forms (NFKC: fullwidth, math letters, circled letters); accents
 * and other marks; invisible characters; a right-to-left override, read in the
 * order it displays; the look-alike letters in LOOKALIKES (Cyrillic, Greek,
 * Armenian, Latin small capitals); digits and symbols used as letters (0/o, 1/l,
 * $/s, @/a); l, I and 1 as one letter; rn as m and cl as d.
 *
 * Not folded, on purpose: misspellings and letter swaps (Stavve, Staev, Staue);
 * Stave written in another alphabet by sound (Ставе, ステイヴ); look-alikes from
 * scripts outside LOOKALIKES, such as Cherokee; pictures of letters (🅢).
 *
 * Decided: "Administrator of Vibes" is allowed. It is a joke title, not a claim
 * to run Stave, and only the phrases below are refused. The cost of matching
 * across spaces is that "Ad Min" and "Mo D" are refused too: they can't be told
 * apart from "A d m i n".
 */

/** What a refused name is told. Lowercase and unpunctuated, like the server's other errors. */
export const RESERVED_NAME_ERROR = "that name is kept for the people who run Stave, so please choose a different one";

/** #2450 — what a name with nothing visible in it is told, in the same style. */
export const BLANK_NAME_ERROR = "name has nothing you can see in it, so please add a letter, number or symbol";

/**
 * #2450 — characters that show nothing on their own: spaces of every width,
 * invisible format characters (zero-width space and joiners, word joiner, soft
 * hyphen), the Hangul fillers (default-ignorable), the blank Braille cell U+2800
 * (which isn't), control characters, and accents with no letter to sit on.
 */
const SHOWS_SOMETHING = /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Z}\p{M}⠀]/u;

/**
 * Does this name show at least one letter, number or symbol? A name that doesn't
 * reads as blank wherever it appears, including the trust question, so the same
 * doors as the reserved check refuse it, and refuse it even unchanged: unlike a
 * name chosen before the reserved rule, nobody's real name is invisible.
 */
export function hasVisibleCharacter(name: string): boolean {
  return SHOWS_SOMETHING.test(name);
}

/** #2465 — what a name with nothing visible in it is shown as. */
export const UNNAMED_AUTHOR = "Unnamed artist";

/**
 * #2465 — the name to show for an author. One stored before #2450 may have
 * nothing visible in it; everywhere a name is shown goes through here, so it
 * reads as UNNAMED_AUTHOR rather than as a gap. The stored name is unchanged:
 * the profile editor shows (and refuses) what's really there, and the trust
 * question keeps its own words for it (safeRun.ts galleryTrustMessage).
 */
export function shownName(name: string): string {
  return hasVisibleCharacter(name) ? name : UNNAMED_AUTHOR;
}

/** Letters that look like a Latin letter, after lowercasing. Pairs: look-alike, then the letter. */
const LOOKALIKES = new Map<string, string>(
  (
    // Cyrillic
    "аa вb гr дd еe иn кk мm нh оo пn рp сc тt уy хx яr ѕs іi јj һh ԁd ԛq ԝw ѵv " +
    // Greek
    "αa βb εe ηn ιi κk μm νv οo ρp τt υu χx ωw " +
    // Armenian
    "օo սu ոn հh " +
    // Latin small capitals and close relatives
    "ᴀa ʙb ᴄc ᴅd ᴇe ғf ɢg ʜh ɪi ᴊj ᴋk ʟl ᴍm ɴn ᴏo ᴘp ʀr ꜱs ᴛt ᴜu ᴠv ᴡw ʏy ᴢz ıi ɑa øo łl đd ŧt"
  )
    .split(" ")
    .map((pair) => [pair[0], pair[1]]),
);

/** Greek capitals that look like a different letter from their own lowercase, so they go first. */
const GREEK_CAPITALS: Record<string, string> = { Ν: "n", Η: "h", Υ: "y" };

/** Digits and symbols that stand in for letters. They are only read as letters on one of the two passes. */
const STAND_INS = new Map<string, string>(Object.entries({ "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", $: "s", "@": "a", "!": "i", "|": "l", "€": "e", "+": "t" }));

/** A right-to-left override shows the text after it backwards, so read it the way it shows. */
const asDisplayed = (name: string): string =>
  name.replace(/‮([^‬]*)‬?/g, (_, run: string) => [...run].reverse().join(""));

/**
 * The name's letters, folded as the header says. `standIns` decides whether digits
 * and symbols count as the letters they imitate ("St4ve") or drop out ("Stave1!").
 * Accents go with the separators: NFD splits them off as marks, and marks aren't letters.
 */
function skeleton(name: string, standIns: boolean): string {
  const plain = asDisplayed(name)
    .normalize("NFKC")
    .replace(/[ΝΗΥ]/g, (c) => GREEK_CAPITALS[c])
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  const mapped = [...plain].map((c) => LOOKALIKES.get(c) ?? (standIns ? STAND_INS.get(c) : undefined) ?? c).join("");
  return mapped
    .replace(standIns ? /[^\p{L}\p{N}]/gu : /[^\p{L}]/gu, "")
    .replace(/rn/g, "m")
    .replace(/cl/g, "d")
    .replace(/l/g, "i");
}

const phrase = (words: readonly string[]): string => `(?:${words.map((w) => skeleton(w, false)).join("|")})s?`;

/** Stave, with any of these around it: "The Stave Team", "Official Stave", "Admin of Stave". */
const AROUND_STAVE = phrase([
  "the", "official", "real", "team", "staff", "support", "help", "admin", "administrator", "administration",
  "moderator", "moderation", "mod", "security", "trust", "safety", "gallery", "studio", "app", "live", "hq",
  "bot", "account", "of", "at", "for", "from",
]);
const STAVE = new RegExp(`^(?:${AROUND_STAVE})*stave(?:s?(?:${AROUND_STAVE})+)?$`, "u");

/** A role on its own, with no Stave in it: "Admin", "Head Moderator", "The Mods", "Moderation Team". */
const ROLE = new RegExp(
  `^(?:${phrase(["the", "official", "site", "gallery", "community", "head", "chief", "lead"])})*` +
    phrase(["admin", "administrator", "administration", "moderator", "moderation", "mod"]) +
    `(?:${phrase(["team", "staff", "account", "official"])})*$`,
  "u",
);

/** Does this name read as Stave itself, or as someone who runs it? */
export function isReservedName(name: string): boolean {
  return [skeleton(name, true), skeleton(name, false)].some((s) => STAVE.test(s) || ROLE.test(s));
}
