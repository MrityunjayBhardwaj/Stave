import { parse } from 'acorn';
import 'react';
import '@strudel/mini/krill-parser.js';
import '@strudel/core/euclid.mjs';
import '@strudel/core/controls.mjs';
import '@strudel/mini/mini.mjs';
import '@tonaljs/chord';
import { init, parse as parse$1 } from 'es-module-lexer';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/visualizers/worker/dom-shim.ts
function makeStyle() {
  return new Proxy(
    {},
    {
      get: /* @__PURE__ */ __name((t, k) => k in t ? t[k] : "", "get"),
      set: /* @__PURE__ */ __name((t, k, v) => {
        t[k] = v;
        return true;
      }, "set")
    }
  );
}
__name(makeStyle, "makeStyle");
function collectByTag(root, TAG, out) {
  const kids = root && (root.children || root.childNodes);
  if (!Array.isArray(kids)) return;
  for (const c of kids) {
    if (c && c.tagName === TAG) out.push(c);
    collectByTag(c, TAG, out);
  }
}
__name(collectByTag, "collectByTag");
function makeElement(tag) {
  const children = [];
  const listeners2 = {};
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    nodeType: 1,
    style: makeStyle(),
    dataset: {},
    classList: { add() {
    }, remove() {
    }, contains: /* @__PURE__ */ __name(() => false, "contains"), toggle() {
    } },
    attributes: {},
    children,
    childNodes: children,
    parentNode: null,
    ownerDocument: null,
    clientWidth: 0,
    clientHeight: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return this.attributes[k] ?? null;
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    hasAttribute(k) {
      return k in this.attributes;
    },
    appendChild(c) {
      children.push(c);
      if (c) c.parentNode = el;
      return c;
    },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      return c;
    },
    insertBefore(c) {
      children.push(c);
      if (c) c.parentNode = el;
      return c;
    },
    remove() {
    },
    // p5's downloadFile (save/saveCanvas/saveGif, io/utilities.js) does
    // `createElement('a').click()` to trigger a browser download (#315). A worker
    // has no anchor/navigation, so a real download is architecturally impossible
    // here (it needs postMessage→main). A no-op click lets save() complete cleanly
    // instead of throwing `click is not a function` — paired with canvas.toBlob
    // below, save() degrades to a silent no-op rather than a per-frame error.
    click() {
    },
    addEventListener(type, fn) {
      (listeners2[type] || (listeners2[type] = [])).push(fn);
    },
    removeEventListener() {
    },
    dispatchEvent: /* @__PURE__ */ __name(() => true, "dispatchEvent"),
    getBoundingClientRect: /* @__PURE__ */ __name(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0
    }), "getBoundingClientRect"),
    getElementsByTagName: /* @__PURE__ */ __name(() => [], "getElementsByTagName"),
    querySelector: /* @__PURE__ */ __name(() => null, "querySelector"),
    querySelectorAll: /* @__PURE__ */ __name(() => [], "querySelectorAll"),
    elt: void 0
    // p5.Element compat — set by p5 itself
  };
  return el;
}
__name(makeElement, "makeElement");
function wrapCanvas(offscreen) {
  const oc = offscreen;
  const def = /* @__PURE__ */ __name((k, v) => Object.defineProperty(oc, k, { value: v, writable: true, configurable: true }), "def");
  const getr = /* @__PURE__ */ __name((k, fn) => Object.defineProperty(oc, k, { get: fn, configurable: true }), "getr");
  const attributes = {};
  def("tagName", "CANVAS");
  def("nodeName", "CANVAS");
  def("nodeType", 1);
  def("style", makeStyle());
  def("dataset", {});
  def("id", "");
  def("className", "");
  def("classList", { add() {
  }, remove() {
  }, contains: /* @__PURE__ */ __name(() => false, "contains"), toggle() {
  } });
  def("parentNode", null);
  def("parentElement", null);
  def("ownerDocument", null);
  def("children", []);
  def("childNodes", []);
  def("elt", void 0);
  getr("clientWidth", () => oc.width);
  getr("clientHeight", () => oc.height);
  getr("offsetWidth", () => oc.width);
  getr("offsetHeight", () => oc.height);
  def("offsetLeft", 0);
  def("offsetTop", 0);
  getr("scrollWidth", () => oc.width);
  getr("scrollHeight", () => oc.height);
  def("setAttribute", (k, v) => {
    attributes[k] = v;
  });
  def("getAttribute", (k) => k in attributes ? attributes[k] : null);
  def("removeAttribute", (k) => {
    delete attributes[k];
  });
  def("hasAttribute", (k) => k in attributes);
  def("addEventListener", () => {
  });
  def("removeEventListener", () => {
  });
  def("dispatchEvent", () => true);
  def("getBoundingClientRect", () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: oc.width,
    height: oc.height
  }));
  def("remove", () => {
  });
  def("toBlob", (cb, type, quality) => {
    try {
      ;
      oc.convertToBlob({ type, quality }).then((b) => cb && cb(b)).catch(() => cb && cb(null));
    } catch {
      cb && cb(null);
    }
  });
  return offscreen;
}
__name(wrapCanvas, "wrapCanvas");
function installWorkerDomShim(makeCanvasEl) {
  var _a, _b;
  const self = globalThis;
  const doc = {
    nodeType: 9,
    createElement(tag) {
      if (String(tag).toLowerCase() === "canvas") return makeCanvasEl();
      const el = makeElement(tag);
      el.ownerDocument = doc;
      return el;
    },
    createElementNS(_ns, tag) {
      return this.createElement(tag);
    },
    createTextNode: /* @__PURE__ */ __name((t) => ({ nodeType: 3, textContent: t }), "createTextNode"),
    getElementById() {
      return null;
    },
    getElementsByTagName(t) {
      const out = [];
      const TAG = String(t).toUpperCase();
      collectByTag(doc.body, TAG, out);
      return out;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {
    },
    removeEventListener() {
    },
    hasFocus: /* @__PURE__ */ __name(() => true, "hasFocus"),
    elementFromPoint: /* @__PURE__ */ __name(() => null, "elementFromPoint")
  };
  const body = makeElement("body");
  const docEl = makeElement("html");
  body.ownerDocument = doc;
  docEl.ownerDocument = doc;
  docEl.lang = "en-US";
  docEl.setAttribute("lang", "en-US");
  doc.body = body;
  doc.documentElement = docEl;
  doc.head = makeElement("head");
  doc.readyState = "complete";
  doc.cookie = "";
  const realFonts = self.fonts;
  doc.fonts = realFonts ? {
    add: /* @__PURE__ */ __name((f) => realFonts.add(f), "add"),
    delete: /* @__PURE__ */ __name((f) => realFonts.delete(f), "delete"),
    has: /* @__PURE__ */ __name((f) => realFonts.has(f), "has"),
    forEach: /* @__PURE__ */ __name((cb, thisArg) => realFonts.forEach(cb, thisArg), "forEach"),
    load: /* @__PURE__ */ __name((font, text) => realFonts.load(font, text), "load"),
    values: /* @__PURE__ */ __name(() => realFonts.values(), "values"),
    keys: /* @__PURE__ */ __name(() => realFonts.keys?.() ?? realFonts.values(), "keys"),
    [Symbol.iterator]: () => realFonts[Symbol.iterator](),
    get size() {
      return realFonts.size;
    },
    get ready() {
      return Promise.all(Array.from(realFonts, (f) => f.loaded)).then(() => realFonts);
    }
  } : {
    add() {
    },
    delete() {
    },
    has: /* @__PURE__ */ __name(() => false, "has"),
    ready: Promise.resolve(),
    size: 0,
    values: /* @__PURE__ */ __name(() => [][Symbol.iterator](), "values"),
    [Symbol.iterator]() {
      return [][Symbol.iterator]();
    }
  };
  const loc = self.location || {};
  const location = {
    href: loc.href ?? "about:blank",
    search: loc.search ?? "",
    hash: loc.hash ?? "",
    pathname: loc.pathname ?? "/",
    host: loc.host ?? "",
    hostname: loc.hostname ?? "",
    port: loc.port ?? "",
    protocol: loc.protocol ?? "https:",
    origin: loc.origin ?? "null"
  };
  const win = {
    document: doc,
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    screen: { width: 800, height: 600 },
    location,
    navigator: self.navigator,
    addEventListener() {
    },
    removeEventListener() {
    },
    requestAnimationFrame: self.requestAnimationFrame?.bind(self) || ((cb) => setTimeout(() => cb(performance.now()), 16)),
    cancelAnimationFrame: self.cancelAnimationFrame?.bind(self) || ((id) => clearTimeout(id)),
    getComputedStyle: /* @__PURE__ */ __name(() => makeStyle(), "getComputedStyle"),
    matchMedia: /* @__PURE__ */ __name(() => ({ matches: false, addListener() {
    }, removeListener() {
    } }), "matchMedia"),
    performance: self.performance,
    setTimeout: self.setTimeout.bind(self),
    clearTimeout: self.clearTimeout.bind(self)
  };
  const winProxy = new Proxy(win, {
    get(t, p) {
      if (p in t) {
        const v = t[p];
        return typeof v === "function" ? v.bind(t) : v;
      }
      if (p in self) {
        const v = self[p];
        return typeof v === "function" ? v.bind(self) : v;
      }
      return void 0;
    }
  });
  self.window = winProxy;
  self.document = doc;
  self.screen = win.screen;
  if (typeof self.HTMLCanvasElement === "undefined") {
    self.HTMLCanvasElement = (_a = class {
      static [Symbol.hasInstance](x) {
        return typeof OffscreenCanvas !== "undefined" && x instanceof OffscreenCanvas;
      }
    }, __name(_a, "HTMLCanvasElement"), _a);
  }
  if (typeof self.localStorage === "undefined") {
    const store = {};
    const def = /* @__PURE__ */ __name((k, v) => Object.defineProperty(store, k, { value: v, enumerable: false, configurable: true, writable: true }), "def");
    def("getItem", (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null);
    def("setItem", (k, v) => {
      store[String(k)] = String(v);
    });
    def("removeItem", (k) => {
      delete store[k];
    });
    def("clear", () => {
      for (const k of Object.keys(store)) delete store[k];
    });
    def("key", (i) => Object.keys(store)[i] ?? null);
    Object.defineProperty(store, "length", {
      get: /* @__PURE__ */ __name(() => Object.keys(store).length, "get"),
      enumerable: false,
      configurable: true
    });
    self.localStorage = store;
  }
  if (typeof self.CSSFontFaceRule === "undefined") {
    self.CSSFontFaceRule = (_b = class {
    }, __name(_b, "CSSFontFaceRule"), _b);
  }
  if (!("devicePixelRatio" in self)) self.devicePixelRatio = 1;
  if (typeof self.requestAnimationFrame !== "function") {
    self.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    self.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  return { window: winProxy, document: doc };
}
__name(installWorkerDomShim, "installWorkerDomShim");
function installWorkerHydraShim(size) {
  const self = globalThis;
  const W = size.w;
  const H = size.h;
  self.window = self;
  if (typeof self.requestAnimationFrame !== "function") {
    self.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    self.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  if (!("innerWidth" in self)) self.innerWidth = W;
  if (!("innerHeight" in self)) self.innerHeight = H;
  if (!("devicePixelRatio" in self)) self.devicePixelRatio = 1;
  const noopEl = /* @__PURE__ */ __name(() => ({
    style: {},
    appendChild: /* @__PURE__ */ __name(() => {
    }, "appendChild"),
    removeChild: /* @__PURE__ */ __name(() => {
    }, "removeChild"),
    remove: /* @__PURE__ */ __name(() => {
    }, "remove"),
    setAttribute: /* @__PURE__ */ __name(() => {
    }, "setAttribute"),
    addEventListener: /* @__PURE__ */ __name(() => {
    }, "addEventListener"),
    removeEventListener: /* @__PURE__ */ __name(() => {
    }, "removeEventListener")
  }), "noopEl");
  self.document = {
    createElement: /* @__PURE__ */ __name((tag) => String(tag).toLowerCase() === "canvas" ? new OffscreenCanvas(W, H) : noopEl(), "createElement"),
    createElementNS: /* @__PURE__ */ __name(() => noopEl(), "createElementNS"),
    body: noopEl(),
    head: noopEl(),
    querySelector: /* @__PURE__ */ __name(() => null, "querySelector"),
    querySelectorAll: /* @__PURE__ */ __name(() => [], "querySelectorAll"),
    getElementById: /* @__PURE__ */ __name(() => null, "getElementById"),
    addEventListener: /* @__PURE__ */ __name(() => {
    }, "addEventListener"),
    removeEventListener: /* @__PURE__ */ __name(() => {
    }, "removeEventListener"),
    readyState: "complete"
  };
  self.screen = { width: W, height: H };
}
__name(installWorkerHydraShim, "installWorkerHydraShim");
function syntaxErrorAt(code) {
  try {
    parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
    return null;
  } catch (e) {
    const { pos, loc } = e;
    return typeof pos === "number" && loc ? { pos, line: loc.line, column: loc.column } : null;
  }
}
__name(syntaxErrorAt, "syntaxErrorAt");
function parseModule(code) {
  try {
    return { ok: true, program: parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true }) };
  } catch (e) {
    const err = e;
    return {
      ok: false,
      message: String(err.message ?? e).replace(/\s*\(\d+:\d+\)$/, ""),
      line: err.loc?.line,
      column: err.loc?.column
    };
  }
}
__name(parseModule, "parseModule");

// src/codeView/ir/statementHeads.ts
var TEMPO_SETTERS = ["setcps", "setCps", "setcpm", "setCpm"];
var NON_TRACK_HEADS = /* @__PURE__ */ new Set([
  "all",
  "samples",
  ...TEMPO_SETTERS,
  "setbpm",
  "setBpm",
  "hush",
  "useRNG",
  "setVoicingRange",
  "initAudio",
  "aliasBank"
]);
new RegExp(
  `^[ \\t]*(?:${[...NON_TRACK_HEADS].sort((a, b) => b.length - a.length).join("|")})\\s*\\(`
);

// src/codeView/chunkDetect.ts
var PICK_METHODS = /* @__PURE__ */ new Set([
  "pick",
  "pickmod",
  "pickOut",
  "pickmodOut",
  "pickRestart",
  "pickmodRestart",
  "pickReset",
  "pickmodReset",
  "inhabit",
  "inhabitmod",
  "pickSqueeze",
  "pickmodSqueeze"
]);
/* @__PURE__ */ new Set([...PICK_METHODS, "squeeze"]);

// src/visualizers/signals/aliasMap.ts
var DEFAULT_VIZ_ENGINE = "strudel";
var BUILTIN_ALIASES = {
  uKick: { strudel: "bd", sonicpi: "drum_heavy_kick" },
  uSnare: { strudel: "sd", sonicpi: "drum_snare_hard" },
  uHat: { strudel: "hh", sonicpi: "drum_cymbal_closed" },
  uOpenHat: { strudel: "oh", sonicpi: "drum_cymbal_open" },
  uClap: { strudel: "cp" },
  uRim: { strudel: "rim" },
  uTom: {
    strudel: ["lt", "mt", "ht"],
    sonicpi: ["drum_tom_lo_hard", "drum_tom_mid_hard", "drum_tom_hi_hard"]
  }
};
function resolveAliasesForEngine(custom, engine) {
  const out = {};
  for (const [name, slots] of Object.entries(BUILTIN_ALIASES)) {
    const v = slots[engine];
    if (v != null) out[name] = v;
  }
  for (const [name, slots] of Object.entries(custom)) {
    const v = slots[engine];
    if (v != null) out[name] = v;
  }
  return out;
}
__name(resolveAliasesForEngine, "resolveAliasesForEngine");
var ALIAS_MAP = resolveAliasesForEngine(
  {},
  DEFAULT_VIZ_ENGINE
);

// src/perf/profiler.ts
var RING = 240;
var DROP_FACTOR = 2;
var SLOW_FRAME_MS = 1e3 / 30;
function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0;
}
__name(nowMs, "nowMs");
var _Ring = class _Ring {
  constructor() {
    this.buf = [];
    this.head = 0;
    /** Total pushed since reset (uncapped) — distinct from retained length. */
    this.total = 0;
  }
  push(v) {
    if (this.buf.length < RING) this.buf.push(v);
    else this.buf[this.head] = v;
    this.head = (this.head + 1) % RING;
    this.total++;
  }
  get last() {
    if (this.buf.length === 0) return 0;
    const i = (this.head - 1 + RING) % RING;
    return this.buf[i] ?? 0;
  }
  /** Sorted copy of the retained samples (ascending). */
  sorted() {
    return this.buf.slice().sort((a, b) => a - b);
  }
  stats() {
    const n = this.buf.length;
    if (n === 0) {
      return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, last: 0 };
    }
    const s = this.sorted();
    let sum = 0;
    for (const v of this.buf) sum += v;
    return {
      count: this.total,
      mean: sum / n,
      p50: percentile(s, 0.5),
      p95: percentile(s, 0.95),
      p99: percentile(s, 0.99),
      max: s[n - 1],
      last: this.last
    };
  }
  /** Median over the retained samples (for the drop-detection threshold). */
  median() {
    if (this.buf.length === 0) return 0;
    return percentile(this.sorted(), 0.5);
  }
};
__name(_Ring, "Ring");
var Ring = _Ring;
function percentile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sortedAsc[idx];
}
__name(percentile, "percentile");
var _FrameTracker = class _FrameTracker {
  constructor() {
    this.intervals = new Ring();
    this.lastTs = null;
    this.dropCount = 0;
    this.slowCount = 0;
    this.frameCount = 0;
  }
  tick(ts) {
    this.frameCount++;
    if (this.lastTs != null) {
      const dt = ts - this.lastTs;
      const med = this.intervals.median();
      if (med > 0 && dt > med * DROP_FACTOR) this.dropCount++;
      if (dt > SLOW_FRAME_MS) this.slowCount++;
      this.intervals.push(dt);
    }
    this.lastTs = ts;
  }
  stats() {
    const s = this.intervals.stats();
    return {
      count: this.frameCount,
      fps: s.p50 > 0 ? 1e3 / s.p50 : 0,
      p50: s.p50,
      p95: s.p95,
      drops: this.dropCount,
      slowFrames: this.slowCount
    };
  }
};
__name(_FrameTracker, "FrameTracker");
var FrameTracker = _FrameTracker;
var _Profiler = class _Profiler {
  constructor() {
    /** Plain field (not a getter) so the hot-path branch is a bare load. */
    this._enabled = false;
    this.startTs = 0;
    this.sections = /* @__PURE__ */ new Map();
    this.frames = /* @__PURE__ */ new Map();
    this.counters = /* @__PURE__ */ new Map();
    /** Live gauges (current-state counts) — survive reset(), unlike counters. */
    this.gauges = /* @__PURE__ */ new Map();
    /** Open spans for begin()/end() keyed by label — last-write-wins (a label
     *  isn't expected to nest with itself within a frame). */
    this.open = /* @__PURE__ */ new Map();
    this.longtaskCount = 0;
    this.longtaskTotalMs = 0;
    this.longtaskMaxMs = 0;
    this.ltObserver = null;
  }
  get enabled() {
    return this._enabled;
  }
  /** Turn profiling on/off. Enabling (re)starts the longtask observer and
   *  stamps the uptime origin; disabling tears the observer down so a disabled
   *  profiler has no live platform hook. Idempotent. */
  setEnabled(on) {
    if (on === this._enabled) return;
    this._enabled = on;
    if (on) {
      this.startTs = nowMs();
      this.startLongtaskObserver();
    } else {
      this.ltObserver?.disconnect();
      this.ltObserver = null;
    }
  }
  startLongtaskObserver() {
    if (this.ltObserver) return;
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.ltObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longtaskCount++;
          this.longtaskTotalMs += entry.duration;
          if (entry.duration > this.longtaskMaxMs) this.longtaskMaxMs = entry.duration;
        }
      });
      this.ltObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      this.ltObserver = null;
    }
  }
  // ── section timing ────────────────────────────────────────────────────────
  /** Record a section duration directly (ms). Cheap no-op when disabled. */
  record(name, ms) {
    if (!this._enabled) return;
    let ring = this.sections.get(name);
    if (!ring) {
      ring = new Ring();
      this.sections.set(name, ring);
    }
    ring.push(ms);
  }
  /** Open a span. Pair with `end(name)`. No-op when disabled. */
  begin(name) {
    if (!this._enabled) return;
    this.open.set(name, nowMs());
  }
  /** Close a span opened by `begin(name)` and record its duration. No-op when
   *  disabled or when no matching open span exists. */
  end(name) {
    if (!this._enabled) return;
    const t0 = this.open.get(name);
    if (t0 === void 0) return;
    this.open.delete(name);
    this.record(name, nowMs() - t0);
  }
  /** Time a synchronous function and record it under `name`. Returns the fn's
   *  result. When disabled, calls the fn with no timing overhead. The fn runs
   *  even if disabled (it's the real work, not just measurement). */
  time(name, fn) {
    if (!this._enabled) return fn();
    const t0 = nowMs();
    try {
      return fn();
    } finally {
      this.record(name, nowMs() - t0);
    }
  }
  // ── frames ──────────────────────────────────────────────────────────────
  /** Record a rendered frame for an instance (e.g. `'p5#3'`). No-op when
   *  disabled. */
  frame(instanceId) {
    if (!this._enabled) return;
    let ft = this.frames.get(instanceId);
    if (!ft) {
      ft = new FrameTracker();
      this.frames.set(instanceId, ft);
    }
    ft.tick(nowMs());
  }
  /** Forget an instance's frame history (on renderer destroy) so a dead viz
   *  doesn't linger in the snapshot. No-op when disabled. */
  dropFrames(instanceId) {
    if (!this._enabled) return;
    this.frames.delete(instanceId);
  }
  // ── counters ──────────────────────────────────────────────────────────────
  /** Add to a CUMULATIVE counter (reset() clears it; rate = value/uptime). */
  inc(name, by = 1) {
    if (!this._enabled) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  dec(name, by = 1) {
    if (!this._enabled) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) - by);
  }
  /** Adjust a LIVE GAUGE (current-state count, e.g. mounted viz instances).
   *  Gauges survive reset() — they reflect what's live now, not samples.
   *  Use +1 on mount, -1 on destroy. */
  gauge(name, delta) {
    if (!this._enabled) return;
    this.gauges.set(name, (this.gauges.get(name) ?? 0) + delta);
  }
  // ── read / reset ────────────────────────────────────────────────────────
  snapshot() {
    const sections = {};
    for (const [name, ring] of this.sections) sections[name] = ring.stats();
    const frames = {};
    for (const [id, ft] of this.frames) frames[id] = ft.stats();
    const counters = {};
    for (const [name, v] of this.counters) counters[name] = v;
    const gauges = {};
    for (const [name, v] of this.gauges) gauges[name] = Math.max(0, v);
    return {
      enabled: this._enabled,
      uptimeMs: this._enabled ? nowMs() - this.startTs : 0,
      sections,
      frames,
      counters,
      gauges,
      longtasks: {
        count: this.longtaskCount,
        totalMs: this.longtaskTotalMs,
        maxMs: this.longtaskMaxMs
      }
    };
  }
  /** Clear all samples/counters but keep the enabled state + observer. Use to
   *  start a clean measurement window (e.g. before driving a heavy patch). */
  reset() {
    this.sections.clear();
    this.frames.clear();
    this.counters.clear();
    this.open.clear();
    this.longtaskCount = 0;
    this.longtaskTotalMs = 0;
    this.longtaskMaxMs = 0;
    this.startTs = nowMs();
  }
};
__name(_Profiler, "Profiler");
var Profiler = _Profiler;
var perf = new Profiler();
try {
  const g = globalThis;
  if (g.__STAVE_PERF__ === true) perf.setEnabled(true);
  g.__stavePerf = {
    snapshot: /* @__PURE__ */ __name(() => perf.snapshot(), "snapshot"),
    reset: /* @__PURE__ */ __name(() => perf.reset(), "reset"),
    setEnabled: /* @__PURE__ */ __name((on) => perf.setEnabled(on), "setEnabled")
  };
} catch {
}

// src/visualizers/vizFlags.ts
var VIZ_FLAG_KEYS = {
  governor: "stave.viz.governor"};
function read(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
__name(read, "read");
function enabledByDefault(key) {
  return read(key) !== "0";
}
__name(enabledByDefault, "enabledByDefault");
function isVizGovernorEnabled() {
  return enabledByDefault(VIZ_FLAG_KEYS.governor);
}
__name(isVizGovernorEnabled, "isVizGovernorEnabled");

// src/visualizers/vizGovernor.ts
var HEALTHY_MS = 20;
var JANK_MS = 45;
var MIN_FPS = 10;
var EMA_ALPHA = 0.25;
var STRESS_RAMP_DOWN = 0.012;
var IDLE_GAP_MS = 400;
var RES_MIN_SCALE = 0.5;
var RES_STRESS_ON = 0.5;
function computeStress(emaMs, healthy = HEALTHY_MS, jank = JANK_MS) {
  if (emaMs <= healthy) return 0;
  if (emaMs >= jank) return 1;
  return (emaMs - healthy) / (jank - healthy);
}
__name(computeStress, "computeStress");
function maxPerFrame(n, stress) {
  if (n <= 1) return 1;
  return Math.max(1, Math.round(n * (1 - stress)));
}
__name(maxPerFrame, "maxPerFrame");
function periodFor(n, stress) {
  if (n <= 1) return 1;
  return Math.max(1, Math.ceil(n / maxPerFrame(n, stress)));
}
__name(periodFor, "periodFor");
function minGapMs(stress) {
  if (stress <= 0) return 0;
  return stress * (1e3 / MIN_FPS);
}
__name(minGapMs, "minGapMs");
function resolutionScaleFor(stress) {
  if (stress < RES_STRESS_ON) return 1;
  const t = (stress - RES_STRESS_ON) / (1 - RES_STRESS_ON);
  const raw = 1 - t * (1 - RES_MIN_SCALE);
  return Math.max(RES_MIN_SCALE, Math.round(raw * 4) / 4);
}
__name(resolutionScaleFor, "resolutionScaleFor");
var _VizGovernor = class _VizGovernor {
  constructor() {
    this.enabled = true;
    /** Active (looping) renderer id → its stable round-robin offset. */
    this.registered = /* @__PURE__ */ new Map();
    this.lastProduce = /* @__PURE__ */ new Map();
    this.nextOffset = 0;
    this.frameIndex = 0;
    this.lastObserveTs = 0;
    this.emaMs = HEALTHY_MS;
    this.stress = 0;
    this.enabled = isVizGovernorEnabled();
  }
  /** Register a renderer when its loop STARTS (resume/mount). Idempotent. */
  register(id) {
    if (!this.registered.has(id)) this.registered.set(id, this.nextOffset++);
  }
  /** Unregister when the loop STOPS (pause/destroy). Resets stress when the last
   *  viz leaves so a fresh mount starts from a healthy baseline. */
  unregister(id) {
    this.registered.delete(id);
    this.lastProduce.delete(id);
    if (this.registered.size === 0) {
      this.stress = 0;
      this.emaMs = HEALTHY_MS;
      this.lastObserveTs = 0;
    }
  }
  /** Feed the cadence monitor — call once per rAF tick from EVERY active loop
   *  (idempotent per timestamp: only the first call for a new `ts` advances the
   *  frame + updates stress, so N renderers calling with the same ts is fine). */
  observeFrame(ts) {
    if (!this.enabled || this.registered.size === 0) return;
    if (this.lastObserveTs > 0 && ts > this.lastObserveTs) {
      const d = ts - this.lastObserveTs;
      if (d > IDLE_GAP_MS) {
        this.emaMs = HEALTHY_MS;
      } else {
        this.emaMs = this.emaMs * (1 - EMA_ALPHA) + d * EMA_ALPHA;
      }
      const target = computeStress(this.emaMs);
      this.stress = target > this.stress ? target : Math.max(target, this.stress - STRESS_RAMP_DOWN);
      this.frameIndex++;
      perf.record("viz.governor.stress", Math.round(this.stress * 100));
    }
    if (ts > this.lastObserveTs) this.lastObserveTs = ts;
  }
  /** Gate: may renderer `id` produce a frame at `ts`? Composed with (and called
   *  after) the renderer's own backpressure + maxFps checks. */
  mayProduce(id, ts) {
    if (!this.enabled) return true;
    const n = this.registered.size;
    if (n === 0 || this.stress <= 0) return true;
    const gap = minGapMs(this.stress);
    if (gap > 0) {
      const last = this.lastProduce.get(id) ?? 0;
      if (last > 0 && ts - last < gap - 1) return false;
    }
    if (n > 1) {
      const period = periodFor(n, this.stress);
      if (period > 1) {
        const offset = this.registered.get(id) ?? 0;
        if ((this.frameIndex + offset) % period !== 0) return false;
      }
    }
    this.lastProduce.set(id, ts);
    return true;
  }
  /** Render-resolution scale (lever 3) the renderer should apply to its backing
   *  store at the current stress, in `[RES_MIN_SCALE, 1]`. 1 (full) when disabled
   *  or smooth — so a renderer multiplying its `resize` w,h by this is a total
   *  no-op in the common case (transparency, PV91). The `WorkerVizRenderer` reads
   *  this each rAF and re-posts a scaled `resize` only when the quantized step
   *  changes (the backing-store realloc is relatively expensive). */
  resolutionScale() {
    if (!this.enabled || this.stress <= 0) return 1;
    return resolutionScaleFor(this.stress);
  }
  /** Observability / test hook. */
  state() {
    return { enabled: this.enabled, n: this.registered.size, stress: this.stress, emaMs: this.emaMs, frameIndex: this.frameIndex, resScale: this.resolutionScale() };
  }
  /** Live enable/disable (the "Adaptive performance" toggle, persisted via
   *  editorRegistry under the SAME `stave.viz.governor` key this reads at
   *  construction). Unlike `_setEnabledForTest` it KEEPS the registered renderers
   *  (live viz stay tracked) — it only flips the gate. Disabling resets stress so
   *  the levers release immediately: `mayProduce` returns true and
   *  `resolutionScale` returns 1, so each WorkerVizRenderer's next tick re-posts a
   *  full-resolution resize and stops being throttled. Re-enabling lets stress
   *  rebuild from the live rAF cadence via observeFrame. */
  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.stress = 0;
      this.emaMs = HEALTHY_MS;
      this.lastObserveTs = 0;
    }
  }
  /** Test helper — force enabled state (and reset) deterministically. */
  _setEnabledForTest(on) {
    this.enabled = on;
    this.registered.clear();
    this.lastProduce.clear();
    this.nextOffset = 0;
    this.frameIndex = 0;
    this.lastObserveTs = 0;
    this.emaMs = HEALTHY_MS;
    this.stress = 0;
  }
};
__name(_VizGovernor, "VizGovernor");
var VizGovernor = _VizGovernor;
new VizGovernor();

// src/visualizers/vizConfig.ts
var DEFAULT_VIZ_CONFIG = {
  // Resolver
  defaultRenderer: "p5",
  // Phase B / B-3 — OffscreenCanvas-worker rendering. ON: the matrix gate is GREEN
  // (#245 — trig/s holds 8.4 regardless of viz load, was collapsing to 2.9; main
  // longtasks 0, was up to 251ms). The main-thread P5VizRenderer stays the
  // automatic fallback when a browser can't offload (no OffscreenCanvas /
  // transferControlToOffscreen / worker factory). Opt OUT per project via
  // localStorage['stave.viz.worker'] = '0'.
  workerRenderer: true,
  // Worker pacing / resolution (#261 follow-up). 60fps is the perceptual ceiling
  // for music viz; maxDpr 1 makes the presenting canvas match the worker's actual
  // 1× render (quality-neutral, ~4× cheaper composite on retina than the prior
  // upscale-to-2× behaviour). Both are zero-rewrite levers against the blit/
  // composite wall measured for multi-instance inline viz.
  maxFps: 60,
  maxDpr: 1,
  // Quality / LOD (#269). 1 = full detail, today's behaviour unchanged. Lower
  // values are opted into via "performance mode" (deriveVizQuality) and read by
  // sketches as `sig.density`. Marshalled to the worker via the config channel.
  density: 1,
  // Inline view zones
  inlineZoneHeight: 150,
  // Audio analysis
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  // Hydra
  hydraAudioBins: 4,
  hydraAutoLoop: true,
  // Pianoroll
  pianorollWindowSeconds: 6,
  pianorollCycles: 4,
  pianorollPlayhead: 0.5,
  pianorollMidiMin: 24,
  pianorollMidiMax: 96,
  // Scope / FScope
  scopeWindowSeconds: 4,
  scopeAmplitudeScale: 0.25,
  scopeBaseline: 0.75,
  // Spectrum
  spectrumMinDb: -80,
  spectrumMaxDb: 0,
  spectrumScrollSpeed: 2,
  // Colors
  backgroundColor: "#090912",
  accentColor: "#75baff",
  activeColor: "#FFCA28",
  playheadColor: "rgba(255,255,255,0.5)"
};
var _active = { ...DEFAULT_VIZ_CONFIG };
var _listeners = /* @__PURE__ */ new Set();
function notify() {
  for (const cb of Array.from(_listeners)) cb(_active);
}
__name(notify, "notify");
function getVizConfig() {
  return _active;
}
__name(getVizConfig, "getVizConfig");
function updateVizConfig(patch) {
  _active = { ..._active, ...patch };
  notify();
}
__name(updateVizConfig, "updateVizConfig");

// src/codeView/notation/noteToMidi.ts
function noteToMidi(note) {
  if (typeof note === "number") return Math.round(note);
  if (typeof note !== "string") return null;
  const m = note.match(/^([a-gA-G])([#bsf]*)(-?\d*)$/);
  if (!m) return null;
  const [, letter, accidentals, octave] = m;
  if (octave === "-") return null;
  let offset = 0;
  for (const a of accidentals) offset += a === "#" || a === "s" ? 1 : -1;
  const oct = octave === "" ? DEFAULT_OCTAVE : parseInt(octave, 10);
  return (oct + 1) * 12 + SEMITONE_OF[letter.toLowerCase()] + offset;
}
__name(noteToMidi, "noteToMidi");
var SEMITONE_OF = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
var DEFAULT_OCTAVE = 3;
var PERIOD_PROBE = 24;
var MAX_PROJECT_BARS = 4;
var LEAF_PROJECT_BARS = { grid: 12, roll: 4 };
var PROJECTION_PERIOD_BOUNDS = Object.freeze({
  /** cycles probed when establishing a period */
  probe: PERIOD_PROBE,
  /** the largest period any projection may admit — half the probe, because of the doubling */
  maxVerifiedBars: Math.floor(PERIOD_PROBE / 2),
  /** the element writer's cap, bounded by re-emit readability rather than by this */
  element: MAX_PROJECT_BARS,
  /** the leaf writers' caps, per surface */
  leaf: Object.freeze({ ...LEAF_PROJECT_BARS })
});

// src/codeView/notation/rhythmChart.ts
PROJECTION_PERIOD_BOUNDS.leaf.grid;

// src/visualizers/signals/SignalBus.ts
var ZERO_AUDIO = {
  rms: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  fft: [],
  wave: []
};
var EPSILON = 1e-3;
var DEFAULT_DECAY = 0.92;
var FFT_BINS = 32;
var _SignalBus = class _SignalBus {
  constructor(aliasMap = ALIAS_MAP) {
    /** Per-sound envelope levels (0..1), decayed each frame. Keyed on `e.s`. */
    this.envMap = /* @__PURE__ */ new Map();
    /** Last-bumped color per sound — the `.color` fallback feed. */
    this.colorMap = /* @__PURE__ */ new Map();
    /** Live refs — mutable so `bindScheduler()` rebinds in place
     *  (mirrors `HydraVizRenderer.update` live-ref discipline, `:369-371`). */
    this.scheduler = null;
    this.trackSchedulers = /* @__PURE__ */ new Map();
    /** Per-frame snapshot of active events from the combined scheduler feed
     *  (set by `refreshActive`). The instantaneous feed for `sound()`. */
    this.activeEvents = [];
    /** Per-frame snapshot of active events per track-key (scheduler key space). */
    this.activeByTrack = /* @__PURE__ */ new Map();
    /** Every distinct `e.s` ever bumped — backs `get sounds()`. */
    this.seenSounds = /* @__PURE__ */ new Set();
    // ── DSP feed (analyser refs + per-frame cache, Slice 2) ───────────────────
    /** Live master analyser ref — mutable so `bindAnalysers()` rebinds in place
     *  (mirrors `bindScheduler`). Null in IR-only / demo mode. */
    this.masterAnalyser = null;
    /** Per-track analyser refs, keyed the SAME as `trackSchedulers` (the SCHEDULER
     *  key space `$0`/`d1`, TRAP §5) — `trackAnalysers` is published with those
     *  keys by the engine (LiveCodingEngine.ts:25). */
    this.trackAnalysers = /* @__PURE__ */ new Map();
    /** Scratch byte buffers per analyser (freq + time), allocated/resized lazily
     *  keyed on analyser identity so a rebind to a new node re-allocates. */
    this.freqBufs = /* @__PURE__ */ new WeakMap();
    this.waveBufs = /* @__PURE__ */ new WeakMap();
    /** Per-frame derived DSP reading per analyser — filled by `readAudio()`,
     *  read by the accessors. Cleared each `readAudio()` so a now-unbound
     *  analyser stops reporting stale data. */
    this.audioByAnalyser = /* @__PURE__ */ new Map();
    this.aliasMap = aliasMap;
    this.decay = DEFAULT_DECAY;
  }
  /** Store live scheduler refs (mutable rebind — mirror the renderer's
   *  in-place update discipline). Pass `null`/empty in demo mode. */
  bindScheduler(scheduler, trackSchedulers) {
    this.scheduler = scheduler ?? null;
    this.trackSchedulers = trackSchedulers ?? /* @__PURE__ */ new Map();
  }
  /** Store live analyser refs (mutable rebind — mirror `bindScheduler`). The
   *  orbit is the shared reference: a sound resolves to its orbit, which has
   *  BOTH events (the scheduler feed) AND an analyser (this DSP feed). Pass
   *  `null`/empty in IR-only / demo mode → DSP fields degrade to 0/[]. */
  bindAnalysers(master, trackAnalysers) {
    this.masterAnalyser = master ?? null;
    this.trackAnalysers = trackAnalysers ?? /* @__PURE__ */ new Map();
  }
  /** Replace the active alias map in place (mirror `bindScheduler`'s mutable
   *  rebind). The RENDERER builds the merged map — `{ ...ALIAS_MAP, ...custom }`
   *  with custom WINNING on collision — and pushes it here at mount. The bus
   *  stays PURE (P12): it does NOT import `getSignalAliases`; it only stores the
   *  numbers/maps it is handed. `envValue`/`resolveSounds` resolve ANY key
   *  through this map, so a freshly-set custom alias resolves with no other
   *  change. */
  setAliases(map) {
    this.aliasMap = map;
  }
  // ── .env feed (envelope: bump + decay) ──────────────────────────────────
  /** Bump the envelope for an event's sound. Mirrors `HapEnergyEnvelope.onHap`
   *  (`:67-82`): gain clamped 0..1, level = min(1, prev + gain). Keyed on
   *  `e.s` (NOT a MIDI bin). No-ops for an event with no sound name. */
  bump(e) {
    const sound = e.s;
    if (sound == null) return;
    const gain = Math.min(1, Math.max(0, e.hap?.value?.gain ?? 1));
    const prev = this.envMap.get(sound) ?? 0;
    this.envMap.set(sound, Math.min(1, prev + gain));
    if (e.color != null) this.colorMap.set(sound, e.color);
    else if (!this.colorMap.has(sound)) this.colorMap.set(sound, null);
    this.seenSounds.add(sound);
  }
  /** Apply decay to every envelope entry. Call ONCE per frame, BEFORE
   *  `refreshActive` (mirror `HapEnergyEnvelope.tick`, `:85-89`). */
  tick() {
    for (const [sound, level] of this.envMap) {
      this.envMap.set(sound, level * this.decay);
    }
  }
  // ── instantaneous feed (scheduler query-at-now) ─────────────────────────
  /** Snapshot the active events at `now` from the combined scheduler and each
   *  per-track scheduler. Call ONCE per frame, AFTER `tick()`. The window is
   *  [now, now + ε) — the same tight window `H()` uses (`:175`). */
  refreshActive(now) {
    const begin = now;
    const end = now + EPSILON;
    this.activeEvents = this.scheduler ? this.scheduler.query(begin, end) : [];
    this.activeByTrack.clear();
    for (const [key, sched] of this.trackSchedulers) {
      this.activeByTrack.set(key, sched.query(begin, end));
    }
  }
  /** Current scheduler time (mirror `H()`'s `sched.now()`), 0 in demo mode. */
  now() {
    return this.scheduler ? this.scheduler.now() : 0;
  }
  // ── DSP feed (analyser read-at-now) ───────────────────────────────────────
  /** Snapshot every bound analyser's spectrum + waveform for this frame. Call
   *  ONCE per frame, AFTER `refreshActive` — `audioFor()` resolves a sound to a
   *  trackKey via `activeByTrack`, which `refreshActive` populates (ordering is
   *  the T2 call-site's responsibility). Reads each analyser via
   *  `getByteFrequencyData` + `getByteTimeDomainData` (mirrors
   *  `HydraVizRenderer.pumpAudio:445-455`) and caches the derived
   *  `AudioReading`. An analyser that's no longer bound drops out of the cache. */
  readAudio() {
    this.audioByAnalyser.clear();
    if (this.masterAnalyser) this.readOne(this.masterAnalyser);
    for (const an of this.trackAnalysers.values()) this.readOne(an);
  }
  /** Read one analyser into the per-frame cache (idempotent within a frame). */
  readOne(an) {
    if (this.audioByAnalyser.has(an)) return;
    this.audioByAnalyser.set(an, deriveAudio(an, this.freqBufs, this.waveBufs));
  }
  /** Resolve a sound (or alias) → the analyser whose mix it lives in. Find the
   *  trackKey(s) in `activeByTrack` (SCHEDULER key space, TRAP §5 — NOT
   *  IREvent.trackId) whose active events include any resolved sound. EXACTLY
   *  one such track AND that track has a bound analyser → its isolated analyser.
   *  Otherwise (multi-track, none, or no per-track analyser) → the master
   *  analyser (the combined mix — still meaningful, never silent-zero-as-bug). */
  audioFor(soundOrAlias) {
    const resolved = new Set(this.resolveSounds(soundOrAlias));
    let onlyKey = null;
    for (const [key, events] of this.activeByTrack) {
      const hit = events.some((e) => e.s != null && resolved.has(e.s));
      if (!hit) continue;
      if (onlyKey != null) return this.masterAnalyser;
      onlyKey = key;
    }
    if (onlyKey != null) {
      const isolated = this.trackAnalysers.get(onlyKey);
      if (isolated) return isolated;
    }
    return this.masterAnalyser;
  }
  /** Cached DSP reading for an analyser (this frame), or the zero reading. */
  audioReading(an) {
    if (an == null) return ZERO_AUDIO;
    return this.audioByAnalyser.get(an) ?? ZERO_AUDIO;
  }
  /** Master DSP reading (the combined-mix analyser). Surfaces `u.rms`/`u.fft`
   *  etc. — the T3 master accessor path. Zero reading if no master bound. */
  master() {
    return this.audioReading(this.masterAnalyser);
  }
  // ── accessors ───────────────────────────────────────────────────────────
  /** Resolve an alias OR a raw sound name to a list of concrete sound names.
   *  `'uKick'` → `['bd']`, `'uTom'` → `['lt','mt','ht']`, `'bd'` → `['bd']`. */
  resolveSounds(soundOrAlias) {
    const mapped = this.aliasMap[soundOrAlias];
    if (mapped == null) return [soundOrAlias];
    return Array.isArray(mapped) ? mapped : [mapped];
  }
  /** Decayed envelope level for a sound or alias. Array aliases (`uTom`)
   *  resolve as MAX over members. Demo-mode / never-fired → 0. */
  envValue(soundOrAlias) {
    let max = 0;
    for (const sound of this.resolveSounds(soundOrAlias)) {
      const v = this.envMap.get(sound) ?? 0;
      if (v > max) max = v;
    }
    return max;
  }
  /** Find the first active IREvent (combined feed) whose `s` is in `sounds`. */
  activeEventForSounds(sounds) {
    const set = new Set(sounds);
    for (const ev of this.activeEvents) {
      if (ev.s != null && set.has(ev.s)) return ev;
    }
    return void 0;
  }
  /** Per-sound reading — merged across tracks via the combined active feed
   *  (D-03). `.env` from the envelope; `.velocity`/`.note` from the active
   *  IREvent (NOT the envelope — silent-zero trap §5); `.color` from the
   *  active IREvent, falling back to the last-bumped hap color. */
  sound(soundOrAlias) {
    const sounds = this.resolveSounds(soundOrAlias);
    const env = this.envValue(soundOrAlias);
    const ev = this.activeEventForSounds(sounds);
    const audio = this.audioReading(this.audioFor(soundOrAlias));
    return {
      env,
      velocity: ev?.velocity ?? 0,
      note: ev?.note ?? null,
      color: ev?.color ?? this.colorFallback(sounds),
      ...audio
    };
  }
  /** Last-bumped color over the resolved sounds (the `.color` fallback feed). */
  colorFallback(sounds) {
    for (const sound of sounds) {
      const c = this.colorMap.get(sound);
      if (c != null) return c;
    }
    return null;
  }
  /** Per-track reading, keyed on the SCHEDULER key space (TRAP §5 —
   *  `trackSchedulers.get(id)`, NOT IREvent.trackId). `.env` is the max env over
   *  the sounds this track fired this frame; `.velocity`/`.note`/`.color` come
   *  from the track's first active IREvent (scheduler feed). A `sound(s)`
   *  sub-accessor reads a specific sound within the track. Unknown id → zeros. */
  track(id) {
    const events = this.activeByTrack.get(id) ?? [];
    const first = events[0];
    const trackSounds = events.map((e) => e.s).filter((s) => s != null);
    let env = 0;
    for (const s of trackSounds) {
      const v = this.envMap.get(s) ?? 0;
      if (v > env) env = v;
    }
    const trackAudio = this.audioReading(
      this.trackAnalysers.get(id) ?? this.masterAnalyser
    );
    const soundIn = /* @__PURE__ */ __name((soundOrAlias) => {
      const resolved = new Set(this.resolveSounds(soundOrAlias));
      const ev = events.find((e) => e.s != null && resolved.has(e.s));
      let sEnv = 0;
      for (const s of this.resolveSounds(soundOrAlias)) {
        const v = this.envMap.get(s) ?? 0;
        if (v > sEnv) sEnv = v;
      }
      return {
        env: sEnv,
        velocity: ev?.velocity ?? 0,
        note: ev?.note ?? null,
        color: ev?.color ?? null,
        // A specific sound within a named track reads that track's mix.
        ...trackAudio
      };
    }, "soundIn");
    return {
      env,
      velocity: first?.velocity ?? 0,
      note: first?.note ?? null,
      color: first?.color ?? null,
      ...trackAudio,
      sound: soundIn
    };
  }
  /** Enumerate the published track keys — the SCHEDULER key space
   *  (`trackSchedulers.keys()`, §5), e.g. `['$0','$1']` or `['d1','drums']`. */
  get tracks() {
    return [...this.trackSchedulers.keys()];
  }
  /** Enumerate distinct sounds ever bumped through the envelope feed. */
  get sounds() {
    return [...this.seenSounds];
  }
  /** Normalize a note to a MIDI number (P93 — only when a NUMBER is explicitly
   *  requested; the raw `.note` preserves the user's name|number form). Returns
   *  null for percussion sample names / unrecognized input. */
  noteToMidi(note) {
    if (note == null) return null;
    return noteToMidi(note);
  }
};
__name(_SignalBus, "SignalBus");
var SignalBus = _SignalBus;
function deriveAudio(an, freqBufs, waveBufs) {
  const n = an.frequencyBinCount | 0;
  if (n <= 0) return { ...ZERO_AUDIO, fft: [], wave: [] };
  let freq = freqBufs.get(an);
  if (!freq || freq.length !== n) {
    freq = new Uint8Array(n);
    freqBufs.set(an, freq);
  }
  let time = waveBufs.get(an);
  if (!time || time.length !== n) {
    time = new Uint8Array(n);
    waveBufs.set(an, time);
  }
  an.getByteFrequencyData(freq);
  an.getByteTimeDomainData(time);
  const fft = new Array(FFT_BINS).fill(0);
  const binSize = Math.floor(n / FFT_BINS);
  if (binSize >= 1) {
    for (let i = 0; i < FFT_BINS; i++) {
      let sum = 0;
      for (let j = 0; j < binSize; j++) sum += freq[i * binSize + j];
      fft[i] = sum / (binSize * 255);
    }
  } else {
    for (let i = 0; i < n; i++) fft[i] = freq[i] / 255;
  }
  const third = Math.floor(FFT_BINS / 3);
  const bass = meanSlice(fft, 0, third);
  const mid = meanSlice(fft, third, 2 * third);
  const treble = meanSlice(fft, 2 * third, FFT_BINS);
  const wave = new Array(n);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = (time[i] - 128) / 128;
    wave[i] = v;
    sumSq += v * v;
  }
  const rms = Math.min(1, Math.max(0, Math.sqrt(sumSq / n)));
  return { rms, bass, mid, treble, fft, wave };
}
__name(deriveAudio, "deriveAudio");
function meanSlice(arr, from, to) {
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += arr[i];
  return sum / (to - from);
}
__name(meanSlice, "meanSlice");

// src/visualizers/worker/signalFrame.ts
var MASTER_KEY = "master";

// src/visualizers/worker/workerBusFeed.ts
var _FrameAnalyser = class _FrameAnalyser {
  constructor() {
    this.frequencyBinCount = 0;
    this.freq = new Uint8Array(0);
    this.time = new Uint8Array(0);
  }
  /** Adopt this frame's bytes (copy in — the source buffers may be transferred
   *  away / reused by the transport after the frame is consumed). */
  set(frequencyBinCount, freq, time) {
    this.frequencyBinCount = frequencyBinCount;
    if (this.freq.length !== freq.length) this.freq = new Uint8Array(freq.length);
    if (this.time.length !== time.length) this.time = new Uint8Array(time.length);
    this.freq.set(freq);
    this.time.set(time);
  }
  getByteFrequencyData(arr) {
    arr.set(this.freq.subarray(0, arr.length));
  }
  getByteTimeDomainData(arr) {
    arr.set(this.time.subarray(0, arr.length));
  }
};
__name(_FrameAnalyser, "FrameAnalyser");
var FrameAnalyser = _FrameAnalyser;
function makeSchedulerStub(now, events) {
  const widened = events;
  return {
    now: /* @__PURE__ */ __name(() => now, "now"),
    query: /* @__PURE__ */ __name(() => widened, "query")
  };
}
__name(makeSchedulerStub, "makeSchedulerStub");
var _WorkerBusFeed = class _WorkerBusFeed {
  constructor(aliasMap = ALIAS_MAP) {
    /** Stable analyser stubs by key (`'master'` + track keys). */
    this.analysers = /* @__PURE__ */ new Map();
    this.lastSeq = -1;
    this.bus = new SignalBus(aliasMap);
  }
  /** Push the merged alias map (the renderer reads impure settings on main and
   *  ships the map; the worker bus stays pure — mirrors P5VizRenderer). */
  setAliases(map) {
    this.bus.setAliases(map);
  }
  /**
   * Apply one frame: rebuild the bus's inputs from `frame`, replay bumps, then
   * run the per-frame sequence. Idempotent on a duplicate/stale `seq` (no-op) so
   * a dropped or repeated transport frame can't double-decay the envelope.
   * Returns `true` if the frame advanced state, `false` if skipped as stale.
   */
  applyFrame(frame) {
    if (frame.seq <= this.lastSeq) return false;
    this.lastSeq = frame.seq;
    let master = null;
    const trackAnalysers = /* @__PURE__ */ new Map();
    const present = /* @__PURE__ */ new Set();
    for (const a of frame.analysers) {
      present.add(a.key);
      let stub = this.analysers.get(a.key);
      if (!stub) {
        stub = new FrameAnalyser();
        this.analysers.set(a.key, stub);
      }
      stub.set(a.frequencyBinCount, a.freq, a.time);
      if (a.key === MASTER_KEY) master = stub;
      else trackAnalysers.set(a.key, stub);
    }
    for (const key of [...this.analysers.keys()]) {
      if (!present.has(key)) this.analysers.delete(key);
    }
    const scheduler = makeSchedulerStub(frame.now, frame.activeEvents);
    const trackSchedulers = /* @__PURE__ */ new Map();
    for (const [key, events] of frame.activeByTrack) {
      trackSchedulers.set(key, makeSchedulerStub(frame.now, events));
    }
    this.bus.bindScheduler(scheduler, trackSchedulers);
    this.bus.bindAnalysers(master, trackAnalysers);
    for (const b of frame.bumps) {
      this.bus.bump({ s: b.s, color: b.color, hap: { value: { gain: b.gain } } });
    }
    this.bus.tick();
    this.bus.refreshActive(frame.now);
    this.bus.readAudio();
    return true;
  }
};
__name(_WorkerBusFeed, "WorkerBusFeed");
var WorkerBusFeed = _WorkerBusFeed;

// src/visualizers/worker/rollingHapWindow.ts
var EDGE = 1e-6;

// src/visualizers/worker/rawShims.ts
var _RawAnalyserShim = class _RawAnalyserShim {
  constructor() {
    this.fftSize = 2048;
    this.frequencyBinCount = 1024;
    this.minDecibels = -100;
    this.maxDecibels = -30;
    this.smoothingTimeConstant = 0.8;
    /** Latest frame's bytes (own copies — the transport may neuter the source). */
    this.freq = new Uint8Array(0);
    this.time = new Uint8Array(0);
  }
  /** Adopt the master analyser bytes from a frame. Absent (silent / no analyser)
   *  → zero everything so the float reads return 0.0 (128 byte = silence). */
  set(bytes) {
    if (!bytes) {
      this.freq = new Uint8Array(this.frequencyBinCount);
      this.time = new Uint8Array(this.fftSize).fill(128);
      return;
    }
    this.frequencyBinCount = bytes.frequencyBinCount;
    this.fftSize = bytes.fftSize && bytes.fftSize > 0 ? bytes.fftSize : bytes.frequencyBinCount * 2;
    if (typeof bytes.minDecibels === "number") this.minDecibels = bytes.minDecibels;
    if (typeof bytes.maxDecibels === "number") this.maxDecibels = bytes.maxDecibels;
    if (this.freq.length !== bytes.freq.length) this.freq = new Uint8Array(bytes.freq.length);
    if (this.time.length !== bytes.time.length) this.time = new Uint8Array(bytes.time.length);
    this.freq.set(bytes.freq);
    this.time.set(bytes.time);
  }
  getByteFrequencyData(arr) {
    arr.set(this.freq.subarray(0, arr.length));
  }
  getByteTimeDomainData(arr) {
    if (this.time.length) arr.set(this.time.subarray(0, arr.length));
    else arr.fill(128);
  }
  getFloatTimeDomainData(arr) {
    const n = Math.min(arr.length, this.time.length);
    for (let i = 0; i < n; i++) arr[i] = (this.time[i] - 128) / 128;
    for (let i = n; i < arr.length; i++) arr[i] = 0;
  }
  getFloatFrequencyData(arr) {
    const range = this.maxDecibels - this.minDecibels;
    const n = Math.min(arr.length, this.freq.length);
    for (let i = 0; i < n; i++) {
      arr[i] = this.minDecibels + this.freq[i] * range / 255;
    }
    for (let i = n; i < arr.length; i++) arr[i] = this.minDecibels;
  }
};
__name(_RawAnalyserShim, "RawAnalyserShim");
var RawAnalyserShim = _RawAnalyserShim;
var _RawSchedulerShim = class _RawSchedulerShim {
  constructor() {
    this._now = 0;
    /** The notes as last shipped (#2582) — a superset of the window when the
     *  frames carry `lo`/`hi`. */
    this.held = [];
    /** The shipped version of `held`; undefined when unknown or lost. */
    this.heldVersion = void 0;
    /** This frame's window: `held` narrowed to `[lo, hi)`. */
    this.events = [];
    /** Moves whenever `events` differs from the previous frame's. */
    this.eventsVersion = 0;
    /** The frame carried no version: every frame counts as changed. */
    this.unversioned = true;
    this._cps = 0;
    /** A resend has been asked for and not yet arrived. */
    this.awaitingWindow = false;
  }
  /**
   * Adopt one frame's feed. Main ships the notes only when they change (#2582):
   * a frame without `events` but with the `version` held here means "unchanged",
   * so the notes are kept. With a different version, the frame that carried
   * that version's notes never reached this mount — what is held is not the
   * current window, so it is dropped (never drawn as if current), and the call
   * returns true ONCE so the host can ask main to send the notes again.
   */
  set(raw) {
    this._now = raw?.now ?? 0;
    this._cps = raw?.cps ?? 0;
    let resync = false;
    if (raw?.events) {
      this.held = raw.events;
      this.heldVersion = raw.version;
      this.awaitingWindow = false;
    } else if (raw?.version === void 0) {
      this.held = [];
      this.heldVersion = void 0;
      this.awaitingWindow = false;
    } else if (raw.version !== this.heldVersion) {
      this.held = [];
      this.heldVersion = void 0;
      if (!this.awaitingWindow) {
        this.awaitingWindow = true;
        resync = true;
      }
    }
    this.unversioned = raw?.version === void 0;
    this.narrow(raw?.lo, raw?.hi);
    return resync;
  }
  /** `held` narrowed to this frame's window — the same test the main thread's
   *  `RollingHapWindow.at()` applies, so the answer is the one it would give. */
  narrow(lo, hi) {
    const next = lo === void 0 || hi === void 0 ? this.held : this.held.filter((e) => e.end > lo + EDGE && e.begin < hi - EDGE);
    const prev = this.events;
    let same = next.length === prev.length;
    for (let i = 0; same && i < next.length; i++) same = next[i] === prev[i];
    if (!same) this.eventsVersion++;
    this.events = next;
  }
  /** The whole shipped window (the GLSL note texture packs it, #2571). */
  all() {
    return this.events;
  }
  /** Equal across two frames → `all()` holds the same notes (the GLSL texture
   *  repacks only when it moves, #2571). Undefined when the frames carry no
   *  version: treat every frame as changed. */
  version() {
    return this.unversioned ? void 0 : this.eventsVersion;
  }
  /** Cycles per second, 0 when the frame carried none. */
  cps() {
    return this._cps;
  }
  now() {
    return this._now;
  }
  query(begin, end) {
    const out = [];
    for (const h of this.events) {
      if (h.begin < end && h.end > begin) out.push(h);
    }
    return out;
  }
};
__name(_RawSchedulerShim, "RawSchedulerShim");
var RawSchedulerShim = _RawSchedulerShim;

// src/visualizers/worker/signalTransport.ts
var SIGNAL_FRAME_TAG = "__staveSignalFrame";
function isSignalFrameEnvelope(data) {
  return isFrameEnvelope(data);
}
__name(isSignalFrameEnvelope, "isSignalFrameEnvelope");
function isFrameEnvelope(data) {
  return typeof data === "object" && data !== null && data[SIGNAL_FRAME_TAG] === true;
}
__name(isFrameEnvelope, "isFrameEnvelope");
function createPostMessageReader(channel) {
  let consumer = null;
  const handler = /* @__PURE__ */ __name((ev) => {
    if (consumer && isFrameEnvelope(ev.data)) consumer(ev.data.frame);
  }, "handler");
  channel.addEventListener("message", handler);
  return {
    onFrame(cb) {
      consumer = cb;
    },
    dispose() {
      consumer = null;
      channel.removeEventListener("message", handler);
    }
  };
}
__name(createPostMessageReader, "createPostMessageReader");

// src/visualizers/signals/staveUniforms.ts
function buildStaveUniforms(bus, onTick) {
  const sig = /* @__PURE__ */ __name(((sound) => bus.sound(sound)), "sig");
  sig.track = (id) => bus.track(id);
  Object.defineProperty(sig, "tracks", { get: /* @__PURE__ */ __name(() => bus.tracks, "get"), enumerable: true });
  Object.defineProperty(sig, "sounds", { get: /* @__PURE__ */ __name(() => bus.sounds, "get"), enumerable: true });
  const env = /* @__PURE__ */ __name((key) => ({
    get: /* @__PURE__ */ __name(() => bus.envValue(key), "get"),
    enumerable: true
  }), "env");
  Object.defineProperty(sig, "kick", env("uKick"));
  Object.defineProperty(sig, "snare", env("uSnare"));
  Object.defineProperty(sig, "hat", env("uHat"));
  Object.defineProperty(sig, "openHat", env("uOpenHat"));
  Object.defineProperty(sig, "clap", env("uClap"));
  Object.defineProperty(sig, "rim", env("uRim"));
  Object.defineProperty(sig, "tom", env("uTom"));
  Object.defineProperty(sig, "keyVelocity", {
    get: /* @__PURE__ */ __name(() => {
      let max = 0;
      for (const s of bus.sounds) {
        const v = bus.sound(s).velocity;
        if (v > max) max = v;
      }
      return max;
    }, "get"),
    enumerable: true
  });
  Object.defineProperty(sig, "rms", { get: /* @__PURE__ */ __name(() => bus.master().rms, "get"), enumerable: true });
  Object.defineProperty(sig, "bass", { get: /* @__PURE__ */ __name(() => bus.master().bass, "get"), enumerable: true });
  Object.defineProperty(sig, "mid", { get: /* @__PURE__ */ __name(() => bus.master().mid, "get"), enumerable: true });
  Object.defineProperty(sig, "treble", { get: /* @__PURE__ */ __name(() => bus.master().treble, "get"), enumerable: true });
  Object.defineProperty(sig, "fft", { get: /* @__PURE__ */ __name(() => bus.master().fft, "get"), enumerable: true });
  Object.defineProperty(sig, "wave", { get: /* @__PURE__ */ __name(() => bus.master().wave, "get"), enumerable: true });
  Object.defineProperty(sig, "density", { get: /* @__PURE__ */ __name(() => getVizConfig().density, "get"), enumerable: true });
  const uniforms = { sig };
  Object.defineProperty(uniforms, "__tick", {
    value: onTick ?? (() => {
    }),
    enumerable: false
  });
  return uniforms;
}
__name(buildStaveUniforms, "buildStaveUniforms");

// src/visualizers/renderers/hydraStaveBag.ts
function buildHydraStaveBag(bus, optionsRef = { current: {} }) {
  const soundThunks = /* @__PURE__ */ __name((sound) => {
    const t = {
      env: /* @__PURE__ */ __name(() => bus.sound(sound).env, "env"),
      velocity: /* @__PURE__ */ __name(() => bus.sound(sound).velocity, "velocity"),
      note: /* @__PURE__ */ __name(() => bus.sound(sound).note, "note"),
      color: /* @__PURE__ */ __name(() => bus.sound(sound).color, "color"),
      rms: /* @__PURE__ */ __name(() => bus.sound(sound).rms, "rms"),
      bass: /* @__PURE__ */ __name(() => bus.sound(sound).bass, "bass"),
      mid: /* @__PURE__ */ __name(() => bus.sound(sound).mid, "mid"),
      treble: /* @__PURE__ */ __name(() => bus.sound(sound).treble, "treble")
    };
    Object.defineProperty(t, "fft", { get: /* @__PURE__ */ __name(() => bus.sound(sound).fft, "get"), enumerable: true });
    Object.defineProperty(t, "wave", { get: /* @__PURE__ */ __name(() => bus.sound(sound).wave, "get"), enumerable: true });
    return t;
  }, "soundThunks");
  const sig = /* @__PURE__ */ __name(((sound) => soundThunks(sound)), "sig");
  sig.track = (id) => {
    const t = {
      env: /* @__PURE__ */ __name(() => bus.track(id).env, "env"),
      velocity: /* @__PURE__ */ __name(() => bus.track(id).velocity, "velocity"),
      note: /* @__PURE__ */ __name(() => bus.track(id).note, "note"),
      color: /* @__PURE__ */ __name(() => bus.track(id).color, "color"),
      rms: /* @__PURE__ */ __name(() => bus.track(id).rms, "rms"),
      bass: /* @__PURE__ */ __name(() => bus.track(id).bass, "bass"),
      mid: /* @__PURE__ */ __name(() => bus.track(id).mid, "mid"),
      treble: /* @__PURE__ */ __name(() => bus.track(id).treble, "treble")
    };
    Object.defineProperty(t, "fft", { get: /* @__PURE__ */ __name(() => bus.track(id).fft, "get"), enumerable: true });
    Object.defineProperty(t, "wave", { get: /* @__PURE__ */ __name(() => bus.track(id).wave, "get"), enumerable: true });
    return t;
  };
  Object.defineProperty(sig, "tracks", { get: /* @__PURE__ */ __name(() => bus.tracks, "get"), enumerable: true });
  Object.defineProperty(sig, "sounds", { get: /* @__PURE__ */ __name(() => bus.sounds, "get"), enumerable: true });
  sig.kick = () => bus.envValue("uKick");
  sig.snare = () => bus.envValue("uSnare");
  sig.hat = () => bus.envValue("uHat");
  sig.openHat = () => bus.envValue("uOpenHat");
  sig.clap = () => bus.envValue("uClap");
  sig.rim = () => bus.envValue("uRim");
  sig.tom = () => bus.envValue("uTom");
  sig.keyVelocity = () => {
    let max = 0;
    for (const s of bus.sounds) {
      const v = bus.sound(s).velocity;
      if (v > max) max = v;
    }
    return max;
  };
  sig.rms = () => bus.master().rms;
  sig.bass = () => bus.master().bass;
  sig.mid = () => bus.master().mid;
  sig.treble = () => bus.master().treble;
  Object.defineProperty(sig, "fft", { get: /* @__PURE__ */ __name(() => bus.master().fft, "get"), enumerable: true });
  Object.defineProperty(sig, "wave", { get: /* @__PURE__ */ __name(() => bus.master().wave, "get"), enumerable: true });
  const bag = {
    // Read THROUGH the slot on every access (#883). The renderer REPLACES
    // `optionsRef.current` on each re-publish, and this bag is built once per
    // mount — so a captured value would pin the first evaluate's options and a
    // removed key would keep applying forever. Same live-ref idiom as `sig.fft`
    // above and p5's `stave.options` getter.
    get options() {
      return optionsRef.current;
    },
    scheduler: null,
    tracks: /* @__PURE__ */ new Map(),
    sig,
    H: /* @__PURE__ */ __name((trackId, field = "gain") => {
      return () => {
        const sched = bag.tracks.get(trackId) ?? bag.scheduler;
        if (!sched) return 0;
        const now = sched.now();
        const events = sched.query(now, now + 1e-3);
        const ev = events[0];
        if (!ev) return 0;
        const raw = ev[field];
        return typeof raw === "number" ? raw : 0;
      };
    }, "H")
  };
  return bag;
}
__name(buildHydraStaveBag, "buildHydraStaveBag");

// src/engine/engineLog.ts
var MAX_HISTORY = 500;
var history = [];
var dedupeIndex = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
var idSeq = 0;
function makeId() {
  idSeq += 1;
  return `log-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}
__name(makeId, "makeId");
function dedupeKey(p) {
  return [p.level, p.runtime, p.source ?? "", p.line ?? "", p.message].join("\0");
}
__name(dedupeKey, "dedupeKey");
function emitLog(partial) {
  const key = dedupeKey(partial);
  const existing = dedupeIndex.get(key);
  if (existing) {
    existing.ts = Date.now();
    existing.count = (existing.count ?? 1) + 1;
    if (partial.alongside === void 0) delete existing.alongside;
    else existing.alongside = partial.alongside;
    queueMicrotask(() => {
      for (const fn of listeners) {
        try {
          fn(existing, history);
        } catch {
        }
      }
    });
    return existing;
  }
  const entry = {
    id: makeId(),
    ts: Date.now(),
    count: 1,
    ...partial
  };
  history.push(entry);
  dedupeIndex.set(key, entry);
  while (history.length > MAX_HISTORY) {
    const info = history.findIndex((e) => e.level === "info");
    const [r] = history.splice(info === -1 ? 0 : info, 1);
    const rk = dedupeKey(r);
    if (dedupeIndex.get(rk) === r) dedupeIndex.delete(rk);
  }
  queueMicrotask(() => {
    for (const fn of listeners) {
      try {
        fn(entry, history);
      } catch {
      }
    }
  });
  return entry;
}
__name(emitLog, "emitLog");
function subscribeLog(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
__name(subscribeLog, "subscribeLog");

// src/engine/friendlyErrors.ts
function parseStackLocation(err) {
  const stack = typeof err === "object" && err !== null && "stack" in err ? String(err.stack ?? "") : "";
  if (!stack) return null;
  const v8Eval = stack.match(/at eval[^(]*\(<anonymous>:(\d+):(\d+)\)/);
  if (v8Eval)
    return { line: parseInt(v8Eval[1], 10), column: parseInt(v8Eval[2], 10) };
  const v8EvalWrap = stack.match(/eval at .+?<anonymous>:(\d+):(\d+)/);
  if (v8EvalWrap)
    return { line: parseInt(v8EvalWrap[1], 10), column: parseInt(v8EvalWrap[2], 10) };
  const v8Named = stack.match(/at\s+\S+\s+\(<anonymous>:(\d+):(\d+)\)/);
  if (v8Named)
    return { line: parseInt(v8Named[1], 10), column: parseInt(v8Named[2], 10) };
  const v8Anon = stack.match(/^\s*at\s+<anonymous>:(\d+):(\d+)/m);
  if (v8Anon)
    return { line: parseInt(v8Anon[1], 10), column: parseInt(v8Anon[2], 10) };
  const ff = stack.match(
    /@(?:<anonymous>|debugger eval|eval):(\d+):(\d+)/
  );
  if (ff) return { line: parseInt(ff[1], 10), column: parseInt(ff[2], 10) };
  const ffDynamic = stack.match(/ line \d+ > (?:Function|eval):(\d+):(\d+)/);
  if (ffDynamic)
    return { line: parseInt(ffDynamic[1], 10), column: parseInt(ffDynamic[2], 10) };
  if (typeof err === "object" && err !== null && !/^\s+at /m.test(stack)) {
    const { line, column, sourceURL } = err;
    if (typeof line === "number" && Number.isInteger(line) && line >= 1 && typeof column === "number" && Number.isInteger(column) && column >= 1 && !sourceURL) {
      return { line, column: Math.max(1, column - 1) };
    }
  }
  return null;
}
__name(parseStackLocation, "parseStackLocation");
function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        // insert
        prev[j] + 1,
        // delete
        prev[j - 1] + cost
        // substitute
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}
__name(levenshtein, "levenshtein");
function fuzzyMatch(word, corpus, options = {}) {
  if (!word) return [];
  const lower = word.toLowerCase();
  const threshold = options.maxDistance ?? Math.max(2, Math.ceil(word.length / 3));
  const limit = options.limit ?? 5;
  const hits = [];
  for (const candidate of corpus) {
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d <= threshold) hits.push({ name: candidate, distance: d });
  }
  hits.sort(
    (a, b) => a.distance - b.distance || // Prefer case-matching names on ties (e.g. PI over Pi).
    (a.name === word ? -1 : b.name === word ? 1 : 0) || a.name.localeCompare(b.name)
  );
  return hits.slice(0, limit);
}
__name(fuzzyMatch, "fuzzyMatch");
var REFERENCE_ERROR_PATTERNS = [
  // Chrome / Edge / Node: "foo is not defined"
  /^(\w+) is not defined$/,
  // Firefox: "foo is not defined"
  /^ReferenceError: (\w+) is not defined$/,
  // Safari: "Can't find variable: foo"
  /^Can't find variable: (\w+)$/
];
function extractReferenceIdentifier(err) {
  const message = typeof err === "object" && err !== null && "message" in err ? String(err.message) : String(err);
  if (!message) return null;
  const trimmed = message.replace(/^Uncaught\s+/, "").trim();
  for (const re of REFERENCE_ERROR_PATTERNS) {
    const m = re.exec(trimmed);
    if (m && m[1]) return m[1];
  }
  return null;
}
__name(extractReferenceIdentifier, "extractReferenceIdentifier");
var SAFARI_NOT_A_FUNCTION = " is not a function. (In '";
function chromeNotAFunctionWording(message) {
  const at = message.indexOf(SAFARI_NOT_A_FUNCTION);
  if (at < 0 || !message.endsWith(")")) return message;
  const said = message.slice(0, at);
  let out = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < said.length; i++) {
    const c = said[i];
    if (quote) {
      if (depth === 0) out += c;
      if (c === "\\") {
        i++;
        if (depth === 0) out += said[i] ?? "";
      } else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") {
      depth++;
      continue;
    } else if (c === ")" && depth > 0) {
      if (--depth === 0) out += "(...)";
      continue;
    }
    if (depth === 0) out += c;
  }
  return `${out.replace(/\[(['"`])([A-Za-z_$][\w$]*)\1\]/g, ".$2")} is not a function`;
}
__name(chromeNotAFunctionWording, "chromeNotAFunctionWording");
var SOUND_NOT_FOUND_PATTERNS = [
  /sound\s+["']?([\w.-]+)["']?\s+not\s+found/i
];
function extractMissingSoundName(rawMessage) {
  for (const re of SOUND_NOT_FOUND_PATTERNS) {
    const m = re.exec(rawMessage);
    if (m && m[1]) return m[1];
  }
  return null;
}
__name(extractMissingSoundName, "extractMissingSoundName");
var SOUNDFONT_ZONE_RE = /no soundfont zone found/i;
function isSoundfontZoneError(message) {
  return SOUNDFONT_ZONE_RE.test(message);
}
__name(isSoundfontZoneError, "isSoundfontZoneError");
var SOUNDFONT_ZONE_HINT = "A note is outside the chosen instrument's sampled range \u2014 try a lower octave or a fuller-range instrument.";
function buildAliasSuffix(missingName, ctx) {
  if (!ctx) return "";
  const parts = [];
  if (ctx.resolutions && ctx.resolutions.length > 0) {
    const seen = /* @__PURE__ */ new Set();
    const lines = [];
    for (const r of ctx.resolutions) {
      const key = `${r.from}\u2192${r.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`\`${r.from}\` \u2192 \`${r.to}\``);
    }
    parts.push(`tried alias ${lines.join(", ")}`);
  }
  if (missingName && ctx.lookupAlias) {
    const target = ctx.lookupAlias(missingName);
    if (target) {
      parts.push(`alias map: \`${missingName}\` \u2192 \`${target}\` (but \`${target}\` is not loaded)`);
    } else {
      parts.push(`alias map: no entry for \`${missingName}\``);
    }
  }
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}
__name(buildAliasSuffix, "buildAliasSuffix");
function asRegExp(match) {
  return match instanceof RegExp ? match : new RegExp(match, "i");
}
__name(asRegExp, "asRegExp");
function evalMistake(mistake, ctx) {
  const { detect } = mistake;
  if (detect.kind === "message") {
    return asRegExp(detect.match).test(ctx.rawMessage);
  }
  if (detect.kind === "code") {
    if (!ctx.codeContext) return false;
    return asRegExp(detect.match).test(ctx.codeContext);
  }
  return ctx.identifier !== null && ctx.identifier === detect.alias;
}
__name(evalMistake, "evalMistake");
var SPECIFICITY = {
  message: 3,
  code: 2,
  identifier: 1
};
function rankHits(hits) {
  if (hits.length === 0) return null;
  hits.sort((a, b) => {
    const wa = a.mistake.weight ?? 1;
    const wb = b.mistake.weight ?? 1;
    if (wa !== wb) return wb - wa;
    if (a.specificity !== b.specificity) return b.specificity - a.specificity;
    return a.order - b.order;
  });
  return hits[0];
}
__name(rankHits, "rankHits");
function collectMistakes(index, ctx) {
  const hits = [];
  let order = 0;
  if (ctx.identifier && index.docs[ctx.identifier]) {
    const doc = index.docs[ctx.identifier];
    for (const m of doc.commonMistakes ?? []) {
      if (evalMistake(m, ctx)) {
        hits.push({
          mistake: m,
          specificity: SPECIFICITY[m.detect.kind],
          order: order++,
          symbol: { name: ctx.identifier, doc }
        });
      }
    }
  }
  for (const [name, doc] of Object.entries(index.docs)) {
    if (name === ctx.identifier) continue;
    for (const m of doc.commonMistakes ?? []) {
      if (evalMistake(m, ctx)) {
        hits.push({
          mistake: m,
          specificity: SPECIFICITY[m.detect.kind],
          order: order++,
          symbol: { name, doc }
        });
      }
    }
  }
  for (const m of index.globalMistakes ?? []) {
    if (evalMistake(m, ctx)) {
      hits.push({
        mistake: m,
        specificity: SPECIFICITY[m.detect.kind],
        order: order++
      });
    }
  }
  return rankHits(hits);
}
__name(collectMistakes, "collectMistakes");
function defaultDocsUrl(runtime, name) {
  return `/docs/reference/${runtime}/#${name.toLowerCase()}`;
}
__name(defaultDocsUrl, "defaultDocsUrl");
function formatFriendlyError(err, runtime, options = {}) {
  const rawMessage = chromeNotAFunctionWording(
    typeof err === "object" && err !== null && "message" in err ? String(err.message) : String(err)
  );
  const stack = typeof err === "object" && err !== null && "stack" in err && typeof err.stack === "string" ? err.stack : void 0;
  const loc = parseStackLocation(err);
  const identifier = extractReferenceIdentifier(err);
  const missingName = extractMissingSoundName(rawMessage);
  const aliasSuffix = buildAliasSuffix(missingName, options.aliasContext);
  const appendAlias = /* @__PURE__ */ __name((msg) => aliasSuffix ? `${msg}${aliasSuffix}` : msg, "appendAlias");
  if (options.index) {
    const hit = collectMistakes(options.index, {
      rawMessage,
      identifier,
      codeContext: options.codeContext
    });
    if (hit) {
      const suggestion = hit.symbol ? {
        name: hit.symbol.name,
        docsUrl: (options.docsUrlFor ?? defaultDocsUrl)(
          runtime,
          hit.symbol.name
        ),
        example: hit.mistake.example ?? hit.symbol.doc.example,
        description: hit.symbol.doc.description
      } : hit.mistake.example || hit.mistake.link ? {
        // Global mistake without a symbol — synthesise a minimal
        // suggestion so downstream UI still surfaces the example,
        // and the hint's own link when it has one (#2167).
        name: "",
        linkLabel: hit.mistake.link?.label,
        docsUrl: hit.mistake.link?.url ?? "",
        example: hit.mistake.example,
        description: hit.mistake.link?.description
      } : void 0;
      return {
        message: appendAlias(hit.mistake.hint),
        suggestion,
        stack,
        line: loc?.line,
        column: loc?.column
      };
    }
  }
  if (identifier && options.index) {
    const matches = fuzzyMatch(
      identifier,
      Object.keys(options.index.docs)
    );
    if (matches[0]?.name === identifier) {
      const hit = options.index.docs[identifier];
      const receiver = options.index.receiver;
      return {
        message: appendAlias(
          receiver ? `\`${identifier}\` is on \`${receiver}\` here \u2014 write \`${receiver}.${identifier}(\u2026)\`.` : `\`${identifier}\` is not defined.`
        ),
        suggestion: {
          name: identifier,
          docsUrl: (options.docsUrlFor ?? defaultDocsUrl)(runtime, identifier),
          example: hit?.example,
          description: hit?.description
        },
        stack,
        line: loc?.line,
        column: loc?.column
      };
    }
    if (matches.length > 0) {
      const hit = options.index.docs[matches[0].name];
      const docsUrl = (options.docsUrlFor ?? defaultDocsUrl)(
        runtime,
        matches[0].name
      );
      const suggestion = {
        name: matches[0].name,
        docsUrl,
        example: hit?.example,
        description: hit?.description
      };
      return {
        message: appendAlias(`\`${identifier}\` is not defined. Did you mean \`${matches[0].name}\`?`),
        suggestion,
        stack,
        line: loc?.line,
        column: loc?.column
      };
    }
    return {
      message: appendAlias(`\`${identifier}\` is not defined.`),
      stack,
      line: loc?.line,
      column: loc?.column
    };
  }
  if (isSoundfontZoneError(rawMessage)) {
    return {
      message: appendAlias(SOUNDFONT_ZONE_HINT),
      stack,
      line: loc?.line,
      column: loc?.column
    };
  }
  return {
    message: appendAlias(rawMessage || "Unknown error"),
    stack,
    line: loc?.line,
    column: loc?.column
  };
}
__name(formatFriendlyError, "formatFriendlyError");

// src/monaco/docs/types.ts
function validateDocsIndex(label, raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${label}: docs index must be an object`);
  }
  const r = raw;
  if (typeof r.runtime !== "string" || r.runtime.length === 0) {
    throw new Error(`${label}: runtime must be a non-empty string`);
  }
  if (!r.docs || typeof r.docs !== "object") {
    throw new Error(`${label}: docs must be an object`);
  }
  for (const [name, entry] of Object.entries(r.docs)) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${label}: entry "${name}" is not an object`);
    }
    const e = entry;
    if (typeof e.signature !== "string") {
      throw new Error(
        `${label}: entry "${name}" is missing string "signature"`
      );
    }
    if (typeof e.description !== "string") {
      throw new Error(
        `${label}: entry "${name}" is missing string "description"`
      );
    }
    if (e.commonMistakes !== void 0) {
      validateMistakes(`${label}: entry "${name}".commonMistakes`, e.commonMistakes);
    }
  }
  if (r.globalMistakes !== void 0) {
    validateMistakes(`${label}: globalMistakes`, r.globalMistakes);
  }
}
__name(validateDocsIndex, "validateDocsIndex");
function validateMistakes(label, raw) {
  if (!Array.isArray(raw)) {
    throw new Error(`${label} must be an array`);
  }
  raw.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`${label}[${idx}] must be an object`);
    }
    const m = item;
    if (typeof m.hint !== "string" || m.hint.length === 0) {
      throw new Error(`${label}[${idx}] requires non-empty string "hint"`);
    }
    const detect = m.detect;
    if (!detect || typeof detect !== "object") {
      throw new Error(`${label}[${idx}] requires object "detect"`);
    }
    if (detect.kind === "identifier") {
      if (typeof detect.alias !== "string" || detect.alias.length === 0) {
        throw new Error(
          `${label}[${idx}].detect (identifier) requires non-empty string "alias"`
        );
      }
    } else if (detect.kind === "message" || detect.kind === "code") {
      if (typeof detect.match !== "string" && !(detect.match instanceof RegExp)) {
        throw new Error(
          `${label}[${idx}].detect (${detect.kind}) requires string|RegExp "match"`
        );
      }
    } else {
      throw new Error(
        `${label}[${idx}].detect.kind must be "message" | "code" | "identifier"`
      );
    }
  });
}
__name(validateMistakes, "validateMistakes");

// src/monaco/docs/data/p5.json
var p5_default = {
  runtime: "p5js",
  docs: {
    describe: {
      signature: "describe(text: String, display?: Constant)",
      description: "Creates a screen reader-accessible description of the canvas.",
      example: "describe('A pink square with a red heart in the bottom-right corner.')",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/describe"
    },
    describeElement: {
      signature: "describeElement(name: String, text: String, display?: Constant)",
      description: "Creates a screen reader-accessible description of elements in the canvas.",
      example: "describeElement('Circle', 'A yellow circle in the top-left corner.')",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/describeElement"
    },
    textOutput: {
      signature: "textOutput(display?: Constant)",
      description: "Creates a screen reader-accessible description of shapes on the canvas.",
      example: "textOutput()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/textOutput"
    },
    gridOutput: {
      signature: "gridOutput(display?: Constant)",
      description: "Creates a screen reader-accessible description of shapes on the canvas.",
      example: "gridOutput()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/gridOutput"
    },
    alpha: {
      signature: "alpha(color: p5.Color|Number[]|String)",
      description: "Gets the alpha (transparency) value of a color.",
      example: "let alphaValue = alpha(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/alpha"
    },
    blue: {
      signature: "blue(color: p5.Color|Number[]|String)",
      description: "Gets the blue value of a color.",
      example: "let blueValue = blue(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/blue"
    },
    brightness: {
      signature: "brightness(color: p5.Color|Number[]|String)",
      description: "Gets the brightness value of a color.",
      example: "let brightValue = brightness(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/brightness"
    },
    color: {
      signature: "color(gray: Number, alpha?: Number)",
      description: "Creates a p5.",
      example: "let c = color(255, 204, 0)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/color"
    },
    green: {
      signature: "green(color: p5.Color|Number[]|String)",
      description: "Gets the green value of a color.",
      example: "let greenValue = green(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/green"
    },
    hue: {
      signature: "hue(color: p5.Color|Number[]|String)",
      description: "Gets the hue value of a color.",
      example: "let hueValue = hue(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/hue"
    },
    lerpColor: {
      signature: "lerpColor(c1: p5.Color, c2: p5.Color, amt: Number)",
      description: "Blends two colors to find a third color between them.",
      example: "let interA = lerpColor(from, to, 0.33)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/lerpColor"
    },
    paletteLerp: {
      signature: "paletteLerp(colors_stops: [p5.Color, Number][], amt: Number)",
      description: "Blends multiple colors to find a color between them.",
      example: "background(paletteLerp([",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/paletteLerp"
    },
    lightness: {
      signature: "lightness(color: p5.Color|Number[]|String)",
      description: "Gets the lightness value of a color.",
      example: "let lightValue = lightness(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/lightness"
    },
    red: {
      signature: "red(color: p5.Color|Number[]|String)",
      description: "Gets the red value of a color.",
      example: "let redValue = red(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/red"
    },
    saturation: {
      signature: "saturation(color: p5.Color|Number[]|String)",
      description: "Gets the saturation value of a color.",
      example: "let satValue = saturation(c)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/saturation"
    },
    beginClip: {
      signature: "beginClip(options?: Object)",
      description: "Starts defining a shape that will mask any shapes drawn afterward.",
      example: "beginClip()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/beginClip"
    },
    endClip: {
      signature: "endClip()",
      description: "Ends defining a mask that was started with beginClip().",
      example: "endClip()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/endClip"
    },
    clip: {
      signature: "clip(callback: Function, options?: Object)",
      description: "Defines a shape that will mask any shapes drawn afterward.",
      example: "clip(mask)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/clip"
    },
    background: {
      signature: "background(color: p5.Color)",
      description: "Sets the color used for the background of the canvas.",
      example: "background(51)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/background"
    },
    clear: {
      signature: "clear(r?: Number, g?: Number, b?: Number, a?: Number)",
      description: "Clears the pixels on the canvas.",
      example: "clear()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/clear"
    },
    colorMode: {
      signature: "colorMode(mode: Constant, max?: Number)",
      description: "Changes the way color values are interpreted.",
      example: "colorMode(RGB, 100)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/colorMode"
    },
    fill: {
      signature: "fill(v1: Number, v2: Number, v3: Number, alpha?: Number)",
      description: "Sets the color used to fill shapes.",
      example: "fill(51)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/fill"
    },
    noFill: {
      signature: "noFill()",
      description: "Disables setting the fill color for shapes.",
      example: "noFill()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/noFill"
    },
    noStroke: {
      signature: "noStroke()",
      description: "Disables drawing points, lines, and the outlines of shapes.",
      example: "noStroke()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/noStroke"
    },
    stroke: {
      signature: "stroke(v1: Number, v2: Number, v3: Number, alpha?: Number)",
      description: "Sets the color used to draw points, lines, and the outlines of shapes.",
      example: "stroke(51)",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/stroke"
    },
    erase: {
      signature: "erase(strengthFill?: Number, strengthStroke?: Number)",
      description: "Starts using shapes to erase parts of the canvas.",
      example: "erase()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/erase"
    },
    noErase: {
      signature: "noErase()",
      description: "Ends erasing that was started with erase().",
      example: "noErase()",
      kind: "function",
      category: "Color",
      sourceUrl: "https://p5js.org/reference/#/p5/noErase"
    },
    arc: {
      signature: "arc(x: Number, y: Number, w: Number, h: Number, start: Number, stop: Number, mode?: Constant, detail?: Integer)",
      description: "Draws an arc.",
      example: "arc(50, 50, 80, 80, 0, PI + HALF_PI)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/arc"
    },
    ellipse: {
      signature: "ellipse(x: Number, y: Number, w: Number, h?: Number)",
      description: "Draws an ellipse (oval).",
      example: "ellipse(50, 50, 80, 80)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/ellipse"
    },
    circle: {
      signature: "circle(x: Number, y: Number, d: Number)",
      description: "Draws a circle.",
      example: "circle(50, 50, 25)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/circle"
    },
    line: {
      signature: "line(x1: Number, y1: Number, x2: Number, y2: Number)",
      description: "Draws a straight line between two points.",
      example: "line(30, 20, 85, 75)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/line"
    },
    point: {
      signature: "point(x: Number, y: Number, z?: Number)",
      description: "Draws a single point in space.",
      example: "point(30, 20)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/point"
    },
    quad: {
      signature: "quad(x1: Number, y1: Number, x2: Number, y2: Number, x3: Number, y3: Number, x4: Number, y4: Number, detailX?: Integer, detailY?: Integer)",
      description: "Draws a quadrilateral (four-sided shape).",
      example: "quad(20, 20, 80, 20, 80, 80, 20, 80)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/quad"
    },
    rect: {
      signature: "rect(x: Number, y: Number, w: Number, h?: Number, tl?: Number, tr?: Number, br?: Number, bl?: Number)",
      description: "Draws a rectangle.",
      example: "rect(30, 20, 55, 55)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/rect"
    },
    square: {
      signature: "square(x: Number, y: Number, s: Number, tl?: Number, tr?: Number, br?: Number, bl?: Number)",
      description: "Draws a square.",
      example: "square(30, 20, 55)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/square"
    },
    triangle: {
      signature: "triangle(x1: Number, y1: Number, x2: Number, y2: Number, x3: Number, y3: Number)",
      description: "Draws a triangle.",
      example: "triangle(30, 75, 58, 20, 86, 75)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/triangle"
    },
    ellipseMode: {
      signature: "ellipseMode(mode: Constant)",
      description: "Changes where ellipses, circles, and arcs are drawn.",
      example: "ellipseMode(RADIUS)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/ellipseMode"
    },
    noSmooth: {
      signature: "noSmooth()",
      description: "Draws certain features with jagged (aliased) edges.",
      example: "noSmooth()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/noSmooth"
    },
    rectMode: {
      signature: "rectMode(mode: Constant)",
      description: "Changes where rectangles and squares are drawn.",
      example: "rectMode(CORNER)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/rectMode"
    },
    smooth: {
      signature: "smooth()",
      description: "Draws certain features with smooth (antialiased) edges.",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/smooth"
    },
    strokeCap: {
      signature: "strokeCap(cap: Constant)",
      description: "Sets the style for rendering the ends of lines.",
      example: "strokeCap(ROUND)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/strokeCap"
    },
    strokeJoin: {
      signature: "strokeJoin(join: Constant)",
      description: "Sets the style of the joints that connect line segments.",
      example: "strokeJoin(MITER)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/strokeJoin"
    },
    strokeWeight: {
      signature: "strokeWeight(weight: Number)",
      description: "Sets the width of the stroke used for points, lines, and the outlines of shapes.",
      example: "strokeWeight(4)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/strokeWeight"
    },
    bezier: {
      signature: "bezier(x1: Number, y1: Number, x2: Number, y2: Number, x3: Number, y3: Number, x4: Number, y4: Number)",
      description: "Draws a B\xE9zier curve.",
      example: "bezier(85, 20, 10, 10, 90, 90, 15, 80)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/bezier"
    },
    bezierDetail: {
      signature: "bezierDetail(detail: Number)",
      description: "Sets the number of segments used to draw B\xE9zier curves in WebGL mode.",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/bezierDetail"
    },
    bezierPoint: {
      signature: "bezierPoint(a: Number, b: Number, c: Number, d: Number, t: Number)",
      description: "Calculates coordinates along a B\xE9zier curve using interpolation.",
      example: "let x = bezierPoint(x1, x2, x3, x4, 0)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/bezierPoint"
    },
    bezierTangent: {
      signature: "bezierTangent(a: Number, b: Number, c: Number, d: Number, t: Number)",
      description: "Calculates coordinates along a line that's tangent to a B\xE9zier curve.",
      example: "let tx = 0.1 * bezierTangent(x1, x2, x3, x4, 0)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/bezierTangent"
    },
    curve: {
      signature: "curve(x1: Number, y1: Number, x2: Number, y2: Number, x3: Number, y3: Number, x4: Number, y4: Number)",
      description: "Draws a curve using a Catmull-Rom spline.",
      example: "curve(5, 26, 73, 24, 73, 61, 15, 65)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/curve"
    },
    curveDetail: {
      signature: "curveDetail(resolution: Number)",
      description: "Sets the number of segments used to draw spline curves in WebGL mode.",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/curveDetail"
    },
    curveTightness: {
      signature: "curveTightness(amount: Number)",
      description: "Adjusts the way curve() and curveVertex() draw.",
      example: "curveTightness(t)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/curveTightness"
    },
    curvePoint: {
      signature: "curvePoint(a: Number, b: Number, c: Number, d: Number, t: Number)",
      description: "Calculates coordinates along a spline curve using interpolation.",
      example: "let x = curvePoint(x1, x2, x3, x4, 0)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/curvePoint"
    },
    curveTangent: {
      signature: "curveTangent(a: Number, b: Number, c: Number, d: Number, t: Number)",
      description: "Calculates coordinates along a line that's tangent to a spline curve.",
      example: "let tx = 0.2 * curveTangent(x1, x2, x3, x4, 0)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/curveTangent"
    },
    beginContour: {
      signature: "beginContour()",
      description: "Begins creating a hole within a flat shape.",
      example: "beginContour()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/beginContour"
    },
    beginShape: {
      signature: "beginShape(kind?: Constant)",
      description: "Begins adding vertices to a custom shape.",
      example: "beginShape()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/beginShape"
    },
    bezierVertex: {
      signature: "bezierVertex(x2: Number, y2: Number, x3: Number, y3: Number, x4: Number, y4: Number)",
      description: "Adds a B\xE9zier curve segment to a custom shape.",
      example: "bezierVertex(80, 0, 80, 75, 30, 75)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/bezierVertex"
    },
    curveVertex: {
      signature: "curveVertex(x: Number, y: Number)",
      description: "Adds a spline curve segment to a custom shape.",
      example: "curveVertex(32, 91)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/curveVertex"
    },
    endContour: {
      signature: "endContour()",
      description: "Stops creating a hole within a flat shape.",
      example: "endContour()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/endContour"
    },
    endShape: {
      signature: "endShape(mode?: Constant, count?: Integer)",
      description: "Stops adding vertices to a custom shape.",
      example: "endShape(CLOSE)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/endShape"
    },
    quadraticVertex: {
      signature: "quadraticVertex(cx: Number, cy: Number, x3: Number, y3: Number)",
      description: "Adds a quadratic B\xE9zier curve segment to a custom shape.",
      example: "quadraticVertex(80, 20, 50, 50)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/quadraticVertex"
    },
    vertex: {
      signature: "vertex(x: Number, y: Number)",
      description: "Adds a vertex to a custom shape.",
      example: "vertex(30, 20)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/vertex"
    },
    normal: {
      signature: "normal(vector: p5.Vector)",
      description: "Sets the normal vector for vertices in a custom 3D shape.",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/normal"
    },
    VERSION: {
      signature: "VERSION",
      description: "Version of this p5.",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/VERSION"
    },
    P2D: {
      signature: "P2D",
      description: "The default, two-dimensional renderer.",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/P2D"
    },
    WEBGL: {
      signature: "WEBGL",
      description: "One of the two render modes in p5.",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/WEBGL"
    },
    WEBGL2: {
      signature: "WEBGL2",
      description: "One of the two possible values of a WebGL canvas (either WEBGL or WEBGL2), which can be used to determine what capabilities the rendering environment has.",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/WEBGL2"
    },
    ARROW: {
      signature: "ARROW",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ARROW"
    },
    CROSS: {
      signature: "CROSS",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CROSS"
    },
    HAND: {
      signature: "HAND",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/HAND"
    },
    MOVE: {
      signature: "MOVE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/MOVE"
    },
    TEXT: {
      signature: "TEXT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TEXT"
    },
    WAIT: {
      signature: "WAIT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/WAIT"
    },
    HALF_PI: {
      signature: "HALF_PI",
      description: "A `Number` constant that's approximately 1.",
      example: "arc(50, 50, 80, 80, 0, HALF_PI)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/HALF_PI"
    },
    PI: {
      signature: "PI",
      description: "A `Number` constant that's approximately 3.",
      example: "arc(50, 50, 80, 80, 0, PI)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/PI"
    },
    QUARTER_PI: {
      signature: "QUARTER_PI",
      description: "A `Number` constant that's approximately 0.",
      example: "arc(50, 50, 80, 80, 0, QUARTER_PI)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/QUARTER_PI"
    },
    TAU: {
      signature: "TAU",
      description: "A `Number` constant that's approximately 6.",
      example: "arc(50, 50, 80, 80, 0, TAU)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TAU"
    },
    TWO_PI: {
      signature: "TWO_PI",
      description: "A `Number` constant that's approximately 6.",
      example: "arc(50, 50, 80, 80, 0, TWO_PI)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TWO_PI"
    },
    DEGREES: {
      signature: "DEGREES",
      description: "A `String` constant that's used to set the angleMode().",
      example: "angleMode(DEGREES)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DEGREES"
    },
    RADIANS: {
      signature: "RADIANS",
      description: "A `String` constant that's used to set the angleMode().",
      example: "angleMode(RADIANS)",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RADIANS"
    },
    CORNER: {
      signature: "CORNER",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CORNER"
    },
    CORNERS: {
      signature: "CORNERS",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CORNERS"
    },
    RADIUS: {
      signature: "RADIUS",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RADIUS"
    },
    RIGHT: {
      signature: "RIGHT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RIGHT"
    },
    LEFT: {
      signature: "LEFT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LEFT"
    },
    CENTER: {
      signature: "CENTER",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CENTER"
    },
    TOP: {
      signature: "TOP",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TOP"
    },
    BOTTOM: {
      signature: "BOTTOM",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BOTTOM"
    },
    BASELINE: {
      signature: "BASELINE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BASELINE"
    },
    POINTS: {
      signature: "POINTS",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/POINTS"
    },
    LINES: {
      signature: "LINES",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LINES"
    },
    LINE_STRIP: {
      signature: "LINE_STRIP",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LINE_STRIP"
    },
    LINE_LOOP: {
      signature: "LINE_LOOP",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LINE_LOOP"
    },
    TRIANGLES: {
      signature: "TRIANGLES",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TRIANGLES"
    },
    TRIANGLE_FAN: {
      signature: "TRIANGLE_FAN",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TRIANGLE_FAN"
    },
    TRIANGLE_STRIP: {
      signature: "TRIANGLE_STRIP",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TRIANGLE_STRIP"
    },
    QUADS: {
      signature: "QUADS",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/QUADS"
    },
    QUAD_STRIP: {
      signature: "QUAD_STRIP",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/QUAD_STRIP"
    },
    TESS: {
      signature: "TESS",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TESS"
    },
    CLOSE: {
      signature: "CLOSE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CLOSE"
    },
    OPEN: {
      signature: "OPEN",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/OPEN"
    },
    CHORD: {
      signature: "CHORD",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CHORD"
    },
    PIE: {
      signature: "PIE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/PIE"
    },
    PROJECT: {
      signature: "PROJECT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/PROJECT"
    },
    SQUARE: {
      signature: "SQUARE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/SQUARE"
    },
    ROUND: {
      signature: "ROUND",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ROUND"
    },
    BEVEL: {
      signature: "BEVEL",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BEVEL"
    },
    MITER: {
      signature: "MITER",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/MITER"
    },
    RGB: {
      signature: "RGB",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RGB"
    },
    HSB: {
      signature: "HSB",
      description: "HSB (hue, saturation, brightness) is a type of color model.",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/HSB"
    },
    HSL: {
      signature: "HSL",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/HSL"
    },
    AUTO: {
      signature: "AUTO",
      description: "AUTO allows us to automatically set the width or height of an element (but not both), based on the current height and width of the element.",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/AUTO"
    },
    ALT: {
      signature: "ALT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ALT"
    },
    BACKSPACE: {
      signature: "BACKSPACE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BACKSPACE"
    },
    CONTROL: {
      signature: "CONTROL",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CONTROL"
    },
    DELETE: {
      signature: "DELETE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DELETE"
    },
    DOWN_ARROW: {
      signature: "DOWN_ARROW",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DOWN_ARROW"
    },
    ENTER: {
      signature: "ENTER",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ENTER"
    },
    ESCAPE: {
      signature: "ESCAPE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ESCAPE"
    },
    LEFT_ARROW: {
      signature: "LEFT_ARROW",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LEFT_ARROW"
    },
    OPTION: {
      signature: "OPTION",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/OPTION"
    },
    RETURN: {
      signature: "RETURN",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RETURN"
    },
    RIGHT_ARROW: {
      signature: "RIGHT_ARROW",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RIGHT_ARROW"
    },
    SHIFT: {
      signature: "SHIFT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/SHIFT"
    },
    TAB: {
      signature: "TAB",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TAB"
    },
    UP_ARROW: {
      signature: "UP_ARROW",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/UP_ARROW"
    },
    BLEND: {
      signature: "BLEND",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BLEND"
    },
    REMOVE: {
      signature: "REMOVE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/REMOVE"
    },
    ADD: {
      signature: "ADD",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ADD"
    },
    DARKEST: {
      signature: "DARKEST",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DARKEST"
    },
    LIGHTEST: {
      signature: "LIGHTEST",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LIGHTEST"
    },
    DIFFERENCE: {
      signature: "DIFFERENCE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DIFFERENCE"
    },
    SUBTRACT: {
      signature: "SUBTRACT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/SUBTRACT"
    },
    EXCLUSION: {
      signature: "EXCLUSION",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/EXCLUSION"
    },
    MULTIPLY: {
      signature: "MULTIPLY",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/MULTIPLY"
    },
    SCREEN: {
      signature: "SCREEN",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/SCREEN"
    },
    REPLACE: {
      signature: "REPLACE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/REPLACE"
    },
    OVERLAY: {
      signature: "OVERLAY",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/OVERLAY"
    },
    HARD_LIGHT: {
      signature: "HARD_LIGHT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/HARD_LIGHT"
    },
    SOFT_LIGHT: {
      signature: "SOFT_LIGHT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/SOFT_LIGHT"
    },
    DODGE: {
      signature: "DODGE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DODGE"
    },
    BURN: {
      signature: "BURN",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BURN"
    },
    THRESHOLD: {
      signature: "THRESHOLD",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/THRESHOLD"
    },
    GRAY: {
      signature: "GRAY",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/GRAY"
    },
    OPAQUE: {
      signature: "OPAQUE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/OPAQUE"
    },
    INVERT: {
      signature: "INVERT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/INVERT"
    },
    POSTERIZE: {
      signature: "POSTERIZE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/POSTERIZE"
    },
    DILATE: {
      signature: "DILATE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/DILATE"
    },
    ERODE: {
      signature: "ERODE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ERODE"
    },
    BLUR: {
      signature: "BLUR",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BLUR"
    },
    NORMAL: {
      signature: "NORMAL",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/NORMAL"
    },
    ITALIC: {
      signature: "ITALIC",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/ITALIC"
    },
    BOLD: {
      signature: "BOLD",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BOLD"
    },
    BOLDITALIC: {
      signature: "BOLDITALIC",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BOLDITALIC"
    },
    CHAR: {
      signature: "CHAR",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CHAR"
    },
    WORD: {
      signature: "WORD",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/WORD"
    },
    LINEAR: {
      signature: "LINEAR",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LINEAR"
    },
    QUADRATIC: {
      signature: "QUADRATIC",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/QUADRATIC"
    },
    BEZIER: {
      signature: "BEZIER",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/BEZIER"
    },
    CURVE: {
      signature: "CURVE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CURVE"
    },
    STROKE: {
      signature: "STROKE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/STROKE"
    },
    FILL: {
      signature: "FILL",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/FILL"
    },
    TEXTURE: {
      signature: "TEXTURE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/TEXTURE"
    },
    IMMEDIATE: {
      signature: "IMMEDIATE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/IMMEDIATE"
    },
    IMAGE: {
      signature: "IMAGE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/IMAGE"
    },
    NEAREST: {
      signature: "NEAREST",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/NEAREST"
    },
    REPEAT: {
      signature: "REPEAT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/REPEAT"
    },
    CLAMP: {
      signature: "CLAMP",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CLAMP"
    },
    MIRROR: {
      signature: "MIRROR",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/MIRROR"
    },
    FLAT: {
      signature: "FLAT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/FLAT"
    },
    SMOOTH: {
      signature: "SMOOTH",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/SMOOTH"
    },
    LANDSCAPE: {
      signature: "LANDSCAPE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LANDSCAPE"
    },
    PORTRAIT: {
      signature: "PORTRAIT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/PORTRAIT"
    },
    GRID: {
      signature: "GRID",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/GRID"
    },
    AXES: {
      signature: "AXES",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/AXES"
    },
    LABEL: {
      signature: "LABEL",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/LABEL"
    },
    FALLBACK: {
      signature: "FALLBACK",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/FALLBACK"
    },
    CONTAIN: {
      signature: "CONTAIN",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/CONTAIN"
    },
    COVER: {
      signature: "COVER",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/COVER"
    },
    UNSIGNED_BYTE: {
      signature: "UNSIGNED_BYTE",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/UNSIGNED_BYTE"
    },
    UNSIGNED_INT: {
      signature: "UNSIGNED_INT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/UNSIGNED_INT"
    },
    FLOAT: {
      signature: "FLOAT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/FLOAT"
    },
    HALF_FLOAT: {
      signature: "HALF_FLOAT",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/HALF_FLOAT"
    },
    RGBA: {
      signature: "RGBA",
      description: "",
      kind: "variable",
      category: "Constants",
      sourceUrl: "https://p5js.org/reference/#/p5/RGBA"
    },
    print: {
      signature: "print(contents: Any)",
      description: "Displays text in the web browser's console.",
      example: "print('hello, world')",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/print"
    },
    frameCount: {
      signature: "frameCount",
      description: "A `Number` variable that tracks the number of frames drawn since the sketch started.",
      example: "text(frameCount, 50, 50)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/frameCount"
    },
    deltaTime: {
      signature: "deltaTime",
      description: "A `Number` variable that tracks the number of milliseconds it took to draw the last frame.",
      example: "let deltaX = speed * deltaTime",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/deltaTime"
    },
    focused: {
      signature: "focused",
      description: "A `Boolean` variable that's `true` if the browser is focused and `false` if not.",
      example: "if (focused === true) {",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/focused"
    },
    cursor: {
      signature: "cursor(type: String|Constant, x?: Number, y?: Number)",
      description: "Changes the cursor's appearance.",
      example: "cursor(CROSS)",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/cursor"
    },
    frameRate: {
      signature: "frameRate(fps: Number)",
      description: "Sets the number of frames to draw per second.",
      example: "frameRate(10)",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/frameRate"
    },
    getTargetFrameRate: {
      signature: "getTargetFrameRate()",
      description: "Returns the target frame rate.",
      example: "let fps = getTargetFrameRate()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/getTargetFrameRate"
    },
    noCursor: {
      signature: "noCursor()",
      description: "Hides the cursor from view.",
      example: "noCursor()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/noCursor"
    },
    webglVersion: {
      signature: "webglVersion",
      description: "A `String` variable with the WebGL version in use.",
      example: "text(webglVersion, 42, 54)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/webglVersion"
    },
    displayWidth: {
      signature: "displayWidth",
      description: "A `Number` variable that stores the width of the screen display.",
      example: "createCanvas(displayWidth, displayHeight)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/displayWidth"
    },
    displayHeight: {
      signature: "displayHeight",
      description: "A `Number` variable that stores the height of the screen display.",
      example: "createCanvas(displayWidth, displayHeight)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/displayHeight"
    },
    windowWidth: {
      signature: "windowWidth",
      description: "A `Number` variable that stores the width of the browser's viewport.",
      example: "createCanvas(windowWidth, windowHeight)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/windowWidth"
    },
    windowHeight: {
      signature: "windowHeight",
      description: "A `Number` variable that stores the height of the browser's viewport.",
      example: "createCanvas(windowWidth, windowHeight)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/windowHeight"
    },
    windowResized: {
      signature: "windowResized(event?: Event)",
      description: "A function that's called when the browser window is resized.",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/windowResized"
    },
    width: {
      signature: "width",
      description: "A `Number` variable that stores the width of the canvas in pixels.",
      example: "text(width, 42, 54)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/width"
    },
    height: {
      signature: "height",
      description: "A `Number` variable that stores the height of the canvas in pixels.",
      example: "text(height, 42, 54)",
      kind: "variable",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/height"
    },
    fullscreen: {
      signature: "fullscreen(val?: Boolean)",
      description: "Toggles full-screen mode or returns the current mode.",
      example: "let fs = fullscreen()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/fullscreen"
    },
    pixelDensity: {
      signature: "pixelDensity(val?: Number)",
      description: "Sets the pixel density or returns the current density.",
      example: "pixelDensity(1)",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/pixelDensity"
    },
    displayDensity: {
      signature: "displayDensity()",
      description: "Returns the display's current pixel density.",
      example: "let d = displayDensity()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/displayDensity"
    },
    getURL: {
      signature: "getURL()",
      description: "Returns the sketch's current URL as a `String`.",
      example: "let url = getURL()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/getURL"
    },
    getURLPath: {
      signature: "getURLPath()",
      description: "Returns the current URL path as an `Array` of `String`s.",
      example: "let path = getURLPath()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/getURLPath"
    },
    getURLParams: {
      signature: "getURLParams()",
      description: "Returns the current URL parameters in an `Object`.",
      example: "let params = getURLParams()",
      kind: "function",
      category: "Environment",
      sourceUrl: "https://p5js.org/reference/#/p5/getURLParams"
    },
    preload: {
      signature: "preload()",
      description: "A function that's called once to load assets before the sketch runs.",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/preload"
    },
    setup: {
      signature: "setup()",
      description: "A function that's called once when the sketch begins running.",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/setup"
    },
    draw: {
      signature: "draw()",
      description: "A function that's called repeatedly while the sketch runs.",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/draw"
    },
    remove: {
      signature: "remove()",
      description: "Removes the sketch from the web page.",
      example: "remove()",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/remove"
    },
    disableFriendlyErrors: {
      signature: "disableFriendlyErrors",
      description: "Turns off the parts of the Friendly Error System (FES) that impact performance.",
      kind: "variable",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/disableFriendlyErrors"
    },
    let: {
      signature: "let",
      description: "Declares a new variable.",
      example: "let message = 'Hello, \u{1F30D}!'",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/let"
    },
    if: {
      signature: "if",
      description: "A way to choose whether to run a block of code.",
      example: "if (mouseIsPressed === true) {",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/if"
    },
    function: {
      signature: "function",
      description: "A named group of statements.",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/function"
    },
    Boolean: {
      signature: "Boolean",
      description: "A value that's either `true` or `false`.",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/Boolean"
    },
    String: {
      signature: "String",
      description: "A sequence of text characters.",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/String"
    },
    Number: {
      signature: "Number",
      description: "A number that can be positive, negative, or zero.",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/Number"
    },
    Object: {
      signature: "Object",
      description: "A container for data that's stored as key-value pairs.",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/Object"
    },
    Array: {
      signature: "Array",
      description: "A list that keeps several pieces of data in order.",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/Array"
    },
    class: {
      signature: "class",
      description: "A template for creating objects of a particular type.",
      example: "class Frog {",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/class"
    },
    for: {
      signature: "for",
      description: "A way to repeat a block of code when the number of iterations is known.",
      example: "for (let x = 10; x < 100; x += 20) {",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/for"
    },
    while: {
      signature: "while",
      description: "A way to repeat a block of code.",
      example: "while (x < 100) {",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/while"
    },
    console: {
      signature: "console",
      description: "Prints a message to the web browser's console.",
      example: "console.log('Hello!')",
      kind: "variable",
      category: "Foundation",
      sourceUrl: "https://p5js.org/reference/#/p5/console"
    },
    createCanvas: {
      signature: "createCanvas(width?: Number, height?: Number, renderer?: Constant, canvas?: HTMLCanvasElement)",
      description: "Creates a canvas element on the web page.",
      example: "createCanvas(100, 100)",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/createCanvas"
    },
    resizeCanvas: {
      signature: "resizeCanvas(width: Number, height: Number, noRedraw?: Boolean)",
      description: "Resizes the canvas to a given width and height.",
      example: "resizeCanvas(50, 50)",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/resizeCanvas"
    },
    noCanvas: {
      signature: "noCanvas()",
      description: "Removes the default canvas.",
      example: "noCanvas()",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/noCanvas"
    },
    createGraphics: {
      signature: "createGraphics(width: Number, height: Number, renderer?: Constant, canvas?: HTMLCanvasElement)",
      description: "Creates a p5.",
      example: "pg = createGraphics(50, 50)",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/createGraphics"
    },
    createFramebuffer: {
      signature: "createFramebuffer(options?: Object)",
      description: "Creates and a new p5.",
      example: "myBuffer = createFramebuffer()",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/createFramebuffer"
    },
    clearDepth: {
      signature: "clearDepth(depth?: Number)",
      description: "Clears the depth buffer in WebGL mode.",
      example: "clearDepth()",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/clearDepth"
    },
    blendMode: {
      signature: "blendMode(mode: Constant)",
      description: "Sets the way colors blend when added to the canvas.",
      example: "blendMode(BLEND)",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/blendMode"
    },
    drawingContext: {
      signature: "drawingContext",
      description: "A system variable that provides direct access to the sketch's `&lt;canvas&gt;` element.",
      example: "drawingContext.shadowOffsetX = 5",
      kind: "variable",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/drawingContext"
    },
    noLoop: {
      signature: "noLoop()",
      description: "Stops the code in draw() from running repeatedly.",
      example: "noLoop()",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/noLoop"
    },
    loop: {
      signature: "loop()",
      description: "Resumes the draw loop after noLoop() has been called.",
      example: "loop()",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/loop"
    },
    isLooping: {
      signature: "isLooping()",
      description: "Returns `true` if the draw loop is running and `false` if not.",
      example: "if (isLooping() === true) {",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/isLooping"
    },
    push: {
      signature: "push()",
      description: "Begins a drawing group that contains its own styles and transformations.",
      example: "push()",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/push"
    },
    pop: {
      signature: "pop()",
      description: "Ends a drawing group that contains its own styles and transformations.",
      example: "pop()",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/pop"
    },
    redraw: {
      signature: "redraw(n?: Integer)",
      description: "Runs the code in draw() once.",
      example: "redraw()",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/redraw"
    },
    p5: {
      signature: "p5(sketch: Object, node: String|HTMLElement)",
      description: 'Creates a new sketch in "instance" mode.',
      example: "new p5(sketch)",
      kind: "function",
      category: "Structure",
      sourceUrl: "https://p5js.org/reference/#/p5/p5"
    },
    applyMatrix: {
      signature: "applyMatrix(arr: Array)",
      description: "Applies a transformation matrix to the coordinate system.",
      example: "applyMatrix(1, 0, 0, 1, 50, 50)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/applyMatrix"
    },
    resetMatrix: {
      signature: "resetMatrix()",
      description: "Clears all transformations applied to the coordinate system.",
      example: "resetMatrix()",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/resetMatrix"
    },
    rotate: {
      signature: "rotate(angle: Number, axis?: p5.Vector|Number[])",
      description: "Rotates the coordinate system.",
      example: "rotate(QUARTER_PI)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/rotate"
    },
    rotateX: {
      signature: "rotateX(angle: Number)",
      description: "Rotates the coordinate system about the x-axis in WebGL mode.",
      example: "rotateX(QUARTER_PI)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/rotateX"
    },
    rotateY: {
      signature: "rotateY(angle: Number)",
      description: "Rotates the coordinate system about the y-axis in WebGL mode.",
      example: "rotateY(QUARTER_PI)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/rotateY"
    },
    rotateZ: {
      signature: "rotateZ(angle: Number)",
      description: "Rotates the coordinate system about the z-axis in WebGL mode.",
      example: "rotateZ(QUARTER_PI)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/rotateZ"
    },
    scale: {
      signature: "scale(s: Number|p5.Vector|Number[], y?: Number, z?: Number)",
      description: "Scales the coordinate system.",
      example: "scale(0.5)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/scale"
    },
    shearX: {
      signature: "shearX(angle: Number)",
      description: "Shears the x-axis so that shapes appear skewed.",
      example: "shearX(QUARTER_PI)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/shearX"
    },
    shearY: {
      signature: "shearY(angle: Number)",
      description: "Shears the y-axis so that shapes appear skewed.",
      example: "shearY(QUARTER_PI)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/shearY"
    },
    translate: {
      signature: "translate(x: Number, y: Number, z?: Number)",
      description: "Translates the coordinate system.",
      example: "translate(50, 50)",
      kind: "function",
      category: "Transform",
      sourceUrl: "https://p5js.org/reference/#/p5/translate"
    },
    storeItem: {
      signature: "storeItem(key: String, value: String|Number|Boolean|Object|Array)",
      description: "Stores a value in the web browser's local storage.",
      example: "storeItem('name', 'Feist')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/storeItem"
    },
    getItem: {
      signature: "getItem(key: String)",
      description: "Returns a value in the web browser's local storage.",
      example: "let name = getItem('name')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/getItem"
    },
    clearStorage: {
      signature: "clearStorage()",
      description: "Removes all items in the web browser's local storage.",
      example: "clearStorage()",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/clearStorage"
    },
    removeItem: {
      signature: "removeItem(key: String)",
      description: "Removes an item from the web browser's local storage.",
      example: "removeItem('score')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/removeItem"
    },
    createStringDict: {
      signature: "createStringDict(key: String, value: String)",
      description: "Creates a new instance of p5.",
      example: "let myDictionary = createStringDict('p5', 'js')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/createStringDict"
    },
    createNumberDict: {
      signature: "createNumberDict(key: Number, value: Number)",
      description: "Creates a new instance of p5.",
      example: "let myDictionary = createNumberDict(100, 42)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/createNumberDict"
    },
    select: {
      signature: "select(selectors: String, container?: String|p5.Element|HTMLElement)",
      description: "Searches the page for the first element that matches the given CSS selector string.",
      example: "let cnv = select('canvas')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/select"
    },
    selectAll: {
      signature: "selectAll(selectors: String, container?: String|p5.Element|HTMLElement)",
      description: "Searches the page for all elements that matches the given CSS selector string.",
      example: "let buttons = selectAll('button')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/selectAll"
    },
    removeElements: {
      signature: "removeElements()",
      description: "Removes all elements created by p5.",
      example: "removeElements()",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/removeElements"
    },
    changed: {
      signature: "changed(fxn: Function|Boolean)",
      description: "Calls a function when the element changes.",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/changed"
    },
    input: {
      signature: "input(fxn: Function|Boolean)",
      description: "Calls a function when the element receives input.",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/input"
    },
    createDiv: {
      signature: "createDiv(html?: String)",
      description: "Creates a `&lt;div&gt;&lt;/div&gt;` element.",
      example: "let div = createDiv('p5*js')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createDiv"
    },
    createP: {
      signature: "createP(html?: String)",
      description: "Creates a paragraph element.",
      example: "let p = createP('Tell me a story.')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createP"
    },
    createSpan: {
      signature: "createSpan(html?: String)",
      description: "Creates a `&lt;span&gt;&lt;/span&gt;` element.",
      example: "let span = createSpan('p5*js')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createSpan"
    },
    createImg: {
      signature: "createImg(src: String, alt: String)",
      description: "Creates an `&lt;img&gt;` element that can appear outside of the canvas.",
      example: "let img = createImg(",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createImg"
    },
    createA: {
      signature: "createA(href: String, html: String, target?: String)",
      description: "Creates an `&lt;a&gt;&lt;/a&gt;` element that links to another web page.",
      example: "let a = createA('https://p5js.org/', 'p5*js')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createA"
    },
    createSlider: {
      signature: "createSlider(min: Number, max: Number, value?: Number, step?: Number)",
      description: "Creates a slider `&lt;input&gt;&lt;/input&gt;` element.",
      example: "slider = createSlider(0, 255)",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createSlider"
    },
    createButton: {
      signature: "createButton(label: String, value?: String)",
      description: "Creates a `&lt;button&gt;&lt;/button&gt;` element.",
      example: "let button = createButton('click me')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createButton"
    },
    createCheckbox: {
      signature: "createCheckbox(label?: String, value?: Boolean)",
      description: "Creates a checkbox `&lt;input&gt;&lt;/input&gt;` element.",
      example: "checkbox = createCheckbox()",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createCheckbox"
    },
    createSelect: {
      signature: "createSelect(multiple?: Boolean)",
      description: "Creates a dropdown menu `&lt;select&gt;&lt;/select&gt;` element.",
      example: "mySelect = createSelect()",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createSelect"
    },
    createRadio: {
      signature: "createRadio(containerElement?: Object)",
      description: "Creates a radio button element.",
      example: "myRadio = createRadio()",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createRadio"
    },
    createColorPicker: {
      signature: "createColorPicker(value?: String|p5.Color)",
      description: "Creates a color picker element.",
      example: "myPicker = createColorPicker('deeppink')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createColorPicker"
    },
    createInput: {
      signature: "createInput(value?: String, type?: String)",
      description: "Creates a text `&lt;input&gt;&lt;/input&gt;` element.",
      example: "myInput = createInput()",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createInput"
    },
    createFileInput: {
      signature: "createFileInput(callback: Function, multiple?: Boolean)",
      description: "Creates an `&lt;input&gt;&lt;/input&gt;` element of type `'file'`.",
      example: "input = createFileInput(handleImage)",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createFileInput"
    },
    createVideo: {
      signature: "createVideo(src: String|String[], callback?: Function)",
      description: "Creates a `&lt;video&gt;` element for simple audio/video playback.",
      example: "let video = createVideo('assets/small.mp4')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createVideo"
    },
    createAudio: {
      signature: "createAudio(src?: String|String[], callback?: Function)",
      description: "Creates a hidden `&lt;audio&gt;` element for simple audio playback.",
      example: "let beat = createAudio('assets/beat.mp3')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createAudio"
    },
    createCapture: {
      signature: "createCapture(type?: String|Constant|Object, flipped?: Object, callback?: Function)",
      description: 'Creates a `&lt;video&gt;` element that "captures" the audio/video stream from the webcam and microphone.',
      example: "createCapture(VIDEO)",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createCapture"
    },
    createElement: {
      signature: "createElement(tag: String, content?: String)",
      description: "Creates a new p5.",
      example: "createElement('h5')",
      kind: "function",
      category: "DOM",
      sourceUrl: "https://p5js.org/reference/#/p5/createElement"
    },
    deviceOrientation: {
      signature: "deviceOrientation",
      description: "The system variable deviceOrientation always contains the orientation of the device.",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/deviceOrientation"
    },
    accelerationX: {
      signature: "accelerationX",
      description: "The system variable accelerationX always contains the acceleration of the device along the x axis.",
      example: "ellipse(width / 2, height / 2, accelerationX)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/accelerationX"
    },
    accelerationY: {
      signature: "accelerationY",
      description: "The system variable accelerationY always contains the acceleration of the device along the y axis.",
      example: "ellipse(width / 2, height / 2, accelerationY)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/accelerationY"
    },
    accelerationZ: {
      signature: "accelerationZ",
      description: "The system variable accelerationZ always contains the acceleration of the device along the z axis.",
      example: "ellipse(width / 2, height / 2, accelerationZ)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/accelerationZ"
    },
    pAccelerationX: {
      signature: "pAccelerationX",
      description: "The system variable pAccelerationX always contains the acceleration of the device along the x axis in the frame previous to the current frame.",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pAccelerationX"
    },
    pAccelerationY: {
      signature: "pAccelerationY",
      description: "The system variable pAccelerationY always contains the acceleration of the device along the y axis in the frame previous to the current frame.",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pAccelerationY"
    },
    pAccelerationZ: {
      signature: "pAccelerationZ",
      description: "The system variable pAccelerationZ always contains the acceleration of the device along the z axis in the frame previous to the current frame.",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pAccelerationZ"
    },
    rotationX: {
      signature: "rotationX",
      description: "The system variable rotationX always contains the rotation of the device along the x axis.",
      example: "rotateX(radians(rotationX))",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/rotationX"
    },
    rotationY: {
      signature: "rotationY",
      description: "The system variable rotationY always contains the rotation of the device along the y axis.",
      example: "rotateY(radians(rotationY))",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/rotationY"
    },
    rotationZ: {
      signature: "rotationZ",
      description: "The system variable rotationZ always contains the rotation of the device along the z axis.",
      example: "rotateZ(radians(rotationZ))",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/rotationZ"
    },
    pRotationX: {
      signature: "pRotationX",
      description: "The system variable pRotationX always contains the rotation of the device along the x axis in the frame previous to the current frame.",
      example: "let pRX = pRotationX + 180",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pRotationX"
    },
    pRotationY: {
      signature: "pRotationY",
      description: "The system variable pRotationY always contains the rotation of the device along the y axis in the frame previous to the current frame.",
      example: "let pRY = pRotationY + 180",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pRotationY"
    },
    pRotationZ: {
      signature: "pRotationZ",
      description: "The system variable pRotationZ always contains the rotation of the device along the z axis in the frame previous to the current frame.",
      example: "(rotationZ - pRotationZ > 0 && rotationZ - pRotationZ < 270) ||",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pRotationZ"
    },
    turnAxis: {
      signature: "turnAxis",
      description: "When a device is rotated, the axis that triggers the deviceTurned() method is stored in the turnAxis variable.",
      example: "if (turnAxis === 'X') {",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/turnAxis"
    },
    setMoveThreshold: {
      signature: "setMoveThreshold(value: Number)",
      description: "The setMoveThreshold() function is used to set the movement threshold for the deviceMoved() function.",
      example: "setMoveThreshold(threshold)",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/setMoveThreshold"
    },
    setShakeThreshold: {
      signature: "setShakeThreshold(value: Number)",
      description: "The setShakeThreshold() function is used to set the movement threshold for the deviceShaken() function.",
      example: "setShakeThreshold(threshold)",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/setShakeThreshold"
    },
    deviceMoved: {
      signature: "deviceMoved()",
      description: "The deviceMoved() function is called when the device is moved by more than the threshold value along X, Y or Z axis.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/deviceMoved"
    },
    deviceTurned: {
      signature: "deviceTurned()",
      description: "The deviceTurned() function is called when the device rotates by more than 90 degrees continuously.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/deviceTurned"
    },
    deviceShaken: {
      signature: "deviceShaken()",
      description: "The deviceShaken() function is called when the device total acceleration changes of accelerationX and accelerationY values is more than the threshold value.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/deviceShaken"
    },
    keyIsPressed: {
      signature: "keyIsPressed",
      description: "A `Boolean` system variable that's `true` if any key is currently pressed and `false` if not.",
      example: "if (keyIsPressed === true) {",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/keyIsPressed"
    },
    key: {
      signature: "key",
      description: "A `String` system variable that contains the value of the last key typed.",
      example: "'A gray square. The last key pressed is displayed at the center.'",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/key"
    },
    keyCode: {
      signature: "keyCode",
      description: "A `Number` system variable that contains the code of the last key typed.",
      example: "text(`${key} : ${keyCode}`, 50, 50)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/keyCode"
    },
    keyPressed: {
      signature: "keyPressed(event?: KeyboardEvent)",
      description: "A function that's called once when any key is pressed.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/keyPressed"
    },
    keyReleased: {
      signature: "keyReleased(event?: KeyboardEvent)",
      description: "A function that's called once when any key is released.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/keyReleased"
    },
    keyTyped: {
      signature: "keyTyped(event?: KeyboardEvent)",
      description: "A function that's called once when keys with printable characters are pressed.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/keyTyped"
    },
    keyIsDown: {
      signature: "keyIsDown(code: Number)",
      description: "Returns `true` if the key it\u2019s checking is pressed and `false` if not.",
      example: "if (keyIsDown(LEFT_ARROW) === true) {",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/keyIsDown"
    },
    movedX: {
      signature: "movedX",
      description: "A `Number` system variable that tracks the mouse's horizontal movement.",
      example: "if (movedX > 0) {",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/movedX"
    },
    movedY: {
      signature: "movedY",
      description: "A `Number` system variable that tracks the mouse's vertical movement.",
      example: "if (movedY > 0) {",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/movedY"
    },
    mouseX: {
      signature: "mouseX",
      description: "A `Number` system variable that tracks the mouse's horizontal position.",
      example: "line(mouseX, 0, mouseX, 100)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseX"
    },
    mouseY: {
      signature: "mouseY",
      description: "A `Number` system variable that tracks the mouse's vertical position.",
      example: "line(0, mouseY, 100, mouseY)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseY"
    },
    pmouseX: {
      signature: "pmouseX",
      description: "A `Number` system variable that tracks the mouse's previous horizontal position.",
      example: "line(pmouseX, pmouseY, mouseX, mouseY)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pmouseX"
    },
    pmouseY: {
      signature: "pmouseY",
      description: "A `Number` system variable that tracks the mouse's previous vertical position.",
      example: "line(pmouseX, pmouseY, mouseX, mouseY)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pmouseY"
    },
    winMouseX: {
      signature: "winMouseX",
      description: "A `Number` variable that tracks the mouse's horizontal position within the browser.",
      example: "text(`x: ${winMouseX} y: ${winMouseY}`, 50, 50)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/winMouseX"
    },
    winMouseY: {
      signature: "winMouseY",
      description: "A `Number` variable that tracks the mouse's vertical position within the browser.",
      example: "text(`x: ${winMouseX} y: ${winMouseY}`, 50, 50)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/winMouseY"
    },
    pwinMouseX: {
      signature: "pwinMouseX",
      description: "A `Number` variable that tracks the mouse's previous horizontal position within the browser.",
      example: "let d = winMouseX - pwinMouseX",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pwinMouseX"
    },
    pwinMouseY: {
      signature: "pwinMouseY",
      description: "A `Number` variable that tracks the mouse's previous vertical position within the browser.",
      example: "let d = winMouseY - pwinMouseY",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/pwinMouseY"
    },
    mouseButton: {
      signature: "mouseButton",
      description: "A String system variable that contains the value of the last mouse button pressed.",
      example: "text(mouseButton, 50, 50)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseButton"
    },
    mouseIsPressed: {
      signature: "mouseIsPressed",
      description: "A `Boolean` system variable that's `true` if the mouse is pressed and `false` if not.",
      example: "text(mouseIsPressed, 25, 50)",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseIsPressed"
    },
    mouseMoved: {
      signature: "mouseMoved(event?: MouseEvent)",
      description: "A function that's called when the mouse moves.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseMoved"
    },
    mouseDragged: {
      signature: "mouseDragged(event?: MouseEvent)",
      description: "A function that's called when the mouse moves while a button is pressed.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseDragged"
    },
    mousePressed: {
      signature: "mousePressed(event?: MouseEvent)",
      description: "A function that's called once when a mouse button is pressed.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mousePressed"
    },
    mouseReleased: {
      signature: "mouseReleased(event?: MouseEvent)",
      description: "A function that's called once when a mouse button is released.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseReleased"
    },
    mouseClicked: {
      signature: "mouseClicked(event?: MouseEvent)",
      description: "A function that's called once after a mouse button is pressed and released.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseClicked"
    },
    doubleClicked: {
      signature: "doubleClicked(event?: MouseEvent)",
      description: "A function that's called once when a mouse button is clicked twice quickly.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/doubleClicked"
    },
    mouseWheel: {
      signature: "mouseWheel(event?: WheelEvent)",
      description: "A function that's called once when the mouse wheel moves.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/mouseWheel"
    },
    requestPointerLock: {
      signature: "requestPointerLock()",
      description: "Locks the mouse pointer to its current position and makes it invisible.",
      example: "requestPointerLock()",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/requestPointerLock"
    },
    exitPointerLock: {
      signature: "exitPointerLock()",
      description: "Exits a pointer lock started with requestPointerLock.",
      example: "exitPointerLock()",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/exitPointerLock"
    },
    touches: {
      signature: "touches",
      description: "An `Array` of all the current touch points on a touchscreen device.",
      example: "'A gray square. White circles appear where the user touches the square.'",
      kind: "variable",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/touches"
    },
    touchStarted: {
      signature: "touchStarted(event?: TouchEvent)",
      description: "A function that's called once each time the user touches the screen.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/touchStarted"
    },
    touchMoved: {
      signature: "touchMoved(event?: TouchEvent)",
      description: "A function that's called when the user touches the screen and moves.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/touchMoved"
    },
    touchEnded: {
      signature: "touchEnded(event?: TouchEvent)",
      description: "A function that's called once each time a screen touch ends.",
      kind: "function",
      category: "Events",
      sourceUrl: "https://p5js.org/reference/#/p5/touchEnded"
    },
    createImage: {
      signature: "createImage(width: Integer, height: Integer)",
      description: "Creates a new p5.",
      example: "let img = createImage(66, 66)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/createImage"
    },
    saveCanvas: {
      signature: "saveCanvas(selectedCanvas: p5.Framebuffer|p5.Element|HTMLCanvasElement, filename?: String, extension?: String)",
      description: "Saves the current canvas as an image.",
      example: "saveCanvas()",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/saveCanvas"
    },
    saveFrames: {
      signature: "saveFrames(filename: String, extension: String, duration: Number, framerate: Number, callback?: Function(Array))",
      description: "Captures a sequence of frames from the canvas that can be saved as images.",
      example: "saveFrames('frame', 'png', 1, 5)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/saveFrames"
    },
    loadImage: {
      signature: "loadImage(path: String, successCallback?: function(p5.Image), failureCallback?: Function(Event))",
      description: "Loads an image to create a p5.",
      example: "img = loadImage('assets/laDefense.jpg')",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/loadImage"
    },
    saveGif: {
      signature: "saveGif(filename: String, duration: Number, options?: Object)",
      description: "Generates a gif from a sketch and saves it to a file.",
      example: "saveGif('mySketch', 5)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/saveGif"
    },
    image: {
      signature: "image(img: p5.Image|p5.Element|p5.Texture|p5.Framebuffer|p5.FramebufferTexture, x: Number, y: Number, width?: Number, height?: Number)",
      description: "Draws an image to the canvas.",
      example: "image(img, 0, 0)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/image"
    },
    tint: {
      signature: "tint(v1: Number, v2: Number, v3: Number, alpha?: Number)",
      description: "Tints images using a color.",
      example: "tint('red')",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/tint"
    },
    noTint: {
      signature: "noTint()",
      description: "Removes the current tint set by tint().",
      example: "noTint()",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/noTint"
    },
    imageMode: {
      signature: "imageMode(mode: Constant)",
      description: "Changes the location from which images are drawn when image() is called.",
      example: "imageMode(CORNER)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/imageMode"
    },
    pixels: {
      signature: "pixels",
      description: "An array containing the color of each pixel on the canvas.",
      example: "pixels[index] = 0",
      kind: "variable",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/pixels"
    },
    blend: {
      signature: "blend(srcImage: p5.Image, sx: Integer, sy: Integer, sw: Integer, sh: Integer, dx: Integer, dy: Integer, dw: Integer, dh: Integer, blendMode: Constant)",
      description: "Copies a region of pixels from one image to another.",
      example: "blend(img1, 0, 0, 33, 100, 67, 0, 33, 100, LIGHTEST)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/blend"
    },
    copy: {
      signature: "copy(srcImage: p5.Image|p5.Element, sx: Integer, sy: Integer, sw: Integer, sh: Integer, dx: Integer, dy: Integer, dw: Integer, dh: Integer)",
      description: "Copies pixels from a source image to a region of the canvas.",
      example: "copy(img, 7, 22, 10, 10, 35, 25, 50, 50)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/copy"
    },
    filter: {
      signature: "filter(filterType: Constant, filterParam?: Number, useWebGL?: Boolean)",
      description: "Applies an image filter to the canvas.",
      example: "filter(INVERT)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/filter"
    },
    get: {
      signature: "get(x: Number, y: Number, w: Number, h: Number)",
      description: "Gets a pixel or a region of pixels from the canvas.",
      example: "let c = get()",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/get"
    },
    loadPixels: {
      signature: "loadPixels()",
      description: "Loads the current value of each pixel on the canvas into the pixels array.",
      example: "loadPixels()",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/loadPixels"
    },
    set: {
      signature: "set(x: Number, y: Number, c: Number|Number[]|Object)",
      description: "Sets the color of a pixel or draws an image to the canvas.",
      example: "set(30, 20, 0)",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/set"
    },
    updatePixels: {
      signature: "updatePixels(x?: Number, y?: Number, w?: Number, h?: Number)",
      description: "Updates the canvas with the RGBA values in the pixels array.",
      example: "updatePixels()",
      kind: "function",
      category: "Image",
      sourceUrl: "https://p5js.org/reference/#/p5/updatePixels"
    },
    loadJSON: {
      signature: "loadJSON(path: String, successCallback?: Function, errorCallback?: Function)",
      description: "Loads a JSON file to create an `Object`.",
      example: "myData = loadJSON('assets/data.json')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/loadJSON"
    },
    loadStrings: {
      signature: "loadStrings(path: String, successCallback?: Function, errorCallback?: Function)",
      description: "Loads a text file to create an `Array`.",
      example: "myData = loadStrings('assets/test.txt')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/loadStrings"
    },
    loadTable: {
      signature: "loadTable(filename: String, extension?: String, header?: String, callback?: Function, errorCallback?: Function)",
      description: "Reads the contents of a file or URL and creates a p5.",
      example: "table = loadTable('assets/mammals.csv', 'csv', 'header')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/loadTable"
    },
    loadXML: {
      signature: "loadXML(path: String, successCallback?: Function, errorCallback?: Function)",
      description: "Loads an XML file to create a p5.",
      example: "myXML = loadXML('assets/animals.xml')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/loadXML"
    },
    loadBytes: {
      signature: "loadBytes(file: String, callback?: Function, errorCallback?: Function)",
      description: "This method is suitable for fetching files up to size of 64MB.",
      example: "data = loadBytes('assets/mammals.xml')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/loadBytes"
    },
    httpGet: {
      signature: "httpGet(path: String, datatype?: String, data?: Object|Boolean, callback?: Function, errorCallback?: Function)",
      description: "Method for executing an HTTP GET request.",
      example: "httpGet(url, 'jsonp', false, function(response) {",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/httpGet"
    },
    httpPost: {
      signature: "httpPost(path: String, datatype?: String, data?: Object|Boolean, callback?: Function, errorCallback?: Function)",
      description: "Method for executing an HTTP POST request.",
      example: "httpPost(url, 'json', postData, function(result) {",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/httpPost"
    },
    httpDo: {
      signature: "httpDo(path: String, method?: String, datatype?: String, data?: Object, callback?: Function, errorCallback?: Function)",
      description: "Method for executing an HTTP request.",
      example: "httpDo(",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/httpDo"
    },
    createWriter: {
      signature: "createWriter(name: String, extension?: String)",
      description: "Creates a new p5.",
      example: "let myWriter = createWriter('xo.txt')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/createWriter"
    },
    save: {
      signature: "save(objectOrFilename?: Object|String, filename?: String, options?: Boolean|String)",
      description: "Saves a given element(image, text, json, csv, wav, or html) to the client's computer.",
      example: "save(cnv, 'myCanvas.jpg')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/save"
    },
    saveJSON: {
      signature: "saveJSON(json: Array|Object, filename: String, optimize?: Boolean)",
      description: "Saves an `Object` or `Array` to a JSON file.",
      example: "saveJSON(data, 'numbers.json')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/saveJSON"
    },
    saveStrings: {
      signature: "saveStrings(list: String[], filename: String, extension?: String, isCRLF?: Boolean)",
      description: "Saves an `Array` of `String`s to a file, one per line.",
      example: "saveStrings(data, 'data.txt')",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/saveStrings"
    },
    saveTable: {
      signature: "saveTable(Table: p5.Table, filename: String, options?: String)",
      description: "Writes the contents of a Table object to a file.",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/saveTable"
    },
    abs: {
      signature: "abs(n: Number)",
      description: "Calculates the absolute value of a number.",
      example: "let h = abs(mouseX - 50)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/abs"
    },
    ceil: {
      signature: "ceil(n: Number)",
      description: "Calculates the closest integer value that is greater than or equal to a number.",
      example: "r = ceil(r)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/ceil"
    },
    constrain: {
      signature: "constrain(n: Number, low: Number, high: Number)",
      description: "Constrains a number between a minimum and maximum value.",
      example: "let x = constrain(mouseX, 33, 67)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/constrain"
    },
    dist: {
      signature: "dist(x1: Number, y1: Number, x2: Number, y2: Number)",
      description: "Calculates the distance between two points.",
      example: "let d = dist(x1, y1, x2, y2)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/dist"
    },
    exp: {
      signature: "exp(n: Number)",
      description: "Calculates the value of Euler's number e (2.",
      example: "let d = exp(1)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/exp"
    },
    floor: {
      signature: "floor(n: Number)",
      description: "Calculates the closest integer value that is less than or equal to the value of a number.",
      example: "r = floor(r)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/floor"
    },
    lerp: {
      signature: "lerp(start: Number, stop: Number, amt: Number)",
      description: "Calculates a number between two numbers at a specific increment.",
      example: "let c = lerp(a, b, 0.2)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/lerp"
    },
    log: {
      signature: "log(n: Number)",
      description: "Calculates the natural logarithm (the base-e logarithm) of a number.",
      example: "let d = log(50)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/log"
    },
    mag: {
      signature: "mag(x: Number, y: Number)",
      description: "Calculates the magnitude, or length, of a vector.",
      example: "let m = mag(x, y)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/mag"
    },
    map: {
      signature: "map(value: Number, start1: Number, stop1: Number, start2: Number, stop2: Number, withinBounds?: Boolean)",
      description: "Re-maps a number from one range to another.",
      example: "let x = map(mouseX, 0, 100, 0, 50)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/map"
    },
    max: {
      signature: "max(n0: Number, n1: Number)",
      description: "Returns the largest value in a sequence of numbers.",
      example: "let m = max(10, 5, 20)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/max"
    },
    min: {
      signature: "min(n0: Number, n1: Number)",
      description: "Returns the smallest value in a sequence of numbers.",
      example: "let m = min(10, 5, 20)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/min"
    },
    norm: {
      signature: "norm(value: Number, start: Number, stop: Number)",
      description: "Maps a number from one range to a value between 0 and 1.",
      example: "let redValue = norm(mouseX, 0, 100)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/norm"
    },
    pow: {
      signature: "pow(n: Number, e: Number)",
      description: "Calculates exponential expressions such as 23.",
      example: "let d = pow(base, 1)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/pow"
    },
    round: {
      signature: "round(n: Number, decimals?: Number)",
      description: "Calculates the integer closest to a number.",
      example: "let x = round(4.2)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/round"
    },
    sq: {
      signature: "sq(n: Number)",
      description: "Calculates the square of a number.",
      example: "let d = sq(3)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/sq"
    },
    sqrt: {
      signature: "sqrt(n: Number)",
      description: "Calculates the square root of a number.",
      example: "let d = sqrt(16)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/sqrt"
    },
    fract: {
      signature: "fract(n: Number)",
      description: "Calculates the fractional part of a number.",
      example: "let f = fract(n)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/fract"
    },
    createVector: {
      signature: "createVector(x?: Number, y?: Number, z?: Number)",
      description: "Creates a new p5.",
      example: "let p1 = createVector(25, 25)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/createVector"
    },
    noise: {
      signature: "noise(x: Number, y?: Number, z?: Number)",
      description: "Returns random numbers that can be tuned to feel organic.",
      example: "let x = 100 * noise(0.005 * frameCount)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/noise"
    },
    noiseDetail: {
      signature: "noiseDetail(lod: Number, falloff: Number)",
      description: "Adjusts the character of the noise produced by the noise() function.",
      example: "noiseDetail(6, 0.25)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/noiseDetail"
    },
    noiseSeed: {
      signature: "noiseSeed(seed: Number)",
      description: "Sets the seed value for the noise() function.",
      example: "noiseSeed(99)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/noiseSeed"
    },
    randomSeed: {
      signature: "randomSeed(seed: Number)",
      description: "Sets the seed value for the random() and randomGaussian() functions.",
      example: "randomSeed(99)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/randomSeed"
    },
    random: {
      signature: "random(min?: Number, max?: Number)",
      description: "Returns a random number or a random element from an array.",
      example: "let x = random(0, 100)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/random"
    },
    randomGaussian: {
      signature: "randomGaussian(mean?: Number, sd?: Number)",
      description: "Returns a random number fitting a Gaussian, or normal, distribution.",
      example: "x = randomGaussian(50)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/randomGaussian"
    },
    acos: {
      signature: "acos(value: Number)",
      description: "Calculates the arc cosine of a number.",
      example: "let ac = acos(c)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/acos"
    },
    asin: {
      signature: "asin(value: Number)",
      description: "Calculates the arc sine of a number.",
      example: "let as = asin(s)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/asin"
    },
    atan: {
      signature: "atan(value: Number)",
      description: "Calculates the arc tangent of a number.",
      example: "let at = atan(t)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/atan"
    },
    atan2: {
      signature: "atan2(y: Number, x: Number)",
      description: "Calculates the angle formed by a point, the origin, and the positive x-axis.",
      example: "let a = atan2(mouseY, mouseX)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/atan2"
    },
    cos: {
      signature: "cos(angle: Number)",
      description: "Calculates the cosine of an angle.",
      example: "let x = 30 * cos(frameCount * 0.05) + 50",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/cos"
    },
    sin: {
      signature: "sin(angle: Number)",
      description: "Calculates the sine of an angle.",
      example: "let y = 30 * sin(frameCount * 0.05) + 50",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/sin"
    },
    tan: {
      signature: "tan(angle: Number)",
      description: "Calculates the tangent of an angle.",
      example: "let y = 5 * tan(x * 0.1) + 50",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/tan"
    },
    degrees: {
      signature: "degrees(radians: Number)",
      description: "Converts an angle measured in radians to its value in degrees.",
      example: "let deg = degrees(rad)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/degrees"
    },
    radians: {
      signature: "radians(degrees: Number)",
      description: "Converts an angle measured in degrees to its value in radians.",
      example: "let rad = radians(deg)",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/radians"
    },
    angleMode: {
      signature: "angleMode(mode: Constant)",
      description: "Changes the unit system used to measure angles.",
      kind: "function",
      category: "Math",
      sourceUrl: "https://p5js.org/reference/#/p5/angleMode"
    },
    textAlign: {
      signature: "textAlign(horizAlign: Constant, vertAlign?: Constant)",
      description: "Sets the way text is aligned when text() is called.",
      example: "textAlign(RIGHT)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textAlign"
    },
    textLeading: {
      signature: "textLeading(leading: Number)",
      description: "Sets the spacing between lines of text when text() is called.",
      example: "textLeading(30)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textLeading"
    },
    textSize: {
      signature: "textSize(size: Number)",
      description: "Sets the font size when text() is called.",
      example: "textSize(12)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textSize"
    },
    textStyle: {
      signature: "textStyle(style: Constant)",
      description: "Sets the style for system fonts when text() is called.",
      example: "textStyle(NORMAL)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textStyle"
    },
    textWidth: {
      signature: "textWidth(str: String)",
      description: "Calculates the maximum width of a string of text drawn when text() is called.",
      example: "let w = textWidth(s)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textWidth"
    },
    textAscent: {
      signature: "textAscent()",
      description: "Calculates the ascent of the current font at its current size.",
      example: "let a = textAscent() * fontScale",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textAscent"
    },
    textDescent: {
      signature: "textDescent()",
      description: "Calculates the descent of the current font at its current size.",
      example: "let d = textDescent() * fontScale",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textDescent"
    },
    textWrap: {
      signature: "textWrap(style: Constant)",
      description: "Sets the style for wrapping text when text() is called.",
      example: "textWrap(WORD)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textWrap"
    },
    loadFont: {
      signature: "loadFont(path: String, successCallback?: Function, failureCallback?: Function)",
      description: "Loads a font and creates a p5.",
      example: "font = loadFont('assets/inconsolata.otf')",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/loadFont"
    },
    text: {
      signature: "text(str: String|Object|Array|Number|Boolean, x: Number, y: Number, maxWidth?: Number, maxHeight?: Number)",
      description: "Draws text to the canvas.",
      example: "text('hi', 50, 50)",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/text"
    },
    textFont: {
      signature: "textFont()",
      description: "Sets the font used by the text() function.",
      example: "textFont('Courier New')",
      kind: "function",
      category: "Typography",
      sourceUrl: "https://p5js.org/reference/#/p5/textFont"
    },
    append: {
      signature: "append(array: Array, value: Any)",
      description: "Adds a value to the end of an array.",
      example: "append(myArray, 'Peach')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/append"
    },
    arrayCopy: {
      signature: "arrayCopy(src: Array, srcPosition: Integer, dst: Array, dstPosition: Integer, length: Integer)",
      description: "Copies an array (or part of an array) to another array.",
      example: "arrayCopy(src, srcPosition, dst, dstPosition, length)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/arrayCopy"
    },
    concat: {
      signature: "concat(a: Array, b: Array)",
      description: "Concatenates two arrays, maps to Array.",
      example: "let arr3 = concat(arr1, arr2)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/concat"
    },
    reverse: {
      signature: "reverse(list: Array)",
      description: "Reverses the order of an array, maps to Array.",
      example: "reverse(myArray)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/reverse"
    },
    shorten: {
      signature: "shorten(list: Array)",
      description: "Decreases an array by one element and returns the shortened array, maps to Array.",
      example: "let newArray = shorten(myArray)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/shorten"
    },
    shuffle: {
      signature: "shuffle(array: Array, bool?: Boolean)",
      description: "Shuffles the elements of an array.",
      example: "let shuffledColors = shuffle(colors)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/shuffle"
    },
    sort: {
      signature: "sort(list: Array, count?: Integer)",
      description: "Sorts an array of numbers from smallest to largest, or puts an array of words in alphabetical order.",
      example: "words = sort(words, count)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/sort"
    },
    splice: {
      signature: "splice(list: Array, value: Any, position: Integer)",
      description: "Inserts a value or an array of values into an existing array.",
      example: "splice(myArray, insArray, 3)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/splice"
    },
    subset: {
      signature: "subset(list: Array, start: Integer, count?: Integer)",
      description: "Extracts an array of elements from an existing array.",
      example: "let sub1 = subset(myArray, 0, 3)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/subset"
    },
    float: {
      signature: "float(str: String)",
      description: "Converts a `String` to a floating point (decimal) `Number`.",
      example: "let converted = float(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/float"
    },
    int: {
      signature: "int(n: String|Boolean|Number)",
      description: "Converts a `Boolean`, `String`, or decimal `Number` to an integer.",
      example: "let converted = int(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/int"
    },
    str: {
      signature: "str(n: String|Boolean|Number)",
      description: "Converts a `Boolean` or `Number` to `String`.",
      example: "let converted = str(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/str"
    },
    boolean: {
      signature: "boolean(n: String|Boolean|Number)",
      description: "Converts a `String` or `Number` to a `Boolean`.",
      example: "let converted = boolean(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/boolean"
    },
    byte: {
      signature: "byte(n: String|Boolean|Number)",
      description: "Converts a `Boolean`, `String`, or `Number` to its byte value.",
      example: "let converted = byte(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/byte"
    },
    char: {
      signature: "char(n: String|Number)",
      description: "Converts a `Number` or `String` to a single-character `String`.",
      example: "let converted = char(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/char"
    },
    unchar: {
      signature: "unchar(n: String)",
      description: "Converts a single-character `String` to a `Number`.",
      example: "let converted = unchar(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/unchar"
    },
    hex: {
      signature: "hex(n: Number, digits?: Number)",
      description: "Converts a `Number` to a `String` with its hexadecimal value.",
      example: "let converted = hex(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/hex"
    },
    unhex: {
      signature: "unhex(n: String)",
      description: "Converts a `String` with a hexadecimal value to a `Number`.",
      example: "let converted = unhex(original)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/unhex"
    },
    join: {
      signature: "join(list: Array, separator: String)",
      description: "Combines an array of strings into one string.",
      example: "let combined = join(myWords, ' : ')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/join"
    },
    match: {
      signature: "match(str: String, regexp: String)",
      description: "Applies a regular expression to a string and returns an array with the first match.",
      example: "let matches = match(string, '[a-z][0-9]')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/match"
    },
    matchAll: {
      signature: "matchAll(str: String, regexp: String)",
      description: "Applies a regular expression to a string and returns an array of matches.",
      example: "let matches = matchAll(string, '[a-z][0-9]')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/matchAll"
    },
    nf: {
      signature: "nf(num: Number|String, left?: Integer|String, right?: Integer|String)",
      description: "Converts a `Number` into a `String` with a given number of digits.",
      example: "let formatted = nf(number)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/nf"
    },
    nfc: {
      signature: "nfc(num: Number|String, right?: Integer|String)",
      description: "Converts a `Number` into a `String` with commas to mark units of 1,000.",
      example: "let commas = nfc(number)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/nfc"
    },
    nfp: {
      signature: "nfp(num: Number, left?: Integer, right?: Integer)",
      description: "Converts a `Number` into a `String` with a plus or minus sign.",
      example: "let p = nfp(positive)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/nfp"
    },
    nfs: {
      signature: "nfs(num: Number, left?: Integer, right?: Integer)",
      description: "Converts a positive `Number` into a `String` with an extra space in front.",
      example: "let formatted = nfs(positive)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/nfs"
    },
    split: {
      signature: "split(value: String, delim: String)",
      description: "Splits a `String` into pieces and returns an array containing the pieces.",
      example: "let words = split(string, '...')",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/split"
    },
    splitTokens: {
      signature: "splitTokens(value: String, delim?: String)",
      description: "Splits a `String` into pieces and returns an array containing the pieces.",
      example: "let words = splitTokens(string)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/splitTokens"
    },
    trim: {
      signature: "trim(str: String)",
      description: "Removes whitespace from the start and end of a `String` without changing the middle.",
      example: "let trimmed = trim(string)",
      kind: "function",
      category: "Data",
      sourceUrl: "https://p5js.org/reference/#/p5/trim"
    },
    day: {
      signature: "day()",
      description: "Returns the current day as a number from 1\u201331.",
      example: "let d = day()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/day"
    },
    hour: {
      signature: "hour()",
      description: "Returns the current hour as a number from 0\u201323.",
      example: "let h = hour()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/hour"
    },
    minute: {
      signature: "minute()",
      description: "Returns the current minute as a number from 0\u201359.",
      example: "let m = minute()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/minute"
    },
    millis: {
      signature: "millis()",
      description: "Returns the number of milliseconds since a sketch started running.",
      example: "let ms = millis()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/millis"
    },
    month: {
      signature: "month()",
      description: "Returns the current month as a number from 1\u201312.",
      example: "let m = month()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/month"
    },
    second: {
      signature: "second()",
      description: "Returns the current second as a number from 0\u201359.",
      example: "let s = second()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/second"
    },
    year: {
      signature: "year()",
      description: "Returns the current year as a number such as 1999.",
      example: "let y = year()",
      kind: "function",
      category: "IO",
      sourceUrl: "https://p5js.org/reference/#/p5/year"
    },
    beginGeometry: {
      signature: "beginGeometry()",
      description: "Begins adding shapes to a new p5.",
      example: "beginGeometry()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/beginGeometry"
    },
    endGeometry: {
      signature: "endGeometry()",
      description: "Stops adding shapes to a new p5.",
      example: "shape = endGeometry()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/endGeometry"
    },
    buildGeometry: {
      signature: "buildGeometry(callback: Function)",
      description: "Creates a custom p5.",
      example: "shape = buildGeometry(createShape)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/buildGeometry"
    },
    freeGeometry: {
      signature: "freeGeometry(geometry: p5.Geometry)",
      description: "Clears a p5.",
      example: "freeGeometry(shape)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/freeGeometry"
    },
    plane: {
      signature: "plane(width?: Number, height?: Number, detailX?: Integer, detailY?: Integer)",
      description: "Draws a plane.",
      example: "plane()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/plane"
    },
    box: {
      signature: "box(width?: Number, height?: Number, depth?: Number, detailX?: Integer, detailY?: Integer)",
      description: "Draws a box (rectangular prism).",
      example: "box()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/box"
    },
    sphere: {
      signature: "sphere(radius?: Number, detailX?: Integer, detailY?: Integer)",
      description: "Draws a sphere.",
      example: "sphere()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/sphere"
    },
    cylinder: {
      signature: "cylinder(radius?: Number, height?: Number, detailX?: Integer, detailY?: Integer, bottomCap?: Boolean, topCap?: Boolean)",
      description: "Draws a cylinder.",
      example: "cylinder()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/cylinder"
    },
    cone: {
      signature: "cone(radius?: Number, height?: Number, detailX?: Integer, detailY?: Integer, cap?: Boolean)",
      description: "Draws a cone.",
      example: "cone()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/cone"
    },
    ellipsoid: {
      signature: "ellipsoid(radiusX?: Number, radiusY?: Number, radiusZ?: Number, detailX?: Integer, detailY?: Integer)",
      description: "Draws an ellipsoid.",
      example: "ellipsoid(30)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/ellipsoid"
    },
    torus: {
      signature: "torus(radius?: Number, tubeRadius?: Number, detailX?: Integer, detailY?: Integer)",
      description: "Draws a torus.",
      example: "torus()",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/torus"
    },
    orbitControl: {
      signature: "orbitControl(sensitivityX?: Number, sensitivityY?: Number, sensitivityZ?: Number, options?: Object)",
      description: "Allows the user to orbit around a 3D sketch using a mouse, trackpad, or touchscreen.",
      example: "orbitControl()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/orbitControl"
    },
    debugMode: {
      signature: "debugMode()",
      description: "Adds a grid and an axes icon to clarify orientation in 3D sketches.",
      example: "debugMode()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/debugMode"
    },
    noDebugMode: {
      signature: "noDebugMode()",
      description: "Turns off debugMode() in a 3D sketch.",
      example: "noDebugMode()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/noDebugMode"
    },
    ambientLight: {
      signature: "ambientLight(v1: Number, v2: Number, v3: Number, alpha?: Number)",
      description: "Creates a light that shines from all directions.",
      example: "ambientLight(80)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/ambientLight"
    },
    specularColor: {
      signature: "specularColor(v1: Number, v2: Number, v3: Number)",
      description: "Sets the specular color for lights.",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/specularColor"
    },
    directionalLight: {
      signature: "directionalLight(v1: Number, v2: Number, v3: Number, x: Number, y: Number, z: Number)",
      description: "Creates a light that shines in one direction.",
      example: "directionalLight(255, 0, 0, 0, 1, 0)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/directionalLight"
    },
    pointLight: {
      signature: "pointLight(v1: Number, v2: Number, v3: Number, x: Number, y: Number, z: Number)",
      description: "Creates a light that shines from a point in all directions.",
      example: "pointLight(255, 0, 0, 0, -150, 0)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/pointLight"
    },
    imageLight: {
      signature: "imageLight(img: p5.image)",
      description: "Creates an ambient light from an image.",
      example: "imageLight(img)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/imageLight"
    },
    panorama: {
      signature: "panorama(img: p5.Image)",
      description: "Creates an immersive 3D background.",
      example: "panorama(img)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/panorama"
    },
    lights: {
      signature: "lights()",
      description: "Places an ambient and directional light in the scene.",
      example: "lights()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/lights"
    },
    lightFalloff: {
      signature: "lightFalloff(constant: Number, linear: Number, quadratic: Number)",
      description: "Sets the falloff rate for pointLight() and spotLight().",
      example: "lightFalloff(2, 0, 0)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/lightFalloff"
    },
    spotLight: {
      signature: "spotLight(v1: Number, v2: Number, v3: Number, x: Number, y: Number, z: Number, rx: Number, ry: Number, rz: Number, angle?: Number, concentration?: Number)",
      description: "Creates a light that shines from a point in one direction.",
      example: "spotLight(255, 0, 0, 0, 0, 100, 0, 0, -1, PI / 32)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/spotLight"
    },
    noLights: {
      signature: "noLights()",
      description: "Removes all lights from the sketch.",
      example: "noLights()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/noLights"
    },
    loadModel: {
      signature: "loadModel(path: String, normalize: Boolean, successCallback?: function(p5.Geometry), failureCallback?: Function(Event), fileType?: String)",
      description: "Loads a 3D model to create a p5.",
      example: "shape = loadModel('assets/teapot.obj')",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/loadModel"
    },
    model: {
      signature: "model(model: p5.Geometry)",
      description: "Draws a p5.",
      example: "model(shape)",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/model"
    },
    createModel: {
      signature: "createModel(modelString: String, fileType?: String, normalize: Boolean, successCallback?: function(p5.Geometry), failureCallback?: Function(Event))",
      description: "Load a 3d model from an OBJ or STL string.",
      example: "octahedron = createModel(octahedron_model, '.obj')",
      kind: "function",
      category: "Shape",
      sourceUrl: "https://p5js.org/reference/#/p5/createModel"
    },
    loadShader: {
      signature: "loadShader(vertFilename: String, fragFilename: String, successCallback?: Function, failureCallback?: Function)",
      description: "Loads vertex and fragment shaders to create a p5.",
      example: "mandelbrot = loadShader('assets/shader.vert', 'assets/shader.frag')",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/loadShader"
    },
    createShader: {
      signature: "createShader(vertSrc: String, fragSrc: String, options?: Object)",
      description: "Creates a new p5.",
      example: "let shaderProgram = createShader(vertSrc, fragSrc)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/createShader"
    },
    createFilterShader: {
      signature: "createFilterShader(fragSrc: String)",
      description: "Creates a p5.",
      example: "let s = createFilterShader(fragSrc)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/createFilterShader"
    },
    shader: {
      signature: "shader(s: p5.Shader)",
      description: "Sets the p5.",
      example: "shader(shaderProgram)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/shader"
    },
    baseMaterialShader: {
      signature: "baseMaterialShader()",
      description: "Get the default shader used with lights, materials, and textures.",
      example: "myShader = baseMaterialShader().modify({",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/baseMaterialShader"
    },
    baseNormalShader: {
      signature: "baseNormalShader()",
      description: "Get the shader used by `normalMaterial()`.",
      example: "myShader = baseNormalShader().modify({",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/baseNormalShader"
    },
    baseColorShader: {
      signature: "baseColorShader()",
      description: "Get the shader used when no lights or materials are applied.",
      example: "myShader = baseColorShader().modify({",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/baseColorShader"
    },
    baseStrokeShader: {
      signature: "baseStrokeShader()",
      description: "Get the shader used when drawing the strokes of shapes.",
      example: "myShader = baseStrokeShader().modify({",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/baseStrokeShader"
    },
    resetShader: {
      signature: "resetShader()",
      description: "Restores the default shaders.",
      example: "resetShader()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/resetShader"
    },
    texture: {
      signature: "texture(tex: p5.Image|p5.MediaElement|p5.Graphics|p5.Texture|p5.Framebuffer|p5.FramebufferTexture)",
      description: "Sets the texture that will be used on shapes.",
      example: "texture(img)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/texture"
    },
    textureMode: {
      signature: "textureMode(mode: Constant)",
      description: "Changes the coordinate system used for textures when they\u2019re applied to custom shapes.",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/textureMode"
    },
    textureWrap: {
      signature: "textureWrap(wrapX: Constant, wrapY?: Constant)",
      description: "Changes the way textures behave when a shape\u2019s uv coordinates go beyond the texture.",
      example: "textureWrap(CLAMP)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/textureWrap"
    },
    normalMaterial: {
      signature: "normalMaterial()",
      description: "Sets the current material as a normal material.",
      example: "normalMaterial()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/normalMaterial"
    },
    ambientMaterial: {
      signature: "ambientMaterial(v1: Number, v2: Number, v3: Number)",
      description: "Sets the ambient color of shapes\u2019 surface material.",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/ambientMaterial"
    },
    emissiveMaterial: {
      signature: "emissiveMaterial(v1: Number, v2: Number, v3: Number, alpha?: Number)",
      description: "Sets the emissive color of shapes\u2019 surface material.",
      example: "emissiveMaterial(255, 0, 0)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/emissiveMaterial"
    },
    specularMaterial: {
      signature: "specularMaterial(gray: Number, alpha?: Number)",
      description: "Sets the specular color of shapes\u2019 surface material.",
      example: "specularMaterial(255)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/specularMaterial"
    },
    shininess: {
      signature: "shininess(shine: Number)",
      description: 'Sets the amount of gloss ("shininess") of a specularMaterial().',
      example: "shininess(10)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/shininess"
    },
    metalness: {
      signature: "metalness(metallic: Number)",
      description: 'Sets the amount of "metalness" of a specularMaterial().',
      example: "metalness(1)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/metalness"
    },
    camera: {
      signature: "camera(x?: Number, y?: Number, z?: Number, centerX?: Number, centerY?: Number, centerZ?: Number, upX?: Number, upY?: Number, upZ?: Number)",
      description: "Sets the position and orientation of the current camera in a 3D sketch.",
      example: "camera(200, -400, 800)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/camera"
    },
    perspective: {
      signature: "perspective(fovy?: Number, aspect?: Number, near?: Number, far?: Number)",
      description: "Sets a perspective projection for the current camera in a 3D sketch.",
      example: "perspective(0.2, 1.5)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/perspective"
    },
    linePerspective: {
      signature: "linePerspective(enable: Boolean)",
      description: "Enables or disables perspective for lines in 3D sketches.",
      example: "let isEnabled = linePerspective()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/linePerspective"
    },
    ortho: {
      signature: "ortho(left?: Number, right?: Number, bottom?: Number, top?: Number, near?: Number, far?: Number)",
      description: "Sets an orthographic projection for the current camera in a 3D sketch.",
      example: "ortho()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/ortho"
    },
    frustum: {
      signature: "frustum(left?: Number, right?: Number, bottom?: Number, top?: Number, near?: Number, far?: Number)",
      description: "Sets the frustum of the current camera in a 3D sketch.",
      example: "frustum()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/frustum"
    },
    createCamera: {
      signature: "createCamera()",
      description: "Creates a new p5.",
      example: "cam1 = createCamera()",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/createCamera"
    },
    setCamera: {
      signature: "setCamera(cam: p5.Camera)",
      description: "Sets the current (active) camera of a 3D sketch.",
      example: "setCamera(cam1)",
      kind: "function",
      category: "3D",
      sourceUrl: "https://p5js.org/reference/#/p5/setCamera"
    },
    setAttributes: {
      signature: "setAttributes(key: String, value: Boolean)",
      description: "Set attributes for the WebGL Drawing context.",
      kind: "function",
      category: "Rendering",
      sourceUrl: "https://p5js.org/reference/#/p5/setAttributes"
    },
    getAudioContext: {
      signature: "getAudioContext()",
      description: "Returns the Audio Context for this sketch.",
      example: "if (getAudioContext().state !== 'running') {",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/getAudioContext"
    },
    userStartAudio: {
      signature: "userStartAudio(elements?: Element|Array, callback?: Function)",
      description: "It is not only a good practice to give users control over starting audio.",
      example: "userStartAudio()",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/userStartAudio"
    },
    getOutputVolume: {
      signature: "getOutputVolume()",
      description: "Returns a number representing the output volume for sound in this sketch.",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/getOutputVolume"
    },
    outputVolume: {
      signature: "outputVolume(volume: Number|Object, rampTime?: Number, timeFromNow?: Number)",
      description: "Scale the output of all sound in this sketch Scaled between 0.",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/outputVolume"
    },
    soundOut: {
      signature: "soundOut",
      description: "`p5.",
      kind: "variable",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/soundOut"
    },
    sampleRate: {
      signature: "sampleRate()",
      description: "Returns a number representing the sample rate, in samples per second, of all sound objects in this audio context.",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/sampleRate"
    },
    freqToMidi: {
      signature: "freqToMidi(frequency: Number)",
      description: "Returns the closest MIDI note value for a given frequency.",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/freqToMidi"
    },
    midiToFreq: {
      signature: "midiToFreq(midiNote: Number)",
      description: "Returns the frequency value of a MIDI note value.",
      example: "freq = midiToFreq(midiVal)",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/midiToFreq"
    },
    soundFormats: {
      signature: "soundFormats(formats?: String)",
      description: "List the SoundFile formats that you will include.",
      example: "soundFormats('mp3', 'ogg')",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/soundFormats"
    },
    saveSound: {
      signature: "saveSound(soundFile: p5.SoundFile, fileName: String)",
      description: "Save a p5.",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/saveSound"
    },
    loadSound: {
      signature: "loadSound(path: String|Array, successCallback?: Function, errorCallback?: Function, whileLoading?: Function)",
      description: "loadSound() returns a new p5.",
      example: "mySound = loadSound('assets/doorbell')",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/loadSound"
    },
    createConvolver: {
      signature: "createConvolver(path: String, callback?: Function, errorCallback?: Function)",
      description: "Create a p5.",
      example: "cVerb = createConvolver('assets/bx-spring.mp3')",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/createConvolver"
    },
    setBPM: {
      signature: "setBPM(BPM: Number, rampTime: Number)",
      description: "Set the global tempo, in beats per minute, for all p5.",
      kind: "function",
      category: "p5.sound",
      sourceUrl: "https://p5js.org/reference/#/p5/setBPM"
    }
  },
  meta: {
    version: "1.11.13",
    fetchedAt: "2026-04-18",
    source: "https://p5js.org/reference/data.json"
  }
};

// src/monaco/docs/p5.ts
validateDocsIndex("p5.json", p5_default);
var P5_GLOBAL_MISTAKES = [];
var RAW_INDEX = p5_default;
var P5_DOCS_INDEX = {
  ...RAW_INDEX,
  globalMistakes: [...RAW_INDEX.globalMistakes ?? [], ...P5_GLOBAL_MISTAKES]
};

// src/visualizers/vizSyntaxError.ts
var _VizSyntaxError = class _VizSyntaxError extends Error {
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
    this.name = "SyntaxError";
  }
};
__name(_VizSyntaxError, "VizSyntaxError");
var VizSyntaxError = _VizSyntaxError;
var ENDS_EARLY = "Unexpected end of code";
function locateVizSyntaxError(code, err) {
  if (!(err instanceof Error) || err.name !== "SyntaxError" || err instanceof VizSyntaxError) return err;
  const at = syntaxErrorAt(code);
  if (at) {
    const end = code.trimEnd();
    if (at.pos >= end.length) {
      const lines = end.split("\n");
      return new VizSyntaxError(ENDS_EARLY, lines.length, lines[lines.length - 1].length + 1);
    }
    return new VizSyntaxError(err.message, at.line, at.column + 1);
  }
  return new VizSyntaxError(err.message);
}
__name(locateVizSyntaxError, "locateVizSyntaxError");

// src/visualizers/p5Compiler.ts
function isFullLifecycleSketch(code) {
  return /\bfunction\s+(?:draw|setup|preload)\s*\(/.test(code);
}
__name(isFullLifecycleSketch, "isFullLifecycleSketch");
var NEW_FUNCTION_HEADER_LINES = 2;
function getP5LineOffset(code) {
  return isFullLifecycleSketch(code) ? FULL_LIFECYCLE_PREFIX_LINES + NEW_FUNCTION_HEADER_LINES : LEGACY_PREFIX_LINES + NEW_FUNCTION_HEADER_LINES;
}
__name(getP5LineOffset, "getP5LineOffset");
function compileP5Code(code, source) {
  const body = isFullLifecycleSketch(code) ? buildFullLifecycleBody(code) : buildLegacyBody(code);
  const lineOffset = getP5LineOffset(code);
  let syntaxError = null;
  try {
    new Function("p", "stave", "staveUniforms", body);
  } catch (err) {
    const located = locateVizSyntaxError(code, err);
    if (!(located instanceof VizSyntaxError)) throw located;
    syntaxError = located;
  }
  return (hapStreamRef, analyserRef, schedulerRef, containerSizeRef = {
    current: { w: 400, h: 300 }
  }, optionsRef = {
    current: {}
  }, staveUniformsRef = {
    current: makeInertStaveUniforms()
  }) => {
    return (p) => {
      if (syntaxError) {
        installErrorSketch(p, syntaxError.message, containerSizeRef);
        emitLog({
          level: "error",
          runtime: "p5",
          source,
          message: syntaxError.message,
          line: syntaxError.line,
          column: syntaxError.column
        });
        return;
      }
      const staveUniforms = staveUniformsRef.current ?? makeInertStaveUniforms();
      const stave = {
        get scheduler() {
          return schedulerRef.current;
        },
        get analyser() {
          return analyserRef.current;
        },
        get hapStream() {
          return hapStreamRef.current;
        },
        get width() {
          return containerSizeRef.current?.w ?? 400;
        },
        get height() {
          return containerSizeRef.current?.h ?? 300;
        },
        get options() {
          return optionsRef.current ?? {};
        },
        // D-02 — mirror the signal namespace onto the stave namespace.
        // `stave.sig` is the SAME `sig` object exposed bare via `with`.
        get sig() {
          return (staveUniformsRef.current ?? staveUniforms).sig;
        }
      };
      let lifecycle;
      try {
        const compile = new Function("p", "stave", "staveUniforms", body);
        lifecycle = compile(p, stave, staveUniforms);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        installErrorSketch(p, error.message, containerSizeRef);
        const parts = formatFriendlyError(error, "p5", {
          index: P5_DOCS_INDEX
        });
        const loc = parseStackLocation(error);
        const userLine = loc && lineOffset > 0 ? Math.max(1, loc.line - lineOffset) : loc?.line;
        emitLog({
          level: "error",
          runtime: "p5",
          source,
          message: parts.message,
          suggestion: parts.suggestion,
          stack: parts.stack,
          line: userLine,
          column: loc?.column
        });
        return;
      }
      installLifecycle(p, lifecycle, source, lineOffset, staveUniforms);
    };
  };
}
__name(compileP5Code, "compileP5Code");
function makeInertStaveUniforms() {
  const zeroReading = /* @__PURE__ */ __name(() => ({
    env: 0,
    velocity: 0,
    note: null,
    color: null,
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    fft: [],
    wave: []
  }), "zeroReading");
  const sig = /* @__PURE__ */ __name(((_sound) => zeroReading()), "sig");
  sig.track = (_id) => zeroReading();
  sig.tracks = [];
  sig.sounds = [];
  sig.kick = 0;
  sig.snare = 0;
  sig.hat = 0;
  sig.openHat = 0;
  sig.clap = 0;
  sig.rim = 0;
  sig.tom = 0;
  sig.keyVelocity = 0;
  sig.rms = 0;
  sig.bass = 0;
  sig.mid = 0;
  sig.treble = 0;
  sig.fft = [];
  sig.wave = [];
  sig.density = 1;
  return {
    sig,
    __tick: /* @__PURE__ */ __name(() => {
    }, "__tick")
  };
}
__name(makeInertStaveUniforms, "makeInertStaveUniforms");
var FULL_LIFECYCLE_PREFIX = "\nwith (p) {\n  with (staveUniforms) {\n  ";
var FULL_LIFECYCLE_PREFIX_LINES = (FULL_LIFECYCLE_PREFIX.match(/\n/g) || []).length;
function buildFullLifecycleBody(userCode) {
  return `${FULL_LIFECYCLE_PREFIX}${userCode}
  return {
    setup: typeof setup === 'function' ? setup : undefined,
    draw: typeof draw === 'function' ? draw : undefined,
    preload: typeof preload === 'function' ? preload : undefined,
  }
  }
}
  `;
}
__name(buildFullLifecycleBody, "buildFullLifecycleBody");
var LEGACY_PREFIX = `
with (p) {
  with (staveUniforms) {
  return {
    setup: function () {
      createCanvas(p.windowWidth, p.windowHeight)
      colorMode(RGB)
    },
    draw: function () {
      const scheduler = stave.scheduler
      const analyser = stave.analyser
      const hapStream = stave.hapStream
      const sig = staveUniforms.sig
      `;
var LEGACY_PREFIX_LINES = (LEGACY_PREFIX.match(/\n/g) || []).length;
function buildLegacyBody(userCode) {
  return `${LEGACY_PREFIX}${userCode}
    },
    preload: undefined,
  }
  }
}
  `;
}
__name(buildLegacyBody, "buildLegacyBody");
function installLifecycle(p, lifecycle, source, lineOffset, staveUniforms) {
  const pi = p;
  const reportLifecycleError = /* @__PURE__ */ __name((hook, err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const parts = formatFriendlyError(error, "p5", { index: P5_DOCS_INDEX });
    const loc = parseStackLocation(error);
    const userLine = loc && lineOffset > 0 ? Math.max(1, loc.line - lineOffset) : loc?.line;
    emitLog({
      level: "error",
      runtime: "p5",
      source,
      message: `${hook}(): ${parts.message}`,
      suggestion: parts.suggestion,
      stack: parts.stack,
      line: userLine,
      column: loc?.column
    });
  }, "reportLifecycleError");
  const wrap = /* @__PURE__ */ __name((hook, fn) => {
    if (!fn) return void 0;
    return function(...args) {
      try {
        return fn.apply(this, args);
      } catch (err) {
        reportLifecycleError(hook, err);
      }
    };
  }, "wrap");
  if (lifecycle.preload) pi.preload = wrap("preload", lifecycle.preload);
  pi.setup = wrap("setup", lifecycle.setup) ?? function() {
    pi.createCanvas(pi.windowWidth, pi.windowHeight);
  };
  if (lifecycle.draw) {
    const wrappedDraw = wrap("draw", lifecycle.draw);
    pi.draw = function() {
      staveUniforms?.__tick?.();
      return wrappedDraw?.call(this);
    };
  }
}
__name(installLifecycle, "installLifecycle");
function installErrorSketch(p, message, containerSizeRef) {
  const pi = p;
  pi.setup = function() {
    const size = containerSizeRef.current;
    pi.createCanvas(size?.w ?? 400, size?.h ?? 300);
  };
  pi.draw = function() {
    pi.background(20, 20, 24);
    pi.noStroke();
    pi.fill(255, 120, 120);
    pi.textFont("monospace");
    pi.textSize(12);
    pi.text("p5 viz compile error:", 12, 24);
    pi.fill(230);
    pi.textSize(11);
    pi.text(message, 12, 48, pi.width - 24, pi.height - 60);
  };
}
__name(installErrorSketch, "installErrorSketch");

// src/visualizers/hydraCompiler.ts
function compileHydraCode(code) {
  try {
    new Function("s", "stave", code);
  } catch (err) {
    throw locateVizSyntaxError(code, err);
  }
  return (s, stave) => {
    const fn = new Function("s", "stave", code);
    fn(s, stave);
  };
}
__name(compileHydraCode, "compileHydraCode");
var HYDRA_LINE_OFFSET = 2;
function getHydraLineOffset() {
  return HYDRA_LINE_OFFSET;
}
__name(getHydraLineOffset, "getHydraLineOffset");

// src/visualizers/renderers/glslShaderSource.ts
var GLSL_FULLSCREEN_VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
var VERSION = "#version 300 es";
var PRECISION = "precision highp float;\nprecision highp int;";
var MAX_GLSL_TRACKS = 16;
var STAVE_MAX_NOTES = 256;
var UNIFORMS = `uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform sampler2D iChannel0;
uniform float uKick, uSnare, uHat, uOpenHat, uClap, uRim, uTom, uVelocity;
uniform float uRms, uBass, uMid, uTreble;
uniform int uTrackCount;
uniform vec3 uTrackA[${MAX_GLSL_TRACKS}];
uniform vec3 uTrackB[${MAX_GLSL_TRACKS}];
uniform highp sampler2D uNotes;
uniform int uNoteCount;
uniform float uNow;
uniform float uCps;`;
var STAVE_TRACK_API = `struct StaveTrack {
  float env;
  float velocity;
  float rms;
  float bass;
  float mid;
  float treble;
};
StaveTrack staveTrack(int i) {
  vec3 a = uTrackA[i];
  vec3 b = uTrackB[i];
  return StaveTrack(a.x, a.y, a.z, b.x, b.y, b.z);
}`;
var STAVE_NOTE_API = `#define STAVE_MAX_NOTES ${STAVE_MAX_NOTES}
struct StaveNote {
  float begin;
  float end;
  float midi;
  float gain;
  float velocity;
  int track;
};
StaveNote staveNote(int i) {
  vec4 a = texelFetch(uNotes, ivec2(i, 0), 0);
  vec4 b = texelFetch(uNotes, ivec2(i, 1), 0);
  return StaveNote(a.x, a.y, a.z, a.w, b.x, int(b.y));
}`;
var PREAMBLE = `${UNIFORMS}
${STAVE_TRACK_API}
${STAVE_NOTE_API}`;
var SHADERTOY_OUT = "out vec4 stave_FragColor;";
var SHADERTOY_ENTRY = `
void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  stave_FragColor = color;
}
`;
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
__name(stripComments, "stripComments");
function stripVersion(src) {
  return src.replace(/^[ \t]*#version[^\n]*\r?\n?/m, "");
}
__name(stripVersion, "stripVersion");
function buildGLSLFragmentSource(userSource) {
  const probe = stripComments(userSource);
  const hasMainImage = /\bmainImage\s*\(/.test(probe);
  const hasMain = /\bvoid\s+main\s*\(/.test(probe);
  if (hasMainImage && hasMain) {
    throw new Error(
      "GLSL: found both mainImage() and main(). For a ShaderToy shader, remove your main() \u2014 Stave provides it. For a raw GLSL shader, remove mainImage()."
    );
  }
  if (hasMainImage) {
    return `${VERSION}
${PRECISION}
${PREAMBLE}
${SHADERTOY_OUT}
${userSource}
${SHADERTOY_ENTRY}`;
  }
  if (hasMain) {
    return `${VERSION}
${PRECISION}
${PREAMBLE}
${stripVersion(userSource)}
`;
  }
  throw new Error(
    "GLSL: no entry point. Define `void mainImage(out vec4 fragColor, in vec2 fragCoord)` for a ShaderToy shader, or `void main()` for a raw GLSL shader."
  );
}
__name(buildGLSLFragmentSource, "buildGLSLFragmentSource");

// src/visualizers/renderers/glslCore.ts
var GLSL_EVENT_NAMES = [
  "uKick",
  "uSnare",
  "uHat",
  "uOpenHat",
  "uClap",
  "uRim",
  "uTom",
  "uVelocity",
  "uRms",
  "uBass",
  "uMid",
  "uTreble"
];
var ZERO_GLSL_EVENTS = Object.fromEntries(
  GLSL_EVENT_NAMES.map((n) => [n, 0])
);
var GLSL_TRACK_FIELDS = ["env", "velocity", "rms", "bass", "mid", "treble"];
var ZERO_GLSL_TRACKS = {
  count: 0,
  a: new Float32Array(MAX_GLSL_TRACKS * 3),
  b: new Float32Array(MAX_GLSL_TRACKS * 3)
};
var NOTES_UNIT = 1;
var AUDIO_TEX_W = 512;
var AUDIO_TEX_H = 2;
function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(`glsl: could not create ${label} shader`);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "";
    gl.deleteShader(sh);
    throw new Error(`glsl ${label} compile error:
${log.trim()}`);
  }
  return sh;
}
__name(compileShader, "compileShader");
function resampleByteRow(src, srcLen, dst, dstLen) {
  if (srcLen <= 0) {
    dst.fill(0, 0, dstLen);
    return;
  }
  const bucket = srcLen / dstLen;
  for (let i = 0; i < dstLen; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < srcLen; j++) {
      sum += src[j];
      n++;
    }
    dst[i] = n > 0 ? Math.round(sum / n) : 0;
  }
}
__name(resampleByteRow, "resampleByteRow");
var _GLSLProgram = class _GLSLProgram {
  constructor(gl, userSource) {
    this.gl = gl;
    /** The RGBA32F notes texture; created only when the shader samples `uNotes`. */
    this.notesTex = null;
    /** `GLSLNotes.version` last uploaded (−1 = never). */
    this.notesUploaded = -1;
    /** Scratch buffers, allocated once (no per-frame alloc). */
    this.freqScratch = new Uint8Array(AUDIO_TEX_W * 4);
    this.waveScratch = new Uint8Array(AUDIO_TEX_W * 4);
    /** The 2-row texel buffer uploaded each frame (row 0 FFT, row 1 wave). */
    this.texRows = new Uint8Array(AUDIO_TEX_W * AUDIO_TEX_H);
    this.disposed = false;
    /** How many times the notes texture has been uploaded (for tests/diagnostics). */
    this.notesUploads = 0;
    const vert = compileShader(gl, gl.VERTEX_SHADER, GLSL_FULLSCREEN_VERT, "vertex");
    const frag = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      buildGLSLFragmentSource(userSource),
      "fragment"
    );
    const program = gl.createProgram();
    if (!program) throw new Error("glsl: could not create program");
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      throw new Error(`glsl link error:
${log.trim()}`);
    }
    this.program = program;
    this.uResolution = gl.getUniformLocation(program, "iResolution");
    this.uTime = gl.getUniformLocation(program, "iTime");
    this.uMouse = gl.getUniformLocation(program, "iMouse");
    this.uChannel0 = gl.getUniformLocation(program, "iChannel0");
    this.uEvents = GLSL_EVENT_NAMES.map(
      (n) => [n, gl.getUniformLocation(program, n)]
    );
    this.uTrackCount = gl.getUniformLocation(program, "uTrackCount");
    this.uTrackA = gl.getUniformLocation(program, "uTrackA");
    this.uTrackB = gl.getUniformLocation(program, "uTrackB");
    this.uNotes = gl.getUniformLocation(program, "uNotes");
    this.uNoteCount = gl.getUniformLocation(program, "uNoteCount");
    this.uNow = gl.getUniformLocation(program, "uNow");
    this.uCps = gl.getUniformLocation(program, "uCps");
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("glsl: could not create VAO");
    this.vao = vao;
    const tex = gl.createTexture();
    if (!tex) throw new Error("glsl: could not create audio texture");
    this.audioTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      AUDIO_TEX_W,
      AUDIO_TEX_H,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (this.uNotes) {
      const nt = gl.createTexture();
      if (!nt) throw new Error("glsl: could not create notes texture");
      this.notesTex = nt;
      gl.bindTexture(gl.TEXTURE_2D, nt);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        STAVE_MAX_NOTES,
        2,
        0,
        gl.RGBA,
        gl.FLOAT,
        null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }
  /** Whether the shader reads any upcoming-notes uniform (#2571) — a host can
   *  skip gathering notes for one that doesn't. */
  get readsNotes() {
    return !!(this.uNotes || this.uNoteCount || this.uNow || this.uCps);
  }
  /** Render one frame. `audio` may be null (no analyser yet) → the texture stays
   *  at its current contents (or zero) and the shader still animates off iTime.
   *  `events` carries the per-frame pattern-event uniforms (#284); omit → all 0.
   *  `tracks` carries the per-track signal uniforms (#297); omit → no tracks.
   *  `notes` carries the upcoming notes (#2571); omit → no notes. */
  draw(audio, state, events, tracks, notes) {
    if (this.disposed) return;
    const gl = this.gl;
    const w = Math.max(1, Math.round(state.width));
    const h = Math.max(1, Math.round(state.height));
    if (audio) {
      const bins = Math.min(audio.frequencyBinCount, this.freqScratch.length);
      const freq = this.freqScratch.subarray(0, bins);
      const wave = this.waveScratch.subarray(0, bins);
      audio.getByteFrequencyData(freq);
      audio.getByteTimeDomainData(wave);
      resampleByteRow(freq, bins, this.texRows.subarray(0, AUDIO_TEX_W), AUDIO_TEX_W);
      resampleByteRow(wave, bins, this.texRows.subarray(AUDIO_TEX_W), AUDIO_TEX_W);
      gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        AUDIO_TEX_W,
        AUDIO_TEX_H,
        gl.RED,
        gl.UNSIGNED_BYTE,
        this.texRows
      );
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    if (this.uResolution) gl.uniform3f(this.uResolution, w, h, 1);
    if (this.uTime) gl.uniform1f(this.uTime, state.timeMs / 1e3);
    if (this.uMouse) {
      const m = state.mouse ?? [0, 0, 0, 0];
      gl.uniform4f(this.uMouse, m[0], m[1], m[2], m[3]);
    }
    if (this.uChannel0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
      gl.uniform1i(this.uChannel0, 0);
    }
    const ev = events ?? ZERO_GLSL_EVENTS;
    for (const [name, loc] of this.uEvents) {
      if (loc) gl.uniform1f(loc, ev[name]);
    }
    const tr = tracks ?? ZERO_GLSL_TRACKS;
    if (this.uTrackCount) gl.uniform1i(this.uTrackCount, tr.count);
    if (this.uTrackA) gl.uniform3fv(this.uTrackA, tr.a);
    if (this.uTrackB) gl.uniform3fv(this.uTrackB, tr.b);
    if (this.uNotes && this.notesTex) {
      gl.activeTexture(gl.TEXTURE0 + NOTES_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, this.notesTex);
      if (notes && notes.version !== this.notesUploaded) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STAVE_MAX_NOTES, 2, gl.RGBA, gl.FLOAT, notes.data);
        this.notesUploaded = notes.version;
        this.notesUploads++;
      }
      gl.uniform1i(this.uNotes, NOTES_UNIT);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (this.uNoteCount) gl.uniform1i(this.uNoteCount, notes?.count ?? 0);
    if (this.uNow) gl.uniform1f(this.uNow, notes?.now ?? 0);
    if (this.uCps) gl.uniform1f(this.uCps, notes?.cps ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    try {
      gl.deleteProgram(this.program);
      gl.deleteVertexArray(this.vao);
      gl.deleteTexture(this.audioTex);
      if (this.notesTex) gl.deleteTexture(this.notesTex);
    } catch {
    }
  }
};
__name(_GLSLProgram, "GLSLProgram");
var GLSLProgram = _GLSLProgram;
function createGLSLProgram(gl, userSource) {
  return new GLSLProgram(gl, userSource);
}
__name(createGLSLProgram, "createGLSLProgram");

// src/visualizers/renderers/glslEvents.ts
function readGLSLEvents(bus) {
  const m = bus.master();
  let vel = 0;
  for (const s of bus.sounds) {
    const v = bus.sound(s).velocity;
    if (v > vel) vel = v;
  }
  return {
    uKick: bus.envValue("uKick"),
    uSnare: bus.envValue("uSnare"),
    uHat: bus.envValue("uHat"),
    uOpenHat: bus.envValue("uOpenHat"),
    uClap: bus.envValue("uClap"),
    uRim: bus.envValue("uRim"),
    uTom: bus.envValue("uTom"),
    uVelocity: vel,
    uRms: m.rms,
    uBass: m.bass,
    uMid: m.mid,
    uTreble: m.treble
  };
}
__name(readGLSLEvents, "readGLSLEvents");
function readGLSLTracks(bus) {
  const keys = bus.tracks;
  const count = Math.min(keys.length, MAX_GLSL_TRACKS);
  const a = new Float32Array(MAX_GLSL_TRACKS * 3);
  const b = new Float32Array(MAX_GLSL_TRACKS * 3);
  for (let i = 0; i < count; i++) {
    const t = bus.track(keys[i]);
    for (let f = 0; f < GLSL_TRACK_FIELDS.length; f++) {
      const value = t[GLSL_TRACK_FIELDS[f]];
      const target = f < 3 ? a : b;
      target[i * 3 + f % 3] = value;
    }
  }
  return { count, a, b };
}
__name(readGLSLTracks, "readGLSLTracks");

// src/visualizers/renderers/glslNotes.ts
var RGBA = 4;
function distanceToNow(n, now) {
  if (n.begin > now) return n.begin - now;
  if (n.end < now) return now - n.end;
  return 0;
}
__name(distanceToNow, "distanceToNow");
function noteTrackIndex(key, trackKeys) {
  if (key == null) return trackKeys.length === 1 ? 0 : -1;
  return trackKeys.indexOf(key);
}
__name(noteTrackIndex, "noteTrackIndex");
function selectNotes(events, now) {
  let notes;
  if (events.length > STAVE_MAX_NOTES) {
    notes = [...events].sort((a, b) => distanceToNow(a, now) - distanceToNow(b, now) || a.begin - b.begin).slice(0, STAVE_MAX_NOTES);
  } else {
    notes = [...events];
  }
  notes.sort((a, b) => a.begin - b.begin);
  return { notes, dropped: events.length - notes.length };
}
__name(selectNotes, "selectNotes");
function writeNoteTexels(notes, trackKeys, out) {
  out.fill(0);
  const row1 = STAVE_MAX_NOTES * RGBA;
  const n = Math.min(notes.length, STAVE_MAX_NOTES);
  for (let i = 0; i < n; i++) {
    const e = notes[i];
    const o = i * RGBA;
    out[o] = e.begin;
    out[o + 1] = e.end;
    out[o + 2] = typeof e.midi === "number" && Number.isFinite(e.midi) ? e.midi : -1;
    out[o + 3] = e.gain ?? 1;
    out[row1 + o] = e.velocity ?? 1;
    out[row1 + o + 1] = noteTrackIndex(e.trackKey, trackKeys);
  }
}
__name(writeNoteTexels, "writeNoteTexels");
var _GLSLNoteFeed = class _GLSLNoteFeed {
  constructor() {
    /** RGBA32F texels, row 0 then row 1. */
    this.data = new Float32Array(STAVE_MAX_NOTES * 2 * RGBA);
    /** Notes in `data` (`uNoteCount`). */
    this.count = 0;
    /** Notes the last pack dropped over the cap. */
    this.dropped = 0;
    /** Bumps on every repack; the GL side uploads when it differs from its own. */
    this.version = 0;
    /** Scheduler now (`uNow`) and cycles per second (`uCps`), set every frame. */
    this.now = 0;
    this.cps = 0;
    this.windowVersion = null;
    this.trackSig = "";
    this.warned = false;
  }
  /**
   * Feed one frame. `windowVersion` is the window's own change counter
   * (`RollingHapWindow.version`); when it and the track list are unchanged the
   * texels are left alone. Absent → always repack. Returns true when the texels
   * were rewritten. `onDrop` runs once per feed, the first time notes are
   * dropped over the cap.
   */
  update(events, windowVersion, now, cps, trackKeys, onDrop) {
    this.now = now;
    this.cps = cps;
    const sig = trackKeys.join("\0");
    if (windowVersion !== void 0 && windowVersion === this.windowVersion && sig === this.trackSig) {
      return false;
    }
    this.windowVersion = windowVersion ?? null;
    this.trackSig = sig;
    const { notes, dropped } = selectNotes(events, now);
    writeNoteTexels(notes, trackKeys, this.data);
    this.count = notes.length;
    this.dropped = dropped;
    this.version++;
    if (dropped > 0 && !this.warned) {
      this.warned = true;
      onDrop?.(dropped, events.length);
    }
    return true;
  }
};
__name(_GLSLNoteFeed, "GLSLNoteFeed");
var GLSLNoteFeed = _GLSLNoteFeed;
function droppedNotesMessage(dropped, total) {
  return `GLSL: ${total} notes in the window (now\u22124 \u2026 now+2 cycles), but uNotes holds ${STAVE_MAX_NOTES}. Kept the ${STAVE_MAX_NOTES} nearest to now and dropped ${dropped}; uNoteCount says how many came through.`;
}
__name(droppedNotesMessage, "droppedNotesMessage");

// src/visualizers/libraries/threeAddons.generated.ts
var THREE_ADDON_LOADERS = {
  "animation/AnimationClipCreator.js": /* @__PURE__ */ __name(() => import('three/addons/animation/AnimationClipCreator.js'), "animation/AnimationClipCreator.js"),
  "animation/CCDIKSolver.js": /* @__PURE__ */ __name(() => import('three/addons/animation/CCDIKSolver.js'), "animation/CCDIKSolver.js"),
  "capabilities/WebGL.js": /* @__PURE__ */ __name(() => import('three/addons/capabilities/WebGL.js'), "capabilities/WebGL.js"),
  "capabilities/WebGPU.js": /* @__PURE__ */ __name(() => import('three/addons/capabilities/WebGPU.js'), "capabilities/WebGPU.js"),
  "controls/ArcballControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/ArcballControls.js'), "controls/ArcballControls.js"),
  "controls/DragControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/DragControls.js'), "controls/DragControls.js"),
  "controls/FirstPersonControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/FirstPersonControls.js'), "controls/FirstPersonControls.js"),
  "controls/FlyControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/FlyControls.js'), "controls/FlyControls.js"),
  "controls/MapControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/MapControls.js'), "controls/MapControls.js"),
  "controls/OrbitControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/OrbitControls.js'), "controls/OrbitControls.js"),
  "controls/PointerLockControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/PointerLockControls.js'), "controls/PointerLockControls.js"),
  "controls/TrackballControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/TrackballControls.js'), "controls/TrackballControls.js"),
  "controls/TransformControls.js": /* @__PURE__ */ __name(() => import('three/addons/controls/TransformControls.js'), "controls/TransformControls.js"),
  "csm/CSM.js": /* @__PURE__ */ __name(() => import('three/addons/csm/CSM.js'), "csm/CSM.js"),
  "csm/CSMFrustum.js": /* @__PURE__ */ __name(() => import('three/addons/csm/CSMFrustum.js'), "csm/CSMFrustum.js"),
  "csm/CSMHelper.js": /* @__PURE__ */ __name(() => import('three/addons/csm/CSMHelper.js'), "csm/CSMHelper.js"),
  "csm/CSMShader.js": /* @__PURE__ */ __name(() => import('three/addons/csm/CSMShader.js'), "csm/CSMShader.js"),
  "csm/CSMShadowNode.js": /* @__PURE__ */ __name(() => import('three/addons/csm/CSMShadowNode.js'), "csm/CSMShadowNode.js"),
  "curves/CurveExtras.js": /* @__PURE__ */ __name(() => import('three/addons/curves/CurveExtras.js'), "curves/CurveExtras.js"),
  "curves/NURBSCurve.js": /* @__PURE__ */ __name(() => import('three/addons/curves/NURBSCurve.js'), "curves/NURBSCurve.js"),
  "curves/NURBSSurface.js": /* @__PURE__ */ __name(() => import('three/addons/curves/NURBSSurface.js'), "curves/NURBSSurface.js"),
  "curves/NURBSUtils.js": /* @__PURE__ */ __name(() => import('three/addons/curves/NURBSUtils.js'), "curves/NURBSUtils.js"),
  "curves/NURBSVolume.js": /* @__PURE__ */ __name(() => import('three/addons/curves/NURBSVolume.js'), "curves/NURBSVolume.js"),
  "effects/AnaglyphEffect.js": /* @__PURE__ */ __name(() => import('three/addons/effects/AnaglyphEffect.js'), "effects/AnaglyphEffect.js"),
  "effects/AsciiEffect.js": /* @__PURE__ */ __name(() => import('three/addons/effects/AsciiEffect.js'), "effects/AsciiEffect.js"),
  "effects/OutlineEffect.js": /* @__PURE__ */ __name(() => import('three/addons/effects/OutlineEffect.js'), "effects/OutlineEffect.js"),
  "effects/ParallaxBarrierEffect.js": /* @__PURE__ */ __name(() => import('three/addons/effects/ParallaxBarrierEffect.js'), "effects/ParallaxBarrierEffect.js"),
  "effects/StereoEffect.js": /* @__PURE__ */ __name(() => import('three/addons/effects/StereoEffect.js'), "effects/StereoEffect.js"),
  "environments/ColorEnvironment.js": /* @__PURE__ */ __name(() => import('three/addons/environments/ColorEnvironment.js'), "environments/ColorEnvironment.js"),
  "environments/DebugEnvironment.js": /* @__PURE__ */ __name(() => import('three/addons/environments/DebugEnvironment.js'), "environments/DebugEnvironment.js"),
  "environments/RoomEnvironment.js": /* @__PURE__ */ __name(() => import('three/addons/environments/RoomEnvironment.js'), "environments/RoomEnvironment.js"),
  "exporters/DRACOExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/DRACOExporter.js'), "exporters/DRACOExporter.js"),
  "exporters/EXRExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/EXRExporter.js'), "exporters/EXRExporter.js"),
  "exporters/GLTFExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/GLTFExporter.js'), "exporters/GLTFExporter.js"),
  "exporters/KTX2Exporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/KTX2Exporter.js'), "exporters/KTX2Exporter.js"),
  "exporters/OBJExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/OBJExporter.js'), "exporters/OBJExporter.js"),
  "exporters/PLYExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/PLYExporter.js'), "exporters/PLYExporter.js"),
  "exporters/STLExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/STLExporter.js'), "exporters/STLExporter.js"),
  "exporters/USDZExporter.js": /* @__PURE__ */ __name(() => import('three/addons/exporters/USDZExporter.js'), "exporters/USDZExporter.js"),
  "generators/CityGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/CityGenerator.js'), "generators/CityGenerator.js"),
  "generators/ForestGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/ForestGenerator.js'), "generators/ForestGenerator.js"),
  "generators/TerrainGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/TerrainGenerator.js'), "generators/TerrainGenerator.js"),
  "generators/TreeGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/TreeGenerator.js'), "generators/TreeGenerator.js"),
  "generators/city/BenchGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/BenchGenerator.js'), "generators/city/BenchGenerator.js"),
  "generators/city/CarGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/CarGenerator.js'), "generators/city/CarGenerator.js"),
  "generators/city/CityGeneratorUtils.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/CityGeneratorUtils.js'), "generators/city/CityGeneratorUtils.js"),
  "generators/city/HydrantGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/HydrantGenerator.js'), "generators/city/HydrantGenerator.js"),
  "generators/city/InstancedMeshGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/InstancedMeshGenerator.js'), "generators/city/InstancedMeshGenerator.js"),
  "generators/city/PersonGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/PersonGenerator.js'), "generators/city/PersonGenerator.js"),
  "generators/city/SidewalkGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/SidewalkGenerator.js'), "generators/city/SidewalkGenerator.js"),
  "generators/city/SkyscraperGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/SkyscraperGenerator.js'), "generators/city/SkyscraperGenerator.js"),
  "generators/city/StreetTreeGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/StreetTreeGenerator.js'), "generators/city/StreetTreeGenerator.js"),
  "generators/city/StreetlightGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/StreetlightGenerator.js'), "generators/city/StreetlightGenerator.js"),
  "generators/city/TrafficlightGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/TrafficlightGenerator.js'), "generators/city/TrafficlightGenerator.js"),
  "generators/city/TrashcanGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/generators/city/TrashcanGenerator.js'), "generators/city/TrashcanGenerator.js"),
  "geometries/BoxLineGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/BoxLineGeometry.js'), "geometries/BoxLineGeometry.js"),
  "geometries/ConvexGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/ConvexGeometry.js'), "geometries/ConvexGeometry.js"),
  "geometries/DecalGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/DecalGeometry.js'), "geometries/DecalGeometry.js"),
  "geometries/LoftGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/LoftGeometry.js'), "geometries/LoftGeometry.js"),
  "geometries/ParametricFunctions.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/ParametricFunctions.js'), "geometries/ParametricFunctions.js"),
  "geometries/ParametricGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/ParametricGeometry.js'), "geometries/ParametricGeometry.js"),
  "geometries/RoundedBoxGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/RoundedBoxGeometry.js'), "geometries/RoundedBoxGeometry.js"),
  "geometries/TeapotGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/TeapotGeometry.js'), "geometries/TeapotGeometry.js"),
  "geometries/TextGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/geometries/TextGeometry.js'), "geometries/TextGeometry.js"),
  "gpgpu/BitonicSort.js": /* @__PURE__ */ __name(() => import('three/addons/gpgpu/BitonicSort.js'), "gpgpu/BitonicSort.js"),
  "gpgpu/CountingSort.js": /* @__PURE__ */ __name(() => import('three/addons/gpgpu/CountingSort.js'), "gpgpu/CountingSort.js"),
  "helpers/AnimationPathHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/AnimationPathHelper.js'), "helpers/AnimationPathHelper.js"),
  "helpers/LightProbeGridHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/LightProbeGridHelper.js'), "helpers/LightProbeGridHelper.js"),
  "helpers/LightProbeGridHelperWebGL.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/LightProbeGridHelperWebGL.js'), "helpers/LightProbeGridHelperWebGL.js"),
  "helpers/LightProbeHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/LightProbeHelper.js'), "helpers/LightProbeHelper.js"),
  "helpers/LightProbeHelperGPU.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/LightProbeHelperGPU.js'), "helpers/LightProbeHelperGPU.js"),
  "helpers/OctreeHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/OctreeHelper.js'), "helpers/OctreeHelper.js"),
  "helpers/PositionalAudioHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/PositionalAudioHelper.js'), "helpers/PositionalAudioHelper.js"),
  "helpers/RapierHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/RapierHelper.js'), "helpers/RapierHelper.js"),
  "helpers/RectAreaLightHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/RectAreaLightHelper.js'), "helpers/RectAreaLightHelper.js"),
  "helpers/TextureHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/TextureHelper.js'), "helpers/TextureHelper.js"),
  "helpers/TextureHelperGPU.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/TextureHelperGPU.js'), "helpers/TextureHelperGPU.js"),
  "helpers/VertexNormalsHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/VertexNormalsHelper.js'), "helpers/VertexNormalsHelper.js"),
  "helpers/VertexTangentsHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/VertexTangentsHelper.js'), "helpers/VertexTangentsHelper.js"),
  "helpers/ViewHelper.js": /* @__PURE__ */ __name(() => import('three/addons/helpers/ViewHelper.js'), "helpers/ViewHelper.js"),
  "inspector/Extension.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/Extension.js'), "inspector/Extension.js"),
  "inspector/Inspector.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/Inspector.js'), "inspector/Inspector.js"),
  "inspector/RendererInspector.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/RendererInspector.js'), "inspector/RendererInspector.js"),
  "inspector/Storage.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/Storage.js'), "inspector/Storage.js"),
  "inspector/extensions/color-grading/ColorGrading.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/ColorGrading.js'), "inspector/extensions/color-grading/ColorGrading.js"),
  "inspector/extensions/color-grading/ColorWheel.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/ColorWheel.js'), "inspector/extensions/color-grading/ColorWheel.js"),
  "inspector/extensions/color-grading/CurveEditor.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/CurveEditor.js'), "inspector/extensions/color-grading/CurveEditor.js"),
  "inspector/extensions/color-grading/LUT3DStyle.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/LUT3DStyle.js'), "inspector/extensions/color-grading/LUT3DStyle.js"),
  "inspector/extensions/color-grading/LUTMath.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/LUTMath.js'), "inspector/extensions/color-grading/LUTMath.js"),
  "inspector/extensions/color-grading/modules/BrightnessModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/BrightnessModule.js'), "inspector/extensions/color-grading/modules/BrightnessModule.js"),
  "inspector/extensions/color-grading/modules/ColorWheelModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/ColorWheelModule.js'), "inspector/extensions/color-grading/modules/ColorWheelModule.js"),
  "inspector/extensions/color-grading/modules/ContrastModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/ContrastModule.js'), "inspector/extensions/color-grading/modules/ContrastModule.js"),
  "inspector/extensions/color-grading/modules/CurvesModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/CurvesModule.js'), "inspector/extensions/color-grading/modules/CurvesModule.js"),
  "inspector/extensions/color-grading/modules/ExposureHueModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/ExposureHueModule.js'), "inspector/extensions/color-grading/modules/ExposureHueModule.js"),
  "inspector/extensions/color-grading/modules/ExposureModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/ExposureModule.js'), "inspector/extensions/color-grading/modules/ExposureModule.js"),
  "inspector/extensions/color-grading/modules/HueModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/HueModule.js'), "inspector/extensions/color-grading/modules/HueModule.js"),
  "inspector/extensions/color-grading/modules/ImportedCubeModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/ImportedCubeModule.js'), "inspector/extensions/color-grading/modules/ImportedCubeModule.js"),
  "inspector/extensions/color-grading/modules/Module.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/Module.js'), "inspector/extensions/color-grading/modules/Module.js"),
  "inspector/extensions/color-grading/modules/OutputModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/OutputModule.js'), "inspector/extensions/color-grading/modules/OutputModule.js"),
  "inspector/extensions/color-grading/modules/RendererModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/RendererModule.js'), "inspector/extensions/color-grading/modules/RendererModule.js"),
  "inspector/extensions/color-grading/modules/SatVibranceModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/SatVibranceModule.js'), "inspector/extensions/color-grading/modules/SatVibranceModule.js"),
  "inspector/extensions/color-grading/modules/SaturationModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/SaturationModule.js'), "inspector/extensions/color-grading/modules/SaturationModule.js"),
  "inspector/extensions/color-grading/modules/VibranceModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/VibranceModule.js'), "inspector/extensions/color-grading/modules/VibranceModule.js"),
  "inspector/extensions/color-grading/modules/WhiteBalanceModule.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/color-grading/modules/WhiteBalanceModule.js'), "inspector/extensions/color-grading/modules/WhiteBalanceModule.js"),
  "inspector/extensions/tsl-graph/TSLGraphEditor.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/tsl-graph/TSLGraphEditor.js'), "inspector/extensions/tsl-graph/TSLGraphEditor.js"),
  "inspector/extensions/tsl-graph/TSLGraphLoader.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/extensions/tsl-graph/TSLGraphLoader.js'), "inspector/extensions/tsl-graph/TSLGraphLoader.js"),
  "inspector/tabs/Console.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Console.js'), "inspector/tabs/Console.js"),
  "inspector/tabs/Memory.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Memory.js'), "inspector/tabs/Memory.js"),
  "inspector/tabs/Parameters.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Parameters.js'), "inspector/tabs/Parameters.js"),
  "inspector/tabs/Performance.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Performance.js'), "inspector/tabs/Performance.js"),
  "inspector/tabs/Settings.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Settings.js'), "inspector/tabs/Settings.js"),
  "inspector/tabs/Timeline.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Timeline.js'), "inspector/tabs/Timeline.js"),
  "inspector/tabs/Viewer.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/tabs/Viewer.js'), "inspector/tabs/Viewer.js"),
  "inspector/ui/Graph.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/Graph.js'), "inspector/ui/Graph.js"),
  "inspector/ui/Item.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/Item.js'), "inspector/ui/Item.js"),
  "inspector/ui/List.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/List.js'), "inspector/ui/List.js"),
  "inspector/ui/Profiler.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/Profiler.js'), "inspector/ui/Profiler.js"),
  "inspector/ui/Style.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/Style.js'), "inspector/ui/Style.js"),
  "inspector/ui/Tab.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/Tab.js'), "inspector/ui/Tab.js"),
  "inspector/ui/Values.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/Values.js'), "inspector/ui/Values.js"),
  "inspector/ui/utils.js": /* @__PURE__ */ __name(() => import('three/addons/inspector/ui/utils.js'), "inspector/ui/utils.js"),
  "interaction/InteractionManager.js": /* @__PURE__ */ __name(() => import('three/addons/interaction/InteractionManager.js'), "interaction/InteractionManager.js"),
  "interactive/HTMLMesh.js": /* @__PURE__ */ __name(() => import('three/addons/interactive/HTMLMesh.js'), "interactive/HTMLMesh.js"),
  "interactive/InteractiveGroup.js": /* @__PURE__ */ __name(() => import('three/addons/interactive/InteractiveGroup.js'), "interactive/InteractiveGroup.js"),
  "interactive/SelectionBox.js": /* @__PURE__ */ __name(() => import('three/addons/interactive/SelectionBox.js'), "interactive/SelectionBox.js"),
  "interactive/SelectionHelper.js": /* @__PURE__ */ __name(() => import('three/addons/interactive/SelectionHelper.js'), "interactive/SelectionHelper.js"),
  "libs/chevrotain.module.min.js": /* @__PURE__ */ __name(() => import('three/addons/libs/chevrotain.module.min.js'), "libs/chevrotain.module.min.js"),
  "libs/fflate.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/fflate.module.js'), "libs/fflate.module.js"),
  "libs/ktx-parse.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/ktx-parse.module.js'), "libs/ktx-parse.module.js"),
  "libs/lil-gui.module.min.js": /* @__PURE__ */ __name(() => import('three/addons/libs/lil-gui.module.min.js'), "libs/lil-gui.module.min.js"),
  "libs/meshopt_clusterizer.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/meshopt_clusterizer.module.js'), "libs/meshopt_clusterizer.module.js"),
  "libs/meshopt_decoder.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/meshopt_decoder.module.js'), "libs/meshopt_decoder.module.js"),
  "libs/meshopt_simplifier.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/meshopt_simplifier.module.js'), "libs/meshopt_simplifier.module.js"),
  "libs/mikktspace.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/mikktspace.module.js'), "libs/mikktspace.module.js"),
  "libs/motion-controllers.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/motion-controllers.module.js'), "libs/motion-controllers.module.js"),
  "libs/potpack.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/potpack.module.js'), "libs/potpack.module.js"),
  "libs/stats.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/stats.module.js'), "libs/stats.module.js"),
  "libs/tween.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/tween.module.js'), "libs/tween.module.js"),
  "libs/utif.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/utif.module.js'), "libs/utif.module.js"),
  "libs/zstddec.module.js": /* @__PURE__ */ __name(() => import('three/addons/libs/zstddec.module.js'), "libs/zstddec.module.js"),
  "lighting/ClusteredLighting.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/ClusteredLighting.js'), "lighting/ClusteredLighting.js"),
  "lighting/DynamicLighting.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/DynamicLighting.js'), "lighting/DynamicLighting.js"),
  "lighting/LightMapper.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/LightMapper.js'), "lighting/LightMapper.js"),
  "lighting/LightProbeGrid.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/LightProbeGrid.js'), "lighting/LightProbeGrid.js"),
  "lighting/LightProbeGridUtils.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/LightProbeGridUtils.js'), "lighting/LightProbeGridUtils.js"),
  "lighting/LightProbeGridWebGL.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/LightProbeGridWebGL.js'), "lighting/LightProbeGridWebGL.js"),
  "lighting/vxgi/VXGIConeTracer.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/vxgi/VXGIConeTracer.js'), "lighting/vxgi/VXGIConeTracer.js"),
  "lighting/vxgi/VXGIIrradiance.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/vxgi/VXGIIrradiance.js'), "lighting/vxgi/VXGIIrradiance.js"),
  "lighting/vxgi/VXGINode.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/vxgi/VXGINode.js'), "lighting/vxgi/VXGINode.js"),
  "lighting/vxgi/VXGISceneCollector.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/vxgi/VXGISceneCollector.js'), "lighting/vxgi/VXGISceneCollector.js"),
  "lighting/vxgi/VXGIVolume.js": /* @__PURE__ */ __name(() => import('three/addons/lighting/vxgi/VXGIVolume.js'), "lighting/vxgi/VXGIVolume.js"),
  "lights/LightProbeGenerator.js": /* @__PURE__ */ __name(() => import('three/addons/lights/LightProbeGenerator.js'), "lights/LightProbeGenerator.js"),
  "lights/RectAreaLightTexturesLib.js": /* @__PURE__ */ __name(() => import('three/addons/lights/RectAreaLightTexturesLib.js'), "lights/RectAreaLightTexturesLib.js"),
  "lights/RectAreaLightUniformsLib.js": /* @__PURE__ */ __name(() => import('three/addons/lights/RectAreaLightUniformsLib.js'), "lights/RectAreaLightUniformsLib.js"),
  "lights/SunLight.js": /* @__PURE__ */ __name(() => import('three/addons/lights/SunLight.js'), "lights/SunLight.js"),
  "lights/SunLightNode.js": /* @__PURE__ */ __name(() => import('three/addons/lights/SunLightNode.js'), "lights/SunLightNode.js"),
  "lights/SunLightShadow.js": /* @__PURE__ */ __name(() => import('three/addons/lights/SunLightShadow.js'), "lights/SunLightShadow.js"),
  "lights/SunShadowNode.js": /* @__PURE__ */ __name(() => import('three/addons/lights/SunShadowNode.js'), "lights/SunShadowNode.js"),
  "lines/Line2.js": /* @__PURE__ */ __name(() => import('three/addons/lines/Line2.js'), "lines/Line2.js"),
  "lines/LineGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/lines/LineGeometry.js'), "lines/LineGeometry.js"),
  "lines/LineMaterial.js": /* @__PURE__ */ __name(() => import('three/addons/lines/LineMaterial.js'), "lines/LineMaterial.js"),
  "lines/LineSegments2.js": /* @__PURE__ */ __name(() => import('three/addons/lines/LineSegments2.js'), "lines/LineSegments2.js"),
  "lines/LineSegmentsGeometry.js": /* @__PURE__ */ __name(() => import('three/addons/lines/LineSegmentsGeometry.js'), "lines/LineSegmentsGeometry.js"),
  "lines/Wireframe.js": /* @__PURE__ */ __name(() => import('three/addons/lines/Wireframe.js'), "lines/Wireframe.js"),
  "lines/WireframeGeometry2.js": /* @__PURE__ */ __name(() => import('three/addons/lines/WireframeGeometry2.js'), "lines/WireframeGeometry2.js"),
  "lines/webgpu/Line2.js": /* @__PURE__ */ __name(() => import('three/addons/lines/webgpu/Line2.js'), "lines/webgpu/Line2.js"),
  "lines/webgpu/LineSegments2.js": /* @__PURE__ */ __name(() => import('three/addons/lines/webgpu/LineSegments2.js'), "lines/webgpu/LineSegments2.js"),
  "lines/webgpu/Wireframe.js": /* @__PURE__ */ __name(() => import('three/addons/lines/webgpu/Wireframe.js'), "lines/webgpu/Wireframe.js"),
  "loaders/3DMLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/3DMLoader.js'), "loaders/3DMLoader.js"),
  "loaders/3MFLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/3MFLoader.js'), "loaders/3MFLoader.js"),
  "loaders/AMFLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/AMFLoader.js'), "loaders/AMFLoader.js"),
  "loaders/BVHLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/BVHLoader.js'), "loaders/BVHLoader.js"),
  "loaders/ColladaLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/ColladaLoader.js'), "loaders/ColladaLoader.js"),
  "loaders/DDSLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/DDSLoader.js'), "loaders/DDSLoader.js"),
  "loaders/DRACOLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/DRACOLoader.js'), "loaders/DRACOLoader.js"),
  "loaders/EXRLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/EXRLoader.js'), "loaders/EXRLoader.js"),
  "loaders/FBXLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/FBXLoader.js'), "loaders/FBXLoader.js"),
  "loaders/FontLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/FontLoader.js'), "loaders/FontLoader.js"),
  "loaders/GCodeLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/GCodeLoader.js'), "loaders/GCodeLoader.js"),
  "loaders/GLTFGaussianSplatLoaderExtension.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/GLTFGaussianSplatLoaderExtension.js'), "loaders/GLTFGaussianSplatLoaderExtension.js"),
  "loaders/GLTFLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/GLTFLoader.js'), "loaders/GLTFLoader.js"),
  "loaders/GaussianSplatPLYLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/GaussianSplatPLYLoader.js'), "loaders/GaussianSplatPLYLoader.js"),
  "loaders/HDRCubeTextureLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/HDRCubeTextureLoader.js'), "loaders/HDRCubeTextureLoader.js"),
  "loaders/HDRLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/HDRLoader.js'), "loaders/HDRLoader.js"),
  "loaders/IESLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/IESLoader.js'), "loaders/IESLoader.js"),
  "loaders/JXLLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/JXLLoader.js'), "loaders/JXLLoader.js"),
  "loaders/KMZLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/KMZLoader.js'), "loaders/KMZLoader.js"),
  "loaders/KSPLATLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/KSPLATLoader.js'), "loaders/KSPLATLoader.js"),
  "loaders/KTX2Loader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/KTX2Loader.js'), "loaders/KTX2Loader.js"),
  "loaders/KTXLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/KTXLoader.js'), "loaders/KTXLoader.js"),
  "loaders/LDrawLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/LDrawLoader.js'), "loaders/LDrawLoader.js"),
  "loaders/LUT3dlLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/LUT3dlLoader.js'), "loaders/LUT3dlLoader.js"),
  "loaders/LUTCubeLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/LUTCubeLoader.js'), "loaders/LUTCubeLoader.js"),
  "loaders/LUTImageLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/LUTImageLoader.js'), "loaders/LUTImageLoader.js"),
  "loaders/LWOLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/LWOLoader.js'), "loaders/LWOLoader.js"),
  "loaders/MD2Loader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/MD2Loader.js'), "loaders/MD2Loader.js"),
  "loaders/MDDLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/MDDLoader.js'), "loaders/MDDLoader.js"),
  "loaders/MTLLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/MTLLoader.js'), "loaders/MTLLoader.js"),
  "loaders/MaterialXLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/MaterialXLoader.js'), "loaders/MaterialXLoader.js"),
  "loaders/NRRDLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/NRRDLoader.js'), "loaders/NRRDLoader.js"),
  "loaders/OBJLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/OBJLoader.js'), "loaders/OBJLoader.js"),
  "loaders/PCDLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/PCDLoader.js'), "loaders/PCDLoader.js"),
  "loaders/PDBLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/PDBLoader.js'), "loaders/PDBLoader.js"),
  "loaders/PLYLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/PLYLoader.js'), "loaders/PLYLoader.js"),
  "loaders/PVRLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/PVRLoader.js'), "loaders/PVRLoader.js"),
  "loaders/RGBELoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/RGBELoader.js'), "loaders/RGBELoader.js"),
  "loaders/SPLATLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/SPLATLoader.js'), "loaders/SPLATLoader.js"),
  "loaders/SPZLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/SPZLoader.js'), "loaders/SPZLoader.js"),
  "loaders/STLLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/STLLoader.js'), "loaders/STLLoader.js"),
  "loaders/SVGLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/SVGLoader.js'), "loaders/SVGLoader.js"),
  "loaders/TDSLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/TDSLoader.js'), "loaders/TDSLoader.js"),
  "loaders/TGALoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/TGALoader.js'), "loaders/TGALoader.js"),
  "loaders/TIFFLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/TIFFLoader.js'), "loaders/TIFFLoader.js"),
  "loaders/USDLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/USDLoader.js'), "loaders/USDLoader.js"),
  "loaders/USDZLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/USDZLoader.js'), "loaders/USDZLoader.js"),
  "loaders/UltraHDRLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/UltraHDRLoader.js'), "loaders/UltraHDRLoader.js"),
  "loaders/VOXLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/VOXLoader.js'), "loaders/VOXLoader.js"),
  "loaders/VRMLLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/VRMLLoader.js'), "loaders/VRMLLoader.js"),
  "loaders/VTKLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/VTKLoader.js'), "loaders/VTKLoader.js"),
  "loaders/XYZLoader.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/XYZLoader.js'), "loaders/XYZLoader.js"),
  "loaders/collada/ColladaComposer.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/collada/ColladaComposer.js'), "loaders/collada/ColladaComposer.js"),
  "loaders/collada/ColladaParser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/collada/ColladaParser.js'), "loaders/collada/ColladaParser.js"),
  "loaders/lwo/IFFParser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/lwo/IFFParser.js'), "loaders/lwo/IFFParser.js"),
  "loaders/lwo/LWO2Parser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/lwo/LWO2Parser.js'), "loaders/lwo/LWO2Parser.js"),
  "loaders/lwo/LWO3Parser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/lwo/LWO3Parser.js'), "loaders/lwo/LWO3Parser.js"),
  "loaders/materialx/MaterialXArchive.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXArchive.js'), "loaders/materialx/MaterialXArchive.js"),
  "loaders/materialx/MaterialXDocument.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXDocument.js'), "loaders/materialx/MaterialXDocument.js"),
  "loaders/materialx/MaterialXHextile.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXHextile.js'), "loaders/materialx/MaterialXHextile.js"),
  "loaders/materialx/MaterialXInterfaceValidation.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXInterfaceValidation.js'), "loaders/materialx/MaterialXInterfaceValidation.js"),
  "loaders/materialx/MaterialXLog.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXLog.js'), "loaders/materialx/MaterialXLog.js"),
  "loaders/materialx/MaterialXNodeDefs.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXNodeDefs.js'), "loaders/materialx/MaterialXNodeDefs.js"),
  "loaders/materialx/MaterialXNodeInterfaceRegistry.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXNodeInterfaceRegistry.js'), "loaders/materialx/MaterialXNodeInterfaceRegistry.js"),
  "loaders/materialx/MaterialXNodeLibrary.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXNodeLibrary.js'), "loaders/materialx/MaterialXNodeLibrary.js"),
  "loaders/materialx/MaterialXSurfaceMappings.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXSurfaceMappings.js'), "loaders/materialx/MaterialXSurfaceMappings.js"),
  "loaders/materialx/MaterialXUtils.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/MaterialXUtils.js'), "loaders/materialx/MaterialXUtils.js"),
  "loaders/materialx/compile/MaterialXCompileRegistry.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/compile/MaterialXCompileRegistry.js'), "loaders/materialx/compile/MaterialXCompileRegistry.js"),
  "loaders/materialx/parse/MaterialXParser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/materialx/parse/MaterialXParser.js'), "loaders/materialx/parse/MaterialXParser.js"),
  "loaders/usd/USDAParser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/usd/USDAParser.js'), "loaders/usd/USDAParser.js"),
  "loaders/usd/USDCParser.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/usd/USDCParser.js'), "loaders/usd/USDCParser.js"),
  "loaders/usd/USDComposer.js": /* @__PURE__ */ __name(() => import('three/addons/loaders/usd/USDComposer.js'), "loaders/usd/USDComposer.js"),
  "materials/LDrawConditionalLineMaterial.js": /* @__PURE__ */ __name(() => import('three/addons/materials/LDrawConditionalLineMaterial.js'), "materials/LDrawConditionalLineMaterial.js"),
  "materials/LDrawConditionalLineNodeMaterial.js": /* @__PURE__ */ __name(() => import('three/addons/materials/LDrawConditionalLineNodeMaterial.js'), "materials/LDrawConditionalLineNodeMaterial.js"),
  "materials/WoodNodeMaterial.js": /* @__PURE__ */ __name(() => import('three/addons/materials/WoodNodeMaterial.js'), "materials/WoodNodeMaterial.js"),
  "math/Capsule.js": /* @__PURE__ */ __name(() => import('three/addons/math/Capsule.js'), "math/Capsule.js"),
  "math/ColorConverter.js": /* @__PURE__ */ __name(() => import('three/addons/math/ColorConverter.js'), "math/ColorConverter.js"),
  "math/ColorSpaces.js": /* @__PURE__ */ __name(() => import('three/addons/math/ColorSpaces.js'), "math/ColorSpaces.js"),
  "math/ConvexHull.js": /* @__PURE__ */ __name(() => import('three/addons/math/ConvexHull.js'), "math/ConvexHull.js"),
  "math/ImprovedNoise.js": /* @__PURE__ */ __name(() => import('three/addons/math/ImprovedNoise.js'), "math/ImprovedNoise.js"),
  "math/Lut.js": /* @__PURE__ */ __name(() => import('three/addons/math/Lut.js'), "math/Lut.js"),
  "math/MeshSurfaceSampler.js": /* @__PURE__ */ __name(() => import('three/addons/math/MeshSurfaceSampler.js'), "math/MeshSurfaceSampler.js"),
  "math/OBB.js": /* @__PURE__ */ __name(() => import('three/addons/math/OBB.js'), "math/OBB.js"),
  "math/Octree.js": /* @__PURE__ */ __name(() => import('three/addons/math/Octree.js'), "math/Octree.js"),
  "math/SimplexNoise.js": /* @__PURE__ */ __name(() => import('three/addons/math/SimplexNoise.js'), "math/SimplexNoise.js"),
  "misc/ConvexObjectBreaker.js": /* @__PURE__ */ __name(() => import('three/addons/misc/ConvexObjectBreaker.js'), "misc/ConvexObjectBreaker.js"),
  "misc/GPUComputationRenderer.js": /* @__PURE__ */ __name(() => import('three/addons/misc/GPUComputationRenderer.js'), "misc/GPUComputationRenderer.js"),
  "misc/Gyroscope.js": /* @__PURE__ */ __name(() => import('three/addons/misc/Gyroscope.js'), "misc/Gyroscope.js"),
  "misc/MD2Character.js": /* @__PURE__ */ __name(() => import('three/addons/misc/MD2Character.js'), "misc/MD2Character.js"),
  "misc/MD2CharacterComplex.js": /* @__PURE__ */ __name(() => import('three/addons/misc/MD2CharacterComplex.js'), "misc/MD2CharacterComplex.js"),
  "misc/MorphAnimMesh.js": /* @__PURE__ */ __name(() => import('three/addons/misc/MorphAnimMesh.js'), "misc/MorphAnimMesh.js"),
  "misc/MorphBlendMesh.js": /* @__PURE__ */ __name(() => import('three/addons/misc/MorphBlendMesh.js'), "misc/MorphBlendMesh.js"),
  "misc/ProgressiveLightMap.js": /* @__PURE__ */ __name(() => import('three/addons/misc/ProgressiveLightMap.js'), "misc/ProgressiveLightMap.js"),
  "misc/ProgressiveLightMapGPU.js": /* @__PURE__ */ __name(() => import('three/addons/misc/ProgressiveLightMapGPU.js'), "misc/ProgressiveLightMapGPU.js"),
  "misc/RollerCoaster.js": /* @__PURE__ */ __name(() => import('three/addons/misc/RollerCoaster.js'), "misc/RollerCoaster.js"),
  "misc/Sculptor.js": /* @__PURE__ */ __name(() => import('three/addons/misc/Sculptor.js'), "misc/Sculptor.js"),
  "misc/SculptorMesh.js": /* @__PURE__ */ __name(() => import('three/addons/misc/SculptorMesh.js'), "misc/SculptorMesh.js"),
  "misc/SculptorTools.js": /* @__PURE__ */ __name(() => import('three/addons/misc/SculptorTools.js'), "misc/SculptorTools.js"),
  "misc/SculptorUtils.js": /* @__PURE__ */ __name(() => import('three/addons/misc/SculptorUtils.js'), "misc/SculptorUtils.js"),
  "misc/TileCreasedNormalsPlugin.js": /* @__PURE__ */ __name(() => import('three/addons/misc/TileCreasedNormalsPlugin.js'), "misc/TileCreasedNormalsPlugin.js"),
  "misc/TubePainter.js": /* @__PURE__ */ __name(() => import('three/addons/misc/TubePainter.js'), "misc/TubePainter.js"),
  "misc/Volume.js": /* @__PURE__ */ __name(() => import('three/addons/misc/Volume.js'), "misc/Volume.js"),
  "misc/VolumeSlice.js": /* @__PURE__ */ __name(() => import('three/addons/misc/VolumeSlice.js'), "misc/VolumeSlice.js"),
  "modifiers/CurveModifier.js": /* @__PURE__ */ __name(() => import('three/addons/modifiers/CurveModifier.js'), "modifiers/CurveModifier.js"),
  "modifiers/CurveModifierGPU.js": /* @__PURE__ */ __name(() => import('three/addons/modifiers/CurveModifierGPU.js'), "modifiers/CurveModifierGPU.js"),
  "modifiers/EdgeSplitModifier.js": /* @__PURE__ */ __name(() => import('three/addons/modifiers/EdgeSplitModifier.js'), "modifiers/EdgeSplitModifier.js"),
  "modifiers/SimplifyModifier.js": /* @__PURE__ */ __name(() => import('three/addons/modifiers/SimplifyModifier.js'), "modifiers/SimplifyModifier.js"),
  "modifiers/TessellateModifier.js": /* @__PURE__ */ __name(() => import('three/addons/modifiers/TessellateModifier.js'), "modifiers/TessellateModifier.js"),
  "objects/GaussianSplat.js": /* @__PURE__ */ __name(() => import('three/addons/objects/GaussianSplat.js'), "objects/GaussianSplat.js"),
  "objects/GroundedSkybox.js": /* @__PURE__ */ __name(() => import('three/addons/objects/GroundedSkybox.js'), "objects/GroundedSkybox.js"),
  "objects/Lensflare.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Lensflare.js'), "objects/Lensflare.js"),
  "objects/LensflareMesh.js": /* @__PURE__ */ __name(() => import('three/addons/objects/LensflareMesh.js'), "objects/LensflareMesh.js"),
  "objects/MarchingCubes.js": /* @__PURE__ */ __name(() => import('three/addons/objects/MarchingCubes.js'), "objects/MarchingCubes.js"),
  "objects/Reflector.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Reflector.js'), "objects/Reflector.js"),
  "objects/ReflectorForSSRPass.js": /* @__PURE__ */ __name(() => import('three/addons/objects/ReflectorForSSRPass.js'), "objects/ReflectorForSSRPass.js"),
  "objects/Refractor.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Refractor.js'), "objects/Refractor.js"),
  "objects/ShadowMesh.js": /* @__PURE__ */ __name(() => import('three/addons/objects/ShadowMesh.js'), "objects/ShadowMesh.js"),
  "objects/Sky.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Sky.js'), "objects/Sky.js"),
  "objects/SkyMesh.js": /* @__PURE__ */ __name(() => import('three/addons/objects/SkyMesh.js'), "objects/SkyMesh.js"),
  "objects/Water.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Water.js'), "objects/Water.js"),
  "objects/Water2.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Water2.js'), "objects/Water2.js"),
  "objects/Water2Mesh.js": /* @__PURE__ */ __name(() => import('three/addons/objects/Water2Mesh.js'), "objects/Water2Mesh.js"),
  "objects/WaterMesh.js": /* @__PURE__ */ __name(() => import('three/addons/objects/WaterMesh.js'), "objects/WaterMesh.js"),
  "offscreen/jank.js": /* @__PURE__ */ __name(() => import('three/addons/offscreen/jank.js'), "offscreen/jank.js"),
  "offscreen/scene.js": /* @__PURE__ */ __name(() => import('three/addons/offscreen/scene.js'), "offscreen/scene.js"),
  "physics/AmmoPhysics.js": /* @__PURE__ */ __name(() => import('three/addons/physics/AmmoPhysics.js'), "physics/AmmoPhysics.js"),
  "physics/JoltPhysics.js": /* @__PURE__ */ __name(() => import('three/addons/physics/JoltPhysics.js'), "physics/JoltPhysics.js"),
  "physics/RapierPhysics.js": /* @__PURE__ */ __name(() => import('three/addons/physics/RapierPhysics.js'), "physics/RapierPhysics.js"),
  "pipelines/MeshletDrawingPipeline.js": /* @__PURE__ */ __name(() => import('three/addons/pipelines/MeshletDrawingPipeline.js'), "pipelines/MeshletDrawingPipeline.js"),
  "pipelines/VisibilityBufferDrawingPipeline.js": /* @__PURE__ */ __name(() => import('three/addons/pipelines/VisibilityBufferDrawingPipeline.js'), "pipelines/VisibilityBufferDrawingPipeline.js"),
  "postprocessing/AfterimagePass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/AfterimagePass.js'), "postprocessing/AfterimagePass.js"),
  "postprocessing/BloomPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/BloomPass.js'), "postprocessing/BloomPass.js"),
  "postprocessing/BokehPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/BokehPass.js'), "postprocessing/BokehPass.js"),
  "postprocessing/ClearPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/ClearPass.js'), "postprocessing/ClearPass.js"),
  "postprocessing/CubeTexturePass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/CubeTexturePass.js'), "postprocessing/CubeTexturePass.js"),
  "postprocessing/DotScreenPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/DotScreenPass.js'), "postprocessing/DotScreenPass.js"),
  "postprocessing/EffectComposer.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/EffectComposer.js'), "postprocessing/EffectComposer.js"),
  "postprocessing/FXAAPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/FXAAPass.js'), "postprocessing/FXAAPass.js"),
  "postprocessing/FilmPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/FilmPass.js'), "postprocessing/FilmPass.js"),
  "postprocessing/GTAOPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/GTAOPass.js'), "postprocessing/GTAOPass.js"),
  "postprocessing/GlitchPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/GlitchPass.js'), "postprocessing/GlitchPass.js"),
  "postprocessing/HalftonePass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/HalftonePass.js'), "postprocessing/HalftonePass.js"),
  "postprocessing/LUTPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/LUTPass.js'), "postprocessing/LUTPass.js"),
  "postprocessing/MaskPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/MaskPass.js'), "postprocessing/MaskPass.js"),
  "postprocessing/OutlinePass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/OutlinePass.js'), "postprocessing/OutlinePass.js"),
  "postprocessing/OutputPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/OutputPass.js'), "postprocessing/OutputPass.js"),
  "postprocessing/Pass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/Pass.js'), "postprocessing/Pass.js"),
  "postprocessing/RenderPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/RenderPass.js'), "postprocessing/RenderPass.js"),
  "postprocessing/RenderPixelatedPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/RenderPixelatedPass.js'), "postprocessing/RenderPixelatedPass.js"),
  "postprocessing/RenderTransitionPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/RenderTransitionPass.js'), "postprocessing/RenderTransitionPass.js"),
  "postprocessing/SAOPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/SAOPass.js'), "postprocessing/SAOPass.js"),
  "postprocessing/SMAAPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/SMAAPass.js'), "postprocessing/SMAAPass.js"),
  "postprocessing/SSAARenderPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/SSAARenderPass.js'), "postprocessing/SSAARenderPass.js"),
  "postprocessing/SSAOPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/SSAOPass.js'), "postprocessing/SSAOPass.js"),
  "postprocessing/SSRPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/SSRPass.js'), "postprocessing/SSRPass.js"),
  "postprocessing/SavePass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/SavePass.js'), "postprocessing/SavePass.js"),
  "postprocessing/ShaderPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/ShaderPass.js'), "postprocessing/ShaderPass.js"),
  "postprocessing/TAARenderPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/TAARenderPass.js'), "postprocessing/TAARenderPass.js"),
  "postprocessing/TexturePass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/TexturePass.js'), "postprocessing/TexturePass.js"),
  "postprocessing/UnrealBloomPass.js": /* @__PURE__ */ __name(() => import('three/addons/postprocessing/UnrealBloomPass.js'), "postprocessing/UnrealBloomPass.js"),
  "renderers/CSS2DRenderer.js": /* @__PURE__ */ __name(() => import('three/addons/renderers/CSS2DRenderer.js'), "renderers/CSS2DRenderer.js"),
  "renderers/CSS3DRenderer.js": /* @__PURE__ */ __name(() => import('three/addons/renderers/CSS3DRenderer.js'), "renderers/CSS3DRenderer.js"),
  "renderers/Projector.js": /* @__PURE__ */ __name(() => import('three/addons/renderers/Projector.js'), "renderers/Projector.js"),
  "renderers/SVGRenderer.js": /* @__PURE__ */ __name(() => import('three/addons/renderers/SVGRenderer.js'), "renderers/SVGRenderer.js"),
  "shaders/ACESFilmicToneMappingShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/ACESFilmicToneMappingShader.js'), "shaders/ACESFilmicToneMappingShader.js"),
  "shaders/AfterimageShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/AfterimageShader.js'), "shaders/AfterimageShader.js"),
  "shaders/BasicShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/BasicShader.js'), "shaders/BasicShader.js"),
  "shaders/BleachBypassShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/BleachBypassShader.js'), "shaders/BleachBypassShader.js"),
  "shaders/BlendShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/BlendShader.js'), "shaders/BlendShader.js"),
  "shaders/BokehShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/BokehShader.js'), "shaders/BokehShader.js"),
  "shaders/BokehShader2.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/BokehShader2.js'), "shaders/BokehShader2.js"),
  "shaders/BrightnessContrastShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/BrightnessContrastShader.js'), "shaders/BrightnessContrastShader.js"),
  "shaders/ColorCorrectionShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/ColorCorrectionShader.js'), "shaders/ColorCorrectionShader.js"),
  "shaders/ColorifyShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/ColorifyShader.js'), "shaders/ColorifyShader.js"),
  "shaders/ConvolutionShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/ConvolutionShader.js'), "shaders/ConvolutionShader.js"),
  "shaders/CopyShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/CopyShader.js'), "shaders/CopyShader.js"),
  "shaders/DOFMipMapShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/DOFMipMapShader.js'), "shaders/DOFMipMapShader.js"),
  "shaders/DepthLimitedBlurShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/DepthLimitedBlurShader.js'), "shaders/DepthLimitedBlurShader.js"),
  "shaders/DigitalGlitch.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/DigitalGlitch.js'), "shaders/DigitalGlitch.js"),
  "shaders/DotScreenShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/DotScreenShader.js'), "shaders/DotScreenShader.js"),
  "shaders/ExposureShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/ExposureShader.js'), "shaders/ExposureShader.js"),
  "shaders/FXAAShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/FXAAShader.js'), "shaders/FXAAShader.js"),
  "shaders/FilmShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/FilmShader.js'), "shaders/FilmShader.js"),
  "shaders/FocusShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/FocusShader.js'), "shaders/FocusShader.js"),
  "shaders/FreiChenShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/FreiChenShader.js'), "shaders/FreiChenShader.js"),
  "shaders/GTAOShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/GTAOShader.js'), "shaders/GTAOShader.js"),
  "shaders/GammaCorrectionShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/GammaCorrectionShader.js'), "shaders/GammaCorrectionShader.js"),
  "shaders/HalftoneShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/HalftoneShader.js'), "shaders/HalftoneShader.js"),
  "shaders/HorizontalBlurShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/HorizontalBlurShader.js'), "shaders/HorizontalBlurShader.js"),
  "shaders/HorizontalTiltShiftShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/HorizontalTiltShiftShader.js'), "shaders/HorizontalTiltShiftShader.js"),
  "shaders/HueSaturationShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/HueSaturationShader.js'), "shaders/HueSaturationShader.js"),
  "shaders/KaleidoShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/KaleidoShader.js'), "shaders/KaleidoShader.js"),
  "shaders/LuminosityHighPassShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/LuminosityHighPassShader.js'), "shaders/LuminosityHighPassShader.js"),
  "shaders/LuminosityShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/LuminosityShader.js'), "shaders/LuminosityShader.js"),
  "shaders/MirrorShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/MirrorShader.js'), "shaders/MirrorShader.js"),
  "shaders/NormalMapShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/NormalMapShader.js'), "shaders/NormalMapShader.js"),
  "shaders/OutputShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/OutputShader.js'), "shaders/OutputShader.js"),
  "shaders/PoissonDenoiseShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/PoissonDenoiseShader.js'), "shaders/PoissonDenoiseShader.js"),
  "shaders/RGBShiftShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/RGBShiftShader.js'), "shaders/RGBShiftShader.js"),
  "shaders/SAOShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SAOShader.js'), "shaders/SAOShader.js"),
  "shaders/SMAAShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SMAAShader.js'), "shaders/SMAAShader.js"),
  "shaders/SSAOShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SSAOShader.js'), "shaders/SSAOShader.js"),
  "shaders/SSRShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SSRShader.js'), "shaders/SSRShader.js"),
  "shaders/SepiaShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SepiaShader.js'), "shaders/SepiaShader.js"),
  "shaders/SobelOperatorShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SobelOperatorShader.js'), "shaders/SobelOperatorShader.js"),
  "shaders/SubsurfaceScatteringShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/SubsurfaceScatteringShader.js'), "shaders/SubsurfaceScatteringShader.js"),
  "shaders/TechnicolorShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/TechnicolorShader.js'), "shaders/TechnicolorShader.js"),
  "shaders/ToonShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/ToonShader.js'), "shaders/ToonShader.js"),
  "shaders/TriangleBlurShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/TriangleBlurShader.js'), "shaders/TriangleBlurShader.js"),
  "shaders/UnpackDepthRGBAShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/UnpackDepthRGBAShader.js'), "shaders/UnpackDepthRGBAShader.js"),
  "shaders/VelocityShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/VelocityShader.js'), "shaders/VelocityShader.js"),
  "shaders/VerticalBlurShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/VerticalBlurShader.js'), "shaders/VerticalBlurShader.js"),
  "shaders/VerticalTiltShiftShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/VerticalTiltShiftShader.js'), "shaders/VerticalTiltShiftShader.js"),
  "shaders/VignetteShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/VignetteShader.js'), "shaders/VignetteShader.js"),
  "shaders/VolumeShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/VolumeShader.js'), "shaders/VolumeShader.js"),
  "shaders/WaterRefractionShader.js": /* @__PURE__ */ __name(() => import('three/addons/shaders/WaterRefractionShader.js'), "shaders/WaterRefractionShader.js"),
  "textures/FlakesTexture.js": /* @__PURE__ */ __name(() => import('three/addons/textures/FlakesTexture.js'), "textures/FlakesTexture.js"),
  "transpiler/AST.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/AST.js'), "transpiler/AST.js"),
  "transpiler/GLSLDecoder.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/GLSLDecoder.js'), "transpiler/GLSLDecoder.js"),
  "transpiler/Linker.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/Linker.js'), "transpiler/Linker.js"),
  "transpiler/ShaderToyDecoder.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/ShaderToyDecoder.js'), "transpiler/ShaderToyDecoder.js"),
  "transpiler/TSLEncoder.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/TSLEncoder.js'), "transpiler/TSLEncoder.js"),
  "transpiler/Transpiler.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/Transpiler.js'), "transpiler/Transpiler.js"),
  "transpiler/TranspilerUtils.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/TranspilerUtils.js'), "transpiler/TranspilerUtils.js"),
  "transpiler/WGSLEncoder.js": /* @__PURE__ */ __name(() => import('three/addons/transpiler/WGSLEncoder.js'), "transpiler/WGSLEncoder.js"),
  "tsl/WebGLNodesHandler.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/WebGLNodesHandler.js'), "tsl/WebGLNodesHandler.js"),
  "tsl/display/AfterImageNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/AfterImageNode.js'), "tsl/display/AfterImageNode.js"),
  "tsl/display/AnaglyphPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/AnaglyphPassNode.js'), "tsl/display/AnaglyphPassNode.js"),
  "tsl/display/BilateralBlurNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/BilateralBlurNode.js'), "tsl/display/BilateralBlurNode.js"),
  "tsl/display/BleachBypass.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/BleachBypass.js'), "tsl/display/BleachBypass.js"),
  "tsl/display/BloomNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/BloomNode.js'), "tsl/display/BloomNode.js"),
  "tsl/display/CRT.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/CRT.js'), "tsl/display/CRT.js"),
  "tsl/display/ChromaticAberrationNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/ChromaticAberrationNode.js'), "tsl/display/ChromaticAberrationNode.js"),
  "tsl/display/DenoiseNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/DenoiseNode.js'), "tsl/display/DenoiseNode.js"),
  "tsl/display/DepthOfFieldNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/DepthOfFieldNode.js'), "tsl/display/DepthOfFieldNode.js"),
  "tsl/display/DotScreenNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/DotScreenNode.js'), "tsl/display/DotScreenNode.js"),
  "tsl/display/FSR1Node.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/FSR1Node.js'), "tsl/display/FSR1Node.js"),
  "tsl/display/FXAANode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/FXAANode.js'), "tsl/display/FXAANode.js"),
  "tsl/display/FilmNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/FilmNode.js'), "tsl/display/FilmNode.js"),
  "tsl/display/GTAONode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/GTAONode.js'), "tsl/display/GTAONode.js"),
  "tsl/display/GaussianBlurNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/GaussianBlurNode.js'), "tsl/display/GaussianBlurNode.js"),
  "tsl/display/GodraysNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/GodraysNode.js'), "tsl/display/GodraysNode.js"),
  "tsl/display/ImportanceSampledEnvironment.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/ImportanceSampledEnvironment.js'), "tsl/display/ImportanceSampledEnvironment.js"),
  "tsl/display/LensflareNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/LensflareNode.js'), "tsl/display/LensflareNode.js"),
  "tsl/display/Lut3DNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/Lut3DNode.js'), "tsl/display/Lut3DNode.js"),
  "tsl/display/MotionBlur.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/MotionBlur.js'), "tsl/display/MotionBlur.js"),
  "tsl/display/OITPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/OITPassNode.js'), "tsl/display/OITPassNode.js"),
  "tsl/display/OutlineNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/OutlineNode.js'), "tsl/display/OutlineNode.js"),
  "tsl/display/ParallaxBarrierPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/ParallaxBarrierPassNode.js'), "tsl/display/ParallaxBarrierPassNode.js"),
  "tsl/display/PixelationPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/PixelationPassNode.js'), "tsl/display/PixelationPassNode.js"),
  "tsl/display/RGBShiftNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/RGBShiftNode.js'), "tsl/display/RGBShiftNode.js"),
  "tsl/display/RecurrentDenoiseNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/RecurrentDenoiseNode.js'), "tsl/display/RecurrentDenoiseNode.js"),
  "tsl/display/RetroPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/RetroPassNode.js'), "tsl/display/RetroPassNode.js"),
  "tsl/display/SMAANode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SMAANode.js'), "tsl/display/SMAANode.js"),
  "tsl/display/SSAAPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SSAAPassNode.js'), "tsl/display/SSAAPassNode.js"),
  "tsl/display/SSAONode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SSAONode.js'), "tsl/display/SSAONode.js"),
  "tsl/display/SSGINode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SSGINode.js'), "tsl/display/SSGINode.js"),
  "tsl/display/SSRNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SSRNode.js'), "tsl/display/SSRNode.js"),
  "tsl/display/SSSNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SSSNode.js'), "tsl/display/SSSNode.js"),
  "tsl/display/Sepia.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/Sepia.js'), "tsl/display/Sepia.js"),
  "tsl/display/Shape.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/Shape.js'), "tsl/display/Shape.js"),
  "tsl/display/SharpenNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SharpenNode.js'), "tsl/display/SharpenNode.js"),
  "tsl/display/SobelOperatorNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/SobelOperatorNode.js'), "tsl/display/SobelOperatorNode.js"),
  "tsl/display/StereoCompositePassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/StereoCompositePassNode.js'), "tsl/display/StereoCompositePassNode.js"),
  "tsl/display/StereoPassNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/StereoPassNode.js'), "tsl/display/StereoPassNode.js"),
  "tsl/display/TAAUNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/TAAUNode.js'), "tsl/display/TAAUNode.js"),
  "tsl/display/TRAANode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/TRAANode.js'), "tsl/display/TRAANode.js"),
  "tsl/display/TemporalReprojectNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/TemporalReprojectNode.js'), "tsl/display/TemporalReprojectNode.js"),
  "tsl/display/TransitionNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/TransitionNode.js'), "tsl/display/TransitionNode.js"),
  "tsl/display/boxBlur.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/boxBlur.js'), "tsl/display/boxBlur.js"),
  "tsl/display/depthAwareBlend.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/depthAwareBlend.js'), "tsl/display/depthAwareBlend.js"),
  "tsl/display/depthAwareBlur.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/depthAwareBlur.js'), "tsl/display/depthAwareBlur.js"),
  "tsl/display/hashBlur.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/hashBlur.js'), "tsl/display/hashBlur.js"),
  "tsl/display/lensDirt.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/lensDirt.js'), "tsl/display/lensDirt.js"),
  "tsl/display/radialBlur.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/display/radialBlur.js'), "tsl/display/radialBlur.js"),
  "tsl/lighting/ClusteredLightsNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/ClusteredLightsNode.js'), "tsl/lighting/ClusteredLightsNode.js"),
  "tsl/lighting/DynamicLightsNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/DynamicLightsNode.js'), "tsl/lighting/DynamicLightsNode.js"),
  "tsl/lighting/LightProbeGridNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/LightProbeGridNode.js'), "tsl/lighting/LightProbeGridNode.js"),
  "tsl/lighting/data/AmbientLightDataNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/data/AmbientLightDataNode.js'), "tsl/lighting/data/AmbientLightDataNode.js"),
  "tsl/lighting/data/DirectionalLightDataNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/data/DirectionalLightDataNode.js'), "tsl/lighting/data/DirectionalLightDataNode.js"),
  "tsl/lighting/data/HemisphereLightDataNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/data/HemisphereLightDataNode.js'), "tsl/lighting/data/HemisphereLightDataNode.js"),
  "tsl/lighting/data/PointLightDataNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/data/PointLightDataNode.js'), "tsl/lighting/data/PointLightDataNode.js"),
  "tsl/lighting/data/SpotLightDataNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/lighting/data/SpotLightDataNode.js'), "tsl/lighting/data/SpotLightDataNode.js"),
  "tsl/math/Bayer.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/math/Bayer.js'), "tsl/math/Bayer.js"),
  "tsl/math/curlNoise.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/math/curlNoise.js'), "tsl/math/curlNoise.js"),
  "tsl/math/voronoiNoise.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/math/voronoiNoise.js'), "tsl/math/voronoiNoise.js"),
  "tsl/shadows/TileShadowNode.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/shadows/TileShadowNode.js'), "tsl/shadows/TileShadowNode.js"),
  "tsl/shadows/TileShadowNodeHelper.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/shadows/TileShadowNodeHelper.js'), "tsl/shadows/TileShadowNodeHelper.js"),
  "tsl/utils/GroundedSkybox.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/utils/GroundedSkybox.js'), "tsl/utils/GroundedSkybox.js"),
  "tsl/utils/RNoise.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/utils/RNoise.js'), "tsl/utils/RNoise.js"),
  "tsl/utils/Raymarching.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/utils/Raymarching.js'), "tsl/utils/Raymarching.js"),
  "tsl/utils/SoftParticles.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/utils/SoftParticles.js'), "tsl/utils/SoftParticles.js"),
  "tsl/utils/SpecularHelpers.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/utils/SpecularHelpers.js'), "tsl/utils/SpecularHelpers.js"),
  "tsl/utils/TAAUtils.js": /* @__PURE__ */ __name(() => import('three/addons/tsl/utils/TAAUtils.js'), "tsl/utils/TAAUtils.js"),
  "utils/BufferGeometryUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/BufferGeometryUtils.js'), "utils/BufferGeometryUtils.js"),
  "utils/CameraUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/CameraUtils.js'), "utils/CameraUtils.js"),
  "utils/ColorUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/ColorUtils.js'), "utils/ColorUtils.js"),
  "utils/GaussianSplatUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/GaussianSplatUtils.js'), "utils/GaussianSplatUtils.js"),
  "utils/GeometryCompressionUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/GeometryCompressionUtils.js'), "utils/GeometryCompressionUtils.js"),
  "utils/GeometryUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/GeometryUtils.js'), "utils/GeometryUtils.js"),
  "utils/LDrawUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/LDrawUtils.js'), "utils/LDrawUtils.js"),
  "utils/MeshletGeometryUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/MeshletGeometryUtils.js'), "utils/MeshletGeometryUtils.js"),
  "utils/SceneOptimizer.js": /* @__PURE__ */ __name(() => import('three/addons/utils/SceneOptimizer.js'), "utils/SceneOptimizer.js"),
  "utils/SceneUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/SceneUtils.js'), "utils/SceneUtils.js"),
  "utils/ShadowMapViewer.js": /* @__PURE__ */ __name(() => import('three/addons/utils/ShadowMapViewer.js'), "utils/ShadowMapViewer.js"),
  "utils/ShadowMapViewerGPU.js": /* @__PURE__ */ __name(() => import('three/addons/utils/ShadowMapViewerGPU.js'), "utils/ShadowMapViewerGPU.js"),
  "utils/SkeletonUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/SkeletonUtils.js'), "utils/SkeletonUtils.js"),
  "utils/SortUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/SortUtils.js'), "utils/SortUtils.js"),
  "utils/UVsDebug.js": /* @__PURE__ */ __name(() => import('three/addons/utils/UVsDebug.js'), "utils/UVsDebug.js"),
  "utils/WebGLTextureUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/WebGLTextureUtils.js'), "utils/WebGLTextureUtils.js"),
  "utils/WebGPUTextureUtils.js": /* @__PURE__ */ __name(() => import('three/addons/utils/WebGPUTextureUtils.js'), "utils/WebGPUTextureUtils.js"),
  "utils/WorkerPool.js": /* @__PURE__ */ __name(() => import('three/addons/utils/WorkerPool.js'), "utils/WorkerPool.js"),
  "utils/unwrapUVs.js": /* @__PURE__ */ __name(() => import('three/addons/utils/unwrapUVs.js'), "utils/unwrapUVs.js"),
  "webxr/ARButton.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/ARButton.js'), "webxr/ARButton.js"),
  "webxr/OculusHandModel.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/OculusHandModel.js'), "webxr/OculusHandModel.js"),
  "webxr/OculusHandPointerModel.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/OculusHandPointerModel.js'), "webxr/OculusHandPointerModel.js"),
  "webxr/Text2D.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/Text2D.js'), "webxr/Text2D.js"),
  "webxr/VRButton.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/VRButton.js'), "webxr/VRButton.js"),
  "webxr/WebGLXRFallback.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/WebGLXRFallback.js'), "webxr/WebGLXRFallback.js"),
  "webxr/XRButton.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XRButton.js'), "webxr/XRButton.js"),
  "webxr/XRControllerModelFactory.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XRControllerModelFactory.js'), "webxr/XRControllerModelFactory.js"),
  "webxr/XREstimatedLight.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XREstimatedLight.js'), "webxr/XREstimatedLight.js"),
  "webxr/XRHandMeshModel.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XRHandMeshModel.js'), "webxr/XRHandMeshModel.js"),
  "webxr/XRHandModelFactory.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XRHandModelFactory.js'), "webxr/XRHandModelFactory.js"),
  "webxr/XRHandPrimitiveModel.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XRHandPrimitiveModel.js'), "webxr/XRHandPrimitiveModel.js"),
  "webxr/XRPlanes.js": /* @__PURE__ */ __name(() => import('three/addons/webxr/XRPlanes.js'), "webxr/XRPlanes.js")
};
var THREE_ADDONS_LEFT_OUT = {
  "Addons.js": "it imports three/addons/loaders/TTFLoader.js, which can't be loaded in Stave",
  "libs/basis/basis_transcoder.js": "it is a classic script that a loader fetches by URL, not an ES module",
  "libs/demuxer_mp4.js": "it imports a module from a URL (https://cdn.jsdelivr.net/npm/mp4box@2.3.0/+esm), which can't be bundled with Stave",
  "libs/draco/draco_decoder.js": "it is a classic script that a loader fetches by URL, not an ES module",
  "libs/draco/draco_wasm_wrapper.js": "it is a classic script that a loader fetches by URL, not an ES module",
  "libs/draco/gltf/draco_decoder.js": "it is a classic script that a loader fetches by URL, not an ES module",
  "libs/draco/gltf/draco_wasm_wrapper.js": "it is a classic script that a loader fetches by URL, not an ES module",
  "loaders/TTFLoader.js": "it imports a module from a URL (https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/+esm), which can't be bundled with Stave",
  "offscreen/offscreen.js": "it is a worker's entry script (it sets self.onmessage)"
};
var THREE_ADDONS_VERSION = "0.187.0";

// src/visualizers/libraries/hostModules.ts
var ADDONS = THREE_ADDON_LOADERS;
var NEEDS_INPUT = /(^|\/)(OrbitControls|TrackballControls|FlyControls|FirstPersonControls|PointerLockControls|DragControls|TransformControls|MapControls|ArcballControls)\.js$/;
var has = /* @__PURE__ */ __name((o, k) => Object.prototype.hasOwnProperty.call(o, k), "has");
function parseThreeSpecifier(spec) {
  if (spec === "three") return { kind: "three" };
  const m = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(spec);
  if (!m) return null;
  const path = m[1].endsWith(".js") ? m[1] : `${m[1]}.js`;
  return { kind: "addon", path };
}
__name(parseThreeSpecifier, "parseThreeSpecifier");
var threePromise = null;
function loadThree() {
  threePromise ?? (threePromise = import('three'));
  return threePromise;
}
__name(loadThree, "loadThree");
function hostModuleName(spec) {
  const r = parseThreeSpecifier(spec);
  if (!r) return null;
  if (r.kind === "three") return "three";
  if (NEEDS_INPUT.test(r.path)) return null;
  return has(ADDONS, r.path) ? `three/addons/${r.path}` : null;
}
__name(hostModuleName, "hostModuleName");
function loadHostModule(name) {
  if (name === "three") return loadThree();
  return ADDONS[name.slice("three/addons/".length)]();
}
__name(loadHostModule, "loadHostModule");
var hostResolver = {
  name: "host",
  resolve(spec) {
    const name = hostModuleName(spec);
    if (!name) return null;
    if (name === "three") return { kind: "three" };
    return { kind: "module", load: /* @__PURE__ */ __name(() => loadHostModule(name), "load") };
  }
};
function unsupportedImportMessage(spec) {
  const parsed = parseThreeSpecifier(spec);
  if (parsed?.kind === "addon") {
    if (NEEDS_INPUT.test(parsed.path)) {
      return `'${spec}' needs pointer input, which a Stave viz doesn't receive. Move the camera in code instead (for example from \`sig\` or the time).`;
    }
    if (has(THREE_ADDONS_LEFT_OUT, parsed.path)) return `'${spec}' can't be loaded in Stave: ${THREE_ADDONS_LEFT_OUT[parsed.path]}.`;
    return `'${spec}' isn't a three.js addon: three.js ${THREE_ADDONS_VERSION} has no file 'three/addons/${parsed.path}'.`;
  }
  return `'${spec}' isn't available in Stave. A three.js sketch can import 'three' and any 'three/addons/\u2026' file.`;
}
__name(unsupportedImportMessage, "unsupportedImportMessage");
var HOST_CHAIN = {
  links: [hostResolver],
  refusal: unsupportedImportMessage
};

// src/visualizers/libraries/resolver.ts
var _ThreeImportError = class _ThreeImportError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
    this.name = "ThreeImportError";
  }
};
__name(_ThreeImportError, "ThreeImportError");
var ThreeImportError = _ThreeImportError;
function resolveImport(chain, spec) {
  for (const link of chain.links) {
    const r = link.resolve(spec);
    if (r) return r;
  }
  return null;
}
__name(resolveImport, "resolveImport");
function resolveOrRefuse(chain, spec, line) {
  const r = resolveImport(chain, spec);
  if (!r) throw new ThreeImportError(chain.refusal(spec), line);
  return r;
}
__name(resolveOrRefuse, "resolveOrRefuse");

// src/visualizers/renderers/threeSketch.ts
var THREE_LINE_OFFSET = 3;
var PARAMS = ["__env", "__mod", "__import"];
function isIdent(s) {
  return /^[A-Za-z_$][\w$]*$/.test(s);
}
__name(isIdent, "isIdent");
function compileThreeSketch(code) {
  const parsed = parseModule(code);
  if (!parsed.ok) {
    return {
      imports: [],
      source: "",
      syntaxError: new VizSyntaxError(parsed.message, parsed.line, parsed.column !== void 0 ? parsed.column + 1 : void 0)
    };
  }
  const ast = parsed.program;
  const chars = code.split("");
  const blank = /* @__PURE__ */ __name((start, end) => {
    for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  }, "blank");
  const imports = [];
  const bindings = [];
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      const index = imports.length;
      imports.push({ spec: String(node.source.value), line: node.loc.start.line });
      for (const s of node.specifiers) {
        if (s.type === "ImportDefaultSpecifier") bindings.push({ module: index, imported: "default", local: s.local.name });
        else if (s.type === "ImportNamespaceSpecifier") bindings.push({ module: index, imported: "*", local: s.local.name });
        else {
          const imported = s.imported.type === "Identifier" ? s.imported.name : String(s.imported.value);
          bindings.push({ module: index, imported, local: s.local.name });
        }
      }
      blank(node.start, node.end);
    } else if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
      if (node.declaration) blank(node.start, node.declaration.start);
      else blank(node.start, node.end);
    } else if (node.type === "ExportAllDeclaration") {
      blank(node.start, node.end);
    }
  }
  const dynamic = [];
  const walk = /* @__PURE__ */ __name((n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "ImportExpression") dynamic.push(n.start);
    for (const key of Object.keys(n)) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && typeof v.type === "string") walk(v);
    }
  }, "walk");
  walk(ast);
  for (const at of dynamic) {
    chars[at] = "__import";
    for (let i = at + 1; i < at + 6; i++) chars[i] = "";
  }
  const decls = bindings.map((b) => {
    const from = `__mod[${b.module}]`;
    if (b.imported === "*") return `const ${b.local} = ${from};`;
    const key = isIdent(b.imported) ? `.${b.imported}` : `[${JSON.stringify(b.imported)}]`;
    return `const ${b.local} = ${from}${key};`;
  });
  const head = `with (__env) { return (async () => { 'use strict'; ${decls.join(" ")}`;
  const source = `${head}
${chars.join("")}
})() }`;
  return { imports, source, syntaxError: null };
}
__name(compileThreeSketch, "compileThreeSketch");
async function loadThreeModules(compiled, chain = HOST_CHAIN) {
  const resolved = compiled.imports.map((imp) => resolveOrRefuse(chain, imp.spec, imp.line));
  const THREE = await loadThree();
  const modules = await Promise.all(
    resolved.map(
      (r, i) => r.kind === "three" ? null : r.load().catch((e) => {
        if (e instanceof ThreeImportError && e.line === void 0) throw new ThreeImportError(e.message, compiled.imports[i].line);
        throw e;
      })
    )
  );
  return { THREE, modules, chain };
}
__name(loadThreeModules, "loadThreeModules");
var INPUT_EVENTS = /* @__PURE__ */ new Set([
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerenter",
  "pointerleave",
  "pointerover",
  "pointerout",
  "pointercancel",
  "mousedown",
  "mouseup",
  "mousemove",
  "mouseenter",
  "mouseleave",
  "mouseover",
  "mouseout",
  "click",
  "dblclick",
  "contextmenu",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
  "keydown",
  "keyup",
  "keypress"
]);
function threeUserLine(err) {
  const loc = parseStackLocation(err);
  if (!loc) return void 0;
  const line = loc.line - THREE_LINE_OFFSET;
  return line >= 1 ? { line, column: loc.column } : void 0;
}
__name(threeUserLine, "threeUserLine");
function errorOf(e) {
  return e instanceof Error ? e : new Error(String(e));
}
__name(errorOf, "errorOf");
var loadTrackers = /* @__PURE__ */ new WeakMap();
function trackLoads(manager) {
  if (!manager || typeof manager.itemStart !== "function" || typeof manager.itemEnd !== "function") return null;
  const known = loadTrackers.get(manager);
  if (known) return known;
  const t = { pending: 0, idle: /* @__PURE__ */ new Set() };
  const start = manager.itemStart;
  const end = manager.itemEnd;
  manager.itemStart = function(url) {
    t.pending++;
    return start.call(this, url);
  };
  manager.itemEnd = function(url) {
    if (t.pending > 0) t.pending--;
    const r = end.call(this, url);
    if (t.pending === 0) for (const fn of [...t.idle]) fn();
    return r;
  };
  loadTrackers.set(manager, t);
  return t;
}
__name(trackLoads, "trackLoads");
function newLedger() {
  return { workers: /* @__PURE__ */ new Set(), blobs: /* @__PURE__ */ new Set(), intervals: /* @__PURE__ */ new Set(), closed: false };
}
__name(newLedger, "newLedger");
function closeLedger(l) {
  l.closed = true;
  for (const w of l.workers) {
    try {
      w.terminate();
    } catch {
    }
  }
  l.workers.clear();
  for (const u of l.blobs) {
    try {
      URL.revokeObjectURL(u);
    } catch {
    }
  }
  l.blobs.clear();
  for (const id of l.intervals) clearInterval(id);
  l.intervals.clear();
}
__name(closeLedger, "closeLedger");
var workerLedger = /* @__PURE__ */ new WeakMap();
function enterWorker(l, w) {
  if (l.closed) {
    w.terminate();
    return;
  }
  l.workers.add(w);
  workerLedger.set(w, l);
}
__name(enterWorker, "enterWorker");
function enterBlob(l, url) {
  if (l.closed) URL.revokeObjectURL(url);
  else l.blobs.add(url);
}
__name(enterBlob, "enterBlob");
var realmLedger = null;
var realmPatched = false;
function patchRealm() {
  var _a;
  if (realmPatched) return;
  realmPatched = true;
  const G = globalThis;
  const NativeWorker = G.Worker;
  if (typeof NativeWorker === "function") {
    G.Worker = (_a = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        if (realmLedger) enterWorker(realmLedger, this);
      }
      terminate() {
        workerLedger.get(this)?.workers.delete(this);
        super.terminate();
      }
    }, __name(_a, "TrackedWorker"), _a);
  }
  const U = G.URL;
  if (U && typeof U.createObjectURL === "function") {
    const create = U.createObjectURL;
    const revoke = U.revokeObjectURL;
    U.createObjectURL = function(obj) {
      const url = create.call(U, obj);
      if (realmLedger) enterBlob(realmLedger, url);
      return url;
    };
    U.revokeObjectURL = function(url) {
      realmLedger?.blobs.delete(url);
      revoke.call(U, url);
    };
  }
}
__name(patchRealm, "patchRealm");
function trackedGlobals(l) {
  var _a, _b;
  const G = globalThis;
  const out = {};
  const BaseWorker = G.Worker;
  if (typeof BaseWorker === "function") {
    out.Worker = (_a = class extends BaseWorker {
      constructor(...args) {
        super(...args);
        enterWorker(l, this);
      }
      terminate() {
        l.workers.delete(this);
        super.terminate();
      }
    }, __name(_a, "TrackedWorker"), _a);
  }
  const BaseURL = G.URL;
  if (typeof BaseURL === "function") {
    out.URL = (_b = class extends BaseURL {
      static createObjectURL(obj) {
        const url = BaseURL.createObjectURL(obj);
        enterBlob(l, url);
        return url;
      }
      static revokeObjectURL(url) {
        l.blobs.delete(url);
        BaseURL.revokeObjectURL(url);
      }
    }, __name(_b, "TrackedURL"), _b);
  }
  out.setTimeout = (fn, ms, ...args) => l.closed ? 0 : G.setTimeout(fn, ms, ...args);
  out.setInterval = (fn, ms, ...args) => {
    if (l.closed) return 0;
    const id = G.setInterval(fn, ms, ...args);
    l.intervals.add(id);
    return id;
  };
  out.clearInterval = (id) => {
    l.intervals.delete(id);
    G.clearInterval(id);
  };
  return out;
}
__name(trackedGlobals, "trackedGlobals");
function runThreeSketch(compiled, loaded2, host) {
  var _a;
  const BaseRenderer = loaded2.THREE.WebGLRenderer;
  const loads = trackLoads(loaded2.THREE.DefaultLoadingManager);
  let disposed = false;
  let topLevelDone = false;
  let renderedThisFrame = false;
  const renderers = [];
  const loops = /* @__PURE__ */ new Map();
  let rafQueue = /* @__PURE__ */ new Map();
  let rafSeq = 0;
  const resizeListeners = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const ledger = newLedger();
  if (host.ownsRealm) {
    patchRealm();
    realmLedger = ledger;
  }
  const tracked = trackedGlobals(ledger);
  const reportOnce = /* @__PURE__ */ __name((level, e, prefix = "") => {
    const err = errorOf(e);
    const at = threeUserLine(err);
    const key = `${level}|${err.message}|${at?.line ?? ""}`;
    if (seen.has(key)) return;
    if (seen.size > 64) seen.clear();
    seen.add(key);
    host.report({
      level,
      message: prefix + err.message,
      line: at?.line,
      column: at?.column,
      stack: String(err.stack ?? "").split("\n").slice(0, 6).join("\n")
    });
  }, "reportOnce");
  const warnHere = /* @__PURE__ */ __name((message) => reportOnce("warn", new Error(message)), "warnHere");
  const warnInput = /* @__PURE__ */ __name((type) => warnHere(`'${type}' events don't reach a three.js sketch in Stave (a viz receives no pointer or keyboard input). Move things in code instead.`), "warnInput");
  const warnDom = /* @__PURE__ */ __name(() => warnHere(`HTML overlays (panels, stats meters, text) aren't shown in Stave: a three.js sketch draws only on its canvas.`), "warnDom");
  const addListener = /* @__PURE__ */ __name((type, fn) => {
    if (type === "resize" && typeof fn === "function") resizeListeners.add(fn);
    else if (INPUT_EVENTS.has(type)) warnInput(type);
  }, "addListener");
  const removeListener = /* @__PURE__ */ __name((type, fn) => {
    if (type === "resize") resizeListeners.delete(fn);
  }, "removeListener");
  const canvas = host.canvas;
  if (!("style" in canvas)) canvas.style = {};
  const canvasAddListener = canvas.addEventListener;
  let canvasPatched = false;
  const _StaveWebGLRenderer = class _StaveWebGLRenderer extends BaseRenderer {
    constructor(params = {}) {
      if (disposed) throw new Error("this sketch was stopped");
      super({ ...params, canvas: host.canvas });
      const self = this;
      renderers.push(self);
      const render = self.render;
      self.render = function(scene, camera) {
        renderedThisFrame = true;
        return render.call(self, scene, camera);
      };
      const setSize = self.setSize;
      self.setSize = function(w, h) {
        return setSize.call(self, w, h, false);
      };
      self.setAnimationLoop = (cb) => {
        if (typeof cb === "function") loops.set(self, cb);
        else loops.delete(self);
      };
      if (!canvasPatched && typeof canvasAddListener === "function") {
        canvasPatched = true;
        canvas.addEventListener = function(type, ...rest) {
          if (INPUT_EVENTS.has(type)) warnInput(type);
          return canvasAddListener.call(canvas, type, ...rest);
        };
      }
    }
  };
  __name(_StaveWebGLRenderer, "StaveWebGLRenderer");
  let StaveWebGLRenderer = _StaveWebGLRenderer;
  let TextureLoader = loaded2.THREE.TextureLoader;
  if (typeof document === "undefined" && loaded2.THREE.ImageBitmapLoader) {
    const { Loader, Texture, ImageBitmapLoader } = loaded2.THREE;
    TextureLoader = (_a = class extends Loader {
      load(url, onLoad, onProgress, onError) {
        const texture = new Texture();
        const loader = new ImageBitmapLoader(this.manager);
        loader.setOptions({ imageOrientation: "flipY" });
        loader.setCrossOrigin(this.crossOrigin);
        loader.setPath(this.path);
        loader.load(
          url,
          (bitmap) => {
            texture.image = bitmap;
            texture.flipY = false;
            texture.needsUpdate = true;
            onLoad?.(texture);
          },
          onProgress,
          onError
        );
        return texture;
      }
    }, __name(_a, "StaveTextureLoader"), _a);
  }
  const THREE = { ...loaded2.THREE, WebGLRenderer: StaveWebGLRenderer, TextureLoader };
  const modules = loaded2.modules.map((m) => m === null ? THREE : m);
  const requestAnimationFrame = /* @__PURE__ */ __name((cb) => {
    const id = ++rafSeq;
    if (!disposed && typeof cb === "function") rafQueue.set(id, cb);
    return id;
  }, "requestAnimationFrame");
  const cancelAnimationFrame = /* @__PURE__ */ __name((id) => {
    rafQueue.delete(id);
  }, "cancelAnimationFrame");
  const stave = {
    get width() {
      return host.size().w;
    },
    get height() {
      return host.size().h;
    },
    get options() {
      return host.options();
    },
    get scheduler() {
      return host.scheduler();
    },
    get sig() {
      return host.uniforms().sig;
    }
  };
  const stubElement = /* @__PURE__ */ __name(() => {
    warnDom();
    const el = {
      style: {},
      dataset: {},
      classList: { add() {
      }, remove() {
      }, toggle() {
      }, contains: /* @__PURE__ */ __name(() => false, "contains") },
      appendChild: /* @__PURE__ */ __name((c) => c, "appendChild"),
      removeChild: /* @__PURE__ */ __name((c) => c, "removeChild"),
      remove() {
      },
      setAttribute() {
      },
      getAttribute: /* @__PURE__ */ __name(() => null, "getAttribute"),
      addEventListener: addListener,
      removeEventListener: removeListener,
      textContent: "",
      innerHTML: ""
    };
    return el;
  }, "stubElement");
  const createElement = /* @__PURE__ */ __name((tag) => String(tag).toLowerCase() === "canvas" ? host.createCanvas() : stubElement(), "createElement");
  const body = {
    style: {},
    appendChild: /* @__PURE__ */ __name((c) => c, "appendChild"),
    removeChild: /* @__PURE__ */ __name((c) => c, "removeChild"),
    addEventListener: addListener,
    removeEventListener: removeListener
  };
  const documentShim = {
    body,
    documentElement: body,
    createElement,
    createElementNS: /* @__PURE__ */ __name((_ns, tag) => createElement(tag), "createElementNS"),
    getElementById: /* @__PURE__ */ __name(() => null, "getElementById"),
    querySelector: /* @__PURE__ */ __name(() => null, "querySelector"),
    addEventListener: addListener,
    removeEventListener: removeListener
  };
  const own = {};
  Object.defineProperties(own, {
    innerWidth: { get: /* @__PURE__ */ __name(() => host.size().w, "get"), enumerable: true },
    innerHeight: { get: /* @__PURE__ */ __name(() => host.size().h, "get"), enumerable: true },
    devicePixelRatio: { get: /* @__PURE__ */ __name(() => host.dpr(), "get"), enumerable: true }
  });
  Object.assign(own, {
    addEventListener: addListener,
    removeEventListener: removeListener,
    requestAnimationFrame,
    cancelAnimationFrame,
    document: documentShim,
    ...tracked
  });
  const boundCache = /* @__PURE__ */ new Map();
  const windowShim = new Proxy(own, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "window" || key === "self" || key === "globalThis") return windowShim;
      const v = globalThis[key];
      if (typeof v !== "function") return v;
      if (/^[A-Z]/.test(String(key))) return v;
      if (!boundCache.has(key)) boundCache.set(key, v.bind(globalThis));
      return boundCache.get(key);
    },
    has(t, key) {
      return key in t || key in globalThis;
    }
  });
  const env = {};
  Object.defineProperties(env, {
    innerWidth: { get: /* @__PURE__ */ __name(() => host.size().w, "get") },
    innerHeight: { get: /* @__PURE__ */ __name(() => host.size().h, "get") },
    devicePixelRatio: { get: /* @__PURE__ */ __name(() => host.dpr(), "get") },
    sig: { get: /* @__PURE__ */ __name(() => host.uniforms().sig, "get") }
  });
  Object.assign(env, {
    stave,
    window: windowShim,
    self: windowShim,
    document: documentShim,
    requestAnimationFrame,
    cancelAnimationFrame,
    addEventListener: addListener,
    removeEventListener: removeListener,
    ...tracked
  });
  const chain = loaded2.chain ?? HOST_CHAIN;
  const importDynamic = /* @__PURE__ */ __name(async (spec) => {
    const r = resolveOrRefuse(chain, String(spec));
    return r.kind === "three" ? THREE : r.load();
  }, "importDynamic");
  let done;
  try {
    const fn = new Function(...PARAMS, compiled.source);
    done = Promise.resolve(fn(env, modules, importDynamic)).then(
      () => {
        topLevelDone = true;
        return { error: null };
      },
      (e) => {
        topLevelDone = true;
        if (!disposed) reportOnce("error", e);
        return { error: errorOf(e) };
      }
    );
  } catch (e) {
    topLevelDone = true;
    const err = errorOf(e);
    host.report({ level: "error", message: err.message });
    done = Promise.resolve({ error: err });
  }
  let loadedPromise = null;
  const whenLoadedOnce = /* @__PURE__ */ __name(() => {
    if (loadedPromise) return loadedPromise;
    loadedPromise = done.then(
      () => new Promise((resolve) => {
        const idle = /* @__PURE__ */ __name(() => disposed || !loads || loads.pending === 0, "idle");
        const check = /* @__PURE__ */ __name(() => {
          if (!idle()) return;
          setTimeout(() => {
            if (!idle()) return;
            loads?.idle.delete(check);
            resolve();
          }, 0);
        }, "check");
        loads?.idle.add(check);
        check();
      })
    );
    return loadedPromise;
  }, "whenLoadedOnce");
  const settleOnDispose = [];
  return {
    done,
    whenLoaded: /* @__PURE__ */ __name(() => disposed ? Promise.resolve() : new Promise((resolve) => {
      settleOnDispose.push(resolve);
      void whenLoadedOnce().then(resolve);
    }), "whenLoaded"),
    ready: /* @__PURE__ */ __name(() => topLevelDone || loops.size > 0 || rafQueue.size > 0, "ready"),
    rendered: /* @__PURE__ */ __name(() => renderedThisFrame, "rendered"),
    frame(timeMs) {
      if (disposed) return;
      renderedThisFrame = false;
      const queued = rafQueue;
      rafQueue = /* @__PURE__ */ new Map();
      for (const cb of queued.values()) {
        try {
          cb(timeMs);
        } catch (e) {
          reportOnce("error", e);
        }
      }
      for (const cb of [...loops.values()]) {
        try {
          cb(timeMs);
        } catch (e) {
          reportOnce("error", e);
        }
      }
    },
    resize() {
      if (disposed) return;
      if (resizeListeners.size > 0) {
        const ev = { type: "resize", target: windowShim };
        for (const fn of [...resizeListeners]) {
          try {
            fn(ev);
          } catch (e) {
            reportOnce("error", e);
          }
        }
        return;
      }
      const { w, h } = host.size();
      for (const r of renderers) {
        try {
          r.setSize(w, h, false);
        } catch {
        }
      }
    },
    gl() {
      try {
        return renderers[0]?.getContext?.() ?? null;
      } catch {
        return null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of settleOnDispose.splice(0)) fn();
      loops.clear();
      rafQueue.clear();
      resizeListeners.clear();
      closeLedger(ledger);
      if (realmLedger === ledger) realmLedger = null;
      for (const r of renderers) {
        try {
          r.dispose();
        } catch {
        }
        try {
          const gl = r.getContext?.();
          if (gl && !gl.isContextLost?.()) r.forceContextLoss();
        } catch {
        }
      }
      renderers.length = 0;
      if (canvasPatched) {
        try {
          delete canvas.addEventListener;
        } catch {
        }
      }
    }
  };
}
__name(runThreeSketch, "runThreeSketch");

// src/visualizers/libraries/declarations.ts
var LIBS_FILE = "stave.libs.json";
var SHA384_B64 = /^[A-Za-z0-9+/]{64}$/;
function isAllowedLibraryUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}
__name(isAllowedLibraryUrl, "isAllowedLibraryUrl");
function parseLibraryDeclarations(text) {
  if (text == null || text.trim() === "") return { ok: true, libs: {} };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: `${LIBS_FILE} isn't valid JSON (${e instanceof Error ? e.message : String(e)}).` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: `${LIBS_FILE} should be an object: { "<import name>": { "url": "https://\u2026", "sha384": "\u2026" } }.` };
  }
  const libs = {};
  for (const [name, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      return { ok: false, message: `${LIBS_FILE}: '${name}' should be { "url": "https://\u2026", "sha384": "\u2026" }.` };
    }
    const { url, sha384 } = v;
    if (typeof url !== "string" || !isAllowedLibraryUrl(url)) {
      return { ok: false, message: `${LIBS_FILE}: '${name}' needs a "url" that starts with https:// (got ${JSON.stringify(url ?? null)}).` };
    }
    if (sha384 !== void 0) {
      if (typeof sha384 !== "string" || !SHA384_B64.test(sha384)) {
        const hint = typeof sha384 === "string" && sha384.startsWith("sha384-") ? ' Leave out the "sha384-" prefix.' : "";
        return { ok: false, message: `${LIBS_FILE}: '${name}' has a "sha384" that isn't a base64 SHA-384 (64 characters).${hint}` };
      }
    }
    libs[name] = sha384 === void 0 ? { url } : { url, sha384 };
  }
  return { ok: true, libs };
}
__name(parseLibraryDeclarations, "parseLibraryDeclarations");
var _LibraryLoadError = class _LibraryLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "LibraryLoadError";
  }
};
__name(_LibraryLoadError, "LibraryLoadError");
var LibraryLoadError = _LibraryLoadError;
var MAX_GRAPH_MODULES = 256;
var MAX_GRAPH_CHARS = 64 * 1024 * 1024;
async function defaultFetchText(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new LibraryLoadError(`fetching ${url} failed (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) throw new LibraryLoadError(`fetching ${url} failed (HTTP ${res.status})`);
  return res.text();
}
__name(defaultFetchText, "defaultFetchText");
async function moduleImports(text) {
  await init;
  const [imports] = parse$1(text);
  const out = [];
  for (const i of imports) {
    if (typeof i.specifier !== "string") continue;
    out.push({ specifier: i.specifier, start: i.start, end: i.end, dynamic: i.type === "dynamic" });
  }
  return out;
}
__name(moduleImports, "moduleImports");
function bareImportMessage(fromUrl, specifier) {
  if (parseThreeSpecifier(specifier)) return `${fromUrl} imports '${specifier}', which Stave doesn't provide: ${unsupportedImportMessage(specifier).replace(/\.$/, "")}`;
  return `${fromUrl} imports '${specifier}', which is neither a URL nor a module Stave provides ('three' or 'three/addons/\u2026'). Use a build of the library that bundles '${specifier}' or imports it by URL`;
}
__name(bareImportMessage, "bareImportMessage");
var URL_LIKE = /^(?:\.{0,2}\/|[a-zA-Z][a-zA-Z\d+.-]*:)/;
function classifyImport(specifier, fromUrl) {
  const host = hostModuleName(specifier);
  if (host) return { kind: "host", name: host };
  if (URL_LIKE.test(specifier)) return { kind: "url", url: new URL(specifier, fromUrl).href };
  return { kind: "bare" };
}
__name(classifyImport, "classifyImport");
async function loadLibraryGraph(entryUrl, options = {}) {
  const fetchText = options.fetchText ?? defaultFetchText;
  const entry = new URL(entryUrl).href;
  const modules = {};
  const pending = /* @__PURE__ */ new Map();
  let chars = 0;
  const visit = /* @__PURE__ */ __name((url) => {
    let p = pending.get(url);
    if (p) return p;
    if (pending.size >= MAX_GRAPH_MODULES) {
      return Promise.reject(new LibraryLoadError(`it reaches more than ${MAX_GRAPH_MODULES} modules`));
    }
    p = (async () => {
      const text = await fetchText(url);
      chars += text.length;
      if (chars > MAX_GRAPH_CHARS) throw new LibraryLoadError(`its files add up to more than ${MAX_GRAPH_CHARS} characters`);
      modules[url] = text;
      const next = [];
      for (const imp of await moduleImports(text)) {
        const t = classifyImport(imp.specifier, url);
        if (t.kind === "url") next.push(visit(t.url));
        else if (t.kind === "bare") throw new LibraryLoadError(bareImportMessage(url, imp.specifier));
      }
      await Promise.all(next);
    })();
    pending.set(url, p);
    return p;
  }, "visit");
  await visit(entry);
  return { entry, modules };
}
__name(loadLibraryGraph, "loadLibraryGraph");
function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(bin);
}
__name(toBase64, "toBase64");
function libraryGraphBytes(graph) {
  const urls = Object.keys(graph.modules).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  let s = "";
  for (const url of urls) {
    const text = graph.modules[url];
    s += `${url}
${String(text.length)}
${text}
`;
  }
  return new TextEncoder().encode(s);
}
__name(libraryGraphBytes, "libraryGraphBytes");
async function libraryGraphHash(graph) {
  const digest = await crypto.subtle.digest("SHA-384", libraryGraphBytes(graph));
  return toBase64(new Uint8Array(digest));
}
__name(libraryGraphHash, "libraryGraphHash");

// src/visualizers/libraries/hostShims.ts
var HOST_REGISTRY_KEY = "__staveHostModules";
function registry() {
  const g = globalThis;
  let r = g[HOST_REGISTRY_KEY];
  if (!r) {
    r = /* @__PURE__ */ Object.create(null);
    Object.defineProperty(globalThis, HOST_REGISTRY_KEY, { value: r, enumerable: false, configurable: false, writable: false });
  }
  return r;
}
__name(registry, "registry");
var blobModuleUrl = /* @__PURE__ */ __name((source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" })), "blobModuleUrl");
var dataModuleUrl = /* @__PURE__ */ __name((source) => (
  // `'` too (encodeURIComponent leaves it): the URL may replace a single-quoted specifier.
  `data:text/javascript;charset=utf-8,${encodeURIComponent(source).replace(/'/g, "%27")}`
), "dataModuleUrl");
function defaultModuleUrlMaker() {
  return typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? blobModuleUrl : dataModuleUrl;
}
__name(defaultModuleUrlMaker, "defaultModuleUrlMaker");
var IDENT = /^[A-Za-z_$][\w$]*$/;
function shimSource(key, ns) {
  const names = Object.keys(ns);
  const reads = names.map((n, i) => `const __${i} = m[${JSON.stringify(n)}];`);
  const specs = names.map((n, i) => `__${i} as ${n === "default" || IDENT.test(n) ? n : JSON.stringify(n)}`);
  return `const m = globalThis[${JSON.stringify(HOST_REGISTRY_KEY)}][${JSON.stringify(key)}];
${reads.join("\n")}
export { ${specs.join(", ")} };
`;
}
__name(shimSource, "shimSource");
var shimSets = 0;
function createHostShims(options = {}) {
  const load = options.load ?? loadHostModule;
  const makeUrl = options.makeUrl ?? defaultModuleUrlMaker();
  const prefix = `s${++shimSets}:`;
  const urls = /* @__PURE__ */ new Map();
  return {
    nameFor: hostModuleName,
    urlFor(spec) {
      const name = hostModuleName(spec);
      if (!name) return Promise.resolve(null);
      let url = urls.get(name);
      if (!url) {
        url = load(name).then((ns) => {
          const key = prefix + name;
          registry()[key] = ns;
          return makeUrl(shimSource(key, ns));
        });
        urls.set(name, url);
        url.catch(() => urls.delete(name));
      }
      return url;
    }
  };
}
__name(createHostShims, "createHostShims");
var shared = null;
function hostShims() {
  shared ?? (shared = createHostShims());
  return shared;
}
__name(hostShims, "hostShims");

// src/visualizers/libraries/instantiate.ts
var defaultRevoke = /* @__PURE__ */ __name((url) => {
  if (url.startsWith("blob:") && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}, "defaultRevoke");
async function instantiateLibraryGraph(graph, options = {}) {
  const shims = options.shims ?? hostShims();
  const makeUrl = options.makeUrl ?? defaultModuleUrlMaker();
  const made = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const urls = [];
  const dynamicTargets = /* @__PURE__ */ new Set();
  let hostRewrites = 0;
  const make = /* @__PURE__ */ __name(async (url) => {
    const done = made.get(url);
    if (done) return done;
    if (visiting.has(url)) {
      throw new LibraryLoadError(`its modules import each other in a cycle (at ${url}), which Stave can't load yet`);
    }
    const text = graph.modules[url];
    if (text === void 0) throw new LibraryLoadError(`${url} is missing from the fetched files`);
    visiting.add(url);
    let out = "";
    let last = 0;
    for (const imp of await moduleImports(text)) {
      const t = classifyImport(imp.specifier, url);
      let to;
      if (t.kind === "host") {
        const shim = await shims.urlFor(imp.specifier);
        if (!shim) throw new LibraryLoadError(`${url} imports '${imp.specifier}', which Stave can't provide`);
        to = shim;
        hostRewrites++;
      } else if (t.kind === "url") {
        to = await make(t.url);
        if (imp.dynamic) dynamicTargets.add(to);
      } else {
        throw new LibraryLoadError(bareImportMessage(url, imp.specifier));
      }
      out += text.slice(last, imp.start) + (imp.dynamic ? JSON.stringify(to) : to);
      last = imp.end;
    }
    out += text.slice(last);
    visiting.delete(url);
    const moduleUrl = makeUrl(out);
    made.set(url, moduleUrl);
    urls.push(moduleUrl);
    return moduleUrl;
  }, "make");
  const entryUrl = await make(graph.entry);
  const revoke = options.revokeUrl ?? defaultRevoke;
  let namespace;
  try {
    namespace = await import(
      /* webpackIgnore: true */
      /* @vite-ignore */
      entryUrl
    );
  } catch (e) {
    for (const u of urls) revoke(u);
    throw e;
  }
  const retained = urls.filter((u) => dynamicTargets.has(u));
  for (const u of urls) if (!dynamicTargets.has(u)) revoke(u);
  return { namespace, urls, retained, hostRewrites };
}
__name(instantiateLibraryGraph, "instantiateLibraryGraph");

// src/visualizers/libraries/declaredLibraries.ts
var loaded = /* @__PURE__ */ new Map();
function loadDeclaredLibrary(name, decl, deps = {}) {
  const key = `${decl.url}
${decl.sha384 ?? ""}`;
  let p = loaded.get(key);
  if (!p) {
    p = loadOnce(name, decl, deps);
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  return p;
}
__name(loadDeclaredLibrary, "loadDeclaredLibrary");
async function loadOnce(name, decl, deps) {
  const from = `'${name}' (declared in ${LIBS_FILE})`;
  let graph = decl.sha384 && deps.cache ? await deps.cache.getGraph(decl.sha384).catch(() => null) : null;
  const fromCache = graph !== null;
  if (!graph) {
    try {
      graph = await loadLibraryGraph(decl.url, { fetchText: deps.fetchText });
    } catch (e) {
      throw new ThreeImportError(`${from} couldn't be loaded: ${e instanceof Error ? e.message : String(e)}.`);
    }
  }
  const actual = await libraryGraphHash(graph);
  if (!decl.sha384) {
    throw new ThreeImportError(
      `${from} has no "sha384", so Stave can't check what it loads. What ${decl.url} serves now hashes to "${actual}": add "sha384": "${actual}" to its entry if that is the version you mean.`
    );
  }
  if (actual !== decl.sha384) {
    throw new ThreeImportError(
      `${from} was refused: what ${decl.url} serves doesn't match the "sha384" in ${LIBS_FILE} (expected "${decl.sha384}", got "${actual}"). Nothing from it was run. If the library changed on purpose, put the new value in ${LIBS_FILE}.`
    );
  }
  if (!fromCache && deps.cache) await deps.cache.putGraph(actual, graph).catch(() => {
  });
  try {
    return await (deps.instantiate ?? instantiateLibraryGraph)(graph);
  } catch (e) {
    throw new ThreeImportError(`${from} couldn't be started: ${e instanceof Error ? e.message : String(e)}.`);
  }
}
__name(loadOnce, "loadOnce");
function declaredResolver(parsed, deps = {}) {
  return {
    name: "declared",
    resolve(spec) {
      if (!parsed.ok || !Object.prototype.hasOwnProperty.call(parsed.libs, spec)) return null;
      const decl = parsed.libs[spec];
      return { kind: "module", load: /* @__PURE__ */ __name(async () => (await loadDeclaredLibrary(spec, decl, deps)).namespace, "load") };
    }
  };
}
__name(declaredResolver, "declaredResolver");
var URL_SPEC = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
var RELATIVE = /^\.{0,2}\//;
function refusalMessage(spec, parsed) {
  if (parseThreeSpecifier(spec) || RELATIVE.test(spec)) return unsupportedImportMessage(spec);
  if (!parsed.ok) return `'${spec}' can't be looked up: ${parsed.message}`;
  if (URL_SPEC.test(spec)) {
    return `'${spec}' can't be imported by URL in a Stave sketch: declare it in ${LIBS_FILE} at the project root, { "<name>": { "url": ${JSON.stringify(spec)}, "sha384": "\u2026" } }, then import '<name>'.`;
  }
  return `'${spec}' isn't available in Stave. A three.js sketch can import 'three' and any 'three/addons/\u2026' file. To use a library, declare it in ${LIBS_FILE} at the project root: { ${JSON.stringify(spec)}: { "url": "https://\u2026", "sha384": "\u2026" } }.`;
}
__name(refusalMessage, "refusalMessage");
function sketchImportChain(libsText, deps = {}) {
  const parsed = parseLibraryDeclarations(libsText);
  return {
    links: [hostResolver, declaredResolver(parsed, deps)],
    refusal: /* @__PURE__ */ __name((spec) => refusalMessage(spec, parsed), "refusal")
  };
}
__name(sketchImportChain, "sketchImportChain");

// src/visualizers/worker/workerMessages.ts
function isControlMessage(data) {
  return typeof data === "object" && data !== null && typeof data.type === "string";
}
__name(isControlMessage, "isControlMessage");

// src/visualizers/worker/hostP5Worker.ts
var P5ctor = null;
var Hydractor = null;
var GLCTX_UP = "glctx+";
var GLCTX_RELEASE = true;
function hostVizWorker(scope) {
  let state = null;
  let lastDrawMs;
  const diag = /* @__PURE__ */ __name((level, message, stack) => {
    try {
      scope.postMessage({ type: "diag", level, message, stack });
    } catch {
    }
  }, "diag");
  const signalReady = /* @__PURE__ */ __name(() => {
    try {
      scope.postMessage({ type: "ready" });
    } catch {
    }
  }, "signalReady");
  const post = /* @__PURE__ */ __name((type) => {
    try {
      scope.postMessage({ type });
    } catch {
    }
  }, "post");
  const seenWorkerErrors = /* @__PURE__ */ new Set();
  const currentRuntimeRef = { kind: "p5" };
  const postVizLog = /* @__PURE__ */ __name((entry) => {
    const sig = `${entry.runtime}|${entry.message}|${entry.line ?? ""}`;
    if (seenWorkerErrors.has(sig)) return;
    if (seenWorkerErrors.size > 64) seenWorkerErrors.clear();
    seenWorkerErrors.add(sig);
    try {
      scope.postMessage({ type: "vizlog", entry });
    } catch {
    }
  }, "postVizLog");
  subscribeLog((entry) => {
    if (entry?.level === "error") {
      const { id: _id, ts: _ts, ...rest } = entry;
      postVizLog(rest);
    }
  });
  const HYDRA_WARN_THROW = "ERROR";
  const HYDRA_WARN_NAN = "function does not return a number";
  const realConsoleWarn = console.warn.bind(console);
  console.warn = (...args) => {
    try {
      if (currentRuntimeRef.kind === "hydra" && typeof args[0] === "string") {
        if (args[0] === HYDRA_WARN_THROW) {
          const loc = parseStackLocation(args[1]);
          const line = loc ? Math.max(1, loc.line - getHydraLineOffset()) : void 0;
          postVizLog({
            level: "error",
            runtime: "hydra",
            message: `reactive fn: ${errMsg(args[1])}`,
            stack: errStack(args[1]),
            line
          });
        } else if (args[0] === HYDRA_WARN_NAN) {
          postVizLog({ level: "warn", runtime: "hydra", message: "reactive fn did not return a number" });
        }
      }
    } catch {
    }
    realConsoleWarn(...args);
  };
  let glLoseExt = null;
  let glCtx = null;
  let glAccounted = false;
  const accountGL = /* @__PURE__ */ __name(() => {
    if (glAccounted || !state) return;
    try {
      const ctx = state.gl?.() ?? null;
      const ext = ctx?.getExtension?.("WEBGL_lose_context") ?? null;
      if (ext) {
        glLoseExt = ext;
        glCtx = ctx;
        glAccounted = true;
        diag("info", GLCTX_UP);
      }
    } catch {
    }
  }, "accountGL");
  const releaseGL = /* @__PURE__ */ __name(() => {
    if (!glAccounted) return;
    glAccounted = false;
    const ext = glLoseExt;
    const ctx = glCtx;
    glLoseExt = null;
    glCtx = null;
    try {
      if (ctx?.isContextLost?.()) return;
      if (GLCTX_RELEASE) ext?.loseContext?.();
    } catch {
    }
  }, "releaseGL");
  let mounting = false;
  let pending = {};
  scope.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!isControlMessage(data)) {
      if (!state && isSignalFrameEnvelope(data)) {
        try {
          scope.postMessage({ type: "frameAck" });
        } catch {
        }
      }
      return;
    }
    handleControl(data).catch(
      (e) => diag("error", `worker control '${data.type}' failed: ${errMsg(e)}`, errStack(e))
    );
  });
  async function handleControl(msg) {
    if (mounting && msg.type !== "mount" && msg.type !== "config") {
      if (msg.type === "pause") pending.paused = true;
      else if (msg.type === "resume") pending.paused = false;
      else if (msg.type === "resize") pending.resize = { w: msg.w, h: msg.h, dpr: msg.dpr };
      else if (msg.type === "options") pending.options = msg.options;
      else if (msg.type === "destroy") pending.destroy = true;
      return;
    }
    switch (msg.type) {
      case "mount":
        mounting = true;
        pending = {};
        try {
          await mount(msg);
        } finally {
          mounting = false;
          applyPending();
        }
        break;
      case "resize":
        resize(msg.w, msg.h, msg.dpr);
        break;
      case "pause":
        if (state) state.paused = true;
        break;
      case "resume":
        if (state) state.paused = false;
        break;
      case "destroy":
        destroy();
        break;
      case "config":
        updateVizConfig(msg.patch);
        break;
      case "options":
        state?.setOptions?.(msg.options);
        break;
    }
  }
  __name(handleControl, "handleControl");
  function applyPending() {
    const p = pending;
    pending = {};
    if (p.destroy) {
      destroy();
      return;
    }
    if (!state) return;
    if (p.paused !== void 0) state.paused = p.paused;
    if (p.resize) resize(p.resize.w, p.resize.h, p.resize.dpr);
    if (p.options) state.setOptions?.(p.options);
  }
  __name(applyPending, "applyPending");
  async function mount(msg) {
    post("alive");
    if (state) destroy();
    if (msg.config) updateVizConfig(msg.config);
    currentRuntimeRef.kind = msg.kind;
    const dpr = msg.dpr > 0 ? msg.dpr : 1;
    const feed = new WorkerBusFeed();
    if (msg.aliases) feed.setAliases(msg.aliases);
    const rawAnalyser = new RawAnalyserShim();
    const rawScheduler = new RawSchedulerShim();
    const containerSizeRef = { current: { w: msg.size.w, h: msg.size.h } };
    const strategy = msg.kind === "hydra" ? await mountHydra(msg, feed, rawAnalyser, rawScheduler) : msg.kind === "glsl" ? mountGLSL(msg, rawAnalyser, rawScheduler, feed) : msg.kind === "three" ? await mountThree(msg, feed, rawScheduler, containerSizeRef, dpr) : await mountP5(msg, feed, rawAnalyser, rawScheduler, containerSizeRef, dpr);
    const reader = createPostMessageReader(scope);
    state = {
      feed,
      rawAnalyser,
      rawScheduler,
      containerSizeRef,
      canvas: msg.canvas,
      reader,
      dpr,
      paused: false,
      readySent: false,
      ...strategy
    };
    reader.onFrame(applyAndDraw);
    diag("info", `mounted ${msg.kind} viz '${msg.name}' (${msg.size.w}\xD7${msg.size.h}@${dpr})`);
    const mine = state;
    void strategy.whenLoaded().then(() => {
      if (state !== mine) return;
      if (msg.warm) warmDraw(mine);
      post("loaded");
    });
  }
  __name(mount, "mount");
  function warmDraw(s) {
    if (s.readySent) return;
    const t0 = globalThis.performance?.now?.() ?? 0;
    try {
      s.draw();
    } catch (e) {
      postVizLog({ level: "error", runtime: currentRuntimeRef.kind, message: `draw(): ${errMsg(e)}`, stack: errStack(e) });
      return;
    }
    lastDrawMs = (globalThis.performance?.now?.() ?? 0) - t0;
    s.readySent = true;
    signalReady();
    accountGL();
  }
  __name(warmDraw, "warmDraw");
  async function mountP5(msg, feed, rawAnalyser, rawScheduler, containerSizeRef, dpr) {
    if (!P5ctor) {
      installWorkerDomShim(() => wrapCanvas(new OffscreenCanvas(1, 1)));
      const mod = await import('p5');
      P5ctor = mod.default || mod.p5 || mod;
      P5ctor.disableFriendlyErrors = true;
    }
    const staveUniforms = buildStaveUniforms(feed.bus);
    const analyserRef = { current: rawAnalyser };
    const schedulerRef = { current: rawScheduler };
    const hapStreamRef = { current: null };
    const optionsRef = { current: msg.options ?? {} };
    const staveUniformsRef = { current: staveUniforms };
    const factory = compileP5Code(msg.code, msg.name);
    const userSketchFn = factory(
      hapStreamRef,
      analyserRef,
      schedulerRef,
      containerSizeRef,
      optionsRef,
      staveUniformsRef
    );
    const directCanvas = msg.p5DirectCanvas === true;
    const RENDERER_CONSTS = /* @__PURE__ */ new Set(["p2d", "p2d-hdr", "webgl", "webgl2", "webgpu"]);
    let adopted = false;
    let setup = false;
    let markLoaded = /* @__PURE__ */ __name(() => {
    }, "markLoaded");
    const loadedP5 = new Promise((resolve) => {
      markLoaded = resolve;
    });
    const sketchFn = /* @__PURE__ */ __name((p) => {
      if (directCanvas) {
        const displayEl = wrapCanvas(msg.canvas);
        let ccCalls = 0;
        const origCreate = p.createCanvas.bind(p);
        p.createCanvas = function(w, h, renderer, ...rest) {
          ccCalls += 1;
          if (ccCalls === 1) return origCreate(w, h, renderer, ...rest);
          adopted = true;
          const rk = RENDERER_CONSTS.has(renderer) ? renderer : "p2d";
          return origCreate(w, h, rk, displayEl);
        };
      }
      userSketchFn(p);
      const setup0 = p.setup;
      p.setup = function() {
        if (typeof setup0 === "function") setup0.call(this);
        try {
          p.noLoop();
        } catch {
        }
        setup = true;
        markLoaded();
      };
    }, "sketchFn");
    const inst = new P5ctor(sketchFn);
    let present = null;
    if (!directCanvas) {
      msg.canvas.width = Math.max(1, Math.round(msg.size.w * dpr));
      msg.canvas.height = Math.max(1, Math.round(msg.size.h * dpr));
      try {
        present = msg.canvas.getContext("bitmaprenderer");
      } catch (e) {
        diag("error", `bitmaprenderer unavailable: ${errMsg(e)}`);
      }
    }
    return {
      setupDone: /* @__PURE__ */ __name(() => setup, "setupDone"),
      whenLoaded: /* @__PURE__ */ __name(() => loadedP5, "whenLoaded"),
      // #266 — p5's WEBGL context lives on its internal render canvas (drawingContext);
      // 2D sketches return a CanvasRenderingContext2D whose getExtension yields null.
      gl: /* @__PURE__ */ __name(() => inst?.drawingContext ?? null, "gl"),
      // #875 — the compiler closed over THIS ref, so the next draw() reads the new
      // bag; no remount, exactly like the main-thread renderer's ref re-assign.
      setOptions: /* @__PURE__ */ __name((options) => {
        optionsRef.current = options;
      }, "setOptions"),
      draw: /* @__PURE__ */ __name(() => {
        inst.redraw();
        if (directCanvas && adopted) return;
        if (directCanvas && !present) {
          msg.canvas.width = Math.max(1, Math.round(msg.size.w * dpr));
          msg.canvas.height = Math.max(1, Math.round(msg.size.h * dpr));
          try {
            present = msg.canvas.getContext("bitmaprenderer");
          } catch (e) {
            diag("error", `bitmaprenderer unavailable: ${errMsg(e)}`);
          }
        }
        if (!present) return;
        const src = inst?.drawingContext?.canvas;
        if (!src) return;
        try {
          present.transferFromImageBitmap(src.transferToImageBitmap());
        } catch (e) {
          diag("error", `present blit failed: ${errMsg(e)}`);
        }
      }, "draw"),
      resizeKind: /* @__PURE__ */ __name((w, h, dprNew) => {
        if (!directCanvas) {
          msg.canvas.width = Math.max(1, Math.round(w * dprNew));
          msg.canvas.height = Math.max(1, Math.round(h * dprNew));
        }
        inst?.resizeCanvas?.(w, h);
      }, "resizeKind"),
      teardown: /* @__PURE__ */ __name(() => {
        markLoaded();
        try {
          inst.hitCriticalError = true;
          inst.setup = function() {
          };
          inst.draw = function() {
          };
          inst.preload = function() {
          };
          inst.createCanvas = function() {
            return null;
          };
          inst._setupDone = true;
          inst.remove?.();
        } catch {
        }
      }, "teardown")
    };
  }
  __name(mountP5, "mountP5");
  async function mountHydra(msg, feed, rawAnalyser, rawScheduler, _dpr) {
    installWorkerHydraShim({ w: msg.size.w, h: msg.size.h });
    if (!Hydractor) {
      const mod = await import('hydra-synth');
      Hydractor = mod.default || mod;
    }
    const optionsRef = { current: msg.options ?? {} };
    const bag = buildHydraStaveBag(feed.bus, optionsRef);
    bag.scheduler = rawScheduler;
    const bins = getVizConfig().hydraAudioBins;
    msg.canvas.width = Math.max(1, Math.round(msg.size.w));
    msg.canvas.height = Math.max(1, Math.round(msg.size.h));
    const hydra = new Hydractor({
      canvas: msg.canvas,
      width: msg.size.w,
      height: msg.size.h,
      detectAudio: false,
      // no Meyda/getUserMedia/AudioContext in the worker
      makeGlobal: false,
      // generators live on hydra.synth
      autoLoop: false,
      // WE drive tick() (1:1 with the frame — PK22)
      enableStreamCapture: false
      // OffscreenCanvas has no captureStream
    });
    const synth = hydra.synth;
    const audio = hydra.a;
    if (audio) {
      synth.a = audio;
      if (typeof audio.setCutoff === "function") audio.setCutoff(bins);
      if (typeof audio.setBins === "function") audio.setBins(bins);
      if (!Array.isArray(audio.fft) || audio.fft.length < bins) {
        audio.fft = new Array(bins).fill(0);
      }
    } else {
      synth.a = { fft: new Array(bins).fill(0) };
    }
    compileHydraCode(msg.code)(synth, bag);
    let freqScratch = new Uint8Array(rawAnalyser.frequencyBinCount || 1024);
    return {
      setupDone: /* @__PURE__ */ __name(() => true, "setupDone"),
      // pattern ran synchronously above; frames arrive after
      whenLoaded: /* @__PURE__ */ __name(() => Promise.resolve(), "whenLoaded"),
      // #266 — hydra renders directly into the presenting canvas (regl owns its
      // WebGL context); re-getContext returns that same context for release.
      gl: /* @__PURE__ */ __name(() => msg.canvas.getContext("webgl2") ?? msg.canvas.getContext("webgl"), "gl"),
      // #883 — the bag closed over `optionsRef`, so the next frame reads the new
      // options with no remount; mirrors mountP5's setOptions.
      //
      // DEFENSIVE, not currently exercised: `WorkerVizRenderer.update` posts an
      // `options` message for EVERY kind, and the dispatcher does
      // `state?.setOptions?.(msg.options)` — so without this, a hydra options
      // message is silently swallowed, which is the exact failure class #883
      // exists to kill. Verified by neutering it: the e2e stays green, because an
      // inline re-eval REMOUNTS and the new bag rides in on MountMessage.options.
      // So this covers the no-remount path only, and no test reaches it yet.
      setOptions: /* @__PURE__ */ __name((options) => {
        optionsRef.current = options;
      }, "setOptions"),
      draw: /* @__PURE__ */ __name(() => {
        const a = hydra?.synth?.a;
        if (a?.fft) {
          if (freqScratch.length !== rawAnalyser.frequencyBinCount) {
            freqScratch = new Uint8Array(rawAnalyser.frequencyBinCount);
          }
          rawAnalyser.getByteFrequencyData(freqScratch);
          const numBins = getVizConfig().hydraAudioBins;
          const binSize = Math.max(1, Math.floor(freqScratch.length / numBins));
          for (let i = 0; i < numBins; i++) {
            let sum = 0;
            for (let j = 0; j < binSize; j++) sum += freqScratch[i * binSize + j];
            a.fft[i] = sum / (binSize * 255);
          }
        }
        hydra.tick(performance.now());
      }, "draw"),
      resizeKind: /* @__PURE__ */ __name((w, h) => {
        msg.canvas.width = Math.max(1, Math.round(w));
        msg.canvas.height = Math.max(1, Math.round(h));
        hydra?.setResolution?.(w, h);
      }, "resizeKind"),
      teardown: /* @__PURE__ */ __name(() => {
        try {
          hydra?.synth?.hush?.();
        } catch {
        }
      }, "teardown")
    };
  }
  __name(mountHydra, "mountHydra");
  function mountGLSL(msg, rawAnalyser, rawScheduler, feed) {
    msg.canvas.width = Math.max(1, Math.round(msg.size.w));
    msg.canvas.height = Math.max(1, Math.round(msg.size.h));
    const gl = msg.canvas.getContext("webgl2");
    if (!gl) throw new Error("glsl: WebGL2 unavailable in worker");
    const program = createGLSLProgram(gl, msg.code);
    const startMs = globalThis.performance?.now?.() ?? 0;
    const notes = new GLSLNoteFeed();
    const warnDropped = /* @__PURE__ */ __name((dropped, total) => postVizLog({ level: "warn", runtime: "glsl", source: msg.name || void 0, message: droppedNotesMessage(dropped, total) }), "warnDropped");
    return {
      setupDone: /* @__PURE__ */ __name(() => true, "setupDone"),
      // program built synchronously above; draw on first frame
      whenLoaded: /* @__PURE__ */ __name(() => Promise.resolve(), "whenLoaded"),
      // #266 — raw WebGL2 context we own; re-get returns the same context for the
      // host's accountGL/releaseGL. The EASIEST gl() of the three kinds (no search).
      gl: /* @__PURE__ */ __name(() => msg.canvas.getContext("webgl2"), "gl"),
      draw: /* @__PURE__ */ __name(() => {
        const timeMs = (globalThis.performance?.now?.() ?? 0) - startMs;
        if (program.readsNotes) {
          notes.update(
            rawScheduler.all(),
            rawScheduler.version(),
            rawScheduler.now(),
            rawScheduler.cps(),
            feed.bus.tracks,
            warnDropped
          );
        }
        program.draw(
          rawAnalyser,
          { width: msg.canvas.width, height: msg.canvas.height, timeMs },
          readGLSLEvents(feed.bus),
          readGLSLTracks(feed.bus),
          // #297 per-track signals (same already-ticked bus)
          notes
          // #2571 upcoming notes → uNotes / uNoteCount / uNow / uCps
        );
      }, "draw"),
      resizeKind: /* @__PURE__ */ __name((w, h) => {
        msg.canvas.width = Math.max(1, Math.round(w));
        msg.canvas.height = Math.max(1, Math.round(h));
      }, "resizeKind"),
      teardown: /* @__PURE__ */ __name(() => {
        try {
          program.dispose();
        } catch {
        }
      }, "teardown")
    };
  }
  __name(mountGLSL, "mountGLSL");
  async function mountThree(msg, feed, rawScheduler, containerSizeRef, dpr) {
    const compiled = compileThreeSketch(msg.code);
    if (compiled.syntaxError) throw compiled.syntaxError;
    const loaded2 = await loadThreeModules(compiled, sketchImportChain(msg.libs));
    const uniforms = buildStaveUniforms(feed.bus);
    const optionsRef = { current: msg.options ?? {} };
    let currentDpr = dpr;
    msg.canvas.width = Math.max(1, Math.round(msg.size.w * dpr));
    msg.canvas.height = Math.max(1, Math.round(msg.size.h * dpr));
    let drawn = false;
    let disposed = false;
    const run = runThreeSketch(compiled, loaded2, {
      canvas: msg.canvas,
      size: /* @__PURE__ */ __name(() => containerSizeRef.current, "size"),
      dpr: /* @__PURE__ */ __name(() => currentDpr, "dpr"),
      uniforms: /* @__PURE__ */ __name(() => uniforms, "uniforms"),
      options: /* @__PURE__ */ __name(() => optionsRef.current, "options"),
      // #2570 — the same pre-queried window p5's `stave.scheduler` reads,
      // refreshed from each frame's `rawScheduler` before the draw.
      scheduler: /* @__PURE__ */ __name(() => rawScheduler, "scheduler"),
      createCanvas: /* @__PURE__ */ __name(() => new OffscreenCanvas(1, 1), "createCanvas"),
      // #2641 — this worker runs one sketch at a time, so the workers and blob
      // URLs its libraries make here are the sketch's and end with it (a pooled
      // worker outlives the sketch; without this they would pile up in it).
      ownsRealm: true,
      report: /* @__PURE__ */ __name((entry) => {
        if (entry.level === "error" && !drawn) return;
        postVizLog({ ...entry, runtime: "three" });
      }, "report")
    });
    void run.done.then(({ error }) => {
      if (error && !drawn && !disposed) diag("error", `three: ${error.message}`, errStack(error));
    });
    return {
      setupDone: /* @__PURE__ */ __name(() => run.ready(), "setupDone"),
      // #2560 — top level done and every loader item in (the model, the HDRI).
      whenLoaded: /* @__PURE__ */ __name(() => run.whenLoaded(), "whenLoaded"),
      gl: /* @__PURE__ */ __name(() => run.gl(), "gl"),
      setOptions: /* @__PURE__ */ __name((options) => {
        optionsRef.current = options;
      }, "setOptions"),
      draw: /* @__PURE__ */ __name(() => {
        drawn = true;
        run.frame(globalThis.performance?.now?.() ?? 0);
      }, "draw"),
      resizeKind: /* @__PURE__ */ __name((_w, _h, dprNew) => {
        currentDpr = dprNew;
        run.resize();
      }, "resizeKind"),
      teardown: /* @__PURE__ */ __name(() => {
        disposed = true;
        run.dispose();
      }, "teardown")
    };
  }
  __name(mountThree, "mountThree");
  function applyAndDraw(frame) {
    const s = state;
    if (!s) return;
    try {
      scope.postMessage({ type: "frameAck", drawMs: lastDrawMs });
    } catch {
    }
    s.feed.applyFrame(frame);
    let master;
    for (const a of frame.analysers) if (a.key === MASTER_KEY) master = a;
    s.rawAnalyser.set(master);
    if (s.rawScheduler.set(frame.rawScheduler)) {
      try {
        scope.postMessage({ type: "rawWindowResync" });
      } catch {
      }
    }
    if (!s.setupDone() || s.paused) return;
    const drawT0 = globalThis.performance?.now?.() ?? 0;
    try {
      s.draw();
    } catch (e) {
      postVizLog({ level: "error", runtime: currentRuntimeRef.kind, message: `draw(): ${errMsg(e)}`, stack: errStack(e) });
      return;
    }
    lastDrawMs = (globalThis.performance?.now?.() ?? 0) - drawT0;
    if (!s.readySent) {
      s.readySent = true;
      signalReady();
      accountGL();
    }
  }
  __name(applyAndDraw, "applyAndDraw");
  function resize(w, h, dpr) {
    const s = state;
    if (!s) return;
    s.dpr = dpr > 0 ? dpr : 1;
    s.containerSizeRef.current = { w, h };
    try {
      s.resizeKind(w, h, s.dpr);
    } catch (e) {
      diag("error", `resize failed: ${errMsg(e)}`);
    }
  }
  __name(resize, "resize");
  function destroy() {
    const s = state;
    state = null;
    lastDrawMs = void 0;
    if (!s) return;
    try {
      s.reader.dispose();
    } catch {
    }
    try {
      s.teardown();
    } catch {
    }
    releaseGL();
  }
  __name(destroy, "destroy");
}
__name(hostVizWorker, "hostVizWorker");
var hostP5Worker = hostVizWorker;
function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}
__name(errMsg, "errMsg");
function errStack(e) {
  return e instanceof Error ? String(e.stack || "").split("\n").slice(0, 6).join("\n") : void 0;
}
__name(errStack, "errStack");

export { hostP5Worker, hostVizWorker };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map