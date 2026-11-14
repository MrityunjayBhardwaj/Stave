/**
 * Scoped stylesheet for the unified settings shell (#739).
 *
 * The two legacy modals (EditorSettingsModal / ShortcutsOverlay) used
 * inline-style objects, but the shell's polish — hover states, focus
 * rings, slider thumbs, the pill Switch, the capture pulse, conflict
 * badges — needs real CSS pseudo-selectors and keyframes that inline
 * styles can't express. So the shell renders this once as a `<style>`
 * block, scoped under the `.stave-settings` root class.
 *
 * The design is ported from the approved mockup (cont.62d). The mockup's
 * literal hexes are aliased to the app's own CSS custom properties via
 * the `--s-*` locals below, so the shell tracks the app theme (light /
 * dark / system) instead of hard-coding colours.
 */

export const SETTINGS_ROOT_CLASS = "stave-settings";

export const SETTINGS_SHELL_CSS = `
.stave-settings{
  /* app-var aliases — keeps the ported mockup CSS faithful while theming
     from the app's own tokens (globals.css). */
  --s-surface: var(--bg-elevated);
  --s-surface-2: var(--bg-input);
  --s-surface-3: var(--bg-active-strong);
  --s-border: var(--border-strong);
  --s-border-soft: var(--border-subtle);
  --s-text: var(--text-primary);
  --s-text-2: var(--text-secondary);
  --s-text-3: var(--text-tertiary);
  --s-accent: var(--accent-strong);
  --s-accent-2: var(--accent);
  --s-accent-ghost: color-mix(in srgb, var(--accent-strong) 16%, transparent);
  --s-danger: var(--accent-danger, #f0616a);
  --s-danger-ghost: color-mix(in srgb, var(--accent-danger, #f0616a) 14%, transparent);
  --s-radius: 8px;
  --s-radius-s: 5px;
  --s-mono: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  --s-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
}

.stave-settings *{ box-sizing:border-box; }

/* ── overlay ─────────────────────────────────────────────────── */
.stave-settings.settings-backdrop{
  position:fixed; inset:0; background:var(--bg-overlay);
  display:flex; align-items:flex-start; justify-content:center;
  padding-top:9vh; z-index:20000; font-family:var(--s-sans);
}

/* ── the shell window ────────────────────────────────────────── */
.stave-settings .shell{
  width:760px; max-width:96vw; height:600px; max-height:82vh;
  background:var(--s-surface); border:1px solid var(--s-border);
  border-radius:var(--s-radius); box-shadow:0 24px 70px -12px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.35);
  display:flex; flex-direction:column; overflow:hidden; color:var(--s-text);
}
.stave-settings .titlebar{
  display:flex; align-items:center; gap:2px;
  padding:0 8px 0 6px; height:44px; flex:none;
  border-bottom:1px solid var(--s-border-soft); background:var(--s-surface);
}
.stave-settings .tab{
  appearance:none; border:0; background:none; cursor:pointer;
  font:inherit; font-size:13px; color:var(--s-text-2);
  padding:0 13px; height:44px; display:flex; align-items:center; gap:8px;
  border-bottom:2px solid transparent; margin-bottom:-1px;
}
.stave-settings .tab svg{ width:15px; height:15px; opacity:.8; }
.stave-settings .tab:hover{ color:var(--s-text); }
.stave-settings .tab[aria-selected="true"]{ color:var(--s-text); font-weight:600; border-bottom-color:var(--s-accent); }
.stave-settings .tab[aria-selected="true"] svg{ opacity:1; color:var(--s-accent); }
.stave-settings .titlebar .spacer{ flex:1; }
.stave-settings .xbtn{
  appearance:none; border:0; background:none; cursor:pointer; color:var(--s-text-3);
  width:28px; height:28px; border-radius:var(--s-radius-s); font-size:17px; line-height:1;
  display:grid; place-items:center;
}
.stave-settings .xbtn:hover{ background:var(--s-surface-3); color:var(--s-text); }

.stave-settings .searchwrap{ padding:11px 12px; flex:none; border-bottom:1px solid var(--s-border-soft); }
.stave-settings .search{
  display:flex; align-items:center; gap:8px; height:32px; padding:0 10px;
  background:var(--s-surface-2); border:1px solid var(--s-border);
  border-radius:var(--s-radius-s); color:var(--s-text-3);
}
.stave-settings .search:focus-within{ border-color:var(--s-accent); box-shadow:0 0 0 3px var(--s-accent-ghost); }
.stave-settings .search svg{ width:14px; height:14px; flex:none; }
.stave-settings .search input{
  flex:1; background:none; border:0; outline:0; color:var(--s-text); font:inherit; font-size:13px;
}
.stave-settings .search input::placeholder{ color:var(--s-text-3); }
.stave-settings kbd.esc{
  font:11px/1 var(--s-mono); color:var(--s-text-3); border:1px solid var(--s-border);
  border-radius:4px; padding:2px 5px; background:var(--s-surface);
}

.stave-settings .pane{ flex:1; display:flex; min-height:0; }
.stave-settings .nav{
  width:186px; flex:none; padding:8px; overflow-y:auto;
  border-right:1px solid var(--s-border-soft);
  background:color-mix(in srgb, var(--s-surface) 60%, var(--s-surface-2));
  display:flex; flex-direction:column; gap:1px;
}
.stave-settings .nav-eyebrow{
  font-size:10px; letter-spacing:.11em; text-transform:uppercase; color:var(--s-text-3);
  padding:8px 10px 5px; font-weight:600;
}
.stave-settings .nav-item{
  appearance:none; border:0; background:none; cursor:pointer; font:inherit; text-align:left;
  display:flex; align-items:center; gap:9px; width:100%;
  padding:7px 10px; border-radius:var(--s-radius-s); color:var(--s-text-2); font-size:13px;
}
.stave-settings .nav-item svg{ width:15px; height:15px; flex:none; opacity:.75; }
.stave-settings .nav-item:hover{ background:var(--s-surface-3); color:var(--s-text); }
.stave-settings .nav-item[aria-current="true"]{ background:var(--s-accent-ghost); color:var(--s-text); font-weight:500; }
.stave-settings .nav-item[aria-current="true"] svg{ opacity:1; color:var(--s-accent); }
.stave-settings .nav-count{ margin-left:auto; font:11px/1 var(--s-mono); color:var(--s-text-3); }

.stave-settings .content{ flex:1; overflow-y:auto; padding:6px 20px 26px; }
.stave-settings .content:focus{ outline:none; }
.stave-settings .grp{ padding-top:16px; }
.stave-settings .grp-head{ display:flex; align-items:baseline; gap:10px; padding:6px 0 2px; }
.stave-settings .grp-title{ font-size:13px; font-weight:600; color:var(--s-text); }
.stave-settings .badge{
  font-size:10px; letter-spacing:.03em; padding:2px 7px; border-radius:20px;
  border:1px solid var(--s-border); color:var(--s-text-3); background:var(--s-surface-2);
}
.stave-settings .badge.reload{
  color:var(--s-accent-2); border-color:color-mix(in srgb, var(--s-accent) 40%, var(--s-border));
  background:var(--s-accent-ghost);
}
.stave-settings .badge.mono{ font-family:var(--s-mono); }
.stave-settings .reset{
  margin-left:auto; appearance:none; border:0; background:none; cursor:pointer;
  font:inherit; font-size:11px; color:var(--s-accent-2); display:inline-flex; align-items:center; gap:4px;
}
.stave-settings .reset:hover{ text-decoration:underline; }
.stave-settings .grp-note{ font-size:11.5px; color:var(--s-text-3); line-height:1.55; padding:0 0 6px; }
.stave-settings .grp-note code{
  font-family:var(--s-mono); font-size:11px; background:var(--s-surface-2);
  border:1px solid var(--s-border-soft); border-radius:3px; padding:1px 5px; color:var(--s-text);
}

/* row primitive: [label + desc] .... [control] */
.stave-settings .row{ display:flex; align-items:center; gap:16px; padding:10px 0; border-top:1px solid var(--s-border-soft); }
.stave-settings .grp .row:first-of-type{ border-top:0; }
.stave-settings .row.indent{ padding-left:22px; border-top:0; padding-top:2px; }
.stave-settings .rlabel{ min-width:0; flex:1; }
.stave-settings .rname{ font-size:12.5px; color:var(--s-text); display:flex; align-items:center; gap:8px; }
.stave-settings .rname.dim{ color:var(--s-text-2); }
.stave-settings .rdesc{ font-size:11.5px; color:var(--s-text-3); line-height:1.5; margin-top:2px; }
.stave-settings .rctl{ flex:none; display:flex; align-items:center; gap:10px; }

/* switch */
.stave-settings .sw{ --w:34px; --h:19px; position:relative; width:var(--w); height:var(--h); flex:none; cursor:pointer; }
.stave-settings .sw input{ position:absolute; opacity:0; inset:0; margin:0; cursor:pointer; z-index:1; }
/* Decorative spans never intercept — the transparent input on top takes the
   click (keeps the switch directly hittable for keyboard + automation). */
.stave-settings .sw .track{
  position:absolute; inset:0; border-radius:20px; background:var(--s-surface-3);
  border:1px solid var(--s-border); transition:background .15s, border-color .15s; pointer-events:none;
}
.stave-settings .sw .thumb{
  position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:50%;
  background:var(--s-text-2); transition:transform .16s cubic-bezier(.3,.9,.4,1), background .15s; pointer-events:none;
}
.stave-settings .sw input:checked + .track{ background:var(--s-accent); border-color:var(--s-accent); }
.stave-settings .sw input:checked + .track + .thumb{ transform:translateX(15px); background:#fff; }
.stave-settings .sw input:focus-visible + .track{ box-shadow:0 0 0 3px var(--s-accent-ghost); }
.stave-settings .sw.locked{ opacity:.5; cursor:not-allowed; }
.stave-settings .sw.locked input{ cursor:not-allowed; }

.stave-settings select{
  appearance:none; font:inherit; font-size:12.5px; color:var(--s-text); cursor:pointer;
  background:var(--s-surface-2); border:1px solid var(--s-border); border-radius:var(--s-radius-s);
  padding:5px 26px 5px 10px; min-width:132px;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 3.5L5 6.5L8 3.5' fill='none' stroke='%23888' stroke-width='1.3' stroke-linecap='round'/></svg>");
  background-repeat:no-repeat; background-position:right 9px center;
}
.stave-settings select:focus-visible{ outline:none; border-color:var(--s-accent); box-shadow:0 0 0 3px var(--s-accent-ghost); }
.stave-settings .numinput{
  width:82px; font:inherit; font-size:12.5px; color:var(--s-text);
  background:var(--s-surface-2); border:1px solid var(--s-border); border-radius:var(--s-radius-s); padding:5px 9px;
}
.stave-settings .slider{ display:flex; align-items:center; gap:11px; min-width:190px; }
.stave-settings input[type=range]{
  -webkit-appearance:none; appearance:none; flex:1; height:4px; border-radius:3px;
  background:var(--s-surface-3); accent-color:var(--s-accent); cursor:pointer;
}
.stave-settings input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none; width:14px; height:14px; border-radius:50%;
  background:var(--s-accent); cursor:pointer; border:2px solid var(--s-surface);
}
.stave-settings input[type=range]::-moz-range-thumb{
  width:12px; height:12px; border:2px solid var(--s-surface); border-radius:50%; background:var(--s-accent);
}
.stave-settings .val{ font:12px/1 var(--s-mono); color:var(--s-text-2); min-width:38px; text-align:right; font-variant-numeric:tabular-nums; }

/* module disclosure */
.stave-settings .disclosure{ margin-top:10px; border-top:1px solid var(--s-border-soft); padding-top:6px; }
.stave-settings .disc-btn{
  appearance:none; border:0; background:none; cursor:pointer; font:inherit; color:var(--s-text-2);
  font-size:12px; display:flex; align-items:center; gap:7px; padding:6px 0; width:100%;
}
.stave-settings .disc-btn .chev{ transition:transform .15s; color:var(--s-text-3); }
.stave-settings .disc-btn[aria-expanded="true"] .chev{ transform:rotate(90deg); }
.stave-settings .disc-body{ padding-top:2px; }
.stave-settings .modrow{ display:flex; align-items:center; gap:10px; padding:7px 0; opacity:.6; }
.stave-settings .modrow .mname{ font-size:12px; color:var(--s-text); width:96px; }
.stave-settings .modrow .mdesc{ font-size:11px; color:var(--s-text-3); flex:1; }
.stave-settings .modrow .lock{ font-size:10px; color:var(--s-text-3); border:1px solid var(--s-border); border-radius:4px; padding:1px 6px; }

/* alias editor */
.stave-settings .alias{ display:flex; align-items:center; gap:8px; padding:6px 0; }
.stave-settings .alias input{
  font:inherit; font-size:12.5px; color:var(--s-text); background:var(--s-surface-2);
  border:1px solid var(--s-border); border-radius:var(--s-radius-s); padding:5px 9px;
}
.stave-settings .alias .an{ width:120px; }
.stave-settings .alias .as{ flex:1; min-width:0; }
.stave-settings .alias input.err{ border-color:var(--s-danger); }
.stave-settings .alias .arrow{ color:var(--s-text-3); }
.stave-settings .alias .del{ appearance:none; border:0; background:none; color:var(--s-text-3); cursor:pointer; font-size:16px; padding:2px 6px; }
.stave-settings .alias .del:hover{ color:var(--s-danger); }
.stave-settings .alias-err{ font-size:11px; color:var(--s-danger); padding:0 0 4px 2px; }
.stave-settings .addbtn{
  margin-top:8px; appearance:none; cursor:pointer; font:inherit; font-size:12px; color:var(--s-text);
  background:var(--s-surface-2); border:1px solid var(--s-border); border-radius:var(--s-radius-s); padding:6px 12px;
}
.stave-settings .addbtn:hover{ border-color:var(--s-accent); color:var(--s-accent-2); }

/* keyboard shortcuts */
.stave-settings .kb-row{ display:flex; align-items:center; gap:14px; padding:9px 0; border-top:1px solid var(--s-border-soft); }
.stave-settings .grp .kb-row:first-of-type{ border-top:0; }
.stave-settings .kb-cmd{ flex:1; min-width:0; }
.stave-settings .kb-name{ font-size:12.5px; color:var(--s-text); }
.stave-settings .kb-when{ font-size:11px; color:var(--s-text-3); margin-top:2px; font-family:var(--s-mono); }
.stave-settings .kb-right{ flex:none; display:flex; align-items:center; gap:10px; }
.stave-settings .chord{ display:inline-flex; gap:4px; align-items:center; cursor:pointer; background:none; border:0; font:inherit; padding:0; }
.stave-settings .chord kbd{
  font:11px/1 var(--s-mono); color:var(--s-text); background:var(--s-surface-2);
  border:1px solid var(--s-border); border-bottom-width:2px; border-radius:5px; padding:4px 7px; min-width:22px; text-align:center;
}
.stave-settings .chord:hover kbd{ border-color:var(--s-accent); }
.stave-settings .chord .kb-or{ font-size:11px; color:var(--s-text-3); padding:0 2px; }
.stave-settings .chord.capturing kbd{
  color:var(--s-accent-2); border-color:var(--s-accent); border-style:dashed;
  animation:stave-settings-pulse 1.1s ease-in-out infinite;
}
@keyframes stave-settings-pulse{ 50%{ background:var(--s-accent-ghost); } }
.stave-settings .chord.unbound kbd{ color:var(--s-text-3); border-style:dashed; background:none; }
.stave-settings .chord.system{ cursor:not-allowed; }
.stave-settings .chord.system kbd{ color:var(--s-text-2); opacity:.85; }
.stave-settings .tag{ font-size:10px; letter-spacing:.02em; padding:2px 7px; border-radius:20px; border:1px solid var(--s-border); color:var(--s-text-3); background:var(--s-surface-2); }
.stave-settings .kb-reset{ appearance:none; border:0; background:none; cursor:pointer; color:var(--s-accent-2); font-size:13px; padding:2px; }
.stave-settings .conflict{
  display:flex; align-items:center; gap:6px; font-size:11px; color:var(--s-danger);
  background:var(--s-danger-ghost); border:1px solid color-mix(in srgb, var(--s-danger) 30%, transparent);
  border-radius:4px; padding:3px 8px; margin-top:6px;
}
.stave-settings .conflict svg{ width:12px; height:12px; }
/* #2545 — the Source column, the Source filter, and an extension's read-only rows */
.stave-settings .kb-src{ min-width:52px; text-align:center; }
.stave-settings .kb-src.ext{ color:var(--s-accent-2); border-color:color-mix(in srgb, var(--s-accent) 40%, var(--s-border)); background:var(--s-accent-ghost); }
.stave-settings .src-filter{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:12px 0 2px; font-size:11.5px; color:var(--s-text-3); }
.stave-settings .src-filter button{
  appearance:none; cursor:pointer; font:inherit; font-size:11.5px; color:var(--s-text-2);
  background:none; border:1px solid var(--s-border); border-radius:20px; padding:2px 10px;
}
.stave-settings .src-filter button:hover{ border-color:var(--s-accent); color:var(--s-text); }
.stave-settings .src-filter button[aria-pressed="true"]{ background:var(--s-accent-ghost); border-color:var(--s-accent); color:var(--s-text); }
.stave-settings .kb-give{
  appearance:none; cursor:pointer; font:inherit; font-size:11px; color:var(--s-accent-2); white-space:nowrap;
  background:none; border:1px solid var(--s-border); border-radius:var(--s-radius-s); padding:3px 8px;
}
.stave-settings .kb-give:hover{ border-color:var(--s-accent); }
.stave-settings .kb-row.given .kb-name, .stave-settings .kb-row.given .chord kbd{ opacity:.6; }

/* #2556 — Settings › Extensions: a group per extension, its rows, text box, reset */
.stave-settings .ext-grp{ padding:4px 0 10px; }
.stave-settings .ext-grp + .ext-grp{ border-top:1px solid var(--s-border-soft); margin-top:6px; padding-top:12px; }
.stave-settings .ext-grp-title{
  font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--s-text-2); font-weight:600; padding:4px 0 2px;
}
.stave-settings .ext-grp [data-ext-setting] + [data-ext-setting] > .row{ border-top:1px solid var(--s-border-soft); }
.stave-settings .textinput{
  width:200px; font:inherit; font-size:12.5px; color:var(--s-text);
  background:var(--s-surface-2); border:1px solid var(--s-border); border-radius:var(--s-radius-s); padding:5px 9px;
}
.stave-settings .textinput:focus-visible, .stave-settings .numinput:focus-visible{ outline:none; border-color:var(--s-accent); box-shadow:0 0 0 3px var(--s-accent-ghost); }
.stave-settings .numinput.err{ border-color:var(--s-danger); }
.stave-settings .ext-reset{
  appearance:none; border:0; background:none; cursor:pointer; color:var(--s-accent-2); font-size:14px; line-height:1; padding:2px 4px;
  border-radius:var(--s-radius-s);
}
.stave-settings .ext-reset:hover{ background:var(--s-surface-3); }

.stave-settings .empty{ padding:40px 0; text-align:center; color:var(--s-text-3); font-size:12.5px; }

@media (prefers-reduced-motion:reduce){ .stave-settings *{ animation:none !important; transition:none !important; } }
@media (max-width:680px){
  .stave-settings .nav{ width:52px; }
  .stave-settings .nav-eyebrow, .stave-settings .nav-item span, .stave-settings .nav-count{ display:none; }
  .stave-settings .nav-item{ justify-content:center; }
}
`;
