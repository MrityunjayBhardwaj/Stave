/**
 * catalogue — a short list of libraries tested in Stave sketches (#2643).
 *
 * Choosing one writes a declaration into `stave.libs.json`; nothing is bundled
 * into Stave. One loading path (fetch → hash → instantiate, as for any declared
 * library) means one thing to test.
 *
 * Each entry is pinned to an exact version and an esm.sh build:
 *   - `external=three` keeps the library on Stave's own three.js (two copies of
 *     three don't draw together);
 *   - `target=es2022` fixes the build. Without it esm.sh picks one per browser
 *     (`Vary: User-Agent`), so two people could hash different files;
 *   - `bundle` folds a library's files (and any dependencies, which unbundled
 *     would be fetched by version range, e.g. `^1.0.2`, and move) into one file.
 *
 * Every entry was checked before it was listed (2026-11-23): its graph loads
 * through loadLibraryGraph with no unresolved import, a small sketch using it
 * runs in a Stave sketch (worker and main thread) in Chromium, Firefox and
 * WebKit, it hashes the same whether or not the request carries an Origin
 * header, and its licence (the package's field and its licence file) is
 * permissive. See the PR for #2643 for the numbers and the libraries left out.
 */

import { libraryGraphHash, loadLibraryGraph, type LoadLibraryGraphOptions } from './graph'
import type { LibraryDeclaration } from './declarations'

export interface CatalogueEntry {
  /** The import specifier, exactly as the library's docs write it; the key in stave.libs.json. */
  readonly name: string
  /** Short display name. */
  readonly title: string
  readonly version: string
  /** One line: what it is for. */
  readonly description: string
  /** SPDX licence id, read from the package. */
  readonly license: string
  /** Where the module graph is fetched from. */
  readonly url: string
  /** A line to paste into a sketch. */
  readonly importLine: string
}

export const LIBRARY_CATALOGUE: readonly CatalogueEntry[] = [
  {
    name: '@sparkjsdev/spark',
    title: 'Spark',
    version: '2.4.0',
    description: 'Gaussian splats in three.js',
    license: 'MIT',
    url: 'https://esm.sh/@sparkjsdev/spark@2.4.0?external=three&target=es2022',
    importLine: "import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'",
  },
  {
    name: 'postprocessing',
    title: 'postprocessing',
    version: '6.39.6',
    description: 'Post-processing effects (bloom, colour, depth of field…)',
    license: 'Zlib',
    url: 'https://esm.sh/postprocessing@6.39.6?external=three&target=es2022',
    importLine: "import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing'",
  },
  {
    name: 'three-mesh-bvh',
    title: 'three-mesh-bvh',
    version: '0.9.18',
    description: 'Fast raycasting and spatial queries on meshes',
    license: 'MIT',
    url: 'https://esm.sh/three-mesh-bvh@0.9.18?external=three&target=es2022&bundle',
    importLine: "import { MeshBVH } from 'three-mesh-bvh'",
  },
  {
    name: 'simplex-noise',
    title: 'simplex-noise',
    version: '4.0.3',
    description: 'Simplex noise in 2D, 3D and 4D',
    license: 'MIT',
    url: 'https://esm.sh/simplex-noise@4.0.3?target=es2022',
    importLine: "import { createNoise2D, createNoise3D } from 'simplex-noise'",
  },
]

/** A catalogue entry's declaration, with the hash of what its URL serves right now. */
export async function declarationFor(entry: CatalogueEntry, options: LoadLibraryGraphOptions = {}): Promise<LibraryDeclaration> {
  const graph = await loadLibraryGraph(entry.url, options)
  return { url: entry.url, sha384: await libraryGraphHash(graph) }
}
