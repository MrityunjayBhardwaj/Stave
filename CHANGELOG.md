# Changelog

What's in each version of Stave. What's coming next is on the [roadmap](https://stave.live/docs/roadmap/).

## 0.5.0 (2026-10-20)

The first release, and Stave's public beta. There were no releases before it, so this entry lists everything Stave does today.

### Code

- A Monaco editor for Strudel (the editor inside VS Code), with autocomplete for every sound, hover docs, and errors shown in the code.
- The notes that are sounding light up while the song plays.
- Each `$:` line, and each named part such as `drums:` or `bass:`, is a track with its own colour.

### Arrange: the Timeline

- The whole song, track by track and section by section, with a playhead you can click to jump.
- Duplicate a chorus, split a verse, insert a gap, rename a section, or drag a stretch to loop it.
- Draw a parameter's automation across the song.
- Each section is an `arrange(...)` entry in your code, and editing one rewrites it there.

### Shape: the Pattern tab

- Follows your cursor and shows that line as a grid.
- Drum lines become a step sequencer: click a step to turn it on or off, and drag to set how hard it hits.
- Melodies become a piano roll: place, move and stretch notes, and hold one down to hear it.
- Chord lines become a chord chart.
- Every edit rewrites the mini-notation in your code.

### Mix: the Mixer

- A channel strip for every track: fader, pan, meter, mute and solo, plus a Master strip.
- A chain of effects per track: reverb, delay, filters and more.
- The fader writes `.gain` and an effect writes its call (such as `.lpf(800)`). Mute and solo change the code itself, so what you hear is what the code says.

### See: visuals

- Sketches in p5.js, Hydra and GLSL (ShaderToy-style), reloaded when you save.
- Visuals get the music straight from the pattern: `sig.kick`, `sig.snare`, `sig.hat` and the rest fire the moment that drum plays. `sig('bd')` follows one sound and `sig.track('$0')` one track, and `sig.fft`, `sig.wave`, `sig.bass` and `sig.treble` are there for the sound itself.
- `.viz("name")` draws a visual under its line of code, fed by that track alone.
- Built-in visualisers: `pianoroll`, `scope`, `spectrum`, `spiral`, `pitchwheel`, `wordfall` and more, plus ready-made sketches in the Library.
- Put any visual behind your code as a backdrop, or pop it out into its own window.

### Share

- Bounce the song to WAV, as one mix or as stems.
- Copy a share link that carries the whole project, with nothing uploaded.
- Export and import a `.zip`, your audio included.
- Version history: go back to, fork or compare earlier versions.

### Also

- A sound library: search every sound and hear it before you use it, drop in your own audio, or record a take from your mic.
- A layout for phones and tablets, with a row of pattern symbols above the keyboard.
- Templates: Full Song, Starter, Strudel Sketch, Hydra Visual and Blank.
- Projects live in your browser. There's no account and no server.

### Not yet

- Stave runs best in a Chromium browser (Chrome, Edge, Arc, Brave).
- `.sonicpi` files open with highlighting but don't play yet. Sonic Pi support is planned for 0.7.
- MIDI output works only from code for now: switch it on in **Settings › Modules**, reload, and name your device in `.midi("…")`. A device list and per-track sends are planned for 0.7.
- The Pattern grids don't yet draw nested patterns level by level. That's the main work of 0.6, along with the bug fixes listed on the [roadmap](https://stave.live/docs/roadmap/).
