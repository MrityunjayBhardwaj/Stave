var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/extensions/vim/monacoApi.ts
var KeyCode = void 0;
var Range = void 0;
var Position = void 0;
var Selection = void 0;
var SelectionDirection = void 0;
var editor = void 0;
function useMonaco(monaco) {
  KeyCode = monaco.KeyCode;
  Range = monaco.Range;
  Position = monaco.Position;
  Selection = monaco.Selection;
  SelectionDirection = monaco.SelectionDirection;
  editor = monaco.editor;
}
__name(useMonaco, "useMonaco");

// src/extensions/vim/shiftCommand.ts
function shiftEdit(line, opts) {
  const size = Math.max(1, opts.indentSize || opts.tabSize || 1);
  if (!opts.isUnshift) {
    if (line.length === 0) return null;
    return { from: 1, to: 1, text: opts.insertSpaces ? " ".repeat(size) : "	" };
  }
  if (line.startsWith("	")) return { from: 1, to: 2, text: "" };
  let n = 0;
  while (n < size && line[n] === " ") n++;
  return n === 0 ? null : { from: 1, to: n + 1, text: "" };
}
__name(shiftEdit, "shiftEdit");
var _ShiftCommand = class _ShiftCommand {
  constructor(selection, opts) {
    this.selection = selection;
    this.opts = opts;
    this.selectionId = null;
  }
  getEditOperations(model, builder) {
    const lineNumber = this.selection.startLineNumber;
    const edit = shiftEdit(model.getLineContent(lineNumber), this.opts);
    if (edit) builder.addEditOperation(new Range(lineNumber, edit.from, lineNumber, edit.to), edit.text);
    this.selectionId = builder.trackSelection(this.selection);
  }
  computeCursorState(_model, helper) {
    return this.selectionId ? helper.getTrackedSelection(this.selectionId) : this.selection;
  }
};
__name(_ShiftCommand, "ShiftCommand");
var ShiftCommand = _ShiftCommand;

// ../../node_modules/.pnpm/monaco-vim@0.4.4_monaco-editor@0.50.0/node_modules/monaco-vim/dist/index.mjs
var _CMAdapter;
var VerticalRevealType = { Bottom: 4 };
var EditorOptConstants = {
  readOnly: 65,
  cursorWidth: 20,
  fontInfo: 32
};
var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
function isWordCharBasic(ch) {
  return /\w/.test(ch) || ch > "\x80" && (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
}
__name(isWordCharBasic, "isWordCharBasic");
function Pos$1(line, column) {
  if (!(this instanceof Pos$1)) return new Pos$1(line, column);
  this.line = line;
  this.ch = column;
}
__name(Pos$1, "Pos$1");
function signal(cm, signal$1, args) {
  cm.dispatch(signal$1, args);
}
__name(signal, "signal");
function dummy(key) {
  return function() {
  };
}
__name(dummy, "dummy");
var StringStream = /* @__PURE__ */ __name(function(string, tabSize) {
  this.pos = this.start = 0;
  this.string = string;
  this.tabSize = tabSize || 8;
  this.lastColumnPos = this.lastColumnValue = 0;
  this.lineStart = 0;
}, "StringStream");
StringStream.prototype = {
  eol: /* @__PURE__ */ __name(function() {
    return this.pos >= this.string.length;
  }, "eol"),
  sol: /* @__PURE__ */ __name(function() {
    return this.pos == this.lineStart;
  }, "sol"),
  peek: /* @__PURE__ */ __name(function() {
    return this.string.charAt(this.pos) || void 0;
  }, "peek"),
  next: /* @__PURE__ */ __name(function() {
    if (this.pos < this.string.length) return this.string.charAt(this.pos++);
  }, "next"),
  eat: /* @__PURE__ */ __name(function(match) {
    var ch = this.string.charAt(this.pos);
    if (typeof match == "string") var ok = ch == match;
    else var ok = ch && (match.test ? match.test(ch) : match(ch));
    if (ok) {
      ++this.pos;
      return ch;
    }
  }, "eat"),
  eatWhile: /* @__PURE__ */ __name(function(match) {
    var start = this.pos;
    while (this.eat(match)) ;
    return this.pos > start;
  }, "eatWhile"),
  eatSpace: /* @__PURE__ */ __name(function() {
    var start = this.pos;
    while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
    return this.pos > start;
  }, "eatSpace"),
  skipToEnd: /* @__PURE__ */ __name(function() {
    this.pos = this.string.length;
  }, "skipToEnd"),
  skipTo: /* @__PURE__ */ __name(function(ch) {
    var found = this.string.indexOf(ch, this.pos);
    if (found > -1) {
      this.pos = found;
      return true;
    }
  }, "skipTo"),
  backUp: /* @__PURE__ */ __name(function(n) {
    this.pos -= n;
  }, "backUp"),
  column: /* @__PURE__ */ __name(function() {
    throw "not implemented";
  }, "column"),
  indentation: /* @__PURE__ */ __name(function() {
    throw "not implemented";
  }, "indentation"),
  match: /* @__PURE__ */ __name(function(pattern, consume, caseInsensitive) {
    if (typeof pattern == "string") {
      var cased = /* @__PURE__ */ __name(function(str) {
        return caseInsensitive ? str.toLowerCase() : str;
      }, "cased");
      if (cased(this.string.substr(this.pos, pattern.length)) == cased(pattern)) {
        if (consume !== false) this.pos += pattern.length;
        return true;
      }
    } else {
      var match = this.string.slice(this.pos).match(pattern);
      if (match && match.index > 0) return null;
      if (match && consume !== false) this.pos += match[0].length;
      return match;
    }
  }, "match"),
  current: /* @__PURE__ */ __name(function() {
    return this.string.slice(this.start, this.pos);
  }, "current"),
  hideFirstChars: /* @__PURE__ */ __name(function(n, inner) {
    this.lineStart += n;
    try {
      return inner();
    } finally {
      this.lineStart -= n;
    }
  }, "hideFirstChars")
};
function toCmPos(pos) {
  return new Pos$1(pos.lineNumber - 1, pos.column - 1);
}
__name(toCmPos, "toCmPos");
function toMonacoPos(pos) {
  return new Position(pos.line + 1, pos.ch + 1);
}
__name(toMonacoPos, "toMonacoPos");
var _a;
var Marker = (_a = class {
  constructor(cm, id, line, ch) {
    this.cm = cm;
    this.id = id;
    this.lineNumber = line + 1;
    this.column = ch + 1;
    cm.marks[this.id] = this;
  }
  clear() {
    delete this.cm.marks[this.id];
  }
  find() {
    return toCmPos(this);
  }
}, __name(_a, "Marker"), _a);
function monacoToCmKey(e, skip = false) {
  let addQuotes = true;
  let keyName = KeyCode[e.keyCode];
  if (e.key) {
    keyName = e.key;
    addQuotes = false;
  }
  let key = keyName;
  let skipOnlyShiftCheck = skip;
  switch (e.keyCode) {
    case KeyCode.Shift:
    case KeyCode.Meta:
    case KeyCode.Alt:
    case KeyCode.Ctrl:
      return key;
    case KeyCode.Escape:
      skipOnlyShiftCheck = true;
      key = "Esc";
      break;
    case KeyCode.Space:
      skipOnlyShiftCheck = true;
      break;
  }
  if (keyName.startsWith("Key") || keyName.startsWith("KEY_")) key = keyName[keyName.length - 1].toLowerCase();
  else if (keyName.startsWith("Digit")) key = keyName.slice(5, 6);
  else if (keyName.startsWith("Numpad")) key = keyName.slice(6, 7);
  else if (keyName.endsWith("Arrow")) {
    skipOnlyShiftCheck = true;
    key = keyName.substring(0, keyName.length - 5);
  } else if (keyName.startsWith("US_") || keyName.startsWith("Bracket") || !key) key = e.browserEvent.key;
  if (!skipOnlyShiftCheck && !e.altKey && !e.ctrlKey && !e.metaKey) key = e.key || e.browserEvent.key;
  else {
    if (e.altKey) key = `Alt-${key}`;
    if (e.ctrlKey) key = `Ctrl-${key}`;
    if (e.metaKey) key = `Meta-${key}`;
    if (e.shiftKey) key = `Shift-${key}`;
  }
  if (key.length === 1 && addQuotes) key = `'${key}'`;
  return key;
}
__name(monacoToCmKey, "monacoToCmKey");
var _a2;
var CMAdapter = (_a2 = class {
  constructor(editor$1) {
    this.handleKeyDown = (e) => {
      if (e.browserEvent.defaultPrevented & e.keyCode !== KeyCode.Escape) return;
      if (!this.attached) return;
      const key = monacoToCmKey(e);
      if (this.replaceMode) this.handleReplaceMode(key, e);
      if (!key) return;
      const keymap = this.state.keyMap;
      if (_a2.keyMap[keymap] && _a2.keyMap[keymap].call) {
        const cmd = _a2.keyMap[keymap].call(key, this);
        if (cmd) {
          e.preventDefault();
          e.stopPropagation();
          try {
            cmd();
          } catch (err) {
            console.error(err);
          }
        }
      }
    };
    this.handleCursorChange = (e) => {
      const { position, source } = e;
      const { editor: editor$2 } = this;
      const selection = editor$2.getSelection();
      if (!this.ctxInsert.get() && e.source === "mouse" && selection.isEmpty()) {
        const maxCol = editor$2.getModel().getLineMaxColumn(position.lineNumber);
        if (e.position.column === maxCol) {
          editor$2.setPosition(new Position(e.position.lineNumber, maxCol - 1));
          return;
        }
      }
      this.dispatch("cursorActivity", this, e);
    };
    this.handleChange = (e) => {
      const { changes } = e;
      const change = {
        text: changes.reduce((acc, change$1) => {
          acc.push(change$1.text);
          return acc;
        }, []),
        origin: "+input"
      };
      const curOp = this.curOp = this.curOp || {};
      if (!curOp.changeHandlers) curOp.changeHandlers = this.listeners["change"] && this.listeners["change"].slice();
      if (this.virtualSelectionMode()) return;
      if (!curOp.lastChange) curOp.lastChange = curOp.change = change;
      else curOp.lastChange.next = curOp.lastChange = change;
      this.dispatch("change", this, change);
    };
    this.editor = editor$1;
    this.state = { keyMap: "vim" };
    this.marks = {};
    this.$uid = 0;
    this.disposables = [];
    this.listeners = {};
    this.curOp = {};
    this.attached = false;
    this.statusBar = null;
    this.options = {};
    this.addLocalListeners();
    this.ctxInsert = this.editor.createContextKey("insertMode", true);
  }
  attach() {
    _a2.keyMap.vim.attach(this);
  }
  addLocalListeners() {
    this.disposables.push(this.editor.onDidChangeCursorPosition(this.handleCursorChange), this.editor.onDidChangeModelContent(this.handleChange), this.editor.onKeyDown(this.handleKeyDown));
  }
  handleReplaceMode(key, e) {
    let fromReplace = false;
    let char = key;
    const pos = this.editor.getPosition();
    let range = new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column + 1);
    let forceMoveMarkers = true;
    if (key.startsWith("'")) char = key[1];
    else if (char === "Enter") char = "\n";
    else if (char === "Backspace") {
      const lastItem = this.replaceStack.pop();
      if (!lastItem) return;
      fromReplace = true;
      char = lastItem;
      range = new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column - 1);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.replaceStack) this.replaceStack = [];
    if (!fromReplace) this.replaceStack.push(this.editor.getModel().getValueInRange(range));
    this.editor.executeEdits("vim", [{
      text: char,
      range,
      forceMoveMarkers
    }]);
    if (fromReplace) this.editor.setPosition(range.getStartPosition());
  }
  setOption(key, value) {
    this.state[key] = value;
    if (key === "theme") editor.setTheme(value);
  }
  getConfiguration() {
    const { editor: editor$1 } = this;
    let opts = EditorOptConstants;
    if (typeof editor$1.getConfiguration === "function") return editor$1.getConfiguration();
    else if ("EditorOption" in editor) opts = editor.EditorOption;
    return {
      readOnly: editor$1.getOption(opts.readOnly),
      viewInfo: { cursorWidth: editor$1.getOption(opts.cursorWidth) },
      fontInfo: editor$1.getOption(opts.fontInfo)
    };
  }
  getOption(key) {
    if (key === "readOnly") return this.getConfiguration().readOnly;
    else if (key === "firstLineNumber") return this.firstLine() + 1;
    else if (key === "indentWithTabs") return !this.editor.getModel().getOptions().insertSpaces;
    else {
      if (typeof this.editor.getConfiguration === "function") return this.editor.getRawConfiguration()[key];
      return this.editor.getRawOptions()[key];
    }
  }
  dispatch(signal$1, ...args) {
    const listeners = this.listeners[signal$1];
    if (!listeners) return;
    listeners.forEach((handler) => handler(...args));
  }
  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }
  off(event, handler) {
    const listeners = this.listeners[event];
    if (!listeners) return;
    this.listeners[event] = listeners.filter((l) => l !== handler);
  }
  firstLine() {
    return 0;
  }
  lastLine() {
    return this.lineCount() - 1;
  }
  lineCount() {
    return this.editor.getModel().getLineCount();
  }
  defaultTextHeight() {
    return 1;
  }
  getLine(line) {
    if (line < 0) return "";
    const maxLines = this.editor.getModel().getLineCount();
    if (line + 1 > maxLines) line = maxLines - 1;
    return this.editor.getModel().getLineContent(line + 1);
  }
  getAnchorForSelection(selection) {
    if (selection.isEmpty()) return selection.getPosition();
    return selection.getDirection() === SelectionDirection.LTR ? selection.getStartPosition() : selection.getEndPosition();
  }
  getHeadForSelection(selection) {
    if (selection.isEmpty()) return selection.getPosition();
    return selection.getDirection() === SelectionDirection.LTR ? selection.getEndPosition() : selection.getStartPosition();
  }
  getCursor(type = null) {
    if (!type) return toCmPos(this.editor.getPosition());
    const sel = this.editor.getSelection();
    let pos;
    if (sel.isEmpty()) pos = sel.getPosition();
    else if (type === "anchor") pos = this.getAnchorForSelection(sel);
    else pos = this.getHeadForSelection(sel);
    return toCmPos(pos);
  }
  getRange(start, end) {
    const p1 = toMonacoPos(start);
    const p2 = toMonacoPos(end);
    return this.editor.getModel().getValueInRange(Range.fromPositions(p1, p2));
  }
  getSelection() {
    var list = [];
    var editor$1 = this.editor;
    editor$1.getSelections().map(function(sel) {
      list.push(editor$1.getModel().getValueInRange(sel));
    });
    return list.join("\n");
  }
  replaceRange(text, start, end) {
    const p1 = toMonacoPos(start);
    const p2 = !end ? p1 : toMonacoPos(end);
    this.editor.executeEdits("vim", [{
      text,
      range: Range.fromPositions(p1, p2)
    }]);
    this.pushUndoStop();
  }
  pushUndoStop() {
    this.editor.pushUndoStop();
  }
  setCursor(line, ch) {
    let pos = line;
    if (typeof line !== "object") {
      pos = {};
      pos.line = line;
      pos.ch = ch;
    }
    const monacoPos = this.editor.getModel().validatePosition(toMonacoPos(pos));
    this.editor.setPosition(toMonacoPos(pos));
    this.editor.revealPosition(monacoPos);
  }
  somethingSelected() {
    return !this.editor.getSelection().isEmpty();
  }
  operation(fn, force) {
    return fn();
  }
  listSelections() {
    const selections = this.editor.getSelections();
    if (!selections.length || this.inVirtualSelectionMode) return [{
      anchor: this.getCursor("anchor"),
      head: this.getCursor("head")
    }];
    return selections.map((sel) => {
      sel.getPosition();
      sel.getStartPosition();
      sel.getEndPosition();
      return {
        anchor: this.clipPos(toCmPos(this.getAnchorForSelection(sel))),
        head: this.clipPos(toCmPos(this.getHeadForSelection(sel)))
      };
    });
  }
  focus() {
    this.editor.focus();
  }
  setSelections(selections, primIndex) {
    const hasSel = !!this.editor.getSelections().length;
    const sels = selections.map((sel$1, index) => {
      const { anchor, head } = sel$1;
      if (hasSel) return Selection.fromPositions(toMonacoPos(anchor), toMonacoPos(head));
      else return Selection.fromPositions(toMonacoPos(head), toMonacoPos(anchor));
    });
    if (!primIndex) ; else if (sels[primIndex]) sels.push(sels.splice(primIndex, 1)[0]);
    if (!sels.length) return;
    const sel = sels[0];
    let posToReveal;
    if (sel.getDirection() === SelectionDirection.LTR) posToReveal = sel.getEndPosition();
    else posToReveal = sel.getStartPosition();
    this.editor.setSelections(sels);
    this.editor.revealPosition(posToReveal);
  }
  setSelection(frm, to) {
    const range = Range.fromPositions(toMonacoPos(frm), toMonacoPos(to));
    this.editor.setSelection(range);
  }
  getSelections() {
    const { editor: editor$1 } = this;
    return editor$1.getSelections().map((sel) => editor$1.getModel().getValueInRange(sel));
  }
  replaceSelections(texts) {
    const { editor: editor$1 } = this;
    editor$1.getSelections().forEach((sel, index) => {
      editor$1.executeEdits("vim", [{
        range: sel,
        text: texts[index],
        forceMoveMarkers: false
      }]);
    });
  }
  toggleOverwrite(toggle) {
    if (toggle) {
      this.enterVimMode();
      this.replaceMode = true;
    } else {
      this.leaveVimMode();
      this.replaceMode = false;
      this.replaceStack = [];
    }
  }
  charCoords(pos, mode) {
    return {
      top: pos.line,
      left: pos.ch
    };
  }
  coordsChar(pos, mode) {
  }
  clipPos(p) {
    return toCmPos(this.editor.getModel().validatePosition(toMonacoPos(p)));
  }
  setBookmark(cursor, options) {
    const bm = new Marker(this, this.$uid++, cursor.line, cursor.ch);
    if (!options || !options.insertLeft) bm.$insertRight = true;
    this.marks[bm.id] = bm;
    return bm;
  }
  getScrollInfo() {
    const { editor: editor$1 } = this;
    const [range] = editor$1.getVisibleRanges();
    return {
      left: 0,
      top: range.startLineNumber - 1,
      height: editor$1.getModel().getLineCount(),
      clientHeight: range.endLineNumber - range.startLineNumber + 1
    };
  }
  triggerEditorAction(action) {
    this.editor.trigger("vim", action);
  }
  dispose() {
    this.dispatch("dispose");
    this.removeOverlay();
    if (_a2.keyMap.vim) _a2.keyMap.vim.detach(this);
    this.disposables.forEach((d) => d.dispose());
  }
  getInputField() {
  }
  getWrapperElement() {
  }
  enterVimMode(toVim = true) {
    this.ctxInsert.set(false);
    const config = this.getConfiguration();
    this.initialCursorWidth = config.viewInfo.cursorWidth || 0;
    this.editor.updateOptions({
      cursorWidth: config.fontInfo.typicalFullwidthCharacterWidth,
      cursorBlinking: "solid",
      cursorStyle: "block"
    });
  }
  leaveVimMode() {
    this.ctxInsert.set(true);
    this.editor.updateOptions({
      cursorWidth: this.initialCursorWidth || 0,
      cursorBlinking: "blink",
      cursorStyle: "line"
    });
  }
  virtualSelectionMode() {
    return this.inVirtualSelectionMode;
  }
  markText() {
    return {
      clear: /* @__PURE__ */ __name(function() {
      }, "clear"),
      find: /* @__PURE__ */ __name(function() {
      }, "find")
    };
  }
  getUserVisibleLines() {
    const ranges = this.editor.getVisibleRanges();
    if (!ranges.length) return {
      top: 0,
      bottom: 0
    };
    const res = {
      top: Infinity,
      bottom: 0
    };
    ranges.reduce((acc, range) => {
      if (range.startLineNumber < acc.top) acc.top = range.startLineNumber;
      if (range.endLineNumber > acc.bottom) acc.bottom = range.endLineNumber;
      return acc;
    }, res);
    res.top -= 1;
    res.bottom -= 1;
    return res;
  }
  findPosV(startPos, amount, unit) {
    const { editor: editor$1 } = this;
    let finalAmount = amount;
    let finalUnit = unit;
    const pos = toMonacoPos(startPos);
    if (unit === "page") {
      const editorHeight = editor$1.getLayoutInfo().height;
      const lineHeight = this.getConfiguration().fontInfo.lineHeight;
      finalAmount = finalAmount * Math.floor(editorHeight / lineHeight);
      finalUnit = "line";
    }
    if (finalUnit === "line") pos.lineNumber += finalAmount;
    return toCmPos(pos);
  }
  findMatchingBracket(pos) {
    const mPos = toMonacoPos(pos);
    const model = this.editor.getModel();
    let res;
    if (model.bracketPairs) res = model.bracketPairs.matchBracket(mPos);
    else {
      var _model$matchBracket;
      res = (_model$matchBracket = model.matchBracket) === null || _model$matchBracket === void 0 ? void 0 : _model$matchBracket.call(model, mPos);
    }
    if (!res || !(res.length === 2)) return { to: null };
    return { to: toCmPos(res[1].getStartPosition()) };
  }
  findFirstNonWhiteSpaceCharacter(line) {
    return this.editor.getModel().getLineFirstNonWhitespaceColumn(line + 1) - 1;
  }
  scrollTo(x, y) {
    if (!x && !y) return;
    if (!x) {
      if (y < 0) y = this.editor.getPosition().lineNumber - y;
      this.editor.setScrollTop(this.editor.getTopForLineNumber(y + 1));
    }
  }
  moveCurrentLineTo(viewPosition) {
    const { editor: editor$1 } = this;
    const pos = editor$1.getPosition();
    const range = Range.fromPositions(pos, pos);
    switch (viewPosition) {
      case "top":
        editor$1.revealRangeAtTop(range);
        return;
      case "center":
        editor$1.revealRangeInCenter(range);
        return;
      case "bottom":
        var _editor$_revealRange;
        (_editor$_revealRange = editor$1._revealRange) === null || _editor$_revealRange === void 0 || _editor$_revealRange.call(editor$1, range, VerticalRevealType.Bottom);
        return;
    }
  }
  getSearchCursor(query, pos) {
    let matchCase = false;
    let isRegex = false;
    if (query instanceof RegExp && !query.global) {
      matchCase = !query.ignoreCase;
      query = query.source;
      isRegex = true;
    }
    if (pos.ch == void 0) pos.ch = Number.MAX_VALUE;
    const monacoPos = toMonacoPos(pos);
    const context = this;
    const { editor: editor$1 } = this;
    let lastSearch = null;
    const model = editor$1.getModel();
    const matches = model.findMatches(query, false, isRegex, matchCase) || [];
    return {
      getMatches() {
        return matches;
      },
      findNext() {
        return this.find(false);
      },
      findPrevious() {
        return this.find(true);
      },
      jumpTo(index) {
        if (!matches || !matches.length) return false;
        lastSearch = matches[index].range;
        context.highlightRanges([lastSearch], "currentFindMatch");
        context.highlightRanges(matches.map((m) => m.range).filter((r) => !r.equalsRange(lastSearch)));
        return lastSearch;
      },
      find(back) {
        if (!matches || !matches.length) return false;
        let match;
        if (back) {
          const pos$1 = lastSearch ? lastSearch.getStartPosition() : monacoPos;
          match = model.findPreviousMatch(query, pos$1, isRegex, matchCase);
          if (!match || !match.range.getStartPosition().isBeforeOrEqual(pos$1)) return false;
        } else {
          const pos$1 = lastSearch ? model.getPositionAt(model.getOffsetAt(lastSearch.getEndPosition()) + 1) : monacoPos;
          match = model.findNextMatch(query, pos$1, isRegex, matchCase);
          if (!match || !pos$1.isBeforeOrEqual(match.range.getStartPosition())) return false;
        }
        lastSearch = match.range;
        context.highlightRanges([lastSearch], "currentFindMatch");
        context.highlightRanges(matches.map((m) => m.range).filter((r) => !r.equalsRange(lastSearch)));
        return lastSearch;
      },
      from() {
        return lastSearch && toCmPos(lastSearch.getStartPosition());
      },
      to() {
        return lastSearch && toCmPos(lastSearch.getEndPosition());
      },
      replace(text) {
        if (lastSearch) {
          editor$1.executeEdits("vim", [{
            range: lastSearch,
            text,
            forceMoveMarkers: true
          }], function(edits) {
            const { endLineNumber, endColumn } = edits[0].range;
            lastSearch = lastSearch.setEndPosition(endLineNumber, endColumn);
          });
          editor$1.setPosition(lastSearch.getStartPosition());
        }
      }
    };
  }
  highlightRanges(ranges, className = "findMatch") {
    const decorationKey = `decoration${className}`;
    this[decorationKey] = this.editor.deltaDecorations(this[decorationKey] || [], ranges.map((range) => ({
      range,
      options: {
        stickiness: editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        zIndex: 13,
        className,
        showIfCollapsed: true
      }
    })));
    return this[decorationKey];
  }
  addOverlay({ query }, hasBoundary, style) {
    let matchCase = false;
    let isRegex = false;
    if (query && query instanceof RegExp && !query.global) {
      isRegex = true;
      matchCase = !query.ignoreCase;
      query = query.source;
    }
    const match = this.editor.getModel().findNextMatch(query, this.editor.getPosition(), isRegex, matchCase);
    if (!match || !match.range) return;
    this.highlightRanges([match.range]);
  }
  removeOverlay() {
    ["currentFindMatch", "findMatch"].forEach((key) => {
      this.editor.deltaDecorations(this[`decoration${key}`] || [], []);
    });
  }
  scrollIntoView(pos) {
    if (!pos) return;
    this.editor.revealPosition(toMonacoPos(pos));
  }
  moveH(units, type) {
    if (type !== "char") return;
    const pos = this.editor.getPosition();
    this.editor.setPosition(new Position(pos.lineNumber, pos.column + units));
  }
  scanForBracket(pos, dir, dd, config) {
    const { bracketRegex } = config;
    let mPos = toMonacoPos(pos);
    const model = this.editor.getModel();
    const searchFunc = (dir === -1 ? model.findPreviousMatch : model.findNextMatch).bind(model);
    const stack = [];
    let iterations = 0;
    while (true) {
      if (iterations > 10) return;
      const match = searchFunc(bracketRegex.source, mPos, true, true, null, true);
      const thisBracket = match.matches[0];
      if (match === void 0) return;
      const matchingBracket = _a2.matchingBrackets[thisBracket];
      if (matchingBracket && matchingBracket.charAt(1) === ">" == dir > 0) stack.push(thisBracket);
      else if (stack.length === 0) return { pos: toCmPos(match.range.getStartPosition()) };
      else stack.pop();
      mPos = model.getPositionAt(model.getOffsetAt(match.range.getStartPosition()) + dir);
      iterations += 1;
    }
  }
  indexFromPos(pos) {
    return this.editor.getModel().getOffsetAt(toMonacoPos(pos));
  }
  posFromIndex(offset) {
    return toCmPos(this.editor.getModel().getPositionAt(offset));
  }
  indentLine(line, indentRight = true) {
    const { editor: editor$1 } = this;
    let cursorConfig;
    if (editor$1._getViewModel) cursorConfig = editor$1._getViewModel().cursorConfig;
    else cursorConfig = editor$1._getCursors().context.config;
    const pos = new Position(line + 1, 1);
    const sel = Selection.fromPositions(pos, pos);
    editor$1.executeCommand("vim", new ShiftCommand(sel, {
      isUnshift: !indentRight,
      tabSize: cursorConfig.tabSize,
      indentSize: cursorConfig.indentSize,
      insertSpaces: cursorConfig.insertSpaces,
      useTabStops: cursorConfig.useTabStops,
      autoIndent: cursorConfig.autoIndent
    }));
  }
  setStatusBar(statusBar) {
    this.statusBar = statusBar;
  }
  openDialog(html, callback, options) {
    if (!this.statusBar) return;
    return this.statusBar.setSec(html, callback, options);
  }
  openNotification(html) {
    if (!this.statusBar) return;
    this.statusBar.showNotification(html);
  }
  smartIndent() {
    this.editor.getAction("editor.action.formatSelection").run();
  }
  moveCursorTo(to) {
    const newPos = this.editor.getPosition();
    if (to === "start") newPos.column = 1;
    else if (to === "end") newPos.column = this.editor.getModel().getLineMaxColumn(newPos.lineNumber);
    this.editor.setPosition(newPos);
  }
  execCommand(command) {
    switch (command) {
      case "goLineLeft":
        this.moveCursorTo("start");
        break;
      case "goLineRight":
        this.moveCursorTo("end");
        break;
      case "indentAuto":
        this.smartIndent();
        break;
    }
  }
}, __name(_a2, "CMAdapter"), _a2);
_CMAdapter = CMAdapter;
CMAdapter.Pos = Pos$1;
CMAdapter.signal = signal;
CMAdapter.on = dummy();
CMAdapter.off = dummy();
CMAdapter.addClass = dummy();
CMAdapter.rmClass = dummy();
CMAdapter.defineOption = dummy();
CMAdapter.keyMap = { default: /* @__PURE__ */ __name(function(key) {
  return function(cm) {
    return true;
  };
}, "default") };
CMAdapter.matchingBrackets = {
  "(": ")>",
  ")": "(<",
  "[": "]>",
  "]": "[<",
  "{": "}>",
  "}": "{<",
  "<": ">>",
  ">": "<<"
};
CMAdapter.isWordChar = isWordCharBasic;
CMAdapter.keyName = monacoToCmKey;
CMAdapter.StringStream = StringStream;
CMAdapter.e_stop = function(e) {
  if (e.stopPropagation) e.stopPropagation();
  else e.cancelBubble = true;
  _CMAdapter.e_preventDefault(e);
  return false;
};
CMAdapter.e_preventDefault = function(e) {
  if (e.preventDefault) {
    e.preventDefault();
    if (e.browserEvent) e.browserEvent.preventDefault();
  } else e.returnValue = false;
  return false;
};
CMAdapter.commands = {
  redo: /* @__PURE__ */ __name(function(cm) {
    cm.editor.getModel().redo();
  }, "redo"),
  undo: /* @__PURE__ */ __name(function(cm) {
    cm.editor.getModel().undo();
  }, "undo"),
  newlineAndIndent: /* @__PURE__ */ __name(function(cm) {
    cm.triggerEditorAction("editor.action.insertLineAfter");
  }, "newlineAndIndent")
};
CMAdapter.lookupKey = /* @__PURE__ */ __name(function lookupKey(key, map, handle) {
  if (typeof map === "string") map = _CMAdapter.keyMap[map];
  const found = typeof map == "function" ? map(key) : map[key];
  if (found === false) return "nothing";
  if (found === "...") return "multi";
  if (found != null && handle(found)) return "handled";
  if (map.fallthrough) {
    if (!Array.isArray(map.fallthrough)) return lookupKey(key, map.fallthrough, handle);
    for (var i = 0; i < map.fallthrough.length; i++) {
      var result = lookupKey(key, map.fallthrough[i], handle);
      if (result) return result;
    }
  }
}, "lookupKey");
CMAdapter.defineExtension = function(name, fn) {
  _CMAdapter.prototype[name] = fn;
};
var cm_adapter_default = CMAdapter;
var Pos = cm_adapter_default.Pos;
function transformCursor(cm, range) {
  var vim = cm.state.vim;
  if (!vim || vim.insertMode) return range.head;
  var head = vim.sel.head;
  if (!head) return range.head;
  if (vim.visualBlock) {
    if (range.head.line != head.line) return;
  }
  if (range.from() == range.anchor && !range.empty()) {
    if (range.head.line == head.line && range.head.ch != head.ch) return new Pos(range.head.line, range.head.ch - 1);
  }
  return range.head;
}
__name(transformCursor, "transformCursor");
var defaultKeymap = [
  {
    keys: "<Left>",
    type: "keyToKey",
    toKeys: "h"
  },
  {
    keys: "<Right>",
    type: "keyToKey",
    toKeys: "l"
  },
  {
    keys: "<Up>",
    type: "keyToKey",
    toKeys: "k"
  },
  {
    keys: "<Down>",
    type: "keyToKey",
    toKeys: "j"
  },
  {
    keys: "g<Up>",
    type: "keyToKey",
    toKeys: "gk"
  },
  {
    keys: "g<Down>",
    type: "keyToKey",
    toKeys: "gj"
  },
  {
    keys: "<Space>",
    type: "keyToKey",
    toKeys: "l"
  },
  {
    keys: "<BS>",
    type: "keyToKey",
    toKeys: "h",
    context: "normal"
  },
  {
    keys: "<Del>",
    type: "keyToKey",
    toKeys: "x",
    context: "normal"
  },
  {
    keys: "<C-Space>",
    type: "keyToKey",
    toKeys: "W"
  },
  {
    keys: "<C-BS>",
    type: "keyToKey",
    toKeys: "B",
    context: "normal"
  },
  {
    keys: "<S-Space>",
    type: "keyToKey",
    toKeys: "w"
  },
  {
    keys: "<S-BS>",
    type: "keyToKey",
    toKeys: "b",
    context: "normal"
  },
  {
    keys: "<C-n>",
    type: "keyToKey",
    toKeys: "j"
  },
  {
    keys: "<C-p>",
    type: "keyToKey",
    toKeys: "k"
  },
  {
    keys: "<C-[>",
    type: "keyToKey",
    toKeys: "<Esc>"
  },
  {
    keys: "<C-c>",
    type: "keyToKey",
    toKeys: "<Esc>"
  },
  {
    keys: "<C-[>",
    type: "keyToKey",
    toKeys: "<Esc>",
    context: "insert"
  },
  {
    keys: "<C-c>",
    type: "keyToKey",
    toKeys: "<Esc>",
    context: "insert"
  },
  {
    keys: "s",
    type: "keyToKey",
    toKeys: "cl",
    context: "normal"
  },
  {
    keys: "s",
    type: "keyToKey",
    toKeys: "c",
    context: "visual"
  },
  {
    keys: "S",
    type: "keyToKey",
    toKeys: "cc",
    context: "normal"
  },
  {
    keys: "S",
    type: "keyToKey",
    toKeys: "VdO",
    context: "visual"
  },
  {
    keys: "<Home>",
    type: "keyToKey",
    toKeys: "0"
  },
  {
    keys: "<End>",
    type: "keyToKey",
    toKeys: "$"
  },
  {
    keys: "<PageUp>",
    type: "keyToKey",
    toKeys: "<C-b>"
  },
  {
    keys: "<PageDown>",
    type: "keyToKey",
    toKeys: "<C-f>"
  },
  {
    keys: "<CR>",
    type: "keyToKey",
    toKeys: "j^",
    context: "normal"
  },
  {
    keys: "<Ins>",
    type: "keyToKey",
    toKeys: "i",
    context: "normal"
  },
  {
    keys: "<Ins>",
    type: "action",
    action: "toggleOverwrite",
    context: "insert"
  },
  {
    keys: "H",
    type: "motion",
    motion: "moveToTopLine",
    motionArgs: {
      linewise: true,
      toJumplist: true
    }
  },
  {
    keys: "M",
    type: "motion",
    motion: "moveToMiddleLine",
    motionArgs: {
      linewise: true,
      toJumplist: true
    }
  },
  {
    keys: "L",
    type: "motion",
    motion: "moveToBottomLine",
    motionArgs: {
      linewise: true,
      toJumplist: true
    }
  },
  {
    keys: "h",
    type: "motion",
    motion: "moveByCharacters",
    motionArgs: { forward: false }
  },
  {
    keys: "l",
    type: "motion",
    motion: "moveByCharacters",
    motionArgs: { forward: true }
  },
  {
    keys: "j",
    type: "motion",
    motion: "moveByLines",
    motionArgs: {
      forward: true,
      linewise: true
    }
  },
  {
    keys: "k",
    type: "motion",
    motion: "moveByLines",
    motionArgs: {
      forward: false,
      linewise: true
    }
  },
  {
    keys: "gj",
    type: "motion",
    motion: "moveByDisplayLines",
    motionArgs: { forward: true }
  },
  {
    keys: "gk",
    type: "motion",
    motion: "moveByDisplayLines",
    motionArgs: { forward: false }
  },
  {
    keys: "w",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: true,
      wordEnd: false
    }
  },
  {
    keys: "W",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: true,
      wordEnd: false,
      bigWord: true
    }
  },
  {
    keys: "e",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: true,
      wordEnd: true,
      inclusive: true
    }
  },
  {
    keys: "E",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: true,
      wordEnd: true,
      bigWord: true,
      inclusive: true
    }
  },
  {
    keys: "b",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: false,
      wordEnd: false
    }
  },
  {
    keys: "B",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: false,
      wordEnd: false,
      bigWord: true
    }
  },
  {
    keys: "ge",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: false,
      wordEnd: true,
      inclusive: true
    }
  },
  {
    keys: "gE",
    type: "motion",
    motion: "moveByWords",
    motionArgs: {
      forward: false,
      wordEnd: true,
      bigWord: true,
      inclusive: true
    }
  },
  {
    keys: "{",
    type: "motion",
    motion: "moveByParagraph",
    motionArgs: {
      forward: false,
      toJumplist: true
    }
  },
  {
    keys: "}",
    type: "motion",
    motion: "moveByParagraph",
    motionArgs: {
      forward: true,
      toJumplist: true
    }
  },
  {
    keys: "(",
    type: "motion",
    motion: "moveBySentence",
    motionArgs: { forward: false }
  },
  {
    keys: ")",
    type: "motion",
    motion: "moveBySentence",
    motionArgs: { forward: true }
  },
  {
    keys: "<C-f>",
    type: "motion",
    motion: "moveByPage",
    motionArgs: { forward: true }
  },
  {
    keys: "<C-b>",
    type: "motion",
    motion: "moveByPage",
    motionArgs: { forward: false }
  },
  {
    keys: "<C-d>",
    type: "motion",
    motion: "moveByScroll",
    motionArgs: {
      forward: true,
      explicitRepeat: true
    }
  },
  {
    keys: "<C-u>",
    type: "motion",
    motion: "moveByScroll",
    motionArgs: {
      forward: false,
      explicitRepeat: true
    }
  },
  {
    keys: "gg",
    type: "motion",
    motion: "moveToLineOrEdgeOfDocument",
    motionArgs: {
      forward: false,
      explicitRepeat: true,
      linewise: true,
      toJumplist: true
    }
  },
  {
    keys: "G",
    type: "motion",
    motion: "moveToLineOrEdgeOfDocument",
    motionArgs: {
      forward: true,
      explicitRepeat: true,
      linewise: true,
      toJumplist: true
    }
  },
  {
    keys: "g$",
    type: "motion",
    motion: "moveToEndOfDisplayLine"
  },
  {
    keys: "g^",
    type: "motion",
    motion: "moveToStartOfDisplayLine"
  },
  {
    keys: "g0",
    type: "motion",
    motion: "moveToStartOfDisplayLine"
  },
  {
    keys: "0",
    type: "motion",
    motion: "moveToStartOfLine"
  },
  {
    keys: "^",
    type: "motion",
    motion: "moveToFirstNonWhiteSpaceCharacter"
  },
  {
    keys: "+",
    type: "motion",
    motion: "moveByLines",
    motionArgs: {
      forward: true,
      toFirstChar: true
    }
  },
  {
    keys: "-",
    type: "motion",
    motion: "moveByLines",
    motionArgs: {
      forward: false,
      toFirstChar: true
    }
  },
  {
    keys: "_",
    type: "motion",
    motion: "moveByLines",
    motionArgs: {
      forward: true,
      toFirstChar: true,
      repeatOffset: -1
    }
  },
  {
    keys: "$",
    type: "motion",
    motion: "moveToEol",
    motionArgs: { inclusive: true }
  },
  {
    keys: "%",
    type: "motion",
    motion: "moveToMatchedSymbol",
    motionArgs: {
      inclusive: true,
      toJumplist: true
    }
  },
  {
    keys: "f<character>",
    type: "motion",
    motion: "moveToCharacter",
    motionArgs: {
      forward: true,
      inclusive: true
    }
  },
  {
    keys: "F<character>",
    type: "motion",
    motion: "moveToCharacter",
    motionArgs: { forward: false }
  },
  {
    keys: "t<character>",
    type: "motion",
    motion: "moveTillCharacter",
    motionArgs: {
      forward: true,
      inclusive: true
    }
  },
  {
    keys: "T<character>",
    type: "motion",
    motion: "moveTillCharacter",
    motionArgs: { forward: false }
  },
  {
    keys: ";",
    type: "motion",
    motion: "repeatLastCharacterSearch",
    motionArgs: { forward: true }
  },
  {
    keys: ",",
    type: "motion",
    motion: "repeatLastCharacterSearch",
    motionArgs: { forward: false }
  },
  {
    keys: "'<character>",
    type: "motion",
    motion: "goToMark",
    motionArgs: {
      toJumplist: true,
      linewise: true
    }
  },
  {
    keys: "`<character>",
    type: "motion",
    motion: "goToMark",
    motionArgs: { toJumplist: true }
  },
  {
    keys: "]`",
    type: "motion",
    motion: "jumpToMark",
    motionArgs: { forward: true }
  },
  {
    keys: "[`",
    type: "motion",
    motion: "jumpToMark",
    motionArgs: { forward: false }
  },
  {
    keys: "]'",
    type: "motion",
    motion: "jumpToMark",
    motionArgs: {
      forward: true,
      linewise: true
    }
  },
  {
    keys: "['",
    type: "motion",
    motion: "jumpToMark",
    motionArgs: {
      forward: false,
      linewise: true
    }
  },
  {
    keys: "]p",
    type: "action",
    action: "paste",
    isEdit: true,
    actionArgs: {
      after: true,
      isEdit: true,
      matchIndent: true
    }
  },
  {
    keys: "[p",
    type: "action",
    action: "paste",
    isEdit: true,
    actionArgs: {
      after: false,
      isEdit: true,
      matchIndent: true
    }
  },
  {
    keys: "]<character>",
    type: "motion",
    motion: "moveToSymbol",
    motionArgs: {
      forward: true,
      toJumplist: true
    }
  },
  {
    keys: "[<character>",
    type: "motion",
    motion: "moveToSymbol",
    motionArgs: {
      forward: false,
      toJumplist: true
    }
  },
  {
    keys: "|",
    type: "motion",
    motion: "moveToColumn"
  },
  {
    keys: "o",
    type: "motion",
    motion: "moveToOtherHighlightedEnd",
    context: "visual"
  },
  {
    keys: "O",
    type: "motion",
    motion: "moveToOtherHighlightedEnd",
    motionArgs: { sameLine: true },
    context: "visual"
  },
  {
    keys: "d",
    type: "operator",
    operator: "delete"
  },
  {
    keys: "y",
    type: "operator",
    operator: "yank"
  },
  {
    keys: "c",
    type: "operator",
    operator: "change"
  },
  {
    keys: "=",
    type: "operator",
    operator: "indentAuto"
  },
  {
    keys: ">",
    type: "operator",
    operator: "indent",
    operatorArgs: { indentRight: true }
  },
  {
    keys: "<",
    type: "operator",
    operator: "indent",
    operatorArgs: { indentRight: false }
  },
  {
    keys: "g~",
    type: "operator",
    operator: "changeCase"
  },
  {
    keys: "gu",
    type: "operator",
    operator: "changeCase",
    operatorArgs: { toLower: true },
    isEdit: true
  },
  {
    keys: "gU",
    type: "operator",
    operator: "changeCase",
    operatorArgs: { toLower: false },
    isEdit: true
  },
  {
    keys: "n",
    type: "motion",
    motion: "findNext",
    motionArgs: {
      forward: true,
      toJumplist: true
    }
  },
  {
    keys: "N",
    type: "motion",
    motion: "findNext",
    motionArgs: {
      forward: false,
      toJumplist: true
    }
  },
  {
    keys: "gn",
    type: "motion",
    motion: "findAndSelectNextInclusive",
    motionArgs: { forward: true }
  },
  {
    keys: "gN",
    type: "motion",
    motion: "findAndSelectNextInclusive",
    motionArgs: { forward: false }
  },
  {
    keys: "x",
    type: "operatorMotion",
    operator: "delete",
    motion: "moveByCharacters",
    motionArgs: { forward: true },
    operatorMotionArgs: { visualLine: false }
  },
  {
    keys: "X",
    type: "operatorMotion",
    operator: "delete",
    motion: "moveByCharacters",
    motionArgs: { forward: false },
    operatorMotionArgs: { visualLine: true }
  },
  {
    keys: "D",
    type: "operatorMotion",
    operator: "delete",
    motion: "moveToEol",
    motionArgs: { inclusive: true },
    context: "normal"
  },
  {
    keys: "D",
    type: "operator",
    operator: "delete",
    operatorArgs: { linewise: true },
    context: "visual"
  },
  {
    keys: "Y",
    type: "operatorMotion",
    operator: "yank",
    motion: "expandToLine",
    motionArgs: { linewise: true },
    context: "normal"
  },
  {
    keys: "Y",
    type: "operator",
    operator: "yank",
    operatorArgs: { linewise: true },
    context: "visual"
  },
  {
    keys: "C",
    type: "operatorMotion",
    operator: "change",
    motion: "moveToEol",
    motionArgs: { inclusive: true },
    context: "normal"
  },
  {
    keys: "C",
    type: "operator",
    operator: "change",
    operatorArgs: { linewise: true },
    context: "visual"
  },
  {
    keys: "~",
    type: "operatorMotion",
    operator: "changeCase",
    motion: "moveByCharacters",
    motionArgs: { forward: true },
    operatorArgs: { shouldMoveCursor: true },
    context: "normal"
  },
  {
    keys: "~",
    type: "operator",
    operator: "changeCase",
    context: "visual"
  },
  {
    keys: "<C-u>",
    type: "operatorMotion",
    operator: "delete",
    motion: "moveToStartOfLine",
    context: "insert"
  },
  {
    keys: "<C-w>",
    type: "operatorMotion",
    operator: "delete",
    motion: "moveByWords",
    motionArgs: {
      forward: false,
      wordEnd: false
    },
    context: "insert"
  },
  {
    keys: "<C-w>",
    type: "idle",
    context: "normal"
  },
  {
    keys: "<C-i>",
    type: "action",
    action: "jumpListWalk",
    actionArgs: { forward: true }
  },
  {
    keys: "<C-o>",
    type: "action",
    action: "jumpListWalk",
    actionArgs: { forward: false }
  },
  {
    keys: "<C-e>",
    type: "action",
    action: "scroll",
    actionArgs: {
      forward: true,
      linewise: true
    }
  },
  {
    keys: "<C-y>",
    type: "action",
    action: "scroll",
    actionArgs: {
      forward: false,
      linewise: true
    }
  },
  {
    keys: "a",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "charAfter" },
    context: "normal"
  },
  {
    keys: "A",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "eol" },
    context: "normal"
  },
  {
    keys: "A",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "endOfSelectedArea" },
    context: "visual"
  },
  {
    keys: "i",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "inplace" },
    context: "normal"
  },
  {
    keys: "gi",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "lastEdit" },
    context: "normal"
  },
  {
    keys: "I",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "firstNonBlank" },
    context: "normal"
  },
  {
    keys: "gI",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "bol" },
    context: "normal"
  },
  {
    keys: "I",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { insertAt: "startOfSelectedArea" },
    context: "visual"
  },
  {
    keys: "o",
    type: "action",
    action: "newLineAndEnterInsertMode",
    isEdit: true,
    interlaceInsertRepeat: true,
    actionArgs: { after: true },
    context: "normal"
  },
  {
    keys: "O",
    type: "action",
    action: "newLineAndEnterInsertMode",
    isEdit: true,
    interlaceInsertRepeat: true,
    actionArgs: { after: false },
    context: "normal"
  },
  {
    keys: "v",
    type: "action",
    action: "toggleVisualMode"
  },
  {
    keys: "V",
    type: "action",
    action: "toggleVisualMode",
    actionArgs: { linewise: true }
  },
  {
    keys: "<C-v>",
    type: "action",
    action: "toggleVisualMode",
    actionArgs: { blockwise: true }
  },
  {
    keys: "<C-q>",
    type: "action",
    action: "toggleVisualMode",
    actionArgs: { blockwise: true }
  },
  {
    keys: "gv",
    type: "action",
    action: "reselectLastSelection"
  },
  {
    keys: "J",
    type: "action",
    action: "joinLines",
    isEdit: true
  },
  {
    keys: "gJ",
    type: "action",
    action: "joinLines",
    actionArgs: { keepSpaces: true },
    isEdit: true
  },
  {
    keys: "p",
    type: "action",
    action: "paste",
    isEdit: true,
    actionArgs: {
      after: true,
      isEdit: true
    }
  },
  {
    keys: "P",
    type: "action",
    action: "paste",
    isEdit: true,
    actionArgs: {
      after: false,
      isEdit: true
    }
  },
  {
    keys: "r<character>",
    type: "action",
    action: "replace",
    isEdit: true
  },
  {
    keys: "@<character>",
    type: "action",
    action: "replayMacro"
  },
  {
    keys: "q<character>",
    type: "action",
    action: "enterMacroRecordMode"
  },
  {
    keys: "R",
    type: "action",
    action: "enterInsertMode",
    isEdit: true,
    actionArgs: { replace: true },
    context: "normal"
  },
  {
    keys: "R",
    type: "operator",
    operator: "change",
    operatorArgs: {
      linewise: true,
      fullLine: true
    },
    context: "visual",
    exitVisualBlock: true
  },
  {
    keys: "u",
    type: "action",
    action: "undo",
    context: "normal"
  },
  {
    keys: "u",
    type: "operator",
    operator: "changeCase",
    operatorArgs: { toLower: true },
    context: "visual",
    isEdit: true
  },
  {
    keys: "U",
    type: "operator",
    operator: "changeCase",
    operatorArgs: { toLower: false },
    context: "visual",
    isEdit: true
  },
  {
    keys: "<C-r>",
    type: "action",
    action: "redo"
  },
  {
    keys: "m<character>",
    type: "action",
    action: "setMark"
  },
  {
    keys: '"<character>',
    type: "action",
    action: "setRegister"
  },
  {
    keys: "zz",
    type: "action",
    action: "scrollToCursor",
    actionArgs: { position: "center" }
  },
  {
    keys: "z.",
    type: "action",
    action: "scrollToCursor",
    actionArgs: { position: "center" },
    motion: "moveToFirstNonWhiteSpaceCharacter"
  },
  {
    keys: "zt",
    type: "action",
    action: "scrollToCursor",
    actionArgs: { position: "top" }
  },
  {
    keys: "z<CR>",
    type: "action",
    action: "scrollToCursor",
    actionArgs: { position: "top" },
    motion: "moveToFirstNonWhiteSpaceCharacter"
  },
  {
    keys: "z-",
    type: "action",
    action: "scrollToCursor",
    actionArgs: { position: "bottom" }
  },
  {
    keys: "zb",
    type: "action",
    action: "scrollToCursor",
    actionArgs: { position: "bottom" },
    motion: "moveToFirstNonWhiteSpaceCharacter"
  },
  {
    keys: ".",
    type: "action",
    action: "repeatLastEdit"
  },
  {
    keys: "<C-a>",
    type: "action",
    action: "incrementNumberToken",
    isEdit: true,
    actionArgs: {
      increase: true,
      backtrack: false
    }
  },
  {
    keys: "<C-x>",
    type: "action",
    action: "incrementNumberToken",
    isEdit: true,
    actionArgs: {
      increase: false,
      backtrack: false
    }
  },
  {
    keys: "<C-t>",
    type: "action",
    action: "indent",
    actionArgs: { indentRight: true },
    context: "insert"
  },
  {
    keys: "<C-d>",
    type: "action",
    action: "indent",
    actionArgs: { indentRight: false },
    context: "insert"
  },
  {
    keys: "a<character>",
    type: "motion",
    motion: "textObjectManipulation"
  },
  {
    keys: "i<character>",
    type: "motion",
    motion: "textObjectManipulation",
    motionArgs: { textObjectInner: true }
  },
  {
    keys: "/",
    type: "search",
    searchArgs: {
      forward: true,
      querySrc: "prompt",
      toJumplist: true
    }
  },
  {
    keys: "?",
    type: "search",
    searchArgs: {
      forward: false,
      querySrc: "prompt",
      toJumplist: true
    }
  },
  {
    keys: "*",
    type: "search",
    searchArgs: {
      forward: true,
      querySrc: "wordUnderCursor",
      wholeWordOnly: true,
      toJumplist: true
    }
  },
  {
    keys: "#",
    type: "search",
    searchArgs: {
      forward: false,
      querySrc: "wordUnderCursor",
      wholeWordOnly: true,
      toJumplist: true
    }
  },
  {
    keys: "g*",
    type: "search",
    searchArgs: {
      forward: true,
      querySrc: "wordUnderCursor",
      toJumplist: true
    }
  },
  {
    keys: "g#",
    type: "search",
    searchArgs: {
      forward: false,
      querySrc: "wordUnderCursor",
      toJumplist: true
    }
  },
  {
    keys: ":",
    type: "ex"
  }
];
var defaultKeymapLength = defaultKeymap.length;
var defaultExCommandMap = [
  {
    name: "colorscheme",
    shortName: "colo"
  },
  { name: "map" },
  {
    name: "imap",
    shortName: "im"
  },
  {
    name: "nmap",
    shortName: "nm"
  },
  {
    name: "vmap",
    shortName: "vm"
  },
  { name: "unmap" },
  {
    name: "write",
    shortName: "w"
  },
  {
    name: "undo",
    shortName: "u"
  },
  {
    name: "redo",
    shortName: "red"
  },
  {
    name: "set",
    shortName: "se"
  },
  {
    name: "setlocal",
    shortName: "setl"
  },
  {
    name: "setglobal",
    shortName: "setg"
  },
  {
    name: "sort",
    shortName: "sor"
  },
  {
    name: "substitute",
    shortName: "s",
    possiblyAsync: true
  },
  {
    name: "nohlsearch",
    shortName: "noh"
  },
  {
    name: "yank",
    shortName: "y"
  },
  {
    name: "delmarks",
    shortName: "delm"
  },
  {
    name: "registers",
    shortName: "reg",
    excludeFromCommandHistory: true
  },
  {
    name: "vglobal",
    shortName: "v"
  },
  {
    name: "global",
    shortName: "g"
  }
];
var Vim = /* @__PURE__ */ __name(function() {
  function enterVimMode(cm) {
    cm.setOption("disableInput", true);
    cm.setOption("showCursorWhenSelecting", false);
    cm_adapter_default.signal(cm, "vim-mode-change", { mode: "normal" });
    cm.on("cursorActivity", onCursorActivity);
    maybeInitVimState(cm);
    cm.enterVimMode();
  }
  __name(enterVimMode, "enterVimMode");
  function leaveVimMode(cm) {
    cm.setOption("disableInput", false);
    cm.off("cursorActivity", onCursorActivity);
    cm.state.vim = null;
    if (highlightTimeout) clearTimeout(highlightTimeout);
    cm.leaveVimMode();
  }
  __name(leaveVimMode, "leaveVimMode");
  function detachVimMap(cm, next) {
    cm.attached = false;
    if (this == cm_adapter_default.keyMap.vim) cm.options.$customCursor = null;
    if (!next || next.attach != attachVimMap) leaveVimMode(cm);
  }
  __name(detachVimMap, "detachVimMap");
  function attachVimMap(cm, prev) {
    if (this == cm_adapter_default.keyMap.vim) {
      cm.attached = true;
      if (cm.curOp) cm.curOp.selectionChanged = true;
      cm.options.$customCursor = transformCursor;
    }
    if (!prev || prev.attach != attachVimMap) enterVimMode(cm);
  }
  __name(attachVimMap, "attachVimMap");
  cm_adapter_default.defineOption("vimMode", false, function(cm, val, prev) {
    if (val && cm.getOption("keyMap") != "vim") cm.setOption("keyMap", "vim");
    else if (!val && prev != cm_adapter_default.Init && /^vim/.test(cm.getOption("keyMap"))) cm.setOption("keyMap", "default");
  });
  function cmKey(key, cm) {
    if (!cm) return;
    if (this[key]) return this[key];
    var vimKey = cmKeyToVimKey(key);
    if (!vimKey) return false;
    var cmd = vimApi.findKey(cm, vimKey);
    if (typeof cmd == "function") cm_adapter_default.signal(cm, "vim-keypress", vimKey);
    return cmd;
  }
  __name(cmKey, "cmKey");
  var modifiers = {
    Shift: "S",
    Ctrl: "C",
    Alt: "A",
    Cmd: "D",
    Mod: "A",
    CapsLock: ""
  };
  var specialKeys = {
    Enter: "CR",
    Backspace: "BS",
    Delete: "Del",
    Insert: "Ins"
  };
  function cmKeyToVimKey(key) {
    if (key.charAt(0) == "'") return key.charAt(1);
    if (key === "AltGraph") return false;
    var pieces = key.split(/-(?!$)/);
    var lastPiece = pieces[pieces.length - 1];
    if (pieces.length == 1 && pieces[0].length == 1) return false;
    else if (pieces.length == 2 && pieces[0] == "Shift" && lastPiece.length == 1) return false;
    var hasCharacter = false;
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (piece in modifiers) pieces[i] = modifiers[piece];
      else hasCharacter = true;
      if (piece in specialKeys) pieces[i] = specialKeys[piece];
    }
    if (!hasCharacter) return false;
    if (isUpperCase(lastPiece)) pieces[pieces.length - 1] = lastPiece.toLowerCase();
    return "<" + pieces.join("-") + ">";
  }
  __name(cmKeyToVimKey, "cmKeyToVimKey");
  var numberRegex = /[\d]/;
  var wordCharTest = [cm_adapter_default.isWordChar, function(ch) {
    return ch && !cm_adapter_default.isWordChar(ch) && !/\s/.test(ch);
  }], bigWordCharTest = [function(ch) {
    return /\S/.test(ch);
  }];
  function makeKeyRange(start, size) {
    var keys = [];
    for (var i = start; i < start + size; i++) keys.push(String.fromCharCode(i));
    return keys;
  }
  __name(makeKeyRange, "makeKeyRange");
  var upperCaseAlphabet = makeKeyRange(65, 26);
  var lowerCaseAlphabet = makeKeyRange(97, 26);
  var numbers = makeKeyRange(48, 10);
  var validMarks = [].concat(upperCaseAlphabet, lowerCaseAlphabet, numbers, ["<", ">"]);
  var validRegisters = [].concat(upperCaseAlphabet, lowerCaseAlphabet, numbers, [
    "-",
    '"',
    ".",
    ":",
    "_",
    "/"
  ]);
  var upperCaseChars;
  try {
    upperCaseChars = new RegExp("^[\\p{Lu}]$", "u");
  } catch (_) {
    upperCaseChars = /^[A-Z]$/;
  }
  function isLine(cm, line) {
    return line >= cm.firstLine() && line <= cm.lastLine();
  }
  __name(isLine, "isLine");
  function isLowerCase(k) {
    return /^[a-z]$/.test(k);
  }
  __name(isLowerCase, "isLowerCase");
  function isNumber(k) {
    return numberRegex.test(k);
  }
  __name(isNumber, "isNumber");
  function isUpperCase(k) {
    return upperCaseChars.test(k);
  }
  __name(isUpperCase, "isUpperCase");
  function isWhiteSpaceString(k) {
    return /^\s*$/.test(k);
  }
  __name(isWhiteSpaceString, "isWhiteSpaceString");
  function isEndOfSentenceSymbol(k) {
    return ".?!".indexOf(k) != -1;
  }
  __name(isEndOfSentenceSymbol, "isEndOfSentenceSymbol");
  function inArray(val, arr) {
    for (var i = 0; i < arr.length; i++) if (arr[i] == val) return true;
    return false;
  }
  __name(inArray, "inArray");
  var options = {};
  function defineOption(name, defaultValue, type, aliases, callback) {
    if (defaultValue === void 0 && !callback) throw Error("defaultValue is required unless callback is provided");
    if (!type) type = "string";
    options[name] = {
      type,
      defaultValue,
      callback
    };
    if (aliases) for (var i = 0; i < aliases.length; i++) options[aliases[i]] = options[name];
    if (defaultValue) setOption(name, defaultValue);
  }
  __name(defineOption, "defineOption");
  function setOption(name, value, cm, cfg) {
    var option = options[name];
    cfg = cfg || {};
    var scope = cfg.scope;
    if (!option) return /* @__PURE__ */ new Error("Unknown option: " + name);
    if (option.type == "boolean") {
      if (value && value !== true) return /* @__PURE__ */ new Error("Invalid argument: " + name + "=" + value);
      else if (value !== false) value = true;
    }
    if (option.callback) {
      if (scope !== "local") option.callback(value, void 0);
      if (scope !== "global" && cm) option.callback(value, cm);
    } else {
      if (scope !== "local") option.value = option.type == "boolean" ? !!value : value;
      if (scope !== "global" && cm) cm.state.vim.options[name] = { value };
    }
  }
  __name(setOption, "setOption");
  function getOption(name, cm, cfg) {
    var option = options[name];
    cfg = cfg || {};
    var scope = cfg.scope;
    if (!option) return /* @__PURE__ */ new Error("Unknown option: " + name);
    if (option.callback) {
      var local = cm && option.callback(void 0, cm);
      if (scope !== "global" && local !== void 0) return local;
      if (scope !== "local") return option.callback();
      return;
    } else {
      var local = scope !== "global" && cm && cm.state.vim.options[name];
      return (local || scope !== "local" && option || {}).value;
    }
  }
  __name(getOption, "getOption");
  defineOption("filetype", void 0, "string", ["ft"], function(name, cm) {
    if (cm === void 0) return;
    if (name === void 0) {
      var mode = cm.getOption("mode");
      return mode == "null" ? "" : mode;
    } else {
      var mode = name == "" ? "null" : name;
      cm.setOption("mode", mode);
    }
  });
  var createCircularJumpList = /* @__PURE__ */ __name(function() {
    var size = 100;
    var pointer = -1;
    var head = 0;
    var tail = 0;
    var buffer = new Array(size);
    function add(cm, oldCur, newCur) {
      var curMark = buffer[pointer % size];
      function useNextSlot(cursor) {
        var next = ++pointer % size;
        var trashMark = buffer[next];
        if (trashMark) trashMark.clear();
        buffer[next] = cm.setBookmark(cursor);
      }
      __name(useNextSlot, "useNextSlot");
      if (curMark) {
        var markPos = curMark.find();
        if (markPos && !cursorEqual(markPos, oldCur)) useNextSlot(oldCur);
      } else useNextSlot(oldCur);
      useNextSlot(newCur);
      head = pointer;
      tail = pointer - size + 1;
      if (tail < 0) tail = 0;
    }
    __name(add, "add");
    function move(cm, offset) {
      pointer += offset;
      if (pointer > head) pointer = head;
      else if (pointer < tail) pointer = tail;
      var mark = buffer[(size + pointer) % size];
      if (mark && !mark.find()) {
        var inc = offset > 0 ? 1 : -1;
        var newCur;
        var oldCur = cm.getCursor();
        do {
          pointer += inc;
          mark = buffer[(size + pointer) % size];
          if (mark && (newCur = mark.find()) && !cursorEqual(oldCur, newCur)) break;
        } while (pointer < head && pointer > tail);
      }
      return mark;
    }
    __name(move, "move");
    function find(cm, offset) {
      var oldPointer = pointer;
      var mark = move(cm, offset);
      pointer = oldPointer;
      return mark && mark.find();
    }
    __name(find, "find");
    return {
      cachedCursor: void 0,
      add,
      find,
      move
    };
  }, "createCircularJumpList");
  var createInsertModeChanges = /* @__PURE__ */ __name(function(c) {
    if (c) return {
      changes: c.changes,
      expectCursorActivityForChange: c.expectCursorActivityForChange
    };
    return {
      changes: [],
      expectCursorActivityForChange: false
    };
  }, "createInsertModeChanges");
  function MacroModeState() {
    this.latestRegister = void 0;
    this.isPlaying = false;
    this.isRecording = false;
    this.replaySearchQueries = [];
    this.onRecordingDone = void 0;
    this.lastInsertModeChanges = createInsertModeChanges();
  }
  __name(MacroModeState, "MacroModeState");
  MacroModeState.prototype = {
    exitMacroRecordMode: /* @__PURE__ */ __name(function() {
      var macroModeState = vimGlobalState.macroModeState;
      if (macroModeState.onRecordingDone) macroModeState.onRecordingDone();
      macroModeState.onRecordingDone = void 0;
      macroModeState.isRecording = false;
    }, "exitMacroRecordMode"),
    enterMacroRecordMode: /* @__PURE__ */ __name(function(cm, registerName) {
      var register = vimGlobalState.registerController.getRegister(registerName);
      if (register) {
        register.clear();
        this.latestRegister = registerName;
        if (cm.openDialog) this.onRecordingDone = cm.openDialog(document.createTextNode("(recording)[" + registerName + "]"), null, { bottom: true });
        this.isRecording = true;
      }
    }, "enterMacroRecordMode")
  };
  function maybeInitVimState(cm) {
    if (!cm.state.vim) cm.state.vim = {
      inputState: new InputState(),
      lastEditInputState: void 0,
      lastEditActionCommand: void 0,
      lastHPos: -1,
      lastHSPos: -1,
      lastMotion: null,
      marks: {},
      insertMode: false,
      insertModeRepeat: void 0,
      visualMode: false,
      visualLine: false,
      visualBlock: false,
      lastSelection: null,
      lastPastedText: null,
      sel: {},
      options: {}
    };
    return cm.state.vim;
  }
  __name(maybeInitVimState, "maybeInitVimState");
  var vimGlobalState;
  function resetVimGlobalState() {
    vimGlobalState = {
      searchQuery: null,
      searchIsReversed: false,
      lastSubstituteReplacePart: void 0,
      jumpList: createCircularJumpList(),
      macroModeState: new MacroModeState(),
      lastCharacterSearch: {
        increment: 0,
        forward: true,
        selectedCharacter: ""
      },
      registerController: new RegisterController({}),
      searchHistoryController: new HistoryController(),
      exCommandHistoryController: new HistoryController()
    };
    for (var optionName in options) {
      var option = options[optionName];
      option.value = option.defaultValue;
    }
  }
  __name(resetVimGlobalState, "resetVimGlobalState");
  var lastInsertModeKeyTimer;
  var vimApi = {
    buildKeyMap: /* @__PURE__ */ __name(function() {
    }, "buildKeyMap"),
    getRegisterController: /* @__PURE__ */ __name(function() {
      return vimGlobalState.registerController;
    }, "getRegisterController"),
    resetVimGlobalState_: resetVimGlobalState,
    getVimGlobalState_: /* @__PURE__ */ __name(function() {
      return vimGlobalState;
    }, "getVimGlobalState_"),
    maybeInitVimState_: maybeInitVimState,
    suppressErrorLogging: false,
    InsertModeKey,
    map: /* @__PURE__ */ __name(function(lhs, rhs, ctx) {
      exCommandDispatcher.map(lhs, rhs, ctx);
    }, "map"),
    unmap: /* @__PURE__ */ __name(function(lhs, ctx) {
      return exCommandDispatcher.unmap(lhs, ctx);
    }, "unmap"),
    noremap: /* @__PURE__ */ __name(function(lhs, rhs, ctx) {
      function toCtxArray(ctx$1) {
        return ctx$1 ? [ctx$1] : [
          "normal",
          "insert",
          "visual"
        ];
      }
      __name(toCtxArray, "toCtxArray");
      var ctxsToMap = toCtxArray(ctx);
      var actualLength = defaultKeymap.length;
      for (var i = actualLength - defaultKeymapLength; i < actualLength && ctxsToMap.length; i++) {
        var mapping = defaultKeymap[i];
        if (mapping.keys == rhs && (!ctx || !mapping.context || mapping.context === ctx) && mapping.type.substr(0, 2) !== "ex" && mapping.type.substr(0, 3) !== "key") {
          var newMapping = {};
          for (var key in mapping) newMapping[key] = mapping[key];
          newMapping.keys = lhs;
          if (ctx && !newMapping.context) newMapping.context = ctx;
          this._mapCommand(newMapping);
          var mappedCtxs = toCtxArray(mapping.context);
          ctxsToMap = ctxsToMap.filter(function(el) {
            return mappedCtxs.indexOf(el) === -1;
          });
        }
      }
    }, "noremap"),
    mapclear: /* @__PURE__ */ __name(function(ctx) {
      var actualLength = defaultKeymap.length, origLength = defaultKeymapLength;
      var userKeymap = defaultKeymap.slice(0, actualLength - origLength);
      defaultKeymap = defaultKeymap.slice(actualLength - origLength);
      if (ctx) for (var i = userKeymap.length - 1; i >= 0; i--) {
        var mapping = userKeymap[i];
        if (ctx !== mapping.context) if (mapping.context) this._mapCommand(mapping);
        else {
          var contexts = [
            "normal",
            "insert",
            "visual"
          ];
          for (var j in contexts) if (contexts[j] !== ctx) {
            var newMapping = {};
            for (var key in mapping) newMapping[key] = mapping[key];
            newMapping.context = contexts[j];
            this._mapCommand(newMapping);
          }
        }
      }
    }, "mapclear"),
    setOption,
    getOption,
    defineOption,
    defineEx: /* @__PURE__ */ __name(function(name, prefix, func) {
      if (!prefix) prefix = name;
      else if (name.indexOf(prefix) !== 0) throw new Error('(Vim.defineEx) "' + prefix + '" is not a prefix of "' + name + '", command not registered');
      exCommands[name] = func;
      exCommandDispatcher.commandMap_[prefix] = {
        name,
        shortName: prefix,
        type: "api"
      };
    }, "defineEx"),
    handleKey: /* @__PURE__ */ __name(function(cm, key, origin) {
      var command = this.findKey(cm, key, origin);
      if (typeof command === "function") return command();
    }, "handleKey"),
    findKey: /* @__PURE__ */ __name(function(cm, key, origin) {
      var vim = maybeInitVimState(cm);
      function handleMacroRecording() {
        var macroModeState = vimGlobalState.macroModeState;
        if (macroModeState.isRecording) {
          if (key == "q") {
            macroModeState.exitMacroRecordMode();
            clearInputState(cm);
            return true;
          }
          if (origin != "mapping") logKey(macroModeState, key);
        }
      }
      __name(handleMacroRecording, "handleMacroRecording");
      function handleEsc() {
        if (key == "<Esc>") {
          if (vim.visualMode) exitVisualMode(cm);
          else if (vim.insertMode) exitInsertMode(cm);
          else return;
          clearInputState(cm);
          return true;
        }
      }
      __name(handleEsc, "handleEsc");
      function doKeyToKey(keys) {
        var match;
        while (keys) {
          match = /<\w+-.+?>|<\w+>|./.exec(keys);
          key = match[0];
          keys = keys.substring(match.index + key.length);
          vimApi.handleKey(cm, key, "mapping");
        }
      }
      __name(doKeyToKey, "doKeyToKey");
      function handleKeyInsertMode() {
        if (handleEsc()) return true;
        var keys = vim.inputState.keyBuffer = vim.inputState.keyBuffer + key;
        var keysAreChars = key.length == 1;
        var match = commandDispatcher.matchCommand(keys, defaultKeymap, vim.inputState, "insert");
        while (keys.length > 1 && match.type != "full") {
          var keys = vim.inputState.keyBuffer = keys.slice(1);
          var thisMatch = commandDispatcher.matchCommand(keys, defaultKeymap, vim.inputState, "insert");
          if (thisMatch.type != "none") match = thisMatch;
        }
        if (match.type == "none") {
          clearInputState(cm);
          return false;
        } else if (match.type == "partial") {
          if (lastInsertModeKeyTimer) window.clearTimeout(lastInsertModeKeyTimer);
          lastInsertModeKeyTimer = window.setTimeout(function() {
            if (vim.insertMode && vim.inputState.keyBuffer) clearInputState(cm);
          }, getOption("insertModeEscKeysTimeout"));
          return !keysAreChars;
        }
        if (lastInsertModeKeyTimer) window.clearTimeout(lastInsertModeKeyTimer);
        if (keysAreChars) {
          var selections = cm.listSelections();
          for (var i = 0; i < selections.length; i++) {
            var here = selections[i].head;
            cm.replaceRange("", offsetCursor(here, 0, -(keys.length - 1)), here, "+input");
          }
          vimGlobalState.macroModeState.lastInsertModeChanges.changes.pop();
        }
        clearInputState(cm);
        return match.command;
      }
      __name(handleKeyInsertMode, "handleKeyInsertMode");
      function handleKeyNonInsertMode() {
        if (handleMacroRecording() || handleEsc()) return true;
        var keys = vim.inputState.keyBuffer = vim.inputState.keyBuffer + key;
        if (/^[1-9]\d*$/.test(keys)) return true;
        var keysMatcher = /^(\d*)(.*)$/.exec(keys);
        if (!keysMatcher) {
          clearInputState(cm);
          return false;
        }
        var context = vim.visualMode ? "visual" : "normal";
        var mainKey = keysMatcher[2] || keysMatcher[1];
        if (vim.inputState.operatorShortcut && vim.inputState.operatorShortcut.slice(-1) == mainKey) mainKey = vim.inputState.operatorShortcut;
        var match = commandDispatcher.matchCommand(mainKey, defaultKeymap, vim.inputState, context);
        if (match.type == "none") {
          clearInputState(cm);
          return false;
        } else if (match.type == "partial") return true;
        vim.inputState.keyBuffer = "";
        var keysMatcher = /^(\d*)(.*)$/.exec(keys);
        if (keysMatcher[1] && keysMatcher[1] != "0") vim.inputState.pushRepeatDigit(keysMatcher[1]);
        return match.command;
      }
      __name(handleKeyNonInsertMode, "handleKeyNonInsertMode");
      var command;
      if (vim.insertMode) command = handleKeyInsertMode();
      else command = handleKeyNonInsertMode();
      if (command === false) return !vim.insertMode && key.length === 1 ? function() {
        return true;
      } : void 0;
      else if (command === true) return function() {
        return true;
      };
      else return function() {
        return cm.operation(function() {
          cm.curOp.isVimOp = true;
          try {
            if (command.type == "keyToKey") doKeyToKey(command.toKeys);
            else commandDispatcher.processCommand(cm, vim, command);
          } catch (e) {
            cm.state.vim = void 0;
            maybeInitVimState(cm);
            if (!vimApi.suppressErrorLogging) console["log"](e);
            throw e;
          }
          return true;
        });
      };
    }, "findKey"),
    handleEx: /* @__PURE__ */ __name(function(cm, input) {
      exCommandDispatcher.processCommand(cm, input);
    }, "handleEx"),
    defineMotion,
    defineAction,
    defineOperator,
    mapCommand,
    _mapCommand,
    defineRegister,
    exitVisualMode,
    exitInsertMode
  };
  function InputState() {
    this.prefixRepeat = [];
    this.motionRepeat = [];
    this.operator = null;
    this.operatorArgs = null;
    this.motion = null;
    this.motionArgs = null;
    this.keyBuffer = [];
    this.registerName = null;
  }
  __name(InputState, "InputState");
  InputState.prototype.pushRepeatDigit = function(n) {
    if (!this.operator) this.prefixRepeat = this.prefixRepeat.concat(n);
    else this.motionRepeat = this.motionRepeat.concat(n);
  };
  InputState.prototype.getRepeat = function() {
    var repeat = 0;
    if (this.prefixRepeat.length > 0 || this.motionRepeat.length > 0) {
      repeat = 1;
      if (this.prefixRepeat.length > 0) repeat *= parseInt(this.prefixRepeat.join(""), 10);
      if (this.motionRepeat.length > 0) repeat *= parseInt(this.motionRepeat.join(""), 10);
    }
    return repeat;
  };
  function clearInputState(cm, reason) {
    cm.state.vim.inputState = new InputState();
    cm_adapter_default.signal(cm, "vim-command-done", reason);
  }
  __name(clearInputState, "clearInputState");
  function Register(text, linewise, blockwise) {
    this.clear();
    this.keyBuffer = [text || ""];
    this.insertModeChanges = [];
    this.searchQueries = [];
    this.linewise = !!linewise;
    this.blockwise = !!blockwise;
  }
  __name(Register, "Register");
  Register.prototype = {
    setText: /* @__PURE__ */ __name(function(text, linewise, blockwise) {
      this.keyBuffer = [text || ""];
      this.linewise = !!linewise;
      this.blockwise = !!blockwise;
    }, "setText"),
    pushText: /* @__PURE__ */ __name(function(text, linewise) {
      if (linewise) {
        if (!this.linewise) this.keyBuffer.push("\n");
        this.linewise = true;
      }
      this.keyBuffer.push(text);
    }, "pushText"),
    pushInsertModeChanges: /* @__PURE__ */ __name(function(changes) {
      this.insertModeChanges.push(createInsertModeChanges(changes));
    }, "pushInsertModeChanges"),
    pushSearchQuery: /* @__PURE__ */ __name(function(query) {
      this.searchQueries.push(query);
    }, "pushSearchQuery"),
    clear: /* @__PURE__ */ __name(function() {
      this.keyBuffer = [];
      this.insertModeChanges = [];
      this.searchQueries = [];
      this.linewise = false;
    }, "clear"),
    toString: /* @__PURE__ */ __name(function() {
      return this.keyBuffer.join("");
    }, "toString")
  };
  function defineRegister(name, register) {
    var registers = vimGlobalState.registerController.registers;
    if (!name || name.length != 1) throw Error("Register name must be 1 character");
    if (registers[name]) throw Error("Register already defined " + name);
    registers[name] = register;
    validRegisters.push(name);
  }
  __name(defineRegister, "defineRegister");
  function RegisterController(registers) {
    this.registers = registers;
    this.unnamedRegister = registers['"'] = new Register();
    registers["."] = new Register();
    registers[":"] = new Register();
    registers["/"] = new Register();
  }
  __name(RegisterController, "RegisterController");
  RegisterController.prototype = {
    pushText: /* @__PURE__ */ __name(function(registerName, operator, text, linewise, blockwise) {
      if (registerName === "_") return;
      if (linewise && text.charAt(text.length - 1) !== "\n") text += "\n";
      var register = this.isValidRegister(registerName) ? this.getRegister(registerName) : null;
      if (!register) {
        switch (operator) {
          case "yank":
            this.registers["0"] = new Register(text, linewise, blockwise);
            break;
          case "delete":
          case "change":
            if (text.indexOf("\n") == -1) this.registers["-"] = new Register(text, linewise);
            else {
              this.shiftNumericRegisters_();
              this.registers["1"] = new Register(text, linewise);
            }
            break;
        }
        this.unnamedRegister.setText(text, linewise, blockwise);
        return;
      }
      if (isUpperCase(registerName)) register.pushText(text, linewise);
      else register.setText(text, linewise, blockwise);
      this.unnamedRegister.setText(register.toString(), linewise);
    }, "pushText"),
    getRegister: /* @__PURE__ */ __name(function(name) {
      if (!this.isValidRegister(name)) return this.unnamedRegister;
      name = name.toLowerCase();
      if (!this.registers[name]) this.registers[name] = new Register();
      return this.registers[name];
    }, "getRegister"),
    isValidRegister: /* @__PURE__ */ __name(function(name) {
      return name && inArray(name, validRegisters);
    }, "isValidRegister"),
    shiftNumericRegisters_: /* @__PURE__ */ __name(function() {
      for (var i = 9; i >= 2; i--) this.registers[i] = this.getRegister("" + (i - 1));
    }, "shiftNumericRegisters_")
  };
  function HistoryController() {
    this.historyBuffer = [];
    this.iterator = 0;
    this.initialPrefix = null;
  }
  __name(HistoryController, "HistoryController");
  HistoryController.prototype = {
    nextMatch: /* @__PURE__ */ __name(function(input, up) {
      var historyBuffer = this.historyBuffer;
      var dir = up ? -1 : 1;
      if (this.initialPrefix === null) this.initialPrefix = input;
      for (var i = this.iterator + dir; up ? i >= 0 : i < historyBuffer.length; i += dir) {
        var element = historyBuffer[i];
        for (var j = 0; j <= element.length; j++) if (this.initialPrefix == element.substring(0, j)) {
          this.iterator = i;
          return element;
        }
      }
      if (i >= historyBuffer.length) {
        this.iterator = historyBuffer.length;
        return this.initialPrefix;
      }
      if (i < 0) return input;
    }, "nextMatch"),
    pushInput: /* @__PURE__ */ __name(function(input) {
      var index = this.historyBuffer.indexOf(input);
      if (index > -1) this.historyBuffer.splice(index, 1);
      if (input.length) this.historyBuffer.push(input);
    }, "pushInput"),
    reset: /* @__PURE__ */ __name(function() {
      this.initialPrefix = null;
      this.iterator = this.historyBuffer.length;
    }, "reset")
  };
  var commandDispatcher = {
    matchCommand: /* @__PURE__ */ __name(function(keys, keyMap, inputState, context) {
      var matches = commandMatches(keys, keyMap, context, inputState);
      if (!matches.full && !matches.partial) return { type: "none" };
      else if (!matches.full && matches.partial) return { type: "partial" };
      var bestMatch;
      for (var i = 0; i < matches.full.length; i++) {
        var match = matches.full[i];
        if (!bestMatch) bestMatch = match;
      }
      if (bestMatch.keys.slice(-11) == "<character>") {
        var character = lastChar(keys);
        if (!character) return { type: "none" };
        inputState.selectedCharacter = character;
      }
      return {
        type: "full",
        command: bestMatch
      };
    }, "matchCommand"),
    processCommand: /* @__PURE__ */ __name(function(cm, vim, command) {
      vim.inputState.repeatOverride = command.repeatOverride;
      switch (command.type) {
        case "motion":
          this.processMotion(cm, vim, command);
          break;
        case "operator":
          this.processOperator(cm, vim, command);
          break;
        case "operatorMotion":
          this.processOperatorMotion(cm, vim, command);
          break;
        case "action":
          this.processAction(cm, vim, command);
          break;
        case "search":
          this.processSearch(cm, vim, command);
          break;
        case "ex":
        case "keyToEx":
          this.processEx(cm, vim, command);
          break;
      }
    }, "processCommand"),
    processMotion: /* @__PURE__ */ __name(function(cm, vim, command) {
      vim.inputState.motion = command.motion;
      vim.inputState.motionArgs = copyArgs(command.motionArgs);
      this.evalInput(cm, vim);
    }, "processMotion"),
    processOperator: /* @__PURE__ */ __name(function(cm, vim, command) {
      var inputState = vim.inputState;
      if (inputState.operator) if (inputState.operator == command.operator) {
        inputState.motion = "expandToLine";
        inputState.motionArgs = { linewise: true };
        this.evalInput(cm, vim);
        return;
      } else clearInputState(cm);
      inputState.operator = command.operator;
      inputState.operatorArgs = copyArgs(command.operatorArgs);
      if (command.keys.length > 1) inputState.operatorShortcut = command.keys;
      if (command.exitVisualBlock) {
        vim.visualBlock = false;
        updateCmSelection(cm);
      }
      if (vim.visualMode) this.evalInput(cm, vim);
    }, "processOperator"),
    processOperatorMotion: /* @__PURE__ */ __name(function(cm, vim, command) {
      var visualMode = vim.visualMode;
      var operatorMotionArgs = copyArgs(command.operatorMotionArgs);
      if (operatorMotionArgs) {
        if (visualMode && operatorMotionArgs.visualLine) vim.visualLine = true;
      }
      this.processOperator(cm, vim, command);
      if (!visualMode) this.processMotion(cm, vim, command);
    }, "processOperatorMotion"),
    processAction: /* @__PURE__ */ __name(function(cm, vim, command) {
      var inputState = vim.inputState;
      var repeat = inputState.getRepeat();
      var repeatIsExplicit = !!repeat;
      var actionArgs = copyArgs(command.actionArgs) || {};
      if (inputState.selectedCharacter) actionArgs.selectedCharacter = inputState.selectedCharacter;
      if (command.operator) this.processOperator(cm, vim, command);
      if (command.motion) this.processMotion(cm, vim, command);
      if (command.motion || command.operator) this.evalInput(cm, vim);
      actionArgs.repeat = repeat || 1;
      actionArgs.repeatIsExplicit = repeatIsExplicit;
      actionArgs.registerName = inputState.registerName;
      clearInputState(cm);
      vim.lastMotion = null;
      if (command.isEdit) this.recordLastEdit(vim, inputState, command);
      actions[command.action](cm, actionArgs, vim);
    }, "processAction"),
    processSearch: /* @__PURE__ */ __name(function(cm, vim, command) {
      if (!cm.getSearchCursor) return;
      var forward = command.searchArgs.forward;
      var wholeWordOnly = command.searchArgs.wholeWordOnly;
      getSearchState(cm).setReversed(!forward);
      var promptPrefix = forward ? "/" : "?";
      var originalQuery = getSearchState(cm).getQuery();
      var originalScrollPos = cm.getScrollInfo();
      function handleQuery(query$1, ignoreCase, smartCase) {
        vimGlobalState.searchHistoryController.pushInput(query$1);
        vimGlobalState.searchHistoryController.reset();
        try {
          updateSearchQuery(cm, query$1, ignoreCase, smartCase);
        } catch (e) {
          showConfirm(cm, "Invalid regex: " + query$1);
          clearInputState(cm);
          return;
        }
        commandDispatcher.processMotion(cm, vim, {
          type: "motion",
          motion: "findNext",
          motionArgs: {
            forward: true,
            toJumplist: command.searchArgs.toJumplist
          }
        });
      }
      __name(handleQuery, "handleQuery");
      function onPromptClose(query$1) {
        cm.scrollTo(originalScrollPos.left, originalScrollPos.top);
        handleQuery(
          query$1,
          true,
          true
          /** smartCase */
        );
        var macroModeState$1 = vimGlobalState.macroModeState;
        if (macroModeState$1.isRecording) logSearchQuery(macroModeState$1, query$1);
      }
      __name(onPromptClose, "onPromptClose");
      function onPromptKeyUp(e, query$1, close) {
        var keyName = cm_adapter_default.keyName(e), up, offset;
        if (keyName == "Up" || keyName == "Down") {
          up = keyName == "Up" ? true : false;
          offset = e.target ? e.target.selectionEnd : 0;
          query$1 = vimGlobalState.searchHistoryController.nextMatch(query$1, up) || "";
          close(query$1);
          if (offset && e.target) e.target.selectionEnd = e.target.selectionStart = Math.min(offset, e.target.value.length);
        } else if (keyName != "Left" && keyName != "Right" && keyName != "Ctrl" && keyName != "Alt" && keyName != "Shift") vimGlobalState.searchHistoryController.reset();
        var parsedQuery;
        try {
          parsedQuery = updateSearchQuery(cm, query$1, true, true);
        } catch (e$1) {
        }
        if (parsedQuery) cm.scrollIntoView(findNext(cm, !forward, parsedQuery), 30);
        else {
          clearSearchHighlight(cm);
          cm.scrollTo(originalScrollPos.left, originalScrollPos.top);
        }
      }
      __name(onPromptKeyUp, "onPromptKeyUp");
      function onPromptKeyDown(e, query$1, close) {
        var keyName = cm_adapter_default.keyName(e);
        if (keyName == "Esc" || keyName == "Ctrl-C" || keyName == "Ctrl-[" || keyName == "Backspace" && query$1 == "") {
          vimGlobalState.searchHistoryController.pushInput(query$1);
          vimGlobalState.searchHistoryController.reset();
          updateSearchQuery(cm, originalQuery);
          clearSearchHighlight(cm);
          cm.scrollTo(originalScrollPos.left, originalScrollPos.top);
          cm_adapter_default.e_stop(e);
          clearInputState(cm);
          close();
          cm.focus();
        } else if (keyName == "Up" || keyName == "Down") cm_adapter_default.e_stop(e);
        else if (keyName == "Ctrl-U") {
          cm_adapter_default.e_stop(e);
          close("");
        }
      }
      __name(onPromptKeyDown, "onPromptKeyDown");
      switch (command.searchArgs.querySrc) {
        case "prompt":
          var macroModeState = vimGlobalState.macroModeState;
          if (macroModeState.isPlaying) {
            var query = macroModeState.replaySearchQueries.shift();
            handleQuery(
              query,
              true,
              false
              /** smartCase */
            );
          } else showPrompt(cm, {
            onClose: onPromptClose,
            prefix: promptPrefix,
            desc: "(JavaScript regexp)",
            onKeyUp: onPromptKeyUp,
            onKeyDown: onPromptKeyDown
          });
          break;
        case "wordUnderCursor":
          var word = expandWordUnderCursor(cm, false, true, false, true);
          var isKeyword = true;
          if (!word) {
            word = expandWordUnderCursor(cm, false, true, false, false);
            isKeyword = false;
          }
          if (!word) return;
          var query = cm.getLine(word.start.line).substring(word.start.ch, word.end.ch);
          if (isKeyword && wholeWordOnly) query = "\\b" + query + "\\b";
          else query = escapeRegex(query);
          vimGlobalState.jumpList.cachedCursor = cm.getCursor();
          cm.setCursor(word.start);
          handleQuery(
            query,
            true,
            false
            /** smartCase */
          );
          break;
      }
    }, "processSearch"),
    processEx: /* @__PURE__ */ __name(function(cm, vim, command) {
      function onPromptClose(input) {
        vimGlobalState.exCommandHistoryController.pushInput(input);
        vimGlobalState.exCommandHistoryController.reset();
        exCommandDispatcher.processCommand(cm, input);
      }
      __name(onPromptClose, "onPromptClose");
      function onPromptKeyDown(e, input, close) {
        var keyName = cm_adapter_default.keyName(e), up, offset;
        if (keyName == "Esc" || keyName == "Ctrl-C" || keyName == "Ctrl-[" || keyName == "Backspace" && input == "") {
          vimGlobalState.exCommandHistoryController.pushInput(input);
          vimGlobalState.exCommandHistoryController.reset();
          cm_adapter_default.e_stop(e);
          clearInputState(cm);
          close();
          cm.focus();
        }
        if (keyName == "Up" || keyName == "Down") {
          cm_adapter_default.e_stop(e);
          up = keyName == "Up" ? true : false;
          offset = e.target ? e.target.selectionEnd : 0;
          input = vimGlobalState.exCommandHistoryController.nextMatch(input, up) || "";
          close(input);
          if (offset && e.target) e.target.selectionEnd = e.target.selectionStart = Math.min(offset, e.target.value.length);
        } else if (keyName == "Ctrl-U") {
          cm_adapter_default.e_stop(e);
          close("");
        } else if (keyName != "Left" && keyName != "Right" && keyName != "Ctrl" && keyName != "Alt" && keyName != "Shift") vimGlobalState.exCommandHistoryController.reset();
      }
      __name(onPromptKeyDown, "onPromptKeyDown");
      if (command.type == "keyToEx") exCommandDispatcher.processCommand(cm, command.exArgs.input);
      else if (vim.visualMode) showPrompt(cm, {
        onClose: onPromptClose,
        prefix: ":",
        value: "'<,'>",
        onKeyDown: onPromptKeyDown,
        selectValueOnOpen: false
      });
      else showPrompt(cm, {
        onClose: onPromptClose,
        prefix: ":",
        onKeyDown: onPromptKeyDown
      });
    }, "processEx"),
    evalInput: /* @__PURE__ */ __name(function(cm, vim) {
      var inputState = vim.inputState;
      var motion = inputState.motion;
      var motionArgs = inputState.motionArgs || {};
      var operator = inputState.operator;
      var operatorArgs = inputState.operatorArgs || {};
      var registerName = inputState.registerName;
      var sel = vim.sel;
      var origHead = copyCursor(vim.visualMode ? clipCursorToContent(cm, sel.head) : cm.getCursor("head"));
      var origAnchor = copyCursor(vim.visualMode ? clipCursorToContent(cm, sel.anchor) : cm.getCursor("anchor"));
      var oldHead = copyCursor(origHead);
      var oldAnchor = copyCursor(origAnchor);
      var newHead, newAnchor;
      var repeat;
      if (operator) this.recordLastEdit(vim, inputState);
      if (inputState.repeatOverride !== void 0) repeat = inputState.repeatOverride;
      else repeat = inputState.getRepeat();
      if (repeat > 0 && motionArgs.explicitRepeat) motionArgs.repeatIsExplicit = true;
      else if (motionArgs.noRepeat || !motionArgs.explicitRepeat && repeat === 0) {
        repeat = 1;
        motionArgs.repeatIsExplicit = false;
      }
      if (inputState.selectedCharacter) motionArgs.selectedCharacter = operatorArgs.selectedCharacter = inputState.selectedCharacter;
      motionArgs.repeat = repeat;
      clearInputState(cm);
      if (motion) {
        var motionResult = motions[motion](cm, origHead, motionArgs, vim, inputState);
        vim.lastMotion = motions[motion];
        if (!motionResult) return;
        if (motionArgs.toJumplist) {
          var jumpList = vimGlobalState.jumpList;
          var cachedCursor = jumpList.cachedCursor;
          if (cachedCursor) {
            recordJumpPosition(cm, cachedCursor, motionResult);
            delete jumpList.cachedCursor;
          } else recordJumpPosition(cm, origHead, motionResult);
        }
        if (motionResult instanceof Array) {
          newAnchor = motionResult[0];
          newHead = motionResult[1];
        } else newHead = motionResult;
        if (!newHead) newHead = copyCursor(origHead);
        if (vim.visualMode) {
          if (!(vim.visualBlock && newHead.ch === Infinity)) newHead = clipCursorToContent(cm, newHead);
          if (newAnchor) newAnchor = clipCursorToContent(cm, newAnchor);
          newAnchor = newAnchor || oldAnchor;
          sel.anchor = newAnchor;
          sel.head = newHead;
          updateCmSelection(cm);
          updateMark(cm, vim, "<", cursorIsBefore(newAnchor, newHead) ? newAnchor : newHead);
          updateMark(cm, vim, ">", cursorIsBefore(newAnchor, newHead) ? newHead : newAnchor);
        } else if (!operator) {
          newHead = clipCursorToContent(cm, newHead);
          cm.setCursor(newHead.line, newHead.ch);
        }
      }
      if (operator) {
        if (operatorArgs.lastSel) {
          newAnchor = oldAnchor;
          var lastSel = operatorArgs.lastSel;
          var lineOffset = Math.abs(lastSel.head.line - lastSel.anchor.line);
          var chOffset = Math.abs(lastSel.head.ch - lastSel.anchor.ch);
          if (lastSel.visualLine) newHead = new Pos(oldAnchor.line + lineOffset, oldAnchor.ch);
          else if (lastSel.visualBlock) newHead = new Pos(oldAnchor.line + lineOffset, oldAnchor.ch + chOffset);
          else if (lastSel.head.line == lastSel.anchor.line) newHead = new Pos(oldAnchor.line, oldAnchor.ch + chOffset);
          else newHead = new Pos(oldAnchor.line + lineOffset, oldAnchor.ch);
          vim.visualMode = true;
          vim.visualLine = lastSel.visualLine;
          vim.visualBlock = lastSel.visualBlock;
          sel = vim.sel = {
            anchor: newAnchor,
            head: newHead
          };
          updateCmSelection(cm);
        } else if (vim.visualMode) operatorArgs.lastSel = {
          anchor: copyCursor(sel.anchor),
          head: copyCursor(sel.head),
          visualBlock: vim.visualBlock,
          visualLine: vim.visualLine
        };
        var curStart, curEnd, linewise, mode;
        var cmSel;
        if (vim.visualMode) {
          curStart = cursorMin(sel.head, sel.anchor);
          curEnd = cursorMax(sel.head, sel.anchor);
          linewise = vim.visualLine || operatorArgs.linewise;
          mode = vim.visualBlock ? "block" : linewise ? "line" : "char";
          cmSel = makeCmSelection(cm, {
            anchor: curStart,
            head: curEnd
          }, mode);
          if (linewise) {
            var ranges = cmSel.ranges;
            if (mode == "block") for (var i = 0; i < ranges.length; i++) ranges[i].head.ch = lineLength(cm, ranges[i].head.line);
            else if (mode == "line") ranges[0].head = new Pos(ranges[0].head.line + 1, 0);
          }
        } else {
          curStart = copyCursor(newAnchor || oldAnchor);
          curEnd = copyCursor(newHead || oldHead);
          if (cursorIsBefore(curEnd, curStart)) {
            var tmp = curStart;
            curStart = curEnd;
            curEnd = tmp;
          }
          linewise = motionArgs.linewise || operatorArgs.linewise;
          if (linewise) expandSelectionToLine(cm, curStart, curEnd);
          else if (motionArgs.forward) clipToLine(cm, curStart, curEnd);
          mode = "char";
          var exclusive = !motionArgs.inclusive || linewise;
          cmSel = makeCmSelection(cm, {
            anchor: curStart,
            head: curEnd
          }, mode, exclusive);
        }
        cm.setSelections(cmSel.ranges, cmSel.primary);
        vim.lastMotion = null;
        operatorArgs.repeat = repeat;
        operatorArgs.registerName = registerName;
        operatorArgs.linewise = linewise;
        var operatorMoveTo = operators[operator](cm, operatorArgs, cmSel.ranges, oldAnchor, newHead);
        if (vim.visualMode) exitVisualMode(cm, operatorMoveTo != null);
        if (operatorMoveTo) cm.setCursor(operatorMoveTo);
      }
    }, "evalInput"),
    recordLastEdit: /* @__PURE__ */ __name(function(vim, inputState, actionCommand) {
      var macroModeState = vimGlobalState.macroModeState;
      if (macroModeState.isPlaying) return;
      vim.lastEditInputState = inputState;
      vim.lastEditActionCommand = actionCommand;
      macroModeState.lastInsertModeChanges.changes = [];
      macroModeState.lastInsertModeChanges.expectCursorActivityForChange = false;
      macroModeState.lastInsertModeChanges.visualBlock = vim.visualBlock ? vim.sel.head.line - vim.sel.anchor.line : 0;
    }, "recordLastEdit")
  };
  var motions = {
    moveToTopLine: /* @__PURE__ */ __name(function(cm, _head, motionArgs) {
      var line = getUserVisibleLines(cm).top + motionArgs.repeat - 1;
      return new Pos(line, findFirstNonWhiteSpaceCharacter(cm.getLine(line)));
    }, "moveToTopLine"),
    moveToMiddleLine: /* @__PURE__ */ __name(function(cm) {
      var range = getUserVisibleLines(cm);
      var line = Math.floor((range.top + range.bottom) * 0.5);
      return new Pos(line, findFirstNonWhiteSpaceCharacter(cm.getLine(line)));
    }, "moveToMiddleLine"),
    moveToBottomLine: /* @__PURE__ */ __name(function(cm, _head, motionArgs) {
      var line = getUserVisibleLines(cm).bottom - motionArgs.repeat + 1;
      return new Pos(line, findFirstNonWhiteSpaceCharacter(cm.getLine(line)));
    }, "moveToBottomLine"),
    expandToLine: /* @__PURE__ */ __name(function(_cm, head, motionArgs) {
      return new Pos(head.line + motionArgs.repeat - 1, Infinity);
    }, "expandToLine"),
    findNext: /* @__PURE__ */ __name(function(cm, _head, motionArgs) {
      var state = getSearchState(cm);
      var query = state.getQuery();
      if (!query) return;
      var prev = !motionArgs.forward;
      prev = state.isReversed() ? !prev : prev;
      highlightSearchMatches(cm, query);
      return findNext(cm, prev, query, motionArgs.repeat);
    }, "findNext"),
    findAndSelectNextInclusive: /* @__PURE__ */ __name(function(cm, _head, motionArgs, vim, prevInputState) {
      var state = getSearchState(cm);
      var query = state.getQuery();
      if (!query) return;
      var prev = !motionArgs.forward;
      prev = state.isReversed() ? !prev : prev;
      var next = findNextFromAndToInclusive(cm, prev, query, motionArgs.repeat, vim);
      if (!next) return;
      if (prevInputState.operator) return next;
      var from = next[0];
      var to = new Pos(next[1].line, next[1].ch - 1);
      if (vim.visualMode) {
        if (vim.visualLine || vim.visualBlock) {
          vim.visualLine = false;
          vim.visualBlock = false;
          cm_adapter_default.signal(cm, "vim-mode-change", {
            mode: "visual",
            subMode: ""
          });
        }
        var anchor = vim.sel.anchor;
        if (anchor) if (state.isReversed()) {
          if (motionArgs.forward) return [anchor, from];
          return [anchor, to];
        } else {
          if (motionArgs.forward) return [anchor, to];
          return [anchor, from];
        }
      } else {
        vim.visualMode = true;
        vim.visualLine = false;
        vim.visualBlock = false;
        cm_adapter_default.signal(cm, "vim-mode-change", {
          mode: "visual",
          subMode: ""
        });
      }
      return prev ? [to, from] : [from, to];
    }, "findAndSelectNextInclusive"),
    goToMark: /* @__PURE__ */ __name(function(cm, _head, motionArgs, vim) {
      var pos = getMarkPos(cm, vim, motionArgs.selectedCharacter);
      if (pos) return motionArgs.linewise ? {
        line: pos.line,
        ch: findFirstNonWhiteSpaceCharacter(cm.getLine(pos.line))
      } : pos;
      return null;
    }, "goToMark"),
    moveToOtherHighlightedEnd: /* @__PURE__ */ __name(function(cm, _head, motionArgs, vim) {
      if (vim.visualBlock && motionArgs.sameLine) {
        var sel = vim.sel;
        return [clipCursorToContent(cm, new Pos(sel.anchor.line, sel.head.ch)), clipCursorToContent(cm, new Pos(sel.head.line, sel.anchor.ch))];
      } else return [vim.sel.head, vim.sel.anchor];
    }, "moveToOtherHighlightedEnd"),
    jumpToMark: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      var best = head;
      for (var i = 0; i < motionArgs.repeat; i++) {
        var cursor = best;
        for (var key in vim.marks) {
          if (!isLowerCase(key)) continue;
          var mark = vim.marks[key].find();
          if (motionArgs.forward ? cursorIsBefore(mark, cursor) : cursorIsBefore(cursor, mark)) continue;
          if (motionArgs.linewise && mark.line == cursor.line) continue;
          var equal = cursorEqual(cursor, best);
          var between = motionArgs.forward ? cursorIsBetween(cursor, mark, best) : cursorIsBetween(best, mark, cursor);
          if (equal || between) best = mark;
        }
      }
      if (motionArgs.linewise) best = new Pos(best.line, findFirstNonWhiteSpaceCharacter(cm.getLine(best.line)));
      return best;
    }, "jumpToMark"),
    moveByCharacters: /* @__PURE__ */ __name(function(_cm, head, motionArgs) {
      var cur = head;
      var repeat = motionArgs.repeat;
      var ch = motionArgs.forward ? cur.ch + repeat : cur.ch - repeat;
      return new Pos(cur.line, ch);
    }, "moveByCharacters"),
    moveByLines: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      var cur = head;
      var endCh = cur.ch;
      switch (vim.lastMotion) {
        case this.moveByLines:
        case this.moveByDisplayLines:
        case this.moveByScroll:
        case this.moveToColumn:
        case this.moveToEol:
          endCh = vim.lastHPos;
          break;
        default:
          vim.lastHPos = endCh;
      }
      var repeat = motionArgs.repeat + (motionArgs.repeatOffset || 0);
      var line = motionArgs.forward ? cur.line + repeat : cur.line - repeat;
      var first = cm.firstLine();
      var last = cm.lastLine();
      var posV = cm.findPosV(cur, motionArgs.forward ? repeat : -repeat, "line", vim.lastHSPos);
      if (motionArgs.forward ? posV.line > line : posV.line < line) {
        line = posV.line;
        endCh = posV.ch;
      }
      if (line < first && cur.line == first) return this.moveToStartOfLine(cm, head, motionArgs, vim);
      else if (line > last && cur.line == last) return moveToEol(cm, head, motionArgs, vim, true);
      if (motionArgs.toFirstChar) {
        endCh = findFirstNonWhiteSpaceCharacter(cm.getLine(line));
        vim.lastHPos = endCh;
      }
      vim.lastHSPos = cm.charCoords(new Pos(line, endCh), "div").left;
      return new Pos(line, endCh);
    }, "moveByLines"),
    moveByDisplayLines: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      var cur = head;
      switch (vim.lastMotion) {
        case this.moveByDisplayLines:
        case this.moveByScroll:
        case this.moveByLines:
        case this.moveToColumn:
        case this.moveToEol:
          break;
        default:
          vim.lastHSPos = cm.charCoords(cur, "div").left;
      }
      var repeat = motionArgs.repeat;
      var res = cm.findPosV(cur, motionArgs.forward ? repeat : -repeat, "line", vim.lastHSPos);
      if (res.hitSide) if (motionArgs.forward) {
        var goalCoords = {
          top: cm.charCoords(res, "div").top + 8,
          left: vim.lastHSPos
        };
        var res = cm.coordsChar(goalCoords, "div");
      } else {
        var resCoords = cm.charCoords(new Pos(cm.firstLine(), 0), "div");
        resCoords.left = vim.lastHSPos;
        res = cm.coordsChar(resCoords, "div");
      }
      vim.lastHPos = res.ch;
      return res;
    }, "moveByDisplayLines"),
    moveByPage: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      var curStart = head;
      var repeat = motionArgs.repeat;
      return cm.findPosV(curStart, motionArgs.forward ? repeat : -repeat, "page");
    }, "moveByPage"),
    moveByParagraph: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      var dir = motionArgs.forward ? 1 : -1;
      return findParagraph(cm, head, motionArgs.repeat, dir);
    }, "moveByParagraph"),
    moveBySentence: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      var dir = motionArgs.forward ? 1 : -1;
      return findSentence(cm, head, motionArgs.repeat, dir);
    }, "moveBySentence"),
    moveByScroll: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      var scrollbox = cm.getScrollInfo();
      var curEnd = null;
      var repeat = motionArgs.repeat;
      if (!repeat) repeat = scrollbox.clientHeight / (2 * cm.defaultTextHeight());
      var orig = cm.charCoords(head, "local");
      motionArgs.repeat = repeat;
      var curEnd = motions.moveByDisplayLines(cm, head, motionArgs, vim);
      if (!curEnd) return null;
      var dest = cm.charCoords(curEnd, "local");
      cm.scrollTo(null, scrollbox.top + dest.top - orig.top);
      return curEnd;
    }, "moveByScroll"),
    moveByWords: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      return moveToWord(cm, head, motionArgs.repeat, !!motionArgs.forward, !!motionArgs.wordEnd, !!motionArgs.bigWord);
    }, "moveByWords"),
    moveTillCharacter: /* @__PURE__ */ __name(function(cm, _head, motionArgs) {
      var repeat = motionArgs.repeat;
      var curEnd = moveToCharacter(cm, repeat, motionArgs.forward, motionArgs.selectedCharacter);
      var increment = motionArgs.forward ? -1 : 1;
      recordLastCharacterSearch(increment, motionArgs);
      if (!curEnd) return null;
      curEnd.ch += increment;
      return curEnd;
    }, "moveTillCharacter"),
    moveToCharacter: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      var repeat = motionArgs.repeat;
      recordLastCharacterSearch(0, motionArgs);
      return moveToCharacter(cm, repeat, motionArgs.forward, motionArgs.selectedCharacter) || head;
    }, "moveToCharacter"),
    moveToSymbol: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      var repeat = motionArgs.repeat;
      return findSymbol(cm, repeat, motionArgs.forward, motionArgs.selectedCharacter) || head;
    }, "moveToSymbol"),
    moveToColumn: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      var repeat = motionArgs.repeat;
      vim.lastHPos = repeat - 1;
      vim.lastHSPos = cm.charCoords(head, "div").left;
      return moveToColumn(cm, repeat);
    }, "moveToColumn"),
    moveToEol: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      return moveToEol(cm, head, motionArgs, vim, false);
    }, "moveToEol"),
    moveToFirstNonWhiteSpaceCharacter: /* @__PURE__ */ __name(function(cm, head) {
      var cursor = head;
      return new Pos(cursor.line, findFirstNonWhiteSpaceCharacter(cm.getLine(cursor.line)));
    }, "moveToFirstNonWhiteSpaceCharacter"),
    moveToMatchedSymbol: /* @__PURE__ */ __name(function(cm, head) {
      var cursor = head;
      var line = cursor.line;
      var ch = cursor.ch;
      if (ch < cm.getLine(line).length) {
        var re = ch === "<" || ch === ">" ? /[(){}[\]<>]/ : /[(){}[\]]/;
        return cm.findMatchingBracket(new Pos(line, ch), { bracketRegex: re }).to;
      } else return cursor;
    }, "moveToMatchedSymbol"),
    moveToStartOfLine: /* @__PURE__ */ __name(function(_cm, head) {
      return new Pos(head.line, 0);
    }, "moveToStartOfLine"),
    moveToLineOrEdgeOfDocument: /* @__PURE__ */ __name(function(cm, _head, motionArgs) {
      var lineNum = motionArgs.forward ? cm.lastLine() : cm.firstLine();
      if (motionArgs.repeatIsExplicit) lineNum = motionArgs.repeat - cm.getOption("firstLineNumber");
      return new Pos(lineNum, findFirstNonWhiteSpaceCharacter(cm.getLine(lineNum)));
    }, "moveToLineOrEdgeOfDocument"),
    moveToStartOfDisplayLine: /* @__PURE__ */ __name(function(cm) {
      cm.execCommand("goLineLeft");
      return cm.getCursor();
    }, "moveToStartOfDisplayLine"),
    moveToEndOfDisplayLine: /* @__PURE__ */ __name(function(cm) {
      cm.execCommand("goLineRight");
      var head = cm.getCursor();
      if (head.sticky == "before") head.ch--;
      return head;
    }, "moveToEndOfDisplayLine"),
    textObjectManipulation: /* @__PURE__ */ __name(function(cm, head, motionArgs, vim) {
      var mirroredPairs = {
        "(": ")",
        ")": "(",
        "{": "}",
        "}": "{",
        "[": "]",
        "]": "[",
        "<": ">",
        ">": "<"
      };
      var selfPaired = {
        "'": true,
        '"': true,
        "`": true
      };
      var character = motionArgs.selectedCharacter;
      if (character == "b") character = "(";
      else if (character == "B") character = "{";
      var inclusive = !motionArgs.textObjectInner;
      var tmp;
      if (mirroredPairs[character]) tmp = selectCompanionObject(cm, head, character, inclusive);
      else if (selfPaired[character]) tmp = findBeginningAndEnd(cm, head, character, inclusive);
      else if (character === "W") tmp = expandWordUnderCursor(cm, inclusive, true, true);
      else if (character === "w") tmp = expandWordUnderCursor(cm, inclusive, true, false);
      else if (character === "p") {
        tmp = findParagraph(cm, head, motionArgs.repeat, 0, inclusive);
        motionArgs.linewise = true;
        if (vim.visualMode) {
          if (!vim.visualLine) vim.visualLine = true;
        } else {
          var operatorArgs = vim.inputState.operatorArgs;
          if (operatorArgs) operatorArgs.linewise = true;
          tmp.end.line--;
        }
      } else if (character === "t") tmp = expandTagUnderCursor(cm, head, inclusive);
      else return null;
      if (!cm.state.vim.visualMode) return [tmp.start, tmp.end];
      else return expandSelection(cm, tmp.start, tmp.end);
    }, "textObjectManipulation"),
    repeatLastCharacterSearch: /* @__PURE__ */ __name(function(cm, head, motionArgs) {
      var lastSearch = vimGlobalState.lastCharacterSearch;
      var repeat = motionArgs.repeat;
      var forward = motionArgs.forward === lastSearch.forward;
      var increment = (lastSearch.increment ? 1 : 0) * (forward ? -1 : 1);
      cm.moveH(-increment, "char");
      motionArgs.inclusive = forward ? true : false;
      var curEnd = moveToCharacter(cm, repeat, forward, lastSearch.selectedCharacter);
      if (!curEnd) {
        cm.moveH(increment, "char");
        return head;
      }
      curEnd.ch += increment;
      return curEnd;
    }, "repeatLastCharacterSearch")
  };
  function defineMotion(name, fn) {
    motions[name] = fn;
  }
  __name(defineMotion, "defineMotion");
  function fillArray(val, times) {
    var arr = [];
    for (var i = 0; i < times; i++) arr.push(val);
    return arr;
  }
  __name(fillArray, "fillArray");
  var operators = {
    change: /* @__PURE__ */ __name(function(cm, args, ranges) {
      var finalHead, text;
      var vim = cm.state.vim;
      var anchor = ranges[0].anchor, head = ranges[0].head;
      if (!vim.visualMode) {
        text = cm.getRange(anchor, head);
        var lastState = vim.lastEditInputState || {};
        if (lastState.motion == "moveByWords" && !isWhiteSpaceString(text)) {
          var match = /\s+$/.exec(text);
          if (match && lastState.motionArgs && lastState.motionArgs.forward) {
            head = offsetCursor(head, 0, -match[0].length);
            text = text.slice(0, -match[0].length);
          }
        }
        var prevLineEnd = new Pos(anchor.line - 1, Number.MAX_VALUE);
        var wasLastLine = cm.firstLine() == cm.lastLine();
        if (head.line > cm.lastLine() && args.linewise && !wasLastLine) cm.replaceRange("", prevLineEnd, head);
        else cm.replaceRange("", anchor, head);
        if (args.linewise) {
          if (!wasLastLine) {
            cm.setCursor(prevLineEnd);
            cm_adapter_default.commands.newlineAndIndent(cm);
          }
          anchor.ch = Number.MAX_VALUE;
        }
        finalHead = anchor;
      } else if (args.fullLine) {
        head.ch = Number.MAX_VALUE;
        head.line--;
        cm.setSelection(anchor, head);
        text = cm.getSelection();
        cm.replaceSelections("");
        finalHead = anchor;
      } else {
        text = cm.getSelection();
        var replacement = fillArray("", ranges.length);
        cm.replaceSelections(replacement);
        finalHead = cursorMin(ranges[0].head, ranges[0].anchor);
      }
      vimGlobalState.registerController.pushText(args.registerName, "change", text, args.linewise, ranges.length > 1);
      actions.enterInsertMode(cm, { head: finalHead }, cm.state.vim);
    }, "change"),
    delete: /* @__PURE__ */ __name(function(cm, args, ranges) {
      cm.pushUndoStop();
      var finalHead, text;
      var vim = cm.state.vim;
      if (!vim.visualBlock) {
        var anchor = ranges[0].anchor, head = ranges[0].head;
        if (args.linewise && head.line != cm.firstLine() && anchor.line == cm.lastLine() && anchor.line == head.line - 1) if (anchor.line == cm.firstLine()) anchor.ch = 0;
        else anchor = new Pos(anchor.line - 1, lineLength(cm, anchor.line - 1));
        text = cm.getRange(anchor, head);
        cm.replaceRange("", anchor, head);
        finalHead = anchor;
        if (args.linewise) finalHead = motions.moveToFirstNonWhiteSpaceCharacter(cm, anchor);
      } else {
        text = cm.getSelection();
        var replacement = fillArray("", ranges.length);
        cm.replaceSelections(replacement);
        finalHead = cursorMin(ranges[0].head, ranges[0].anchor);
      }
      vimGlobalState.registerController.pushText(args.registerName, "delete", text, args.linewise, vim.visualBlock);
      return clipCursorToContent(cm, finalHead);
    }, "delete"),
    indent: /* @__PURE__ */ __name(function(cm, args, ranges) {
      var vim = cm.state.vim;
      var startLine = ranges[0].anchor.line;
      var endLine = vim.visualBlock ? ranges[ranges.length - 1].anchor.line : ranges[0].head.line;
      var repeat = vim.visualMode ? args.repeat : 1;
      if (args.linewise) endLine--;
      cm.pushUndoStop();
      for (var i = startLine; i <= endLine; i++) for (var j = 0; j < repeat; j++) cm.indentLine(i, args.indentRight);
      cm.pushUndoStop();
      return motions.moveToFirstNonWhiteSpaceCharacter(cm, ranges[0].anchor);
    }, "indent"),
    indentAuto: /* @__PURE__ */ __name(function(cm, _args, ranges) {
      cm.execCommand("indentAuto");
      return motions.moveToFirstNonWhiteSpaceCharacter(cm, ranges[0].anchor);
    }, "indentAuto"),
    changeCase: /* @__PURE__ */ __name(function(cm, args, ranges, oldAnchor, newHead) {
      var selections = cm.getSelections();
      var swapped = [];
      var toLower = args.toLower;
      for (var j = 0; j < selections.length; j++) {
        var toSwap = selections[j];
        var text = "";
        if (toLower === true) text = toSwap.toLowerCase();
        else if (toLower === false) text = toSwap.toUpperCase();
        else for (var i = 0; i < toSwap.length; i++) {
          var character = toSwap.charAt(i);
          text += isUpperCase(character) ? character.toLowerCase() : character.toUpperCase();
        }
        swapped.push(text);
      }
      cm.replaceSelections(swapped);
      if (args.shouldMoveCursor) return newHead;
      else if (!cm.state.vim.visualMode && args.linewise && ranges[0].anchor.line + 1 == ranges[0].head.line) return motions.moveToFirstNonWhiteSpaceCharacter(cm, oldAnchor);
      else if (args.linewise) return oldAnchor;
      else return cursorMin(ranges[0].anchor, ranges[0].head);
    }, "changeCase"),
    yank: /* @__PURE__ */ __name(function(cm, args, ranges, oldAnchor) {
      var vim = cm.state.vim;
      var text = cm.getSelection();
      var endPos = vim.visualMode ? cursorMin(vim.sel.anchor, vim.sel.head, ranges[0].head, ranges[0].anchor) : oldAnchor;
      vimGlobalState.registerController.pushText(args.registerName, "yank", text, args.linewise, vim.visualBlock);
      return endPos;
    }, "yank")
  };
  function defineOperator(name, fn) {
    operators[name] = fn;
  }
  __name(defineOperator, "defineOperator");
  var actions = {
    jumpListWalk: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      if (vim.visualMode) return;
      var repeat = actionArgs.repeat;
      var forward = actionArgs.forward;
      var mark = vimGlobalState.jumpList.move(cm, forward ? repeat : -repeat);
      var markPos = mark ? mark.find() : void 0;
      markPos = markPos ? markPos : cm.getCursor();
      cm.setCursor(markPos);
    }, "jumpListWalk"),
    scroll: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      if (vim.visualMode) return;
      var repeat = actionArgs.repeat || 1;
      var lineHeight = cm.defaultTextHeight();
      var top = cm.getScrollInfo().top;
      var delta = lineHeight * repeat;
      var newPos = actionArgs.forward ? top + delta : top - delta;
      var cursor = copyCursor(cm.getCursor());
      var cursorCoords = cm.charCoords(cursor, "local");
      if (actionArgs.forward) if (newPos > cursorCoords.top) {
        cursor.line += (newPos - cursorCoords.top) / lineHeight;
        cursor.line = Math.ceil(cursor.line);
        cm.setCursor(cursor);
        cursorCoords = cm.charCoords(cursor, "local");
        cm.scrollTo(null, cursorCoords.top);
      } else cm.scrollTo(null, newPos);
      else {
        var newBottom = newPos + cm.getScrollInfo().clientHeight;
        if (newBottom < cursorCoords.bottom) {
          cursor.line -= (cursorCoords.bottom - newBottom) / lineHeight;
          cursor.line = Math.floor(cursor.line);
          cm.setCursor(cursor);
          cursorCoords = cm.charCoords(cursor, "local");
          cm.scrollTo(null, cursorCoords.bottom - cm.getScrollInfo().clientHeight);
        } else cm.scrollTo(null, newPos);
      }
    }, "scroll"),
    scrollToCursor: /* @__PURE__ */ __name(function(cm, actionArgs) {
      var lineNum = cm.getCursor().line;
      var charCoords = cm.charCoords(new Pos(lineNum, 0), "local");
      var height = cm.getScrollInfo().clientHeight;
      var y = charCoords.top;
      var lineHeight = charCoords.bottom - y;
      switch (actionArgs.position) {
        case "center":
          y = y - height / 2 + lineHeight;
          break;
        case "bottom":
          y = y - height + lineHeight;
          break;
      }
      cm.moveCurrentLineTo(y);
    }, "scrollToCursor"),
    replayMacro: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      var registerName = actionArgs.selectedCharacter;
      var repeat = actionArgs.repeat;
      var macroModeState = vimGlobalState.macroModeState;
      if (registerName == "@") registerName = macroModeState.latestRegister;
      else macroModeState.latestRegister = registerName;
      while (repeat--) executeMacroRegister(cm, vim, macroModeState, registerName);
    }, "replayMacro"),
    enterMacroRecordMode: /* @__PURE__ */ __name(function(cm, actionArgs) {
      var macroModeState = vimGlobalState.macroModeState;
      var registerName = actionArgs.selectedCharacter;
      if (vimGlobalState.registerController.isValidRegister(registerName)) macroModeState.enterMacroRecordMode(cm, registerName);
    }, "enterMacroRecordMode"),
    toggleOverwrite: /* @__PURE__ */ __name(function(cm) {
      if (!cm.state.overwrite) {
        cm.toggleOverwrite(true);
        cm.setOption("keyMap", "vim-replace");
        cm_adapter_default.signal(cm, "vim-mode-change", { mode: "replace" });
      } else {
        cm.toggleOverwrite(false);
        cm.setOption("keyMap", "vim-insert");
        cm_adapter_default.signal(cm, "vim-mode-change", { mode: "insert" });
      }
    }, "toggleOverwrite"),
    enterInsertMode: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      if (cm.getOption("readOnly")) return;
      vim.insertMode = true;
      vim.insertModeRepeat = actionArgs && actionArgs.repeat || 1;
      var insertAt = actionArgs ? actionArgs.insertAt : null;
      var sel = vim.sel;
      var head = actionArgs.head || cm.getCursor("head");
      var height = cm.listSelections().length;
      if (insertAt == "eol") head = new Pos(head.line, lineLength(cm, head.line));
      else if (insertAt == "bol") head = new Pos(head.line, 0);
      else if (insertAt == "charAfter") head = offsetCursor(head, 0, 1);
      else if (insertAt == "firstNonBlank") head = motions.moveToFirstNonWhiteSpaceCharacter(cm, head);
      else if (insertAt == "startOfSelectedArea") {
        if (!vim.visualMode) return;
        if (!vim.visualBlock) if (sel.head.line < sel.anchor.line) head = sel.head;
        else head = new Pos(sel.anchor.line, 0);
        else {
          head = new Pos(Math.min(sel.head.line, sel.anchor.line), Math.min(sel.head.ch, sel.anchor.ch));
          height = Math.abs(sel.head.line - sel.anchor.line) + 1;
        }
      } else if (insertAt == "endOfSelectedArea") {
        if (!vim.visualMode) return;
        if (!vim.visualBlock) if (sel.head.line >= sel.anchor.line) head = offsetCursor(sel.head, 0, 1);
        else head = new Pos(sel.anchor.line, 0);
        else {
          head = new Pos(Math.min(sel.head.line, sel.anchor.line), Math.max(sel.head.ch, sel.anchor.ch) + 1);
          height = Math.abs(sel.head.line - sel.anchor.line) + 1;
        }
      } else if (insertAt == "inplace") {
        if (vim.visualMode) return;
      } else if (insertAt == "lastEdit") head = getLastEditPos(cm) || head;
      cm.setOption("disableInput", false);
      if (actionArgs && actionArgs.replace) {
        cm.toggleOverwrite(true);
        cm.setOption("keyMap", "vim-replace");
        cm_adapter_default.signal(cm, "vim-mode-change", { mode: "replace" });
      } else {
        cm.toggleOverwrite(false);
        cm.setOption("keyMap", "vim-insert");
        cm_adapter_default.signal(cm, "vim-mode-change", { mode: "insert" });
      }
      if (!vimGlobalState.macroModeState.isPlaying) {
        cm.on("change", onChange);
        cm_adapter_default.on(cm.getInputField(), "keydown", onKeyEventTargetKeyDown);
      }
      if (vim.visualMode) exitVisualMode(cm);
      selectForInsert(cm, head, height);
    }, "enterInsertMode"),
    toggleVisualMode: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      var repeat = actionArgs.repeat;
      var anchor = cm.getCursor();
      var head;
      if (!vim.visualMode) {
        vim.visualMode = true;
        vim.visualLine = !!actionArgs.linewise;
        vim.visualBlock = !!actionArgs.blockwise;
        head = clipCursorToContent(cm, new Pos(anchor.line, anchor.ch + repeat - 1));
        vim.sel = {
          anchor,
          head
        };
        cm_adapter_default.signal(cm, "vim-mode-change", {
          mode: "visual",
          subMode: vim.visualLine ? "linewise" : vim.visualBlock ? "blockwise" : ""
        });
        updateCmSelection(cm);
        updateMark(cm, vim, "<", cursorMin(anchor, head));
        updateMark(cm, vim, ">", cursorMax(anchor, head));
      } else if (vim.visualLine ^ actionArgs.linewise || vim.visualBlock ^ actionArgs.blockwise) {
        vim.visualLine = !!actionArgs.linewise;
        vim.visualBlock = !!actionArgs.blockwise;
        cm_adapter_default.signal(cm, "vim-mode-change", {
          mode: "visual",
          subMode: vim.visualLine ? "linewise" : vim.visualBlock ? "blockwise" : ""
        });
        updateCmSelection(cm);
      } else exitVisualMode(cm);
    }, "toggleVisualMode"),
    reselectLastSelection: /* @__PURE__ */ __name(function(cm, _actionArgs, vim) {
      var lastSelection = vim.lastSelection;
      if (vim.visualMode) updateLastSelection(cm, vim);
      if (lastSelection) {
        var anchor = lastSelection.anchorMark.find();
        var head = lastSelection.headMark.find();
        if (!anchor || !head) return;
        vim.sel = {
          anchor,
          head
        };
        vim.visualMode = true;
        vim.visualLine = lastSelection.visualLine;
        vim.visualBlock = lastSelection.visualBlock;
        updateCmSelection(cm);
        updateMark(cm, vim, "<", cursorMin(anchor, head));
        updateMark(cm, vim, ">", cursorMax(anchor, head));
        cm_adapter_default.signal(cm, "vim-mode-change", {
          mode: "visual",
          subMode: vim.visualLine ? "linewise" : vim.visualBlock ? "blockwise" : ""
        });
      }
    }, "reselectLastSelection"),
    joinLines: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      var curStart, curEnd;
      if (vim.visualMode) {
        curStart = cm.getCursor("anchor");
        curEnd = cm.getCursor("head");
        if (cursorIsBefore(curEnd, curStart)) {
          var tmp = curEnd;
          curEnd = curStart;
          curStart = tmp;
        }
        curEnd.ch = lineLength(cm, curEnd.line) - 1;
      } else {
        var repeat = Math.max(actionArgs.repeat, 2);
        curStart = cm.getCursor();
        curEnd = clipCursorToContent(cm, new Pos(curStart.line + repeat - 1, Infinity));
      }
      var finalCh = 0;
      for (var i = curStart.line; i < curEnd.line; i++) {
        finalCh = lineLength(cm, curStart.line);
        var tmp = new Pos(curStart.line + 1, lineLength(cm, curStart.line + 1));
        var text = cm.getRange(curStart, tmp);
        text = actionArgs.keepSpaces ? text.replace(/\n\r?/g, "") : text.replace(/\n\s*/g, " ");
        cm.replaceRange(text, curStart, tmp);
      }
      var curFinalPos = new Pos(curStart.line, finalCh);
      if (vim.visualMode) exitVisualMode(cm, false);
      cm.setCursor(curFinalPos);
    }, "joinLines"),
    newLineAndEnterInsertMode: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      if (cm.getOption("readOnly")) return;
      vim.insertMode = true;
      var insertAt = copyCursor(cm.getCursor());
      if (insertAt.line === cm.firstLine() && !actionArgs.after) {
        cm.replaceRange("\n", new Pos(cm.firstLine(), 0));
        cm.setCursor(cm.firstLine(), 0);
      } else {
        insertAt.line = actionArgs.after ? insertAt.line : insertAt.line - 1;
        insertAt.ch = lineLength(cm, insertAt.line);
        cm.setCursor(insertAt);
        (cm_adapter_default.commands.newlineAndIndentContinueComment || cm_adapter_default.commands.newlineAndIndent)(cm);
      }
      this.enterInsertMode(cm, { repeat: actionArgs.repeat }, vim);
    }, "newLineAndEnterInsertMode"),
    paste: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      var cur = copyCursor(cm.getCursor());
      var register = vimGlobalState.registerController.getRegister(actionArgs.registerName);
      var text = register.toString();
      if (!text) return;
      if (actionArgs.matchIndent) {
        var tabSize = cm.getOption("tabSize");
        var whitespaceLength = /* @__PURE__ */ __name(function(str) {
          var tabs = str.split("	").length - 1;
          var spaces = str.split(" ").length - 1;
          return tabs * tabSize + spaces * 1;
        }, "whitespaceLength");
        var indent = whitespaceLength(cm.getLine(cm.getCursor().line).match(/^\s*/)[0]);
        var chompedText = text.replace(/\n$/, "");
        var wasChomped = text !== chompedText;
        var firstIndent = whitespaceLength(text.match(/^\s*/)[0]);
        var text = chompedText.replace(/^\s*/gm, function(wspace) {
          var newIndent = indent + (whitespaceLength(wspace) - firstIndent);
          if (newIndent < 0) return "";
          else if (cm.getOption("indentWithTabs")) {
            var quotient = Math.floor(newIndent / tabSize);
            return Array(quotient + 1).join("	");
          } else return Array(newIndent + 1).join(" ");
        });
        text += wasChomped ? "\n" : "";
      }
      if (actionArgs.repeat > 1) var text = Array(actionArgs.repeat + 1).join(text);
      var linewise = register.linewise;
      var blockwise = register.blockwise;
      if (blockwise) {
        text = text.split("\n");
        if (linewise) text.pop();
        for (var i = 0; i < text.length; i++) text[i] = text[i] == "" ? " " : text[i];
        cur.ch += actionArgs.after ? 1 : 0;
        cur.ch = Math.min(lineLength(cm, cur.line), cur.ch);
      } else if (linewise) if (vim.visualMode) text = vim.visualLine ? text.slice(0, -1) : "\n" + text.slice(0, text.length - 1) + "\n";
      else if (actionArgs.after) {
        text = "\n" + text.slice(0, text.length - 1);
        cur.ch = lineLength(cm, cur.line);
      } else cur.ch = 0;
      else cur.ch += actionArgs.after ? 1 : 0;
      var curPosFinal;
      var idx;
      if (vim.visualMode) {
        vim.lastPastedText = text;
        var lastSelectionCurEnd;
        var selectedArea = getSelectedAreaRange(cm, vim);
        var selectionStart = selectedArea[0];
        var selectionEnd = selectedArea[1];
        var selectedText = cm.getSelection();
        var selections = cm.listSelections();
        var emptyStrings = new Array(selections.length).join("1").split("1");
        if (vim.lastSelection) lastSelectionCurEnd = vim.lastSelection.headMark.find();
        vimGlobalState.registerController.unnamedRegister.setText(selectedText);
        if (blockwise) {
          cm.replaceSelections(emptyStrings);
          selectionEnd = new Pos(selectionStart.line + text.length - 1, selectionStart.ch);
          cm.setCursor(selectionStart);
          selectBlock(cm, selectionEnd);
          cm.replaceSelections(text);
          curPosFinal = selectionStart;
        } else if (vim.visualBlock) {
          cm.replaceSelections(emptyStrings);
          cm.setCursor(selectionStart);
          cm.replaceRange(text, selectionStart, selectionStart);
          curPosFinal = selectionStart;
        } else {
          cm.replaceRange(text, selectionStart, selectionEnd);
          curPosFinal = cm.posFromIndex(cm.indexFromPos(selectionStart) + text.length - 1);
        }
        if (lastSelectionCurEnd) vim.lastSelection.headMark = cm.setBookmark(lastSelectionCurEnd);
        if (linewise) curPosFinal.ch = 0;
      } else if (blockwise) {
        cm.setCursor(cur);
        for (var i = 0; i < text.length; i++) {
          var line = cur.line + i;
          if (line > cm.lastLine()) cm.replaceRange("\n", new Pos(line, 0));
          if (lineLength(cm, line) < cur.ch) extendLineToColumn(cm, line, cur.ch);
        }
        cm.setCursor(cur);
        selectBlock(cm, new Pos(cur.line + text.length - 1, cur.ch));
        cm.replaceSelections(text);
        curPosFinal = cur;
      } else {
        cm.replaceRange(text, cur);
        if (linewise && actionArgs.after) curPosFinal = new Pos(cur.line + 1, findFirstNonWhiteSpaceCharacter(cm.getLine(cur.line + 1)));
        else if (linewise && !actionArgs.after) curPosFinal = new Pos(cur.line, findFirstNonWhiteSpaceCharacter(cm.getLine(cur.line)));
        else if (!linewise && actionArgs.after) {
          idx = cm.indexFromPos(cur);
          curPosFinal = cm.posFromIndex(idx + text.length - 1);
        } else {
          idx = cm.indexFromPos(cur);
          curPosFinal = cm.posFromIndex(idx + text.length);
        }
      }
      if (vim.visualMode) exitVisualMode(cm, false);
      cm.setCursor(curPosFinal);
    }, "paste"),
    undo: /* @__PURE__ */ __name(function(cm, actionArgs) {
      cm.operation(function() {
        repeatFn(cm, cm_adapter_default.commands.undo, actionArgs.repeat)();
        cm.setCursor(cm.getCursor("anchor"));
      });
    }, "undo"),
    redo: /* @__PURE__ */ __name(function(cm, actionArgs) {
      repeatFn(cm, cm_adapter_default.commands.redo, actionArgs.repeat)();
    }, "redo"),
    setRegister: /* @__PURE__ */ __name(function(_cm, actionArgs, vim) {
      vim.inputState.registerName = actionArgs.selectedCharacter;
    }, "setRegister"),
    setMark: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      var markName = actionArgs.selectedCharacter;
      updateMark(cm, vim, markName, cm.getCursor());
    }, "setMark"),
    replace: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      var replaceWith = actionArgs.selectedCharacter;
      var curStart = cm.getCursor();
      var replaceTo;
      var curEnd;
      var selections = cm.listSelections();
      if (vim.visualMode) {
        curStart = cm.getCursor("start");
        curEnd = cm.getCursor("end");
      } else {
        var line = cm.getLine(curStart.line);
        replaceTo = curStart.ch + actionArgs.repeat;
        if (replaceTo > line.length) replaceTo = line.length;
        curEnd = new Pos(curStart.line, replaceTo);
      }
      if (replaceWith == "\n") {
        if (!vim.visualMode) cm.replaceRange("", curStart, curEnd);
        (cm_adapter_default.commands.newlineAndIndentContinueComment || cm_adapter_default.commands.newlineAndIndent)(cm);
      } else {
        var replaceWithStr = cm.getRange(curStart, curEnd);
        replaceWithStr = replaceWithStr.replace(/[^\n]/g, replaceWith);
        if (vim.visualBlock) {
          var spaces = new Array(cm.getOption("tabSize") + 1).join(" ");
          replaceWithStr = cm.getSelection();
          replaceWithStr = replaceWithStr.replace(/\t/g, spaces).replace(/[^\n]/g, replaceWith).split("\n");
          cm.replaceSelections(replaceWithStr);
        } else cm.replaceRange(replaceWithStr, curStart, curEnd);
        if (vim.visualMode) {
          curStart = cursorIsBefore(selections[0].anchor, selections[0].head) ? selections[0].anchor : selections[0].head;
          cm.setCursor(curStart);
          exitVisualMode(cm, false);
        } else cm.setCursor(offsetCursor(curEnd, 0, -1));
      }
    }, "replace"),
    incrementNumberToken: /* @__PURE__ */ __name(function(cm, actionArgs) {
      var cur = cm.getCursor();
      var lineStr = cm.getLine(cur.line);
      var re = /(-?)(?:(0x)([\da-f]+)|(0b|0|)(\d+))/gi;
      var match;
      var start;
      var end;
      var numberStr;
      while ((match = re.exec(lineStr)) !== null) {
        start = match.index;
        end = start + match[0].length;
        if (cur.ch < end) break;
      }
      if (!actionArgs.backtrack && end <= cur.ch) return;
      if (match) {
        var baseStr = match[2] || match[4];
        var digits = match[3] || match[5];
        var increment = actionArgs.increase ? 1 : -1;
        var base = {
          "0b": 2,
          0: 8,
          "": 10,
          "0x": 16
        }[baseStr.toLowerCase()];
        numberStr = (parseInt(match[1] + digits, base) + increment * actionArgs.repeat).toString(base);
        var zeroPadding = baseStr ? new Array(digits.length - numberStr.length + 1 + match[1].length).join("0") : "";
        if (numberStr.charAt(0) === "-") numberStr = "-" + baseStr + zeroPadding + numberStr.substr(1);
        else numberStr = baseStr + zeroPadding + numberStr;
        var from = new Pos(cur.line, start);
        var to = new Pos(cur.line, end);
        cm.replaceRange(numberStr, from, to);
      } else return;
      cm.setCursor(new Pos(cur.line, start + numberStr.length - 1));
    }, "incrementNumberToken"),
    repeatLastEdit: /* @__PURE__ */ __name(function(cm, actionArgs, vim) {
      if (!vim.lastEditInputState) return;
      var repeat = actionArgs.repeat;
      if (repeat && actionArgs.repeatIsExplicit) vim.lastEditInputState.repeatOverride = repeat;
      else repeat = vim.lastEditInputState.repeatOverride || repeat;
      repeatLastEdit(
        cm,
        vim,
        repeat,
        false
        /** repeatForInsert */
      );
    }, "repeatLastEdit"),
    indent: /* @__PURE__ */ __name(function(cm, actionArgs) {
      cm.indentLine(cm.getCursor().line, actionArgs.indentRight);
    }, "indent"),
    exitInsertMode
  };
  function defineAction(name, fn) {
    actions[name] = fn;
  }
  __name(defineAction, "defineAction");
  function clipCursorToContent(cm, cur) {
    var vim = cm.state.vim;
    var includeLineBreak = vim.insertMode || vim.visualMode;
    var line = Math.min(Math.max(cm.firstLine(), cur.line), cm.lastLine());
    var maxCh = lineLength(cm, line) - 1 + !!includeLineBreak;
    return new Pos(line, Math.min(Math.max(0, cur.ch), maxCh));
  }
  __name(clipCursorToContent, "clipCursorToContent");
  function copyArgs(args) {
    var ret = {};
    for (var prop in args) if (args.hasOwnProperty(prop)) ret[prop] = args[prop];
    return ret;
  }
  __name(copyArgs, "copyArgs");
  function offsetCursor(cur, offsetLine, offsetCh) {
    if (typeof offsetLine === "object") {
      offsetCh = offsetLine.ch;
      offsetLine = offsetLine.line;
    }
    return new Pos(cur.line + offsetLine, cur.ch + offsetCh);
  }
  __name(offsetCursor, "offsetCursor");
  function commandMatches(keys, keyMap, context, inputState) {
    var match, partial = [], full = [];
    for (var i = 0; i < keyMap.length; i++) {
      var command = keyMap[i];
      if (context == "insert" && command.context != "insert" || command.context && command.context != context || inputState.operator && command.type == "action" || !(match = commandMatch(keys, command.keys))) continue;
      if (match == "partial") partial.push(command);
      if (match == "full") full.push(command);
    }
    return {
      partial: partial.length && partial,
      full: full.length && full
    };
  }
  __name(commandMatches, "commandMatches");
  function commandMatch(pressed, mapped) {
    if (mapped.slice(-11) == "<character>") {
      var prefixLen = mapped.length - 11;
      var pressedPrefix = pressed.slice(0, prefixLen);
      var mappedPrefix = mapped.slice(0, prefixLen);
      return pressedPrefix == mappedPrefix && pressed.length > prefixLen ? "full" : mappedPrefix.indexOf(pressedPrefix) == 0 ? "partial" : false;
    } else return pressed == mapped ? "full" : mapped.indexOf(pressed) == 0 ? "partial" : false;
  }
  __name(commandMatch, "commandMatch");
  function lastChar(keys) {
    var match = /^.*(<[^>]+>)$/.exec(keys);
    var selectedCharacter = match ? match[1] : keys.slice(-1);
    if (selectedCharacter.length > 1) switch (selectedCharacter) {
      case "<CR>":
        selectedCharacter = "\n";
        break;
      case "<Space>":
        selectedCharacter = " ";
        break;
      default:
        selectedCharacter = "";
        break;
    }
    return selectedCharacter;
  }
  __name(lastChar, "lastChar");
  function repeatFn(cm, fn, repeat) {
    return function() {
      for (var i = 0; i < repeat; i++) fn(cm);
    };
  }
  __name(repeatFn, "repeatFn");
  function copyCursor(cur) {
    return new Pos(cur.line, cur.ch);
  }
  __name(copyCursor, "copyCursor");
  function cursorEqual(cur1, cur2) {
    return cur1.ch == cur2.ch && cur1.line == cur2.line;
  }
  __name(cursorEqual, "cursorEqual");
  function cursorIsBefore(cur1, cur2) {
    if (cur1.line < cur2.line) return true;
    if (cur1.line == cur2.line && cur1.ch < cur2.ch) return true;
    return false;
  }
  __name(cursorIsBefore, "cursorIsBefore");
  function cursorMin(cur1, cur2) {
    if (arguments.length > 2) cur2 = cursorMin.apply(void 0, Array.prototype.slice.call(arguments, 1));
    return cursorIsBefore(cur1, cur2) ? cur1 : cur2;
  }
  __name(cursorMin, "cursorMin");
  function cursorMax(cur1, cur2) {
    if (arguments.length > 2) cur2 = cursorMax.apply(void 0, Array.prototype.slice.call(arguments, 1));
    return cursorIsBefore(cur1, cur2) ? cur2 : cur1;
  }
  __name(cursorMax, "cursorMax");
  function cursorIsBetween(cur1, cur2, cur3) {
    var cur1before2 = cursorIsBefore(cur1, cur2);
    var cur2before3 = cursorIsBefore(cur2, cur3);
    return cur1before2 && cur2before3;
  }
  __name(cursorIsBetween, "cursorIsBetween");
  function lineLength(cm, lineNum) {
    return cm.getLine(lineNum).length;
  }
  __name(lineLength, "lineLength");
  function trim(s) {
    if (s.trim) return s.trim();
    return s.replace(/^\s+|\s+$/g, "");
  }
  __name(trim, "trim");
  function escapeRegex(s) {
    return s.replace(/([.?*+$\[\]\/\\(){}|\-])/g, "\\$1");
  }
  __name(escapeRegex, "escapeRegex");
  function extendLineToColumn(cm, lineNum, column) {
    var endCh = lineLength(cm, lineNum);
    var spaces = new Array(column - endCh + 1).join(" ");
    cm.setCursor(new Pos(lineNum, endCh));
    cm.replaceRange(spaces, cm.getCursor());
  }
  __name(extendLineToColumn, "extendLineToColumn");
  function selectBlock(cm, selectionEnd) {
    var selections = [], ranges = cm.listSelections();
    var head = copyCursor(cm.clipPos(selectionEnd));
    var isClipped = !cursorEqual(selectionEnd, head);
    var primIndex = getIndex(ranges, cm.getCursor("head"));
    var wasClipped = cursorEqual(ranges[primIndex].head, ranges[primIndex].anchor);
    var max = ranges.length - 1;
    var index = max - primIndex > primIndex ? max : 0;
    var base = ranges[index].anchor;
    var firstLine = Math.min(base.line, head.line);
    var lastLine = Math.max(base.line, head.line);
    var baseCh = base.ch, headCh = head.ch;
    var dir = ranges[index].head.ch - baseCh;
    var newDir = headCh - baseCh;
    if (dir > 0 && newDir <= 0) {
      baseCh++;
      if (!isClipped) headCh--;
    } else if (dir < 0 && newDir >= 0) {
      baseCh--;
      if (!wasClipped) headCh++;
    } else if (dir < 0 && newDir == -1) {
      baseCh--;
      headCh++;
    }
    for (var line = firstLine; line <= lastLine; line++) {
      var range = {
        anchor: new Pos(line, baseCh),
        head: new Pos(line, headCh)
      };
      selections.push(range);
    }
    cm.setSelections(selections);
    selectionEnd.ch = headCh;
    base.ch = baseCh;
    return base;
  }
  __name(selectBlock, "selectBlock");
  function selectForInsert(cm, head, height) {
    var sel = [];
    for (var i = 0; i < height; i++) {
      var lineHead = offsetCursor(head, i, 0);
      sel.push({
        anchor: lineHead,
        head: lineHead
      });
    }
    cm.setSelections(sel, 0);
  }
  __name(selectForInsert, "selectForInsert");
  function getIndex(ranges, cursor, end) {
    for (var i = 0; i < ranges.length; i++) {
      var atAnchor = end != "head" && cursorEqual(ranges[i].anchor, cursor);
      var atHead = end != "anchor" && cursorEqual(ranges[i].head, cursor);
      if (atAnchor || atHead) return i;
    }
    return -1;
  }
  __name(getIndex, "getIndex");
  function getSelectedAreaRange(cm, vim) {
    var lastSelection = vim.lastSelection;
    var getCurrentSelectedAreaRange = /* @__PURE__ */ __name(function() {
      var selections = cm.listSelections();
      var start = selections[0];
      var end = selections[selections.length - 1];
      return [cursorIsBefore(start.anchor, start.head) ? start.anchor : start.head, cursorIsBefore(end.anchor, end.head) ? end.head : end.anchor];
    }, "getCurrentSelectedAreaRange");
    var getLastSelectedAreaRange = /* @__PURE__ */ __name(function() {
      var selectionStart = cm.getCursor();
      var selectionEnd = cm.getCursor();
      var block = lastSelection.visualBlock;
      if (block) {
        var width = block.width;
        var height = block.height;
        selectionEnd = new Pos(selectionStart.line + height, selectionStart.ch + width);
        var selections = [];
        for (var i = selectionStart.line; i < selectionEnd.line; i++) {
          var range = {
            anchor: new Pos(i, selectionStart.ch),
            head: new Pos(i, selectionEnd.ch)
          };
          selections.push(range);
        }
        cm.setSelections(selections);
      } else {
        var start = lastSelection.anchorMark.find();
        var end = lastSelection.headMark.find();
        var line = end.line - start.line;
        var ch = end.ch - start.ch;
        selectionEnd = {
          line: selectionEnd.line + line,
          ch: line ? selectionEnd.ch : ch + selectionEnd.ch
        };
        if (lastSelection.visualLine) {
          selectionStart = new Pos(selectionStart.line, 0);
          selectionEnd = new Pos(selectionEnd.line, lineLength(cm, selectionEnd.line));
        }
        cm.setSelection(selectionStart, selectionEnd);
      }
      return [selectionStart, selectionEnd];
    }, "getLastSelectedAreaRange");
    if (!vim.visualMode) return getLastSelectedAreaRange();
    else return getCurrentSelectedAreaRange();
  }
  __name(getSelectedAreaRange, "getSelectedAreaRange");
  function updateLastSelection(cm, vim) {
    var anchor = vim.sel.anchor;
    var head = vim.sel.head;
    if (vim.lastPastedText) {
      head = cm.posFromIndex(cm.indexFromPos(anchor) + vim.lastPastedText.length);
      vim.lastPastedText = null;
    }
    vim.lastSelection = {
      anchorMark: cm.setBookmark(anchor),
      headMark: cm.setBookmark(head),
      anchor: copyCursor(anchor),
      head: copyCursor(head),
      visualMode: vim.visualMode,
      visualLine: vim.visualLine,
      visualBlock: vim.visualBlock
    };
  }
  __name(updateLastSelection, "updateLastSelection");
  function expandSelection(cm, start, end) {
    var sel = cm.state.vim.sel;
    var head = sel.head;
    var anchor = sel.anchor;
    var tmp;
    if (cursorIsBefore(end, start)) {
      tmp = end;
      end = start;
      start = tmp;
    }
    if (cursorIsBefore(head, anchor)) {
      head = cursorMin(start, head);
      anchor = cursorMax(anchor, end);
    } else {
      anchor = cursorMin(start, anchor);
      head = cursorMax(head, end);
      head = offsetCursor(head, 0, -1);
      if (head.ch == -1 && head.line != cm.firstLine()) head = new Pos(head.line - 1, lineLength(cm, head.line - 1));
    }
    return [anchor, head];
  }
  __name(expandSelection, "expandSelection");
  function updateCmSelection(cm, sel, mode) {
    var vim = cm.state.vim;
    sel = sel || vim.sel;
    var mode = mode || vim.visualLine ? "line" : vim.visualBlock ? "block" : "char";
    var cmSel = makeCmSelection(cm, sel, mode);
    cm.setSelections(cmSel.ranges, cmSel.primary);
  }
  __name(updateCmSelection, "updateCmSelection");
  function makeCmSelection(cm, sel, mode, exclusive) {
    var head = copyCursor(sel.head);
    var anchor = copyCursor(sel.anchor);
    if (mode == "char") {
      var headOffset = !exclusive && !cursorIsBefore(sel.head, sel.anchor) ? 1 : 0;
      var anchorOffset = cursorIsBefore(sel.head, sel.anchor) ? 1 : 0;
      head = offsetCursor(sel.head, 0, headOffset);
      anchor = offsetCursor(sel.anchor, 0, anchorOffset);
      return {
        ranges: [{
          anchor,
          head
        }],
        primary: 0
      };
    } else if (mode == "line") {
      if (!cursorIsBefore(sel.head, sel.anchor)) {
        anchor.ch = 0;
        var lastLine = cm.lastLine();
        if (head.line > lastLine) head.line = lastLine;
        head.ch = lineLength(cm, head.line);
      } else {
        head.ch = 0;
        anchor.ch = lineLength(cm, anchor.line);
      }
      return {
        ranges: [{
          anchor,
          head
        }],
        primary: 0
      };
    } else if (mode == "block") {
      var top = Math.min(anchor.line, head.line), fromCh = anchor.ch, bottom = Math.max(anchor.line, head.line), toCh = head.ch;
      if (fromCh < toCh) toCh += 1;
      else fromCh += 1;
      var height = bottom - top + 1;
      var primary = head.line == top ? 0 : height - 1;
      var ranges = [];
      for (var i = 0; i < height; i++) ranges.push({
        anchor: new Pos(top + i, fromCh),
        head: new Pos(top + i, toCh)
      });
      return {
        ranges,
        primary
      };
    }
  }
  __name(makeCmSelection, "makeCmSelection");
  function getHead(cm) {
    var cur = cm.getCursor("head");
    if (cm.getSelection().length == 1) cur = cursorMin(cur, cm.getCursor("anchor"));
    return cur;
  }
  __name(getHead, "getHead");
  function exitVisualMode(cm, moveHead) {
    var vim = cm.state.vim;
    if (moveHead !== false) cm.setCursor(clipCursorToContent(cm, vim.sel.head));
    updateLastSelection(cm, vim);
    vim.visualMode = false;
    vim.visualLine = false;
    vim.visualBlock = false;
    if (!vim.insertMode) cm_adapter_default.signal(cm, "vim-mode-change", { mode: "normal" });
  }
  __name(exitVisualMode, "exitVisualMode");
  function clipToLine(cm, curStart, curEnd) {
    var selection = cm.getRange(curStart, curEnd);
    if (/\n\s*$/.test(selection)) {
      var lines = selection.split("\n");
      lines.pop();
      var line;
      for (var line = lines.pop(); lines.length > 0 && line && isWhiteSpaceString(line); line = lines.pop()) {
        curEnd.line--;
        curEnd.ch = 0;
      }
      if (line) {
        curEnd.line--;
        curEnd.ch = lineLength(cm, curEnd.line);
      } else curEnd.ch = 0;
    }
  }
  __name(clipToLine, "clipToLine");
  function expandSelectionToLine(_cm, curStart, curEnd) {
    curStart.ch = 0;
    curEnd.ch = 0;
    curEnd.line++;
  }
  __name(expandSelectionToLine, "expandSelectionToLine");
  function findFirstNonWhiteSpaceCharacter(text) {
    if (!text) return 0;
    var firstNonWS = text.search(/\S/);
    return firstNonWS == -1 ? text.length : firstNonWS;
  }
  __name(findFirstNonWhiteSpaceCharacter, "findFirstNonWhiteSpaceCharacter");
  function expandWordUnderCursor(cm, inclusive, _forward, bigWord, noSymbol) {
    var cur = getHead(cm);
    var line = cm.getLine(cur.line);
    var idx = cur.ch;
    var test = noSymbol ? wordCharTest[0] : bigWordCharTest[0];
    while (!test(line.charAt(idx))) {
      idx++;
      if (idx >= line.length) return null;
    }
    if (bigWord) test = bigWordCharTest[0];
    else {
      test = wordCharTest[0];
      if (!test(line.charAt(idx))) test = wordCharTest[1];
    }
    var end = idx, start = idx;
    while (test(line.charAt(end)) && end < line.length) end++;
    while (test(line.charAt(start)) && start >= 0) start--;
    start++;
    if (inclusive) {
      var wordEnd = end;
      while (/\s/.test(line.charAt(end)) && end < line.length) end++;
      if (wordEnd == end) {
        var wordStart = start;
        while (/\s/.test(line.charAt(start - 1)) && start > 0) start--;
        if (!start) start = wordStart;
      }
    }
    return {
      start: new Pos(cur.line, start),
      end: new Pos(cur.line, end)
    };
  }
  __name(expandWordUnderCursor, "expandWordUnderCursor");
  function expandTagUnderCursor(cm, head, inclusive) {
    var cur = head;
    if (!cm_adapter_default.findMatchingTag || !cm_adapter_default.findEnclosingTag) return {
      start: cur,
      end: cur
    };
    var tags = cm_adapter_default.findMatchingTag(cm, head) || cm_adapter_default.findEnclosingTag(cm, head);
    if (!tags || !tags.open || !tags.close) return {
      start: cur,
      end: cur
    };
    if (inclusive) return {
      start: tags.open.from,
      end: tags.close.to
    };
    return {
      start: tags.open.to,
      end: tags.close.from
    };
  }
  __name(expandTagUnderCursor, "expandTagUnderCursor");
  function recordJumpPosition(cm, oldCur, newCur) {
    if (!cursorEqual(oldCur, newCur)) vimGlobalState.jumpList.add(cm, oldCur, newCur);
  }
  __name(recordJumpPosition, "recordJumpPosition");
  function recordLastCharacterSearch(increment, args) {
    vimGlobalState.lastCharacterSearch.increment = increment;
    vimGlobalState.lastCharacterSearch.forward = args.forward;
    vimGlobalState.lastCharacterSearch.selectedCharacter = args.selectedCharacter;
  }
  __name(recordLastCharacterSearch, "recordLastCharacterSearch");
  var symbolToMode = {
    "(": "bracket",
    ")": "bracket",
    "{": "bracket",
    "}": "bracket",
    "[": "section",
    "]": "section",
    "*": "comment",
    "/": "comment",
    m: "method",
    M: "method",
    "#": "preprocess"
  };
  var findSymbolModes = {
    bracket: { isComplete: /* @__PURE__ */ __name(function(state) {
      if (state.nextCh === state.symb) {
        state.depth++;
        if (state.depth >= 1) return true;
      } else if (state.nextCh === state.reverseSymb) state.depth--;
      return false;
    }, "isComplete") },
    section: {
      init: /* @__PURE__ */ __name(function(state) {
        state.curMoveThrough = true;
        state.symb = (state.forward ? "]" : "[") === state.symb ? "{" : "}";
      }, "init"),
      isComplete: /* @__PURE__ */ __name(function(state) {
        return state.index === 0 && state.nextCh === state.symb;
      }, "isComplete")
    },
    comment: { isComplete: /* @__PURE__ */ __name(function(state) {
      var found = state.lastCh === "*" && state.nextCh === "/";
      state.lastCh = state.nextCh;
      return found;
    }, "isComplete") },
    method: {
      init: /* @__PURE__ */ __name(function(state) {
        state.symb = state.symb === "m" ? "{" : "}";
        state.reverseSymb = state.symb === "{" ? "}" : "{";
      }, "init"),
      isComplete: /* @__PURE__ */ __name(function(state) {
        if (state.nextCh === state.symb) return true;
        return false;
      }, "isComplete")
    },
    preprocess: {
      init: /* @__PURE__ */ __name(function(state) {
        state.index = 0;
      }, "init"),
      isComplete: /* @__PURE__ */ __name(function(state) {
        if (state.nextCh === "#") {
          var token = state.lineText.match(/^#(\w+)/)[1];
          if (token === "endif") {
            if (state.forward && state.depth === 0) return true;
            state.depth++;
          } else if (token === "if") {
            if (!state.forward && state.depth === 0) return true;
            state.depth--;
          }
          if (token === "else" && state.depth === 0) return true;
        }
        return false;
      }, "isComplete")
    }
  };
  function findSymbol(cm, repeat, forward, symb) {
    var cur = copyCursor(cm.getCursor());
    var increment = forward ? 1 : -1;
    var endLine = forward ? cm.lineCount() : -1;
    var curCh = cur.ch;
    var line = cur.line;
    var lineText = cm.getLine(line);
    var state = {
      lineText,
      nextCh: lineText.charAt(curCh),
      lastCh: null,
      index: curCh,
      symb,
      reverseSymb: (forward ? {
        ")": "(",
        "}": "{"
      } : {
        "(": ")",
        "{": "}"
      })[symb],
      forward,
      depth: 0,
      curMoveThrough: false
    };
    var mode = symbolToMode[symb];
    if (!mode) return cur;
    var init = findSymbolModes[mode].init;
    var isComplete = findSymbolModes[mode].isComplete;
    if (init) init(state);
    while (line !== endLine && repeat) {
      state.index += increment;
      state.nextCh = state.lineText.charAt(state.index);
      if (!state.nextCh) {
        line += increment;
        state.lineText = cm.getLine(line) || "";
        if (increment > 0) state.index = 0;
        else {
          var lineLen = state.lineText.length;
          state.index = lineLen > 0 ? lineLen - 1 : 0;
        }
        state.nextCh = state.lineText.charAt(state.index);
      }
      if (isComplete(state)) {
        cur.line = line;
        cur.ch = state.index;
        repeat--;
      }
    }
    if (state.nextCh || state.curMoveThrough) return new Pos(line, state.index);
    return cur;
  }
  __name(findSymbol, "findSymbol");
  function findWord(cm, cur, forward, bigWord, emptyLineIsWord) {
    var lineNum = cur.line;
    var pos = cur.ch;
    var line = cm.getLine(lineNum);
    var dir = forward ? 1 : -1;
    var charTests = bigWord ? bigWordCharTest : wordCharTest;
    if (emptyLineIsWord && line == "") {
      lineNum += dir;
      line = cm.getLine(lineNum);
      if (!isLine(cm, lineNum)) return null;
      pos = forward ? 0 : line.length;
    }
    while (true) {
      if (emptyLineIsWord && line == "") return {
        from: 0,
        to: 0,
        line: lineNum
      };
      var stop = dir > 0 ? line.length : -1;
      var wordStart = stop, wordEnd = stop;
      while (pos != stop) {
        var foundWord = false;
        for (var i = 0; i < charTests.length && !foundWord; ++i) if (charTests[i](line.charAt(pos))) {
          wordStart = pos;
          while (pos != stop && charTests[i](line.charAt(pos))) pos += dir;
          wordEnd = pos;
          foundWord = wordStart != wordEnd;
          if (wordStart == cur.ch && lineNum == cur.line && wordEnd == wordStart + dir) continue;
          else return {
            from: Math.min(wordStart, wordEnd + 1),
            to: Math.max(wordStart, wordEnd),
            line: lineNum
          };
        }
        if (!foundWord) pos += dir;
      }
      lineNum += dir;
      if (!isLine(cm, lineNum)) return null;
      line = cm.getLine(lineNum);
      pos = dir > 0 ? 0 : line.length;
    }
  }
  __name(findWord, "findWord");
  function moveToWord(cm, cur, repeat, forward, wordEnd, bigWord) {
    var curStart = copyCursor(cur);
    var words = [];
    if (forward && !wordEnd || !forward && wordEnd) repeat++;
    var emptyLineIsWord = !(forward && wordEnd);
    for (var i = 0; i < repeat; i++) {
      var word = findWord(cm, cur, forward, bigWord, emptyLineIsWord);
      if (!word) {
        var eodCh = lineLength(cm, cm.lastLine());
        words.push(forward ? {
          line: cm.lastLine(),
          from: eodCh,
          to: eodCh
        } : {
          line: 0,
          from: 0,
          to: 0
        });
        break;
      }
      words.push(word);
      cur = new Pos(word.line, forward ? word.to - 1 : word.from);
    }
    var shortCircuit = words.length != repeat;
    var firstWord = words[0];
    var lastWord = words.pop();
    if (forward && !wordEnd) {
      if (!shortCircuit && (firstWord.from != curStart.ch || firstWord.line != curStart.line)) lastWord = words.pop();
      return new Pos(lastWord.line, lastWord.from);
    } else if (forward && wordEnd) return new Pos(lastWord.line, lastWord.to - 1);
    else if (!forward && wordEnd) {
      if (!shortCircuit && (firstWord.to != curStart.ch || firstWord.line != curStart.line)) lastWord = words.pop();
      return new Pos(lastWord.line, lastWord.to);
    } else return new Pos(lastWord.line, lastWord.from);
  }
  __name(moveToWord, "moveToWord");
  function moveToEol(cm, head, motionArgs, vim, keepHPos) {
    var retval = new Pos(head.line + motionArgs.repeat - 1, Infinity);
    var end = cm.clipPos(retval);
    end.ch--;
    if (!keepHPos) {
      vim.lastHPos = Infinity;
      vim.lastHSPos = cm.charCoords(end, "div").left;
    }
    return retval;
  }
  __name(moveToEol, "moveToEol");
  function moveToCharacter(cm, repeat, forward, character) {
    var cur = cm.getCursor();
    var start = cur.ch;
    var idx;
    for (var i = 0; i < repeat; i++) {
      var line = cm.getLine(cur.line);
      idx = charIdxInLine(start, line, character, forward, true);
      if (idx == -1) return null;
      start = idx;
    }
    return new Pos(cm.getCursor().line, idx);
  }
  __name(moveToCharacter, "moveToCharacter");
  function moveToColumn(cm, repeat) {
    var line = cm.getCursor().line;
    return clipCursorToContent(cm, new Pos(line, repeat - 1));
  }
  __name(moveToColumn, "moveToColumn");
  function updateMark(cm, vim, markName, pos) {
    if (!inArray(markName, validMarks)) return;
    if (vim.marks[markName]) vim.marks[markName].clear();
    vim.marks[markName] = cm.setBookmark(pos);
  }
  __name(updateMark, "updateMark");
  function charIdxInLine(start, line, character, forward, includeChar) {
    var idx;
    if (forward) {
      idx = line.indexOf(character, start + 1);
      if (idx != -1 && !includeChar) idx -= 1;
    } else {
      idx = line.lastIndexOf(character, start - 1);
      if (idx != -1 && !includeChar) idx += 1;
    }
    return idx;
  }
  __name(charIdxInLine, "charIdxInLine");
  function findParagraph(cm, head, repeat, dir, inclusive) {
    var line = head.line;
    var min = cm.firstLine();
    var max = cm.lastLine();
    var start, end, i = line;
    function isEmpty(i$1) {
      return !cm.getLine(i$1);
    }
    __name(isEmpty, "isEmpty");
    function isBoundary(i$1, dir$1, any) {
      if (any) return isEmpty(i$1) != isEmpty(i$1 + dir$1);
      return !isEmpty(i$1) && isEmpty(i$1 + dir$1);
    }
    __name(isBoundary, "isBoundary");
    if (dir) {
      while (min <= i && i <= max && repeat > 0) {
        if (isBoundary(i, dir)) repeat--;
        i += dir;
      }
      return new Pos(i, 0);
    }
    var vim = cm.state.vim;
    if (vim.visualLine && isBoundary(line, 1, true)) {
      var anchor = vim.sel.anchor;
      if (isBoundary(anchor.line, -1, true)) {
        if (!inclusive || anchor.line != line) line += 1;
      }
    }
    var startState = isEmpty(line);
    for (i = line; i <= max && repeat; i++) if (isBoundary(i, 1, true)) {
      if (!inclusive || isEmpty(i) != startState) repeat--;
    }
    end = new Pos(i, 0);
    if (i > max && !startState) startState = true;
    else inclusive = false;
    for (i = line; i > min; i--) if (!inclusive || isEmpty(i) == startState || i == line) {
      if (isBoundary(i, -1, true)) break;
    }
    start = new Pos(i, 0);
    return {
      start,
      end
    };
  }
  __name(findParagraph, "findParagraph");
  function findSentence(cm, cur, repeat, dir) {
    function nextChar(cm$1, idx) {
      if (idx.pos + idx.dir < 0 || idx.pos + idx.dir >= idx.line.length) {
        idx.ln += idx.dir;
        if (!isLine(cm$1, idx.ln)) {
          idx.line = null;
          idx.ln = null;
          idx.pos = null;
          return;
        }
        idx.line = cm$1.getLine(idx.ln);
        idx.pos = idx.dir > 0 ? 0 : idx.line.length - 1;
      } else idx.pos += idx.dir;
    }
    __name(nextChar, "nextChar");
    function forward(cm$1, ln, pos, dir$1) {
      var line = cm$1.getLine(ln);
      var stop = line === "";
      var curr = {
        line,
        ln,
        pos,
        dir: dir$1
      };
      var last_valid = {
        ln: curr.ln,
        pos: curr.pos
      };
      var skip_empty_lines = curr.line === "";
      nextChar(cm$1, curr);
      while (curr.line !== null) {
        last_valid.ln = curr.ln;
        last_valid.pos = curr.pos;
        if (curr.line === "" && !skip_empty_lines) return {
          ln: curr.ln,
          pos: curr.pos
        };
        else if (stop && curr.line !== "" && !isWhiteSpaceString(curr.line[curr.pos])) return {
          ln: curr.ln,
          pos: curr.pos
        };
        else if (isEndOfSentenceSymbol(curr.line[curr.pos]) && !stop && (curr.pos === curr.line.length - 1 || isWhiteSpaceString(curr.line[curr.pos + 1]))) stop = true;
        nextChar(cm$1, curr);
      }
      var line = cm$1.getLine(last_valid.ln);
      last_valid.pos = 0;
      for (var i = line.length - 1; i >= 0; --i) if (!isWhiteSpaceString(line[i])) {
        last_valid.pos = i;
        break;
      }
      return last_valid;
    }
    __name(forward, "forward");
    function reverse(cm$1, ln, pos, dir$1) {
      var line = cm$1.getLine(ln);
      var curr = {
        line,
        ln,
        pos,
        dir: dir$1
      };
      var last_valid = {
        ln: curr.ln,
        pos: null
      };
      var skip_empty_lines = curr.line === "";
      nextChar(cm$1, curr);
      while (curr.line !== null) {
        if (curr.line === "" && !skip_empty_lines) if (last_valid.pos !== null) return last_valid;
        else return {
          ln: curr.ln,
          pos: curr.pos
        };
        else if (isEndOfSentenceSymbol(curr.line[curr.pos]) && last_valid.pos !== null && !(curr.ln === last_valid.ln && curr.pos + 1 === last_valid.pos)) return last_valid;
        else if (curr.line !== "" && !isWhiteSpaceString(curr.line[curr.pos])) {
          skip_empty_lines = false;
          last_valid = {
            ln: curr.ln,
            pos: curr.pos
          };
        }
        nextChar(cm$1, curr);
      }
      var line = cm$1.getLine(last_valid.ln);
      last_valid.pos = 0;
      for (var i = 0; i < line.length; ++i) if (!isWhiteSpaceString(line[i])) {
        last_valid.pos = i;
        break;
      }
      return last_valid;
    }
    __name(reverse, "reverse");
    var curr_index = {
      ln: cur.line,
      pos: cur.ch
    };
    while (repeat > 0) {
      if (dir < 0) curr_index = reverse(cm, curr_index.ln, curr_index.pos, dir);
      else curr_index = forward(cm, curr_index.ln, curr_index.pos, dir);
      repeat--;
    }
    return new Pos(curr_index.ln, curr_index.pos);
  }
  __name(findSentence, "findSentence");
  function selectCompanionObject(cm, head, symb, inclusive) {
    var cur = head, start, end;
    var bracketRegexp = {
      "(": /[()]/,
      ")": /[()]/,
      "[": /[[\]]/,
      "]": /[[\]]/,
      "{": /[{}]/,
      "}": /[{}]/,
      "<": /[<>]/,
      ">": /[<>]/
    }[symb];
    var openSym = {
      "(": "(",
      ")": "(",
      "[": "[",
      "]": "[",
      "{": "{",
      "}": "{",
      "<": "<",
      ">": "<"
    }[symb];
    var offset = cm.getLine(cur.line).charAt(cur.ch) === openSym ? 1 : 0;
    start = cm.scanForBracket(new Pos(cur.line, cur.ch + offset), -1, void 0, { bracketRegex: bracketRegexp });
    end = cm.scanForBracket(new Pos(cur.line, cur.ch + offset), 1, void 0, { bracketRegex: bracketRegexp });
    if (!start || !end) return {
      start: cur,
      end: cur
    };
    start = start.pos;
    end = end.pos;
    if (start.line == end.line && start.ch > end.ch || start.line > end.line) {
      var tmp = start;
      start = end;
      end = tmp;
    }
    if (inclusive) end.ch += 1;
    else start.ch += 1;
    return {
      start,
      end
    };
  }
  __name(selectCompanionObject, "selectCompanionObject");
  function findBeginningAndEnd(cm, head, symb, inclusive) {
    var cur = copyCursor(head);
    var chars = cm.getLine(cur.line).split("");
    var start, end, i, len;
    var firstIndex = chars.indexOf(symb);
    if (cur.ch < firstIndex) cur.ch = firstIndex;
    else if (firstIndex < cur.ch && chars[cur.ch] == symb) {
      end = cur.ch;
      --cur.ch;
    }
    if (chars[cur.ch] == symb && !end) start = cur.ch + 1;
    else for (i = cur.ch; i > -1 && !start; i--) if (chars[i] == symb) start = i + 1;
    if (start && !end) {
      for (i = start, len = chars.length; i < len && !end; i++) if (chars[i] == symb) end = i;
    }
    if (!start || !end) return {
      start: cur,
      end: cur
    };
    if (inclusive) {
      --start;
      ++end;
    }
    return {
      start: new Pos(cur.line, start),
      end: new Pos(cur.line, end)
    };
  }
  __name(findBeginningAndEnd, "findBeginningAndEnd");
  defineOption("pcre", true, "boolean");
  function SearchState() {
  }
  __name(SearchState, "SearchState");
  SearchState.prototype = {
    getQuery: /* @__PURE__ */ __name(function() {
      return vimGlobalState.query;
    }, "getQuery"),
    setQuery: /* @__PURE__ */ __name(function(query) {
      vimGlobalState.query = query;
    }, "setQuery"),
    getOverlay: /* @__PURE__ */ __name(function() {
      return this.searchOverlay;
    }, "getOverlay"),
    setOverlay: /* @__PURE__ */ __name(function(overlay) {
      this.searchOverlay = overlay;
    }, "setOverlay"),
    isReversed: /* @__PURE__ */ __name(function() {
      return vimGlobalState.isReversed;
    }, "isReversed"),
    setReversed: /* @__PURE__ */ __name(function(reversed) {
      vimGlobalState.isReversed = reversed;
    }, "setReversed"),
    getScrollbarAnnotate: /* @__PURE__ */ __name(function() {
      return this.annotate;
    }, "getScrollbarAnnotate"),
    setScrollbarAnnotate: /* @__PURE__ */ __name(function(annotate) {
      this.annotate = annotate;
    }, "setScrollbarAnnotate")
  };
  function getSearchState(cm) {
    var vim = cm.state.vim;
    return vim.searchState_ || (vim.searchState_ = new SearchState());
  }
  __name(getSearchState, "getSearchState");
  function splitBySlash(argString) {
    return splitBySeparator(argString, "/");
  }
  __name(splitBySlash, "splitBySlash");
  function findUnescapedSlashes(argString) {
    return findUnescapedSeparators(argString, "/");
  }
  __name(findUnescapedSlashes, "findUnescapedSlashes");
  function splitBySeparator(argString, separator) {
    var slashes = findUnescapedSeparators(argString, separator) || [];
    if (!slashes.length) return [];
    var tokens = [];
    if (slashes[0] !== 0) return;
    for (var i = 0; i < slashes.length; i++) if (typeof slashes[i] == "number") tokens.push(argString.substring(slashes[i] + 1, slashes[i + 1]));
    return tokens;
  }
  __name(splitBySeparator, "splitBySeparator");
  function findUnescapedSeparators(str, separator) {
    if (!separator) separator = "/";
    var escapeNextChar = false;
    var slashes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (!escapeNextChar && c == separator) slashes.push(i);
      escapeNextChar = !escapeNextChar && c == "\\";
    }
    return slashes;
  }
  __name(findUnescapedSeparators, "findUnescapedSeparators");
  function translateRegex(str) {
    var specials = "|(){";
    var unescape = "}";
    var escapeNextChar = false;
    var out = [];
    for (var i = -1; i < str.length; i++) {
      var c = str.charAt(i) || "";
      var n = str.charAt(i + 1) || "";
      var specialComesNext = n && specials.indexOf(n) != -1;
      if (escapeNextChar) {
        if (c !== "\\" || !specialComesNext) out.push(c);
        escapeNextChar = false;
      } else if (c === "\\") {
        escapeNextChar = true;
        if (n && unescape.indexOf(n) != -1) specialComesNext = true;
        if (!specialComesNext || n === "\\") out.push(c);
      } else {
        out.push(c);
        if (specialComesNext && n !== "\\") out.push("\\");
      }
    }
    return out.join("");
  }
  __name(translateRegex, "translateRegex");
  var charUnescapes = {
    "\\n": "\n",
    "\\r": "\r",
    "\\t": "	"
  };
  function translateRegexReplace(str) {
    var escapeNextChar = false;
    var out = [];
    for (var i = -1; i < str.length; i++) {
      var c = str.charAt(i) || "";
      var n = str.charAt(i + 1) || "";
      if (charUnescapes[c + n]) {
        out.push(charUnescapes[c + n]);
        i++;
      } else if (escapeNextChar) {
        out.push(c);
        escapeNextChar = false;
      } else if (c === "\\") {
        escapeNextChar = true;
        if (isNumber(n) || n === "$") out.push("$");
        else if (n !== "/" && n !== "\\") out.push("\\");
      } else {
        if (c === "$") out.push("$");
        out.push(c);
        if (n === "/") out.push("\\");
      }
    }
    return out.join("");
  }
  __name(translateRegexReplace, "translateRegexReplace");
  var unescapes = {
    "\\/": "/",
    "\\\\": "\\",
    "\\n": "\n",
    "\\r": "\r",
    "\\t": "	",
    "\\&": "&"
  };
  function unescapeRegexReplace(str) {
    var stream = new cm_adapter_default.StringStream(str);
    var output = [];
    while (!stream.eol()) {
      while (stream.peek() && stream.peek() != "\\") output.push(stream.next());
      var matched = false;
      for (var matcher in unescapes) if (stream.match(matcher, true)) {
        matched = true;
        output.push(unescapes[matcher]);
        break;
      }
      if (!matched) output.push(stream.next());
    }
    return output.join("");
  }
  __name(unescapeRegexReplace, "unescapeRegexReplace");
  function parseQuery(query, ignoreCase, smartCase) {
    vimGlobalState.registerController.getRegister("/").setText(query);
    if (query instanceof RegExp) return query;
    var slashes = findUnescapedSlashes(query);
    var regexPart;
    var forceIgnoreCase;
    if (!slashes.length) regexPart = query;
    else {
      regexPart = query.substring(0, slashes[0]);
      forceIgnoreCase = query.substring(slashes[0]).indexOf("i") != -1;
    }
    if (!regexPart) return null;
    if (!getOption("pcre")) regexPart = translateRegex(regexPart);
    if (smartCase) ignoreCase = /^[^A-Z]*$/.test(regexPart);
    return new RegExp(regexPart, ignoreCase || forceIgnoreCase ? "im" : "m");
  }
  __name(parseQuery, "parseQuery");
  function dom(n) {
    if (typeof n === "string") n = document.createElement(n);
    for (var a, i = 1; i < arguments.length; i++) {
      if (!(a = arguments[i])) continue;
      if (typeof a !== "object") a = document.createTextNode(a);
      if (a.nodeType) n.appendChild(a);
      else for (var key in a) {
        if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
        if (key[0] === "$") n.style[key.slice(1)] = a[key];
        else n.setAttribute(key, a[key]);
      }
    }
    return n;
  }
  __name(dom, "dom");
  function showConfirm(cm, template) {
    var pre = dom("pre", {
      $color: "red",
      class: "cm-vim-message"
    }, template);
    if (cm.openNotification) cm.openNotification(pre, {
      bottom: true,
      duration: 5e3
    });
    else alert(pre.innerText);
  }
  __name(showConfirm, "showConfirm");
  function makePrompt(prefix, desc) {
    return dom(document.createDocumentFragment(), dom("span", {
      $fontFamily: "monospace",
      $whiteSpace: "pre"
    }, prefix, dom("input", {
      type: "text",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false"
    })), desc && dom("span", { $color: "#888" }, desc));
  }
  __name(makePrompt, "makePrompt");
  function showPrompt(cm, options$1) {
    var template = makePrompt(options$1.prefix, options$1.desc);
    if (cm.openDialog) cm.openDialog(template, options$1.onClose, {
      onKeyDown: options$1.onKeyDown,
      onKeyUp: options$1.onKeyUp,
      bottom: true,
      selectValueOnOpen: false,
      value: options$1.value
    });
    else {
      var shortText = "";
      if (typeof options$1.prefix != "string" && options$1.prefix) shortText += options$1.prefix.textContent;
      if (options$1.desc) shortText += " " + options$1.desc;
      options$1.onClose(prompt(shortText, ""));
    }
  }
  __name(showPrompt, "showPrompt");
  function regexEqual(r1, r2) {
    if (r1 instanceof RegExp && r2 instanceof RegExp) {
      var props = [
        "global",
        "multiline",
        "ignoreCase",
        "source"
      ];
      for (var i = 0; i < props.length; i++) {
        var prop = props[i];
        if (r1[prop] !== r2[prop]) return false;
      }
      return true;
    }
    return false;
  }
  __name(regexEqual, "regexEqual");
  function updateSearchQuery(cm, rawQuery, ignoreCase, smartCase) {
    if (!rawQuery) return;
    var state = getSearchState(cm);
    var query = parseQuery(rawQuery, !!ignoreCase, !!smartCase);
    if (!query) return;
    highlightSearchMatches(cm, query);
    if (regexEqual(query, state.getQuery())) return query;
    state.setQuery(query);
    return query;
  }
  __name(updateSearchQuery, "updateSearchQuery");
  function searchOverlay(query) {
    if (query.source.charAt(0) == "^") var matchSol = true;
    return {
      token: /* @__PURE__ */ __name(function(stream) {
        if (matchSol && !stream.sol()) {
          stream.skipToEnd();
          return;
        }
        var match = stream.match(query, false);
        if (match) {
          if (match[0].length == 0) {
            stream.next();
            return "searching";
          }
          if (!stream.sol()) {
            stream.backUp(1);
            if (!query.exec(stream.next() + match[0])) {
              stream.next();
              return null;
            }
          }
          stream.match(query);
          return "searching";
        }
        while (!stream.eol()) {
          stream.next();
          if (stream.match(query, false)) break;
        }
      }, "token"),
      query
    };
  }
  __name(searchOverlay, "searchOverlay");
  var highlightTimeout = 0;
  function highlightSearchMatches(cm, query) {
    clearTimeout(highlightTimeout);
    highlightTimeout = setTimeout(function() {
      if (!cm.state.vim) return;
      var searchState = getSearchState(cm);
      var overlay = searchState.getOverlay();
      if (!overlay || query != overlay.query) {
        if (overlay) cm.removeOverlay(overlay);
        overlay = searchOverlay(query);
        cm.addOverlay(overlay);
        if (cm.showMatchesOnScrollbar) {
          if (searchState.getScrollbarAnnotate()) searchState.getScrollbarAnnotate().clear();
          searchState.setScrollbarAnnotate(cm.showMatchesOnScrollbar(query));
        }
        searchState.setOverlay(overlay);
      }
    }, 50);
  }
  __name(highlightSearchMatches, "highlightSearchMatches");
  function findNext(cm, prev, query, repeat) {
    if (repeat === void 0) repeat = 1;
    return cm.operation(function() {
      var pos = cm.getCursor();
      var cursor = cm.getSearchCursor(query, pos);
      for (var i = 0; i < repeat; i++) {
        var found = cursor.find(prev);
        if (i == 0 && found && cursorEqual(cursor.from(), pos)) {
          var lastEndPos = prev ? cursor.from() : cursor.to();
          found = cursor.find(prev);
          if (found && !found[0] && cursorEqual(cursor.from(), lastEndPos)) {
            if (cm.getLine(lastEndPos.line).length == lastEndPos.ch) found = cursor.find(prev);
          }
        }
        if (!found) {
          cursor = cm.getSearchCursor(query, prev ? new Pos(cm.lastLine()) : new Pos(cm.firstLine(), 0));
          if (!cursor.find(prev)) return;
        }
      }
      return cursor.from();
    });
  }
  __name(findNext, "findNext");
  function findNextFromAndToInclusive(cm, prev, query, repeat, vim) {
    if (repeat === void 0) repeat = 1;
    return cm.operation(function() {
      var pos = cm.getCursor();
      var cursor = cm.getSearchCursor(query, pos);
      var found = cursor.find(!prev);
      if (!vim.visualMode && found && cursorEqual(cursor.from(), pos)) cursor.find(!prev);
      for (var i = 0; i < repeat; i++) {
        found = cursor.find(prev);
        if (!found) {
          cursor = cm.getSearchCursor(query, prev ? new Pos(cm.lastLine()) : new Pos(cm.firstLine(), 0));
          if (!cursor.find(prev)) return;
        }
      }
      return [cursor.from(), cursor.to()];
    });
  }
  __name(findNextFromAndToInclusive, "findNextFromAndToInclusive");
  function clearSearchHighlight(cm) {
    var state = getSearchState(cm);
    cm.removeOverlay(getSearchState(cm).getOverlay());
    state.setOverlay(null);
    if (state.getScrollbarAnnotate()) {
      state.getScrollbarAnnotate().clear();
      state.setScrollbarAnnotate(null);
    }
  }
  __name(clearSearchHighlight, "clearSearchHighlight");
  function isInRange(pos, start, end) {
    if (typeof pos != "number") pos = pos.line;
    if (start instanceof Array) return inArray(pos, start);
    else if (typeof end == "number") return pos >= start && pos <= end;
    else return pos == start;
  }
  __name(isInRange, "isInRange");
  function getUserVisibleLines(cm) {
    var scrollInfo = cm.getScrollInfo();
    var occludeToleranceTop = 6;
    var occludeToleranceBottom = 10;
    var from = cm.coordsChar({
      left: 0,
      top: occludeToleranceTop + scrollInfo.top
    }, "local");
    var bottomY = scrollInfo.clientHeight - occludeToleranceBottom + scrollInfo.top;
    var to = cm.coordsChar({
      left: 0,
      top: bottomY
    }, "local");
    return {
      top: from.line,
      bottom: to.line
    };
  }
  __name(getUserVisibleLines, "getUserVisibleLines");
  function getMarkPos(cm, vim, markName) {
    if (markName == "'" || markName == "`") return vimGlobalState.jumpList.find(cm, -1) || new Pos(0, 0);
    else if (markName == ".") return getLastEditPos(cm);
    var mark = vim.marks[markName];
    return mark && mark.find();
  }
  __name(getMarkPos, "getMarkPos");
  function getLastEditPos(cm) {
    var done = cm.doc.history.done;
    for (var i = done.length; i--; ) if (done[i].changes) return copyCursor(done[i].changes[0].to);
  }
  __name(getLastEditPos, "getLastEditPos");
  var ExCommandDispatcher = /* @__PURE__ */ __name(function() {
    this.buildCommandMap_();
  }, "ExCommandDispatcher");
  ExCommandDispatcher.prototype = {
    processCommand: /* @__PURE__ */ __name(function(cm, input, opt_params) {
      var that = this;
      cm.operation(function() {
        cm.curOp.isVimOp = true;
        that._processCommand(cm, input, opt_params);
      });
    }, "processCommand"),
    _processCommand: /* @__PURE__ */ __name(function(cm, input, opt_params) {
      var vim = cm.state.vim;
      var commandHistoryRegister = vimGlobalState.registerController.getRegister(":");
      var previousCommand = commandHistoryRegister.toString();
      if (vim.visualMode) exitVisualMode(cm);
      var inputStream = new cm_adapter_default.StringStream(input);
      commandHistoryRegister.setText(input);
      var params = opt_params || {};
      params.input = input;
      try {
        this.parseInput_(cm, inputStream, params);
      } catch (e) {
        showConfirm(cm, e.toString());
        throw e;
      }
      var command;
      var commandName;
      if (!params.commandName) {
        if (params.line !== void 0) commandName = "move";
      } else {
        command = this.matchCommand_(params.commandName);
        if (command) {
          commandName = command.name;
          if (command.excludeFromCommandHistory) commandHistoryRegister.setText(previousCommand);
          this.parseCommandArgs_(inputStream, params, command);
          if (command.type == "exToKey") {
            for (var i = 0; i < command.toKeys.length; i++) vimApi.handleKey(cm, command.toKeys[i], "mapping");
            return;
          } else if (command.type == "exToEx") {
            this.processCommand(cm, command.toInput);
            return;
          }
        }
      }
      if (!commandName) {
        showConfirm(cm, 'Not an editor command ":' + input + '"');
        return;
      }
      try {
        exCommands[commandName](cm, params);
        if ((!command || !command.possiblyAsync) && params.callback) params.callback();
      } catch (e) {
        showConfirm(cm, e.toString());
        throw e;
      }
    }, "_processCommand"),
    parseInput_: /* @__PURE__ */ __name(function(cm, inputStream, result) {
      inputStream.eatWhile(":");
      if (inputStream.eat("%")) {
        result.line = cm.firstLine();
        result.lineEnd = cm.lastLine();
      } else {
        result.line = this.parseLineSpec_(cm, inputStream);
        if (result.line !== void 0 && inputStream.eat(",")) result.lineEnd = this.parseLineSpec_(cm, inputStream);
      }
      var commandMatch$1 = inputStream.match(/^(\w+|!!|@@|[!#&*<=>@~])/);
      if (commandMatch$1) result.commandName = commandMatch$1[1];
      else result.commandName = inputStream.match(/.*/)[0];
      return result;
    }, "parseInput_"),
    parseLineSpec_: /* @__PURE__ */ __name(function(cm, inputStream) {
      var numberMatch = inputStream.match(/^(\d+)/);
      if (numberMatch) return parseInt(numberMatch[1], 10) - 1;
      switch (inputStream.next()) {
        case ".":
          return this.parseLineSpecOffset_(inputStream, cm.getCursor().line);
        case "$":
          return this.parseLineSpecOffset_(inputStream, cm.lastLine());
        case "'":
          var markName = inputStream.next();
          var markPos = getMarkPos(cm, cm.state.vim, markName);
          if (!markPos) throw new Error("Mark not set");
          return this.parseLineSpecOffset_(inputStream, markPos.line);
        case "-":
        case "+":
          inputStream.backUp(1);
          return this.parseLineSpecOffset_(inputStream, cm.getCursor().line);
        default:
          inputStream.backUp(1);
          return;
      }
    }, "parseLineSpec_"),
    parseLineSpecOffset_: /* @__PURE__ */ __name(function(inputStream, line) {
      var offsetMatch = inputStream.match(/^([+-])?(\d+)/);
      if (offsetMatch) {
        var offset = parseInt(offsetMatch[2], 10);
        if (offsetMatch[1] == "-") line -= offset;
        else line += offset;
      }
      return line;
    }, "parseLineSpecOffset_"),
    parseCommandArgs_: /* @__PURE__ */ __name(function(inputStream, params, command) {
      if (inputStream.eol()) return;
      params.argString = inputStream.match(/.*/)[0];
      var delim = command.argDelimiter || /\s+/;
      var args = trim(params.argString).split(delim);
      if (args.length && args[0]) params.args = args;
    }, "parseCommandArgs_"),
    matchCommand_: /* @__PURE__ */ __name(function(commandName) {
      for (var i = commandName.length; i > 0; i--) {
        var prefix = commandName.substring(0, i);
        if (this.commandMap_[prefix]) {
          var command = this.commandMap_[prefix];
          if (command.name.indexOf(commandName) === 0) return command;
        }
      }
      return null;
    }, "matchCommand_"),
    buildCommandMap_: /* @__PURE__ */ __name(function() {
      this.commandMap_ = {};
      for (var i = 0; i < defaultExCommandMap.length; i++) {
        var command = defaultExCommandMap[i];
        var key = command.shortName || command.name;
        this.commandMap_[key] = command;
      }
    }, "buildCommandMap_"),
    map: /* @__PURE__ */ __name(function(lhs, rhs, ctx) {
      if (lhs != ":" && lhs.charAt(0) == ":") {
        if (ctx) throw Error("Mode not supported for ex mappings");
        var commandName = lhs.substring(1);
        if (rhs != ":" && rhs.charAt(0) == ":") this.commandMap_[commandName] = {
          name: commandName,
          type: "exToEx",
          toInput: rhs.substring(1),
          user: true
        };
        else this.commandMap_[commandName] = {
          name: commandName,
          type: "exToKey",
          toKeys: rhs,
          user: true
        };
      } else if (rhs != ":" && rhs.charAt(0) == ":") {
        var mapping = {
          keys: lhs,
          type: "keyToEx",
          exArgs: { input: rhs.substring(1) }
        };
        if (ctx) mapping.context = ctx;
        defaultKeymap.unshift(mapping);
      } else {
        var mapping = {
          keys: lhs,
          type: "keyToKey",
          toKeys: rhs
        };
        if (ctx) mapping.context = ctx;
        defaultKeymap.unshift(mapping);
      }
    }, "map"),
    unmap: /* @__PURE__ */ __name(function(lhs, ctx) {
      if (lhs != ":" && lhs.charAt(0) == ":") {
        if (ctx) throw Error("Mode not supported for ex mappings");
        var commandName = lhs.substring(1);
        if (this.commandMap_[commandName] && this.commandMap_[commandName].user) {
          delete this.commandMap_[commandName];
          return true;
        }
      } else {
        var keys = lhs;
        for (var i = 0; i < defaultKeymap.length; i++) if (keys == defaultKeymap[i].keys && defaultKeymap[i].context === ctx) {
          defaultKeymap.splice(i, 1);
          return true;
        }
      }
    }, "unmap")
  };
  var exCommands = {
    colorscheme: /* @__PURE__ */ __name(function(cm, params) {
      if (!params.args || params.args.length < 1) {
        showConfirm(cm, cm.getOption("theme"));
        return;
      }
      cm.setOption("theme", params.args[0]);
    }, "colorscheme"),
    map: /* @__PURE__ */ __name(function(cm, params, ctx) {
      var mapArgs = params.args;
      if (!mapArgs || mapArgs.length < 2) {
        if (cm) showConfirm(cm, "Invalid mapping: " + params.input);
        return;
      }
      exCommandDispatcher.map(mapArgs[0], mapArgs[1], ctx);
    }, "map"),
    imap: /* @__PURE__ */ __name(function(cm, params) {
      this.map(cm, params, "insert");
    }, "imap"),
    nmap: /* @__PURE__ */ __name(function(cm, params) {
      this.map(cm, params, "normal");
    }, "nmap"),
    vmap: /* @__PURE__ */ __name(function(cm, params) {
      this.map(cm, params, "visual");
    }, "vmap"),
    unmap: /* @__PURE__ */ __name(function(cm, params, ctx) {
      var mapArgs = params.args;
      if (!mapArgs || mapArgs.length < 1 || !exCommandDispatcher.unmap(mapArgs[0], ctx)) {
        if (cm) showConfirm(cm, "No such mapping: " + params.input);
      }
    }, "unmap"),
    move: /* @__PURE__ */ __name(function(cm, params) {
      commandDispatcher.processCommand(cm, cm.state.vim, {
        type: "motion",
        motion: "moveToLineOrEdgeOfDocument",
        motionArgs: {
          forward: false,
          explicitRepeat: true,
          linewise: true
        },
        repeatOverride: params.line + 1
      });
    }, "move"),
    set: /* @__PURE__ */ __name(function(cm, params) {
      var setArgs = params.args;
      var setCfg = params.setCfg || {};
      if (!setArgs || setArgs.length < 1) {
        if (cm) showConfirm(cm, "Invalid mapping: " + params.input);
        return;
      }
      var expr = setArgs[0].split("=");
      var optionName = expr[0];
      var value = expr[1];
      var forceGet = false;
      if (optionName.charAt(optionName.length - 1) == "?") {
        if (value) throw Error("Trailing characters: " + params.argString);
        optionName = optionName.substring(0, optionName.length - 1);
        forceGet = true;
      }
      if (value === void 0 && optionName.substring(0, 2) == "no") {
        optionName = optionName.substring(2);
        value = false;
      }
      var optionIsBoolean = options[optionName] && options[optionName].type == "boolean";
      if (optionIsBoolean && value == void 0) value = true;
      if (!optionIsBoolean && value === void 0 || forceGet) {
        var oldValue = getOption(optionName, cm, setCfg);
        if (oldValue instanceof Error) showConfirm(cm, oldValue.message);
        else if (oldValue === true || oldValue === false) showConfirm(cm, " " + (oldValue ? "" : "no") + optionName);
        else showConfirm(cm, "  " + optionName + "=" + oldValue);
      } else {
        var setOptionReturn = setOption(optionName, value, cm, setCfg);
        if (setOptionReturn instanceof Error) showConfirm(cm, setOptionReturn.message);
      }
    }, "set"),
    setlocal: /* @__PURE__ */ __name(function(cm, params) {
      params.setCfg = { scope: "local" };
      this.set(cm, params);
    }, "setlocal"),
    setglobal: /* @__PURE__ */ __name(function(cm, params) {
      params.setCfg = { scope: "global" };
      this.set(cm, params);
    }, "setglobal"),
    registers: /* @__PURE__ */ __name(function(cm, params) {
      var regArgs = params.args;
      var registers = vimGlobalState.registerController.registers;
      var regInfo = "----------Registers----------\n\n";
      if (!regArgs) for (var registerName in registers) {
        var text = registers[registerName].toString();
        if (text.length) regInfo += '"' + registerName + "    " + text + "\n";
      }
      else {
        var registerName;
        regArgs = regArgs.join("");
        for (var i = 0; i < regArgs.length; i++) {
          registerName = regArgs.charAt(i);
          if (!vimGlobalState.registerController.isValidRegister(registerName)) continue;
          var register = registers[registerName] || new Register();
          regInfo += '"' + registerName + "    " + register.toString() + "\n";
        }
      }
      showConfirm(cm, regInfo);
    }, "registers"),
    sort: /* @__PURE__ */ __name(function(cm, params) {
      var reverse, ignoreCase, unique, number, pattern;
      function parseArgs() {
        if (params.argString) {
          var args = new cm_adapter_default.StringStream(params.argString);
          if (args.eat("!")) reverse = true;
          if (args.eol()) return;
          if (!args.eatSpace()) return "Invalid arguments";
          var opts = args.match(/([dinuox]+)?\s*(\/.+\/)?\s*/);
          if (!opts && !args.eol()) return "Invalid arguments";
          if (opts[1]) {
            ignoreCase = opts[1].indexOf("i") != -1;
            unique = opts[1].indexOf("u") != -1;
            var decimal = opts[1].indexOf("d") != -1 || opts[1].indexOf("n") != -1 && 1;
            var hex = opts[1].indexOf("x") != -1 && 1;
            var octal = opts[1].indexOf("o") != -1 && 1;
            if (decimal + hex + octal > 1) return "Invalid arguments";
            number = decimal && "decimal" || hex && "hex" || octal && "octal";
          }
          if (opts[2]) pattern = new RegExp(opts[2].substr(1, opts[2].length - 2), ignoreCase ? "i" : "");
        }
      }
      __name(parseArgs, "parseArgs");
      var err = parseArgs();
      if (err) {
        showConfirm(cm, err + ": " + params.argString);
        return;
      }
      var lineStart = params.line || cm.firstLine();
      var lineEnd = params.lineEnd || params.line || cm.lastLine();
      if (lineStart == lineEnd) return;
      var curStart = new Pos(lineStart, 0);
      var curEnd = new Pos(lineEnd, lineLength(cm, lineEnd));
      var text = cm.getRange(curStart, curEnd).split("\n");
      var numberRegex$1 = pattern ? pattern : number == "decimal" ? /(-?)([\d]+)/ : number == "hex" ? /(-?)(?:0x)?([0-9a-f]+)/i : number == "octal" ? /([0-7]+)/ : null;
      var radix = number == "decimal" ? 10 : number == "hex" ? 16 : number == "octal" ? 8 : null;
      var numPart = [], textPart = [];
      if (number || pattern) for (var i = 0; i < text.length; i++) {
        var matchPart = pattern ? text[i].match(pattern) : null;
        if (matchPart && matchPart[0] != "") numPart.push(matchPart);
        else if (!pattern && numberRegex$1.exec(text[i])) numPart.push(text[i]);
        else textPart.push(text[i]);
      }
      else textPart = text;
      function compareFn(a, b) {
        if (reverse) {
          var tmp = a;
          a = b;
          b = tmp;
        }
        if (ignoreCase) {
          a = a.toLowerCase();
          b = b.toLowerCase();
        }
        var anum = number && numberRegex$1.exec(a);
        var bnum = number && numberRegex$1.exec(b);
        if (!anum) return a < b ? -1 : 1;
        anum = parseInt((anum[1] + anum[2]).toLowerCase(), radix);
        bnum = parseInt((bnum[1] + bnum[2]).toLowerCase(), radix);
        return anum - bnum;
      }
      __name(compareFn, "compareFn");
      function comparePatternFn(a, b) {
        if (reverse) {
          var tmp = a;
          a = b;
          b = tmp;
        }
        if (ignoreCase) {
          a[0] = a[0].toLowerCase();
          b[0] = b[0].toLowerCase();
        }
        return a[0] < b[0] ? -1 : 1;
      }
      __name(comparePatternFn, "comparePatternFn");
      numPart.sort(pattern ? comparePatternFn : compareFn);
      if (pattern) for (var i = 0; i < numPart.length; i++) numPart[i] = numPart[i].input;
      else if (!number) textPart.sort(compareFn);
      text = !reverse ? textPart.concat(numPart) : numPart.concat(textPart);
      if (unique) {
        var textOld = text;
        var lastLine;
        text = [];
        for (var i = 0; i < textOld.length; i++) {
          if (textOld[i] != lastLine) text.push(textOld[i]);
          lastLine = textOld[i];
        }
      }
      cm.replaceRange(text.join("\n"), curStart, curEnd);
    }, "sort"),
    vglobal: /* @__PURE__ */ __name(function(cm, params) {
      this.global(cm, params);
    }, "vglobal"),
    global: /* @__PURE__ */ __name(function(cm, params) {
      var argString = params.argString;
      if (!argString) {
        showConfirm(cm, "Regular Expression missing from global");
        return;
      }
      var inverted = params.commandName[0] === "v";
      var lineStart = params.line !== void 0 ? params.line : cm.firstLine();
      var lineEnd = params.lineEnd || params.line || cm.lastLine();
      var tokens = splitBySlash(argString);
      var regexPart = argString, cmd;
      if (tokens.length) {
        regexPart = tokens[0];
        cmd = tokens.slice(1, tokens.length).join("/");
      }
      if (regexPart) try {
        updateSearchQuery(cm, regexPart, true, true);
      } catch (e) {
        showConfirm(cm, "Invalid regex: " + regexPart);
        return;
      }
      var query = getSearchState(cm).getQuery();
      var matchedLines = [];
      for (var i = lineStart; i <= lineEnd; i++) {
        var line = cm.getLineHandle(i);
        if (query.test(line.text) !== inverted) matchedLines.push(cmd ? line : line.text);
      }
      if (!cmd) {
        showConfirm(cm, matchedLines.join("\n"));
        return;
      }
      var index = 0;
      var nextCommand = /* @__PURE__ */ __name(function() {
        if (index < matchedLines.length) {
          var line$1 = matchedLines[index++];
          var lineNum = cm.getLineNumber(line$1);
          if (lineNum == null) {
            nextCommand();
            return;
          }
          var command = lineNum + 1 + cmd;
          exCommandDispatcher.processCommand(cm, command, { callback: nextCommand });
        }
      }, "nextCommand");
      nextCommand();
    }, "global"),
    substitute: /* @__PURE__ */ __name(function(cm, params) {
      if (!cm.getSearchCursor) throw new Error("Search feature not available. Requires searchcursor.js or any other getSearchCursor implementation.");
      var argString = params.argString;
      var tokens = argString ? splitBySeparator(argString, argString[0]) : [];
      var regexPart, replacePart = "", trailing, flagsPart, count;
      var confirm = false;
      var global = false;
      if (tokens.length) {
        regexPart = tokens[0];
        if (getOption("pcre") && regexPart !== "") regexPart = new RegExp(regexPart).source;
        replacePart = tokens[1];
        if (replacePart !== void 0) {
          if (getOption("pcre")) replacePart = unescapeRegexReplace(replacePart.replace(/([^\\])&/g, "$1$$&"));
          else replacePart = translateRegexReplace(replacePart);
          vimGlobalState.lastSubstituteReplacePart = replacePart;
        }
        trailing = tokens[2] ? tokens[2].split(" ") : [];
      } else if (argString && argString.length) {
        showConfirm(cm, "Substitutions should be of the form :s/pattern/replace/");
        return;
      }
      if (trailing) {
        flagsPart = trailing[0];
        count = parseInt(trailing[1]);
        if (flagsPart) {
          if (flagsPart.indexOf("c") != -1) confirm = true;
          if (flagsPart.indexOf("g") != -1) global = true;
          if (getOption("pcre")) regexPart = regexPart + "/" + flagsPart;
          else regexPart = regexPart.replace(/\//g, "\\/") + "/" + flagsPart;
        }
      }
      if (regexPart) try {
        updateSearchQuery(cm, regexPart, true, true);
      } catch (e) {
        showConfirm(cm, "Invalid regex: " + regexPart);
        return;
      }
      replacePart = replacePart || vimGlobalState.lastSubstituteReplacePart;
      if (replacePart === void 0) {
        showConfirm(cm, "No previous substitute regular expression");
        return;
      }
      var query = getSearchState(cm).getQuery();
      var lineStart = params.line !== void 0 ? params.line : cm.getCursor().line;
      var lineEnd = params.lineEnd || lineStart;
      if (lineStart == cm.firstLine() && lineEnd == cm.lastLine()) lineEnd = Infinity;
      if (count) {
        lineStart = lineEnd;
        lineEnd = lineStart + count - 1;
      }
      var startPos = clipCursorToContent(cm, new Pos(lineStart, 0));
      var cursor = cm.getSearchCursor(query, startPos);
      cm.pushUndoStop();
      doReplace(cm, confirm, global, lineStart, lineEnd, cursor, query, replacePart, params.callback);
    }, "substitute"),
    redo: cm_adapter_default.commands.redo,
    undo: cm_adapter_default.commands.undo,
    write: /* @__PURE__ */ __name(function(cm) {
      if (cm_adapter_default.commands.save) cm_adapter_default.commands.save(cm);
      else if (cm.save) cm.save();
    }, "write"),
    nohlsearch: /* @__PURE__ */ __name(function(cm) {
      clearSearchHighlight(cm);
    }, "nohlsearch"),
    yank: /* @__PURE__ */ __name(function(cm) {
      var line = copyCursor(cm.getCursor()).line;
      var lineText = cm.getLine(line);
      vimGlobalState.registerController.pushText("0", "yank", lineText, true, true);
    }, "yank"),
    delmarks: /* @__PURE__ */ __name(function(cm, params) {
      if (!params.argString || !trim(params.argString)) {
        showConfirm(cm, "Argument required");
        return;
      }
      var state = cm.state.vim;
      var stream = new cm_adapter_default.StringStream(trim(params.argString));
      while (!stream.eol()) {
        stream.eatSpace();
        var count = stream.pos;
        if (!stream.match(/[a-zA-Z]/, false)) {
          showConfirm(cm, "Invalid argument: " + params.argString.substring(count));
          return;
        }
        var sym = stream.next();
        if (stream.match("-", true)) {
          if (!stream.match(/[a-zA-Z]/, false)) {
            showConfirm(cm, "Invalid argument: " + params.argString.substring(count));
            return;
          }
          var startMark = sym;
          var finishMark = stream.next();
          if (isLowerCase(startMark) && isLowerCase(finishMark) || isUpperCase(startMark) && isUpperCase(finishMark)) {
            var start = startMark.charCodeAt(0);
            var finish = finishMark.charCodeAt(0);
            if (start >= finish) {
              showConfirm(cm, "Invalid argument: " + params.argString.substring(count));
              return;
            }
            for (var j = 0; j <= finish - start; j++) {
              var mark = String.fromCharCode(start + j);
              delete state.marks[mark];
            }
          } else {
            showConfirm(cm, "Invalid argument: " + startMark + "-");
            return;
          }
        } else delete state.marks[sym];
      }
    }, "delmarks")
  };
  var exCommandDispatcher = new ExCommandDispatcher();
  function doReplace(cm, confirm, global, lineStart, lineEnd, searchCursor, query, replaceWith, callback) {
    cm.state.vim.exMode = true;
    var done = false;
    var lastPos, modifiedLineNumber, joined;
    function replaceAll() {
      cm.operation(function() {
        while (!done) {
          replace();
          next();
        }
        stop();
      });
    }
    __name(replaceAll, "replaceAll");
    function replace() {
      var newText = cm.getRange(searchCursor.from(), searchCursor.to()).replace(query, replaceWith);
      var unmodifiedLineNumber = searchCursor.to().line;
      searchCursor.replace(newText);
      modifiedLineNumber = searchCursor.to().line;
      lineEnd += modifiedLineNumber - unmodifiedLineNumber;
      joined = modifiedLineNumber < unmodifiedLineNumber;
    }
    __name(replace, "replace");
    function findNextValidMatch() {
      var lastMatchTo = lastPos && copyCursor(searchCursor.to());
      var match = searchCursor.findNext();
      if (match && !match[0] && lastMatchTo && cursorEqual(searchCursor.from(), lastMatchTo)) match = searchCursor.findNext();
      return match;
    }
    __name(findNextValidMatch, "findNextValidMatch");
    function next() {
      while (findNextValidMatch() && isInRange(searchCursor.from(), lineStart, lineEnd)) {
        if (!global && searchCursor.from().line == modifiedLineNumber && !joined) continue;
        cm.scrollIntoView(searchCursor.from(), 30);
        cm.setSelection(searchCursor.from(), searchCursor.to());
        lastPos = searchCursor.from();
        done = false;
        return;
      }
      done = true;
    }
    __name(next, "next");
    function stop(close) {
      if (close) close();
      cm.focus();
      if (lastPos) {
        cm.setCursor(lastPos);
        var vim = cm.state.vim;
        vim.exMode = false;
        vim.lastHPos = vim.lastHSPos = lastPos.ch;
      }
      if (callback) callback();
    }
    __name(stop, "stop");
    function onPromptKeyDown(e, _value, close) {
      cm_adapter_default.e_stop(e);
      switch (cm_adapter_default.keyName(e)) {
        case "Y":
          replace();
          next();
          break;
        case "N":
          next();
          break;
        case "A":
          var savedCallback = callback;
          callback = void 0;
          cm.operation(replaceAll);
          callback = savedCallback;
          break;
        case "L":
          replace();
        case "Q":
        case "Esc":
        case "Ctrl-C":
        case "Ctrl-[":
          stop(close);
          break;
      }
      if (done) stop(close);
      return true;
    }
    __name(onPromptKeyDown, "onPromptKeyDown");
    next();
    if (done) {
      showConfirm(cm, "No matches for " + query.source);
      return;
    }
    if (!confirm) {
      replaceAll();
      if (callback) callback();
      return;
    }
    showPrompt(cm, {
      prefix: dom("span", "replace with ", dom("strong", replaceWith), " (y/n/a/q/l)"),
      onKeyDown: onPromptKeyDown
    });
  }
  __name(doReplace, "doReplace");
  cm_adapter_default.keyMap.vim = {
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey
  };
  function exitInsertMode(cm) {
    var vim = cm.state.vim;
    var macroModeState = vimGlobalState.macroModeState;
    var insertModeChangeRegister = vimGlobalState.registerController.getRegister(".");
    var isPlaying = macroModeState.isPlaying;
    var lastChange = macroModeState.lastInsertModeChanges;
    if (!isPlaying) {
      cm.off("change", onChange);
      cm_adapter_default.off(cm.getInputField(), "keydown", onKeyEventTargetKeyDown);
    }
    if (!isPlaying && vim.insertModeRepeat > 1) {
      repeatLastEdit(cm, vim, vim.insertModeRepeat - 1, true);
      vim.lastEditInputState.repeatOverride = vim.insertModeRepeat;
    }
    delete vim.insertModeRepeat;
    vim.insertMode = false;
    cm.setCursor(cm.getCursor().line, cm.getCursor().ch - 1);
    cm.setOption("keyMap", "vim");
    cm.setOption("disableInput", true);
    cm.toggleOverwrite(false);
    insertModeChangeRegister.setText(lastChange.changes.join(""));
    cm_adapter_default.signal(cm, "vim-mode-change", { mode: "normal" });
    if (macroModeState.isRecording) logInsertModeChange(macroModeState);
    cm.enterVimMode();
  }
  __name(exitInsertMode, "exitInsertMode");
  function _mapCommand(command) {
    defaultKeymap.unshift(command);
  }
  __name(_mapCommand, "_mapCommand");
  function mapCommand(keys, type, name, args, extra) {
    var command = {
      keys,
      type
    };
    command[type] = name;
    command[type + "Args"] = args;
    for (var key in extra) command[key] = extra[key];
    _mapCommand(command);
  }
  __name(mapCommand, "mapCommand");
  defineOption("insertModeEscKeysTimeout", 200, "number");
  cm_adapter_default.keyMap["vim-insert"] = {
    fallthrough: ["default"],
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey
  };
  cm_adapter_default.keyMap["vim-replace"] = {
    Backspace: "goCharLeft",
    fallthrough: ["vim-insert"],
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey
  };
  function executeMacroRegister(cm, vim, macroModeState, registerName) {
    var register = vimGlobalState.registerController.getRegister(registerName);
    if (registerName == ":") {
      if (register.keyBuffer[0]) exCommandDispatcher.processCommand(cm, register.keyBuffer[0]);
      macroModeState.isPlaying = false;
      return;
    }
    var keyBuffer = register.keyBuffer;
    var imc = 0;
    macroModeState.isPlaying = true;
    macroModeState.replaySearchQueries = register.searchQueries.slice(0);
    for (var i = 0; i < keyBuffer.length; i++) {
      var text = keyBuffer[i];
      var match, key;
      while (text) {
        match = /<\w+-.+?>|<\w+>|./.exec(text);
        key = match[0];
        text = text.substring(match.index + key.length);
        vimApi.handleKey(cm, key, "macro");
        if (vim.insertMode) {
          var changes = register.insertModeChanges[imc++].changes;
          vimGlobalState.macroModeState.lastInsertModeChanges.changes = changes;
          repeatInsertModeChanges(cm, changes, 1);
          exitInsertMode(cm);
        }
      }
    }
    macroModeState.isPlaying = false;
  }
  __name(executeMacroRegister, "executeMacroRegister");
  function logKey(macroModeState, key) {
    if (macroModeState.isPlaying) return;
    var registerName = macroModeState.latestRegister;
    var register = vimGlobalState.registerController.getRegister(registerName);
    if (register) register.pushText(key);
  }
  __name(logKey, "logKey");
  function logInsertModeChange(macroModeState) {
    if (macroModeState.isPlaying) return;
    var registerName = macroModeState.latestRegister;
    var register = vimGlobalState.registerController.getRegister(registerName);
    if (register && register.pushInsertModeChanges) register.pushInsertModeChanges(macroModeState.lastInsertModeChanges);
  }
  __name(logInsertModeChange, "logInsertModeChange");
  function logSearchQuery(macroModeState, query) {
    if (macroModeState.isPlaying) return;
    var registerName = macroModeState.latestRegister;
    var register = vimGlobalState.registerController.getRegister(registerName);
    if (register && register.pushSearchQuery) register.pushSearchQuery(query);
  }
  __name(logSearchQuery, "logSearchQuery");
  function onChange(cm, changeObj) {
    var macroModeState = vimGlobalState.macroModeState;
    var lastChange = macroModeState.lastInsertModeChanges;
    if (!macroModeState.isPlaying) while (changeObj) {
      lastChange.expectCursorActivityForChange = true;
      if (lastChange.ignoreCount > 1) lastChange.ignoreCount--;
      else if (changeObj.origin == "+input" || changeObj.origin == "paste" || changeObj.origin === void 0) {
        var selectionCount = cm.listSelections().length;
        if (selectionCount > 1) lastChange.ignoreCount = selectionCount;
        var text = changeObj.text.join("\n");
        if (lastChange.maybeReset) {
          lastChange.changes = [];
          lastChange.maybeReset = false;
        }
        if (text) if (cm.state.overwrite && !/\n/.test(text)) lastChange.changes.push([text]);
        else lastChange.changes.push(text);
      }
      changeObj = changeObj.next;
    }
  }
  __name(onChange, "onChange");
  function onCursorActivity(cm) {
    var vim = cm.state.vim;
    if (vim.insertMode) {
      var macroModeState = vimGlobalState.macroModeState;
      if (macroModeState.isPlaying) return;
      var lastChange = macroModeState.lastInsertModeChanges;
      if (lastChange.expectCursorActivityForChange) lastChange.expectCursorActivityForChange = false;
      else lastChange.maybeReset = true;
    } else if (!cm.curOp.isVimOp) handleExternalSelection(cm, vim);
  }
  __name(onCursorActivity, "onCursorActivity");
  function handleExternalSelection(cm, vim) {
    var anchor = cm.getCursor("anchor");
    var head = cm.getCursor("head");
    if (vim.visualMode && !cm.somethingSelected()) exitVisualMode(cm, false);
    else if (!vim.visualMode && !vim.insertMode && cm.somethingSelected()) {
      vim.visualMode = true;
      vim.visualLine = false;
      cm_adapter_default.signal(cm, "vim-mode-change", { mode: "visual" });
    }
    if (vim.visualMode) {
      var headOffset = !cursorIsBefore(head, anchor) ? -1 : 0;
      var anchorOffset = cursorIsBefore(head, anchor) ? -1 : 0;
      head = offsetCursor(head, 0, headOffset);
      anchor = offsetCursor(anchor, 0, anchorOffset);
      vim.sel = {
        anchor,
        head
      };
      updateMark(cm, vim, "<", cursorMin(head, anchor));
      updateMark(cm, vim, ">", cursorMax(head, anchor));
    } else if (!vim.insertMode) vim.lastHPos = cm.getCursor().ch;
  }
  __name(handleExternalSelection, "handleExternalSelection");
  function InsertModeKey(keyName) {
    this.keyName = keyName;
  }
  __name(InsertModeKey, "InsertModeKey");
  function onKeyEventTargetKeyDown(e) {
    var lastChange = vimGlobalState.macroModeState.lastInsertModeChanges;
    var keyName = cm_adapter_default.keyName(e);
    if (!keyName) return;
    function onKeyFound() {
      if (lastChange.maybeReset) {
        lastChange.changes = [];
        lastChange.maybeReset = false;
      }
      lastChange.changes.push(new InsertModeKey(keyName));
      return true;
    }
    __name(onKeyFound, "onKeyFound");
    if (keyName.indexOf("Delete") != -1 || keyName.indexOf("Backspace") != -1) cm_adapter_default.lookupKey(keyName, "vim-insert", onKeyFound);
  }
  __name(onKeyEventTargetKeyDown, "onKeyEventTargetKeyDown");
  function repeatLastEdit(cm, vim, repeat, repeatForInsert) {
    var macroModeState = vimGlobalState.macroModeState;
    macroModeState.isPlaying = true;
    var isAction = !!vim.lastEditActionCommand;
    var cachedInputState = vim.inputState;
    function repeatCommand() {
      if (isAction) commandDispatcher.processAction(cm, vim, vim.lastEditActionCommand);
      else commandDispatcher.evalInput(cm, vim);
    }
    __name(repeatCommand, "repeatCommand");
    function repeatInsert(repeat$1) {
      if (macroModeState.lastInsertModeChanges.changes.length > 0) {
        repeat$1 = !vim.lastEditActionCommand ? 1 : repeat$1;
        var changeObject = macroModeState.lastInsertModeChanges;
        repeatInsertModeChanges(cm, changeObject.changes, repeat$1);
      }
    }
    __name(repeatInsert, "repeatInsert");
    vim.inputState = vim.lastEditInputState;
    if (isAction && vim.lastEditActionCommand.interlaceInsertRepeat) for (var i = 0; i < repeat; i++) {
      repeatCommand();
      repeatInsert(1);
    }
    else {
      if (!repeatForInsert) repeatCommand();
      repeatInsert(repeat);
    }
    vim.inputState = cachedInputState;
    if (vim.insertMode && !repeatForInsert) exitInsertMode(cm);
    macroModeState.isPlaying = false;
  }
  __name(repeatLastEdit, "repeatLastEdit");
  function repeatInsertModeChanges(cm, changes, repeat) {
    function keyHandler(binding) {
      if (typeof binding == "string") cm_adapter_default.commands[binding](cm);
      else binding(cm);
      return true;
    }
    __name(keyHandler, "keyHandler");
    var head = cm.getCursor("head");
    var visualBlock = vimGlobalState.macroModeState.lastInsertModeChanges.visualBlock;
    if (visualBlock) {
      selectForInsert(cm, head, visualBlock + 1);
      repeat = cm.listSelections().length;
      cm.setCursor(head);
    }
    for (var i = 0; i < repeat; i++) {
      if (visualBlock) cm.setCursor(offsetCursor(head, i, 0));
      for (var j = 0; j < changes.length; j++) {
        var change = changes[j];
        if (change instanceof InsertModeKey) cm_adapter_default.lookupKey(change.keyName, "vim-insert", keyHandler);
        else if (typeof change == "string") {
          window.cm = cm;
          cm.replaceSelections(change);
        } else {
          var start = cm.getCursor();
          var end = offsetCursor(start, 0, change[0].length);
          cm.replaceRange(change[0], start, end);
          cm.setCursor(end);
        }
      }
    }
    if (visualBlock) cm.setCursor(offsetCursor(head, 0, 1));
  }
  __name(repeatInsertModeChanges, "repeatInsertModeChanges");
  resetVimGlobalState();
  return vimApi;
}, "Vim");
cm_adapter_default.Vim = Vim();
var keymap_vim_default = cm_adapter_default;
var _a3;
var VimStatusBar = (_a3 = class {
  constructor(node, editor$1, sanitizer = null) {
    this.input = null;
    this.closeInput = () => {
      this.removeInputListeners();
      this.input = null;
      this.setSec("");
      if (this.editor) this.editor.focus();
    };
    this.clear = () => {
      this.setInnerHtml_(this.node, "");
    };
    this.inputKeyUp = (e) => {
      if (!this.input) return;
      const { options } = this.input;
      if (options && options.onKeyUp) options.onKeyUp(e, e.target.value, this.closeInput);
    };
    this.inputKeyInput = (e) => {
      if (!this.input) return;
      const { options } = this.input;
      if (options && options.onKeyInput) options.onKeyInput(e, e.target.value, this.closeInput);
    };
    this.inputBlur = (event) => {
      if (!this.input) return;
      const { options } = this.input;
      if (options === null || options === void 0 ? void 0 : options.onBlur) options.onBlur(event, this.closeInput);
      if (options === null || options === void 0 ? void 0 : options.closeOnBlur) this.closeInput();
    };
    this.inputKeyDown = (e) => {
      if (!this.input) return;
      const { options, callback } = this.input;
      if (options && options.onKeyDown && options.onKeyDown(e, e.target.value, this.closeInput)) return;
      if (e.keyCode === 27 || options && options.closeOnEnter !== false && e.keyCode == 13) {
        this.input.node.blur();
        e.stopPropagation();
        this.closeInput();
      }
      if (e.keyCode === 13 && callback) {
        e.stopPropagation();
        e.preventDefault();
        callback(e.target.value);
      }
    };
    this.node = node;
    this.modeInfoNode = document.createElement("span");
    this.secInfoNode = document.createElement("span");
    this.notifNode = document.createElement("span");
    this.notifNode.className = "vim-notification";
    this.keyInfoNode = document.createElement("span");
    this.keyInfoNode.setAttribute("style", "float: right");
    this.node.appendChild(this.modeInfoNode);
    this.node.appendChild(this.secInfoNode);
    this.node.appendChild(this.notifNode);
    this.node.appendChild(this.keyInfoNode);
    this.toggleVisibility(false);
    this.editor = editor$1;
    this.sanitizer = sanitizer;
  }
  setMode(ev) {
    if (ev.mode === "visual") {
      if (ev.subMode === "linewise") this.setText("--VISUAL LINE--");
      else if (ev.subMode === "blockwise") this.setText("--VISUAL BLOCK--");
      else this.setText("--VISUAL--");
      return;
    }
    this.setText(`--${ev.mode.toUpperCase()}--`);
  }
  setKeyBuffer(key) {
    this.keyInfoNode.textContent = key;
  }
  setSec(text, callback, options) {
    this.notifNode.textContent = "";
    if (text === void 0) return this.closeInput;
    this.setInnerHtml_(this.secInfoNode, text);
    const input = this.secInfoNode.querySelector("input");
    if (input) {
      input.focus();
      this.input = {
        callback,
        options,
        node: input
      };
      if (options) {
        if (options.selectValueOnOpen) input.select();
        if (options.value) input.value = options.value;
      }
      this.addInputListeners();
    }
    return this.closeInput;
  }
  setText(text) {
    this.modeInfoNode.textContent = text;
  }
  toggleVisibility(toggle) {
    if (toggle) this.node.style.display = "block";
    else this.node.style.display = "none";
    if (this.input) this.removeInputListeners();
    if (this.notifTimeout) clearTimeout(this.notifTimeout);
  }
  addInputListeners() {
    if (!this.input) return;
    const { node } = this.input;
    node.addEventListener("keyup", this.inputKeyUp);
    node.addEventListener("keydown", this.inputKeyDown);
    node.addEventListener("input", this.inputKeyInput);
    node.addEventListener("blur", this.inputBlur);
  }
  removeInputListeners() {
    if (!this.input || !this.input.node) return;
    const { node } = this.input;
    node.removeEventListener("keyup", this.inputKeyUp);
    node.removeEventListener("keydown", this.inputKeyDown);
    node.removeEventListener("input", this.inputKeyInput);
    node.removeEventListener("blur", this.inputBlur);
  }
  showNotification(text) {
    const sp = document.createElement("span");
    this.setInnerHtml_(sp, text);
    this.notifNode.textContent = sp.textContent;
    this.notifTimeout = setTimeout(() => {
      this.notifNode.textContent = "";
    }, 5e3);
  }
  setInnerHtml_(element, htmlContents) {
    while (element.childNodes.length) element.removeChild(element.childNodes[0]);
    if (!htmlContents) return;
    if (typeof htmlContents === "string") {
      element.appendChild(document.createTextNode(htmlContents));
      return;
    }
    const node = this.sanitizer ? this.sanitizer(htmlContents) : htmlContents;
    element.appendChild(node);
  }
}, __name(_a3, "VimStatusBar"), _a3);
function initVimMode(editor$1, statusbarNode = null, StatusBarClass = VimStatusBar, sanitizer = null) {
  const vimAdapter = new keymap_vim_default(editor$1);
  if (!statusbarNode) {
    vimAdapter.attach();
    return vimAdapter;
  }
  const statusBar = new StatusBarClass(statusbarNode, editor$1, sanitizer);
  let keyBuffer = "";
  vimAdapter.on("vim-mode-change", (mode) => {
    statusBar.setMode(mode);
  });
  vimAdapter.on("vim-keypress", (key) => {
    if (key === ":") keyBuffer = "";
    else keyBuffer += key;
    statusBar.setKeyBuffer(keyBuffer);
  });
  vimAdapter.on("vim-command-done", () => {
    keyBuffer = "";
    statusBar.setKeyBuffer(keyBuffer);
  });
  vimAdapter.on("dispose", function() {
    statusBar.toggleVisibility(false);
    statusBar.closeInput();
    statusBar.clear();
  });
  statusBar.toggleVisibility(true);
  vimAdapter.setStatusBar(statusBar);
  vimAdapter.attach();
  return vimAdapter;
}
__name(initVimMode, "initVimMode");

// src/extensions/vim/bar.ts
var VIM_MESSAGE_MS = 4e3;
function modeLabel(ev) {
  if (ev.mode === "visual") {
    if (ev.subMode === "linewise") return "-- VISUAL LINE --";
    if (ev.subMode === "blockwise") return "-- VISUAL BLOCK --";
    return "-- VISUAL --";
  }
  return `-- ${String(ev.mode).toUpperCase()} --`;
}
__name(modeLabel, "modeLabel");
var _VimBar = class _VimBar {
  constructor(node, editor2, sanitizer = null) {
    this.node = node;
    this.editor = editor2;
    this.sanitizer = sanitizer;
    this.input = null;
    /**
     * Close the `:` line. Focus goes back to the editor only when a `:` line was open and
     * the editor is still there: monaco-vim also calls this as Vim is switched off, and
     * that must not pull the keyboard into a code editor from wherever the person is.
     */
    this.closeInput = /* @__PURE__ */ __name(() => {
      const wasOpen = this.input !== null;
      this.listen(false);
      this.input = null;
      this.mode.style.display = "";
      this.fill(this.command, "");
      if (wasOpen && this.editor?.getModel()) this.editor.focus();
    }, "closeInput");
    this.clear = /* @__PURE__ */ __name(() => {
      if (this.messageTimer) clearTimeout(this.messageTimer);
      this.fill(this.node, "");
    }, "clear");
    // ── the `:` line's input ───────────────────────────────────────────────────────────────
    this.onKeyUp = /* @__PURE__ */ __name((e) => {
      const o = this.input?.options;
      o?.onKeyUp?.(e, e.target.value, this.closeInput);
    }, "onKeyUp");
    this.onInput = /* @__PURE__ */ __name((e) => {
      const o = this.input?.options;
      o?.onKeyInput?.(e, e.target.value, this.closeInput);
    }, "onInput");
    this.onBlur = /* @__PURE__ */ __name((e) => {
      const o = this.input?.options;
      if (!this.input) return;
      o?.onBlur?.(e, this.closeInput);
      if (o?.closeOnBlur) this.closeInput();
    }, "onBlur");
    this.onKeyDown = /* @__PURE__ */ __name((e) => {
      if (!this.input) return;
      const { options, callback } = this.input;
      if (options?.onKeyDown?.(e, e.target.value, this.closeInput)) return;
      const isEnter = e.key === "Enter" || e.keyCode === 13;
      const isEscape = e.key === "Escape" || e.keyCode === 27;
      if (isEscape || options?.closeOnEnter !== false && isEnter) {
        this.input.node.blur();
        e.stopPropagation();
        this.closeInput();
      }
      if (isEnter && callback) {
        e.stopPropagation();
        e.preventDefault();
        callback(e.target.value);
      }
    }, "onKeyDown");
    const doc = node.ownerDocument;
    const span = /* @__PURE__ */ __name((attr, style) => {
      const el = doc.createElement("span");
      el.setAttribute(attr, "");
      el.setAttribute("style", style);
      node.appendChild(el);
      return el;
    }, "span");
    this.mode = span("data-vim-mode", "white-space: pre; font-weight: 600; color: var(--accent, #6ea8fe)");
    this.command = span("data-vim-command", "white-space: pre; display: flex; align-items: center; min-width: 0");
    this.message = span("data-vim-message", "white-space: pre; overflow: hidden; text-overflow: ellipsis; min-width: 0");
    const spacer = doc.createElement("span");
    spacer.setAttribute("style", "flex: 1");
    node.appendChild(spacer);
    this.keys = span("data-vim-keys", "white-space: pre; opacity: 0.8");
    this.toggleVisibility(false);
  }
  setMode(ev) {
    this.setText(modeLabel(ev));
  }
  setText(text) {
    this.mode.textContent = text;
  }
  setKeyBuffer(keys) {
    this.keys.textContent = keys;
  }
  /** Open the `:` line (or another prompt), or show `text` there; returns how to close it. */
  setSec(text, callback, options) {
    this.message.textContent = "";
    if (text === void 0) return this.closeInput;
    this.fill(this.command, text);
    const input = this.command.querySelector("input");
    if (input) {
      input.setAttribute("data-vim-input", "");
      input.setAttribute("aria-label", "Vim command");
      input.setAttribute(
        "style",
        "background: transparent; border: none; outline: none; color: inherit; font: inherit; padding: 0; margin: 0; min-width: 12em"
      );
      this.mode.style.display = "none";
      input.focus();
      this.input = { callback, options, node: input };
      if (options?.selectValueOnOpen) input.select();
      if (options?.value) input.value = options.value;
      this.listen(true);
    }
    return this.closeInput;
  }
  toggleVisibility(show) {
    this.node.style.display = show ? "flex" : "none";
    if (this.input) this.listen(false);
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
  /** A short message, shown for a few seconds. Vim's errors come as `.cm-vim-message`. */
  showNotification(text) {
    const holder = this.node.ownerDocument.createElement("span");
    this.fill(holder, text);
    const isError = !!(holder.querySelector(".cm-vim-message") || holder.firstElementChild?.classList?.contains("cm-vim-message"));
    this.message.textContent = holder.textContent;
    this.message.style.color = isError ? "var(--error, #f87171)" : "";
    this.message.toggleAttribute("data-vim-error", isError);
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message.textContent = "";
      this.messageTimer = void 0;
    }, VIM_MESSAGE_MS);
  }
  listen(on) {
    const node = this.input?.node;
    if (!node) return;
    const method = on ? "addEventListener" : "removeEventListener";
    node[method]("keyup", this.onKeyUp);
    node[method]("keydown", this.onKeyDown);
    node[method]("input", this.onInput);
    node[method]("blur", this.onBlur);
  }
  fill(el, content) {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (!content) return;
    if (typeof content === "string") {
      el.appendChild(el.ownerDocument.createTextNode(content));
      return;
    }
    el.appendChild(this.sanitizer ? this.sanitizer(content) : content);
  }
};
__name(_VimBar, "VimBar");
var VimBar = _VimBar;

// src/extensions/vim/edges.ts
var VIM_CONTEXT_KEYS = ["insertMode"];
var PAST_VERSION = "This is a past version, so it can\u2019t be changed here";
var MOST_STEPS = 1e4;
var _InsertUndo = class _InsertUndo {
  constructor(model) {
    this.model = model;
    /** Each finished span, by the state it ended at. */
    this.spans = /* @__PURE__ */ new Map();
    /** Spans undone, newest last, so Ctrl+R can put each back whole. */
    this.undone = [];
    /** The span being typed, while in insert mode. */
    this.open = null;
    this.last = 0;
  }
  /** Insert mode began; the insert's span begins at `start` (before the key's own edit, for `cw` and `o`). */
  enter(start) {
    const m = this.model();
    if (!m) return;
    m.pushStackElement();
    const now = m.getAlternativeVersionId();
    const from = start ?? now;
    this.open = { start: from, seen: /* @__PURE__ */ new Set([from, now]) };
    this.last = now;
  }
  /** Insert mode ended: the span ends at the current state. */
  exit() {
    const m = this.model();
    if (!this.open || !m) {
      this.open = null;
      return;
    }
    m.pushStackElement();
    this.close(m.getAlternativeVersionId());
    this.open = null;
  }
  /** A content change; `own` when it is this editor's typing (the editor has the keyboard). */
  changed(e, own) {
    if (e.isUndoing || e.isRedoing) {
      if (this.open) this.restartAfter();
      return;
    }
    this.undone.length = 0;
    if (e.isFlush) {
      this.spans.clear();
      if (this.open) this.restartAfter();
      return;
    }
    if (!this.open) return;
    if (own) {
      this.last = this.model()?.getAlternativeVersionId() ?? this.last;
      this.open.seen.add(this.last);
    } else {
      this.restartAfter();
    }
  }
  /** The editor shows another model: nothing remembered applies to it. */
  forget() {
    this.spans.clear();
    this.undone.length = 0;
    if (this.open) this.restartAfter();
  }
  /** Vim's `u`: a whole insert when the text is where an insert ended, else one step. */
  undo() {
    const m = this.model();
    if (!m) return;
    const end = m.getAlternativeVersionId();
    const span = this.spans.get(end);
    if (!span) {
      m.undo();
      return;
    }
    let at = end;
    let steps = 0;
    while (at !== span.start && steps < MOST_STEPS) {
      m.undo();
      steps++;
      const next = m.getAlternativeVersionId();
      if (next === at || !span.seen.has(next)) break;
      at = next;
    }
    if (m.getAlternativeVersionId() === span.start) this.undone.push({ from: span.start, to: end, steps });
  }
  /** Vim's Ctrl+R: the whole insert the last `u` undid, else one step. */
  redo() {
    const m = this.model();
    if (!m) return;
    const at = m.getAlternativeVersionId();
    const plan = this.undone[this.undone.length - 1];
    if (!plan || plan.from !== at) {
      m.redo();
      return;
    }
    this.undone.pop();
    let now = at;
    for (let i = 0; i < plan.steps && now !== plan.to; i++) {
      m.redo();
      const next = m.getAlternativeVersionId();
      if (next === now) break;
      now = next;
    }
  }
  close(end) {
    if (this.open && end !== this.open.start) {
      this.open.seen.add(end);
      this.spans.set(end, this.open);
    }
  }
  /** End the open span where this insert's typing last left it, and begin a new one now. */
  restartAfter() {
    const m = this.model();
    if (!this.open || !m) return;
    this.close(this.last);
    const now = m.getAlternativeVersionId();
    this.open = { start: now, seen: /* @__PURE__ */ new Set([now]) };
    this.last = now;
  }
};
__name(_InsertUndo, "InsertUndo");
var InsertUndo = _InsertUndo;
function hasPendingInput(s) {
  if (!s) return false;
  return String(s.keyBuffer ?? "").length > 0 || !!s.operator || (s.prefixRepeat?.length ?? 0) > 0 || (s.motionRepeat?.length ?? 0) > 0 || !!s.registerName;
}
__name(hasPendingInput, "hasPendingInput");
function isVimEsc(event) {
  if (event.key === "Escape") return true;
  if (!event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === "[" || event.code === "BracketLeft" || event.key.toLowerCase() === "c";
}
__name(isVimEsc, "isVimEsc");
function suggestListOpen(editor2) {
  const el = editor2.getDomNode()?.querySelector(".suggest-widget");
  if (!el) return false;
  return el.style.visibility !== "hidden" && el.style.display !== "none";
}
__name(suggestListOpen, "suggestListOpen");
function removeContextKeys(editor2) {
  for (const key of VIM_CONTEXT_KEYS) {
    editor2.createContextKey(key, void 0);
  }
}
__name(removeContextKeys, "removeContextKeys");

// src/extensions/vim/module.ts
var SAVES_AS_YOU_TYPE = "Stave saves as you type";
var EX_COMMANDS = [
  ["write", "w", "message"],
  ["wall", "wa", "message"],
  ["update", "up", "message"],
  ["quit", "q", "close"],
  ["wq", "wq", "close"],
  ["xit", "x", "close"],
  ["exit", "exi", "close"],
  ["qall", "qa", "closeAll"],
  ["quitall", "quita", "closeAll"],
  ["wqall", "wqa", "closeAll"],
  ["xall", "xa", "closeAll"]
];
var actionsByVim = /* @__PURE__ */ new WeakMap();
function bindEditorActions(vim, actions) {
  if (actions) actionsByVim.set(vim, actions);
  else actionsByVim.delete(vim);
}
__name(bindEditorActions, "bindEditorActions");
function runExAction(action, vim) {
  const actions = actionsByVim.get(vim);
  if (!actions) return;
  if (action === "message") actions.message(SAVES_AS_YOU_TYPE);
  else setTimeout(action === "close" ? actions.close : actions.closeAll, 0);
}
__name(runExAction, "runExAction");
var exDefined = false;
function defineExCommands() {
  if (exDefined) return;
  const vim = keymap_vim_default.Vim;
  for (const [name, prefix, action] of EX_COMMANDS) {
    vim.defineEx(name, prefix, (cm) => runExAction(action, cm));
  }
  exDefined = true;
}
__name(defineExCommands, "defineExCommands");
var EDIT_METHODS = /* @__PURE__ */ new Set(["executeEdits", "executeCommand", "executeCommands"]);
function keyFilteredEditor(editor2, leaveAlone, hooks = {}) {
  const models = /* @__PURE__ */ new WeakMap();
  const vimModel = /* @__PURE__ */ __name((model) => {
    if (!model || !hooks.undo && !hooks.redo) return model;
    let seen = models.get(model);
    if (!seen) {
      seen = new Proxy(model, {
        get(target, prop) {
          if (prop === "undo" && hooks.undo) return hooks.undo;
          if (prop === "redo" && hooks.redo) return hooks.redo;
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      models.set(model, seen);
    }
    return seen;
  }, "vimModel");
  return new Proxy(editor2, {
    get(target, prop) {
      if (prop === "onKeyDown") {
        return (listener) => target.onKeyDown((e) => {
          if (e.browserEvent && leaveAlone(e.browserEvent)) return;
          listener(e);
        });
      }
      if (prop === "getModel") return () => vimModel(target.getModel());
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const bound = value.bind(target);
      const onEdit = hooks.onEdit;
      if (onEdit && EDIT_METHODS.has(prop)) {
        return (...args) => {
          onEdit();
          return bound(...args);
        };
      }
      return bound;
    }
  });
}
__name(keyFilteredEditor, "keyFilteredEditor");
var CURSOR_DEFAULTS = { cursorWidth: 0, cursorBlinking: "blink", cursorStyle: "line" };
function cursorOptions(editor2) {
  const raw = editor2.getRawOptions();
  return {
    cursorWidth: raw.cursorWidth ?? CURSOR_DEFAULTS.cursorWidth,
    cursorBlinking: raw.cursorBlinking ?? CURSOR_DEFAULTS.cursorBlinking,
    cursorStyle: raw.cursorStyle ?? CURSOR_DEFAULTS.cursorStyle
  };
}
__name(cursorOptions, "cursorOptions");
var BAR_STYLE = [
  "align-items: center",
  "gap: 10px",
  "min-height: 20px",
  "padding: 1px 10px",
  "font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  "font-size: 12px",
  "line-height: 18px",
  "color: var(--foreground, #e6e6ea)",
  "background: var(--background, #16161a)",
  "border-top: 1px solid var(--border, rgba(255,255,255,0.12))"
].join("; ");
function leaveAloneFor(host) {
  return (event) => {
    const key = host.keyOf(event);
    return key !== null && !host.takesKey(key);
  };
}
__name(leaveAloneFor, "leaveAloneFor");
function attachVim(ed, host) {
  useMonaco(ed.monaco);
  defineExCommands();
  const doc = ed.bar.ownerDocument;
  const node = doc.createElement("div");
  node.setAttribute("data-vim-bar", "");
  node.setAttribute("style", BAR_STYLE);
  if (ed.readOnly) node.setAttribute("data-vim-readonly", "");
  ed.bar.appendChild(node);
  const before = cursorOptions(ed.editor);
  const handedBack = leaveAloneFor(host);
  let inInsert = false;
  const notVims = /* @__PURE__ */ new WeakSet();
  const leaveAlone = /* @__PURE__ */ __name((event) => handedBack(event) || notVims.has(event), "leaveAlone");
  let saidForKey = false;
  const sayPastVersion = /* @__PURE__ */ __name(() => {
    if (saidForKey) return;
    saidForKey = true;
    vim.openNotification(PAST_VERSION);
  }, "sayPastVersion");
  const undo = new InsertUndo(() => ed.editor.getModel());
  const view = keyFilteredEditor(ed.editor, leaveAlone, {
    onEdit: ed.readOnly ? sayPastVersion : void 0,
    undo: ed.readOnly ? sayPastVersion : () => undo.undo(),
    redo: ed.readOnly ? sayPastVersion : () => undo.redo()
  });
  const vimState = /* @__PURE__ */ __name(() => vim.state?.vim, "vimState");
  let textAtKey = null;
  const beforeVim = ed.editor.onKeyDown((e) => {
    saidForKey = false;
    const model = ed.editor.getModel();
    const state = vimState();
    const browser = e.browserEvent;
    const esc = !!browser && isVimEsc(browser) && !handedBack(browser);
    if (!inInsert && model && !ed.readOnly) {
      model.pushStackElement();
      textAtKey = model.getAlternativeVersionId();
    }
    if (esc && inInsert && suggestListOpen(ed.editor)) {
      notVims.add(browser);
      ed.editor.trigger("vim", "hideSuggestWidget", null);
      e.preventDefault();
      e.stopPropagation();
    } else if (browser?.key === "Escape" && !inInsert && !state?.visualMode && hasPendingInput(state?.inputState)) {
      e.stopPropagation();
    }
    const editBefore = state?.lastEditInputState;
    queueMicrotask(() => {
      textAtKey = null;
      const after = vimState();
      if (ed.readOnly && after?.lastEditInputState !== editBefore && after?.lastEditActionCommand) sayPastVersion();
    });
  });
  const vim = initVimMode(view, node, VimBar);
  bindEditorActions(vim, {
    message: /* @__PURE__ */ __name((text) => vim.openNotification(text), "message"),
    close: /* @__PURE__ */ __name(() => ed.close(), "close"),
    closeAll: /* @__PURE__ */ __name(() => host.closeAllEditors(), "closeAll")
  });
  vim.on("vim-mode-change", (ev) => {
    const insertNow = ev.mode === "insert" || ev.mode === "replace";
    if (insertNow && !inInsert) undo.enter(textAtKey ?? void 0);
    else if (!insertNow && inInsert) undo.exit();
    inInsert = insertNow;
  });
  const contentChange = ed.editor.onDidChangeModelContent((e) => undo.changed(e, ed.editor.hasTextFocus()));
  const modelSwap = ed.editor.onDidChangeModel(() => undo.forget());
  if (ed.readOnly) {
    const note = doc.createElement("span");
    note.setAttribute("data-vim-readonly-note", "");
    note.setAttribute("style", "opacity: 0.7; white-space: pre");
    note.textContent = "read-only";
    node.insertBefore(note, node.querySelector("[data-vim-command]"));
  }
  return () => {
    const goingAway = !ed.editor.getModel?.();
    bindEditorActions(vim, null);
    try {
      beforeVim.dispose();
      contentChange.dispose();
      modelSwap.dispose();
      vim.dispose();
      if (!goingAway) {
        ed.editor.updateOptions(before);
        removeContextKeys(ed.editor);
      }
    } catch (e) {
      if (!goingAway) throw e;
    } finally {
      node.remove();
    }
  };
}
__name(attachVim, "attachVim");
var vimModule = {
  activate(host) {
    host.onEditor((ed) => attachVim(ed, host));
  }
};

export { EX_COMMANDS, SAVES_AS_YOU_TYPE, attachVim, bindEditorActions, keyFilteredEditor, leaveAloneFor, runExAction, vimModule };
//# sourceMappingURL=vim.js.map
//# sourceMappingURL=vim.js.map