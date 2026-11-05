import type { Metadata } from "next";
import { GalleryPlayer } from "../../gallery/GalleryPlayer";

/**
 * #2328 — the gallery's sandboxed preview player. Only meant to be loaded in
 * the gallery's `<iframe sandbox="allow-scripts">`; see GalleryPlayer.tsx.
 *
 * A Next page rather than a static file under `public/`: the player needs the
 * audio engine and the visual renderers from `@stave/editor`, and only the app's
 * bundler builds those. It shares the root layout's COOP/COEP headers, which a
 * frame inside the (credentialless) app page must have to load at all.
 */
export const metadata: Metadata = {
  title: "Stave — gallery preview",
  robots: { index: false, follow: false },
};

export default function GalleryPlayerPage() {
  return <GalleryPlayer />;
}
