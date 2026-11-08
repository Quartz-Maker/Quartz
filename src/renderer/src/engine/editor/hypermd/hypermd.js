// CodeMirror, copyright (c) by laobubu
// Distributed under an MIT license: http://codemirror.net/LICENSE
//
// Derived from HyperMD 0.3.11 `mode/hypermd.js` (MIT, https://github.com/laobubu/HyperMD), a patch
// on top of the CodeMirror 5 markdown mode, adapted for Quartz. Its token stream (token boundaries
// and style strings) is what themes and CSS snippets target.
//
// Compared with the original HyperMD this version: drops TOC / org-mode markup / look-ahead parsing,
// adds [[wikilinks]] / ![[embeds]] (with alias pipe), %%comments%%, ^block-ids, ^[inline
// footnotes], callout lines, block math ($$) lines, hashtags with tag-<name> classes, RTL tables,
// list-item headings ("- # h"), and emits `line-parse-next` where the next line depends on state.

/* eslint-disable */

// ---------------------------------------------------------------------------------------------
// Regular expressions
// ---------------------------------------------------------------------------------------------

var listRE = /^(?:[*\-+]|^[0-9]+([.)]))\s+/;
// Bare URL (from CodeMirror's gfm mode)
var urlRE = /^(?:(?:(?:aaas?|about|acap|adiumxtra|af[ps]|aim|apt|attachment|aw|beshare|bitcoin|bolo|callto|cap|chrome(?:-extension)?|cid|coap|com-eventbrite-attendee|content|crid|cvs|data|dav|dict|dlna-(?:playcontainer|playsingle)|dns|doi|dtn|dvb|ed2k|facetime|feed|file|finger|fish|ftp|geo|gg|git|gizmoproject|go|gopher|gtalk|h323|hcp|https?|iax|icap|icon|im|imap|info|ipn|ipp|irc[6s]?|iris(?:\.beep|\.lwz|\.xpc|\.xpcs)?|itms|jar|javascript|jms|keyparc|lastfm|ldaps?|magnet|mailto|maps|market|message|mid|mms|ms-help|msnim|msrps?|mtqp|mumble|mupdate|mvn|news|nfs|nih?|nntp|notes|oid|opaquelocktoken|palm|paparazzi|platform|pop|pres|proxy|psyc|query|res(?:ource)?|rmi|rsync|rtmp|rtsp|secondlife|service|session|sftp|sgn|shttp|sieve|sips?|skype|sm[bs]|snmp|soap\.beeps?|soldat|spotify|ssh|steam|svn|tag|teamspeak|tel(?:net)?|tftp|things|thismessage|tip|tn3270|tv|udp|unreal|urn|ut2004|vemmi|ventrilo|view-source|webcal|wss?|wtai|wyciwyg|xcon(?:-userid)?|xfire|xmlrpc\.beeps?|xmpp|xri|ymsgr|z39\.50[rs]?):(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]|\([^\s()<>]*\))+(?:\([^\s()<>]*\)|[^\s`*!()\[\]{};:'".,<>?«»“”‘’]))/i;
// Bare e-mail address
var emailRE = /^(?:(?:[^<>()[\]\\.,;:\s@\"`*_~=][^<>()[\]\\.,;:\s@\"`]*(?:\.[^<>()[\]\\.,;:\s@\"]+)*)|(?:\".+\"))@(?:(?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))\b/;
var emailStartBlockerRE = /[<>()[\]\\.,;:\s@\"`*_~=]/;
// Characters allowed in a #tag (anything but general/supplemental punctuation, ASCII punctuation, space)
var tagCharsRE = /^(?:[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s])+/;
// Styles of the surrounding text an inline `$math$` inherits
var mathInheritedStyles = new Set(["em", "strong", "inline-code", "strikethrough", "highlight"]);

var simpleTableRE = /^\s*[^\|].*?\|.*[^|]\s*$/;   // "a | b" (no leading pipe)
var simpleTableRowRE = /^\s*[^\|].*\|/;           // continuation row of a simple table
var normalTableRE = /^\|(?:[^|]+\|)+?\s*$/;       // "| a | b |"
var normalTableRowRE = /^\|/;                      // continuation row of a normal table
var alignRightRE = /^\s*-+\s*:\s*$/;
var alignLeftRE = /^\s*:\s*-+\s*$/;
var alignCenterRE = /^\s*:\s*-+\s*:\s*$/;
var alignDefaultRE = /^\s*-+\s*$/;

// First strong directional character decides the direction of a line
var directionRE = /(?:([‏\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Syriac}\p{sc=Thaana}])|([‎\p{sc=Armenian}\p{sc=Bengali}\p{sc=Bopomofo}\p{sc=Braille}\p{sc=Buhid}\p{sc=Canadian_Aboriginal}\p{sc=Cherokee}\p{sc=Cyrillic}\p{sc=Devanagari}\p{sc=Ethiopic}\p{sc=Georgian}\p{sc=Greek}\p{sc=Gujarati}\p{sc=Gurmukhi}\p{sc=Han}\p{sc=Hangul}\p{sc=Hanunoo}\p{sc=Hiragana}\p{sc=Kannada}\p{sc=Katakana}\p{sc=Khmer}\p{sc=Lao}\p{sc=Latin}\p{sc=Limbu}\p{sc=Malayalam}\p{sc=Mongolian}\p{sc=Myanmar}\p{sc=Ogham}\p{sc=Oriya}\p{sc=Runic}\p{sc=Sinhala}\p{sc=Tagalog}\p{sc=Tagbanwa}\p{sc=Tamil}\p{sc=Telugu}\p{sc=Thai}\p{sc=Tibetan}\p{sc=Yi}]))/u;
export function textDirection(text) {
  var m = text.match(directionRE);
  if (m) {
    if (m[1]) return "rtl";
    if (m[2]) return "ltr";
  }
  return "auto";
}

function isLetter(ch) { return /[a-z]/i.test(ch); }

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

var TABLE_NONE = 0, TABLE_SIMPLE = 1, TABLE_NORMAL = 2;
var FM_NONE = 0, FM_FRONT_MATTER = 1, FM_FRONT_MATTER_END = 2;
var LINK_NONE = 0, LINK_BARELINK = 1, LINK_FOOTREF = 2, LINK_NORMAL = 3, LINK_FOOTNOTE = 4,
  LINK_MAYBE_FOOTNOTE_URL = 5, LINK_MAYBE_FOOTNOTE_URL_TITLE = 6, LINK_BARELINK2 = 7,
  LINK_FOOTREF2 = 8, LINK_INTERNAL = 9, LINK_EMBED = 10;

var linkStyle = {};
linkStyle[LINK_BARELINK] = "hmd-barelink";
linkStyle[LINK_BARELINK2] = "hmd-barelink2";
linkStyle[LINK_FOOTREF] = "hmd-barelink footref";
linkStyle[LINK_FOOTNOTE] = "hmd-barelink hmd-footnote line-HyperMD-footnote";
linkStyle[LINK_FOOTREF2] = "hmd-footref2";
linkStyle[LINK_INTERNAL] = "hmd-internal-link";
linkStyle[LINK_EMBED] = "hmd-internal-link hmd-embed";

function resetTable(state) {
  state.hmdTable = TABLE_NONE;
  state.hmdTableRTL = false;
  state.hmdTableColumns = [];
  state.hmdTableID = null;
  state.hmdTableCol = state.hmdTableRow = 0;
}

// A `|` cell separator ends every inline construct of the cell before it.
function resetInlineStateAtCell(state) {
  state.code = false;
  state.comment = false;
  state.em = false;
  state.formatting = false;
  state.highlight = false;
  state.hmdHashtag = false;
  state.hmdLinkType = LINK_NONE;
  state.isAlias = false;
  state.internalEmbed = false;
  state.internalLink = false;
  state.linkHref = false;
  state.linkText = false;
  state.linkTitle = false;
  state.strikethrough = false;
  state.strong = false;
}

export var defaultTokenTypeOverrides = {
  hr: "line-HyperMD-hr line-background-HyperMD-hr-bg hr",
  list1: "list-1",
  list2: "list-2",
  list3: "list-3",
  code: "inline-code",
  hashtag: "hashtag meta"
};

// Remove every class word containing `fragment` (with its leading space).
function removeWordsContaining(style, fragment) {
  return style.replace(new RegExp("\\s?[^\\s]*" + fragment + "[^\\s]*", "g"), "");
}

export default function install(CodeMirror) {

  CodeMirror.defineMode("hypermd", function (cmCfg, modeCfgUser) {
    var modeCfg = {
      front_matter: true,
      math: true,
      table: true,
      toc: true,
      orgModeMarkup: true,
      hashtag: true,
      fencedCodeBlockHighlighting: true,
      name: "markdown",
      highlightFormatting: true,
      taskLists: true,
      strikethrough: true,
      emoji: false,
      highlight: true,
      tokenTypeOverrides: defaultTokenTypeOverrides,
      headers: true,
      blockquotes: true,
      indentedCode: true,
      lists: true,
      hr: true,
      blockId: true
    };
    Object.assign(modeCfg, modeCfgUser);
    if (modeCfg.tokenTypeOverrides !== defaultTokenTypeOverrides)
      modeCfg.tokenTypeOverrides = Object.assign({}, defaultTokenTypeOverrides, modeCfg.tokenTypeOverrides);
    modeCfg.name = "markdown";

    /** Functions captured from the markdown mode closure, only used for identity checks. */
    var rawClosure = { htmlBlock: null, block: null };
    var rawMode = CodeMirror.getMode(cmCfg, modeCfg);
    var newMode = Object.assign({}, rawMode);

    // ----- inner modes (front matter, math, html comments) ------------------------------------

    function innerModeToken(stream, state) {
      var exit = state.hmdInnerExitChecker(stream, state);
      var extraStyle = state.hmdInnerStyle;
      var ans = ((!exit || !exit.skipInnerMode) && state.hmdInnerMode.token(stream, state.hmdInnerState)) || "";
      if (extraStyle) ans += " " + extraStyle;
      if (exit) {
        if (exit.style) ans += " " + exit.style;
        if (exit.endPos) stream.pos = exit.endPos;
        state.hmdInnerExitChecker = null;
        state.hmdInnerMode = null;
        state.hmdInnerState = null;
        state.inMathBlock = false;
        state.hmdOverride = null;
      } else if (stream.start === stream.pos) {
        stream.skipToEnd();
      }
      return ans.trim() || null;
    }

    function createDummyMode(endTag) {
      return {
        token: function (stream) {
          var endTagSince = stream.string.indexOf(endTag, stream.start);
          if (endTagSince === -1) stream.skipToEnd();
          else if (endTagSince === 0) stream.pos += endTag.length;
          else {
            stream.pos = endTagSince;
            if (stream.string.charAt(endTagSince - 1) === "\\") stream.pos++;
          }
          return null;
        }
      };
    }

    function simpleExitChecker(endTag) {
      var info = {};
      return function (stream) {
        if (stream.string.substr(stream.start, endTag.length) === endTag) {
          info.endPos = stream.start + endTag.length;
          return info;
        }
        return null;
      };
    }

    /** Switch to another mode until `opt.exitChecker` (or `opt.endTag`) says otherwise. */
    function enterMode(stream, state, mode, opt) {
      if (typeof mode === "string") mode = CodeMirror.getMode(cmCfg, mode);
      if (!mode || mode.name === "null") {
        if ("endTag" in opt) mode = createDummyMode(opt.endTag);
        else mode = typeof opt.fallbackMode === "function" && opt.fallbackMode();
        if (!mode) throw new Error("no mode");
      }
      state.hmdInnerExitChecker = "endTag" in opt ? simpleExitChecker(opt.endTag) : opt.exitChecker;
      state.hmdInnerStyle = opt.style;
      state.hmdInnerMode = mode;
      state.hmdOverride = innerModeToken;
      state.hmdInnerState = CodeMirror.startState(mode);
      var ans = opt.style || "";
      // NB: a null inner token deliberately stringifies (" null").
      if (!opt.skipFirstToken) ans += " " + mode.token(stream, state.hmdInnerState);
      return ans.trim();
    }

    // ----- mode interface ----------------------------------------------------------------------

    newMode.startState = function () {
      var ans = rawMode.startState();
      resetTable(ans);
      ans.hmdOverride = null;
      ans.hmdInnerExitChecker = null;
      ans.hmdInnerMode = null;
      ans.hmdLinkType = LINK_NONE;
      ans.hmdNextMaybe = modeCfg.front_matter ? FM_FRONT_MATTER : FM_NONE;
      ans.hmdNextState = null;
      ans.hmdNextStyle = null;
      ans.hmdNextPos = null;
      ans.hmdHashtag = false;
      rawClosure.block = ans.block;
      return ans;
    };

    var copiedKeys = [
      "hmdLinkType", "hmdNextMaybe", "hmdTable", "hmdTableID", "hmdTableCol", "hmdTableRow",
      "hmdOverride", "hmdInnerMode", "hmdInnerStyle", "hmdInnerExitChecker", "hmdNextPos",
      "hmdNextState", "hmdNextStyle", "hmdHashtag", "comment", "internalLink", "internalEmbed",
      "inlineFootnote", "hasAlias", "isAlias", "wasHeading", "isHeading", "mathed", "inFootnote",
      "inMathBlock"
    ];
    newMode.copyState = function (s) {
      var ans = rawMode.copyState(s);
      for (var i = 0; i < copiedKeys.length; i++) ans[copiedKeys[i]] = s[copiedKeys[i]];
      ans.hmdTableColumns = s.hmdTableColumns.slice(0);
      if (s.hmdInnerMode) ans.hmdInnerState = CodeMirror.copyState(s.hmdInnerMode, s.hmdInnerState);
      return ans;
    };

    newMode.blankLine = function (state) {
      var ans;
      var innerMode = state.hmdInnerMode;
      if (innerMode) {
        if (innerMode.blankLine) ans = innerMode.blankLine(state.hmdInnerState);
      } else {
        ans = rawMode.blankLine(state);
      }
      if (!ans) ans = "";
      if (state.hmdNextMaybe === FM_FRONT_MATTER) state.hmdNextMaybe = FM_NONE;
      if (state.hmdLinkType) state.hmdLinkType = LINK_NONE;
      if (state.inFootnote) ans += " line-HyperMD-footnote";
      if (state.code === -1) ans += " line-HyperMD-codeblock line-background-HyperMD-codeblock-bg line-parse-next";
      if (state.inMathBlock) ans += " line-HyperMD-math line-parse-next";
      resetTable(state);
      return ans.trim() || null;
    };

    newMode.indent = function (state, textAfter) {
      var mode = state.hmdInnerMode || rawMode;
      var f = mode.indent;
      if (typeof f === "function") return f.apply(mode, arguments);
      return CodeMirror.Pass;
    };

    newMode.innerMode = function (state) {
      if (state.hmdInnerMode) return { mode: state.hmdInnerMode, state: state.hmdInnerState };
      return rawMode.innerMode(state);
    };

    // Features that can be switched off through the mode config strip their classes again.
    function applyDisabledFeatures(state, style) {
      if (!style) return style;
      if (!modeCfg.hr && state.hr) { style = removeWordsContaining(style, "hr"); state.hr = false; }
      if (!modeCfg.headers && state.header) { style = removeWordsContaining(style, "header"); state.header = 0; }
      if (!modeCfg.indentedCode && state.indentedCode) { style = removeWordsContaining(style, "inline-code"); state.indentedCode = false; }
      if (!modeCfg.blockquotes && state.quote) { style = removeWordsContaining(style, "quote"); state.quote = 0; }
      if (!modeCfg.lists && state.list) { style = removeWordsContaining(style, "list"); state.list = false; }
      return style;
    }

    newMode.token = function (stream, state) {
      var tmp;
      stream.tabSize = 4;
      if (state.hmdOverride) return state.hmdOverride(stream, state);

      // Spaces around a table cell separator are unstyled tokens of their own
      if (state.hmdTable && stream.peek() === " ") {
        if (stream.string[stream.pos - 1] === "|" && stream.string[stream.pos - 2] !== "\\") {
          stream.match(/^ +/);
          return "";
        }
        if (stream.match(/^ +\|/)) {
          stream.backUp(1);
          return "";
        }
      }

      // Front matter: only a first line of exactly "---" opens it
      if (state.hmdNextMaybe === FM_FRONT_MATTER) {
        if (stream.string === "---") {
          state.hmdNextMaybe = FM_FRONT_MATTER_END;
          return enterMode(stream, state, "yaml", {
            style: "hmd-frontmatter",
            fallbackMode: function () { return createDummyMode("---"); },
            exitChecker: function (stream, state) {
              if (stream.string.startsWith("---") && stream.string.substring(3).trim() === "") {
                state.hmdNextMaybe = FM_NONE;
                return { endPos: stream.string.length };
              }
              return null;
            }
          });
        }
        state.hmdNextMaybe = FM_NONE;
      }

      var wasInHTML = state.f === rawClosure.htmlBlock;
      var wasInCodeFence = state.code === -1;
      var prevQuote = state.quote;
      var bol = stream.start === 0;

      if (bol) {
        if (!(state.inFootnote && state.hmdLinkType === LINK_MAYBE_FOOTNOTE_URL)) state.hmdLinkType = LINK_NONE;
        state.inlineFootnote = false;
        state.wasHeading = state.isHeading;
        state.isHeading = false;
        // single/double backtick code spans never continue onto the next line
        if (state.code && (state.code === 1 || state.code === 2)) state.code = 0;
      }

      var wasLinkText = state.linkText;
      var wasLinkHref = state.linkHref;
      var inMarkdown = !(wasInCodeFence || wasInHTML);
      var inMarkdownInline = inMarkdown && !(state.code || state.indentedCode || state.linkHref);
      var ans = "";
      var useCopiedState = false;   // tokenize with a throw-away copy of the markdown state
      var forcedEnd = -1;           // token end decided by this layer
      var isEscape = false;
      var m;

      if (inMarkdown) {
        if (inMarkdownInline && stream.peek() === "\\") isEscape = true;

        // "- # heading" inside a bullet list item
        if (state.list && !state.header && stream.peek() === "#" && /^\s*[*\-+]\s$/.test(stream.string.substr(0, stream.pos))) {
          m = stream.match(/^(#+)(?: |$)/, true);
          if (m) {
            var level = m[1].length;
            state.header = level;
            return "formatting formatting-header formatting-header-" + level + " header header-" + level;
          }
        }

        //#region Math
        if (modeCfg.math && inMarkdownInline && stream.peek() === "$" &&
            (state.hmdLinkType === LINK_NONE || state.hmdLinkType === LINK_MAYBE_FOOTNOTE_URL) &&
            !state.internalLink && !state.internalEmbed) {
          var inlineMath = stream.match(/^(\$)[^\s$]/, false);
          var blockMath = stream.match(/^(\${2})/, false);
          var endTag = inlineMath ? "$" : "$$";
          if (inlineMath) {
            // `$x$` needs a closing `$` preceded by a non-space and not followed by a digit
            tmp = stream.string.slice(stream.pos + 1).match(/[^\\]\$(.|$)/);
            if (!(tmp && tmp[0].match(/^[^\s\\]\$([^0-9]|$)/))) inlineMath = null;
          }
          var mathed = false;
          if (inlineMath || blockMath) {
            if (stream.pos !== 0 || state.mathed) {
              var mathStyle = "math";
              state.inMathBlock = !!blockMath && !stream.string.slice(0, stream.start).trim() && stream.string.indexOf("$", stream.start + 2) === -1;
              if (state.inMathBlock) mathStyle += " line-HyperMD-math line-parse-next";
              if (state.quote) mathStyle += " line-HyperMD-quote line-HyperMD-quote-" + state.quote + " line-HyperMD-quote-lazy line-parse-next";
              if (inlineMath) {
                var outer = rawMode.getType(state);
                if (outer) {
                  var inherited = outer.split(" ").filter(function (w) { return mathInheritedStyles.has(w); }).join(" ");
                  if (inherited) mathStyle += " " + inherited;
                }
              }
              var texMode = CodeMirror.getMode(cmCfg, { name: "stex" });
              var noTexMode = texMode.name !== "stex";
              ans += enterMode(stream, state, texMode, {
                style: mathStyle,
                skipFirstToken: noTexMode,
                fallbackMode: function () { return createDummyMode(endTag); },
                exitChecker: function (stream, state) {
                  var start = stream.start, str = stream.string;
                  var endStyle = "formatting formatting-math formatting-math-end math-";
                  if (state.hmdTable && str[start] === "|") return { endPos: start, style: endStyle };
                  if (str.substr(start, endTag.length) === endTag) return { endPos: start + endTag.length, style: endStyle };
                  return null;
                }
              });
              if (inlineMath) {
                if (noTexMode) stream.pos += inlineMath[1].length;
                ans += " formatting formatting-math formatting-math-begin";
              } else {
                if (noTexMode) stream.pos += blockMath[1].length;
                ans += " formatting formatting-math formatting-math-begin math-block";
              }
              return ans;
            }
            // A `$` at column 0 is first run through markdown (for the line's block state), then
            // the token is rejected (end = 0) and re-run with `mathed` set, which enters math.
            mathed = true;
            forcedEnd = 0;
          }
          state.mathed = mathed;
        }
        //#endregion

        if (inMarkdownInline) {
          //#region Internal links and embeds
          if (state.internalLink) { state.hmdLinkType = LINK_INTERNAL; state.internalLink = false; }
          else if (state.internalEmbed) { state.hmdLinkType = LINK_EMBED; state.internalEmbed = false; }
          var inInternalLink = state.hmdLinkType === LINK_INTERNAL || state.hmdLinkType === LINK_EMBED;
          if (inInternalLink) {
            if (stream.peek() === "|") {
              state.isAlias = true;
              forcedEnd = stream.pos + 1;
              ans += " link-alias-pipe";
            } else if (stream.peek() === "]" && stream.match("]]", false)) {
              state.hmdLinkType = LINK_NONE;
              state.linkText = false;
              state.isAlias = false;
              state.hasAlias = false;
              forcedEnd = stream.pos + 2;
              ans += " formatting-link formatting-link-end";
            } else {
              useCopiedState = true;
              if (state.isAlias) ans += " link-alias";
              if (state.hasAlias && !state.isAlias) ans += " link-has-alias";
              tmp = stream.match(/^([^|\]]*?)/, false);
              forcedEnd = stream.pos + Math.max(1, tmp[0].length);
            }
          } else if ((tmp = (stream.peek() === "!" || stream.peek() === "[") && stream.match(/^(!?\[\[)(.*?)]]/, false))) {
            if (tmp[1].charAt(0) === "!") {
              ans += " formatting-link formatting-link-start formatting-embed";
              state.internalEmbed = true;
            } else {
              ans += " formatting-link formatting-link-start";
              state.internalLink = true;
            }
            forcedEnd = stream.pos + tmp[1].length;
            state.hasAlias = tmp[2].includes("|");
          }
          //#endregion

          //#region Footnote references [^ref]
          if (state.hmdLinkType === LINK_FOOTREF) {
            useCopiedState = true;
            if (stream.peek() === "]") {
              state.hmdLinkType = LINK_NONE;
              forcedEnd = stream.pos + 1;
              ans += " formatting formatting-link formatting-link-end " + linkStyle[LINK_FOOTREF];
            } else {
              tmp = stream.match(/^([^\]]*?)/, false);
              forcedEnd = stream.pos + Math.max(1, tmp[0].length);
            }
          } else {
            tmp = stream.peek() === "[" && stream.match(/^\[\^([^\]\s]*?)\](:?)/, false);
            if (tmp && !(bol && tmp[2])) {
              stream.match("[^");
              ans += " formatting formatting-link formatting-link-start";
              state.hmdLinkType = LINK_FOOTREF;
              forcedEnd = stream.pos;
            }
          }
          //#endregion

          // ^block-id at the very end of a line
          if (modeCfg.blockId && stream.peek() === "^" && stream.match(/^\^([a-zA-Z0-9\-]+)$/)) return ans += " blockid";

          //#region Inline footnotes ^[...]
          if (!state.inlineFootnote && stream.peek() === "^" && stream.match("^[", false)) {
            state.inlineFootnote = true;
            ans += " inline-footnote-start formatting-inline-footnote";
            forcedEnd = stream.pos + 2;
          } else if (state.inlineFootnote && !inInternalLink && state.hmdLinkType === LINK_NONE && !state.image && stream.match("]")) {
            state.inlineFootnote = false;
            ans += " footref inline-footnote inline-footnote-end formatting-inline-footnote";
            forcedEnd = stream.pos;
          }
          //#endregion

          //#region %%comments%%
          if (stream.peek() === "%" && stream.match("%%", false)) {
            if (state.comment) {
              ans += " comment formatting comment-end";
              state.comment = false;
            } else {
              ans += " comment formatting comment-start";
              state.comment = true;
            }
            forcedEnd = stream.pos + 2;
          } else if (state.comment) {
            ans += " comment";
          }
          //#endregion
        }

        // Bare URLs / e-mail addresses
        if (inMarkdownInline && !state.hmdLinkType && !state.image && !state.linkText) {
          var urlStart = stream.pos;
          if ((isLetter(stream.peek()) && stream.match(urlRE)) ||
              (!emailStartBlockerRE.test(stream.peek()) && stream.match(emailRE))) {
            ans += " url";
            forcedEnd = stream.pos;
            stream.pos = urlStart;
          }
        }

        // Continuation lines of a footnote definition are indented by multiples of the tab size
        if (bol && state.inFootnote) {
          var footIndent = stream.match(/^\s*/, false)[0].replace(/\t/g, "    ").length;
          if (footIndent && footIndent % stream.tabSize == 0) ans += " line-HyperMD-footnote";
          else state.inFootnote = false;
        }

        //#region Footnote / link reference definitions  [id]: url "title"
        var definition = bol && stream.peek() === "[" && stream.match(/^\[((?:[^\]\\]|\\.)*)\]:/, false);
        if (definition) {
          var label = definition[1];
          if (label[0] !== "^" || !/\s/.test(label)) {
            stream.match(/\[\^?/);
            state.hmdLinkType = LINK_FOOTNOTE;
            state.formatting = "link";
            state.linkText = true;
            return ans += "formatting formatting-link link " + linkStyle[LINK_FOOTNOTE];
          }
        } else if (state.hmdLinkType === LINK_FOOTNOTE) {
          if (stream.peek() === "]" && stream.match("]:")) {
            ans += " formatting formatting-link link " + linkStyle[LINK_FOOTNOTE];
            state.linkText = false;
            state.inFootnote = true;
            state.hmdLinkType = LINK_MAYBE_FOOTNOTE_URL;
            state.f = state.inline = rawMode.startState().inline;
            return ans;
          }
          ans += " link " + linkStyle[LINK_FOOTNOTE];
        } else if (state.hmdLinkType === LINK_MAYBE_FOOTNOTE_URL) {
          if (stream.eatSpace()) return ans;
          if (isLetter(stream.peek()) && stream.match(urlRE)) {
            ans += " url hmd-footnote-url";
            state.hmdLinkType = LINK_MAYBE_FOOTNOTE_URL_TITLE;
            return ans;
          }
          state.hmdLinkType = LINK_NONE;
        } else if (state.hmdLinkType === LINK_MAYBE_FOOTNOTE_URL_TITLE) {
          if (stream.eatSpace()) return ans;
          state.hmdLinkType = LINK_NONE;
          if (stream.match(/^(["']).*?\1/) || stream.match(/^\([^)]*?\)/)) return ans += " hmd-footnote-url-title";
        }
        //#endregion
      }

      if (state.hmdTable && stream.peek() === "|" && stream.string[stream.pos - 1] !== "\\") resetInlineStateAtCell(state);

      // ----- run the markdown base mode ----------------------------------------------------------
      if (state.hmdNextState) {
        stream.pos = state.hmdNextPos;
        ans += " " + (state.hmdNextStyle || "");
        Object.assign(state, state.hmdNextState);
        state.hmdNextState = null;
        state.hmdNextStyle = null;
        state.hmdNextPos = null;
      } else {
        var consumedAtBol = bol && stream.pos !== 0;
        if (useCopiedState) {
          var copy = rawMode.copyState(state);
          var savedPos = stream.pos;
          ans += " " + (rawMode.token(stream, copy) || "");
          stream.pos = savedPos;
        } else {
          ans += " " + (rawMode.token(stream, state) || "");
        }
        if (consumedAtBol && state.f === state.block) state.f = state.inline = rawMode.startState().inline;
        if (state.inFootnote) state.indentationDiff = 0;
      }

      ans = applyDisabledFeatures(state, ans);
      if (ans.includes("formatting-task")) ans += " line-HyperMD-task-line";
      if (forcedEnd !== -1) stream.pos = forcedEnd;
      if (state.hmdHashtag) ans += " " + modeCfg.tokenTypeOverrides.hashtag;
      if (state.header) state.isHeading = true;

      // capture the markdown mode's htmlBlock function (identity only)
      if (!rawClosure.htmlBlock && state.htmlState) rawClosure.htmlBlock = state.f;
      var inHTML = state.f === rawClosure.htmlBlock;
      var inCodeFence = state.code === -1;
      inMarkdown = inMarkdown && !(inHTML || inCodeFence);
      inMarkdownInline = inMarkdownInline && inMarkdown && !(state.code || state.indentedCode || state.linkHref);

      // A `|` inside a table ends inline HTML that swallowed it
      if (state.hmdTable && inHTML) {
        var cur = stream.current();
        if (/(?:^|[^\\])\|/.test(cur) && (ans.trim() === "" || /string|attribute|error/.test(ans))) {
          inHTML = false;
          wasInHTML = false;
          state.htmlState = null;
          state.block = rawClosure.block;
          state.f = state.inline = rawMode.startState().inline;
          stream.pos = cur === "|" ? stream.start : stream.start + 1;
        }
      }

      var current = stream.current();
      if (inHTML !== wasInHTML) {
        if (inHTML) {
          ans += " hmd-html-begin";
          rawClosure.htmlBlock = state.f;
        } else {
          ans += " hmd-html-end";
        }
      }

      if (wasInCodeFence || inCodeFence) {
        if (!(state.localMode && wasInCodeFence)) ans = ans.replace("inline-code", "");
        ans += " line-HyperMD-codeblock line-background-HyperMD-codeblock-bg hmd-codeblock";
        if (inCodeFence !== wasInCodeFence) {
          if (inCodeFence) {
            if (!wasInCodeFence) ans += " line-HyperMD-codeblock-begin line-background-HyperMD-codeblock-begin-bg line-parse-next";
          } else {
            ans += " line-HyperMD-codeblock-end line-background-HyperMD-codeblock-end-bg";
          }
        } else {
          ans += " line-parse-next";
        }
        if (state.list !== false && state.listStack && state.listStack.length > 0)
          ans += " line-HyperMD-list-line-nobullet line-HyperMD-list-line";
      }

      if (inMarkdown) {
        var tableType = state.hmdTable;   // NB: keeps its value even if the table ends below

        //#region Table rows: continue or end the table
        if (bol && tableType) {
          if ((tableType == TABLE_SIMPLE ? simpleTableRowRE : normalTableRowRE).test(stream.string)) {
            state.hmdTableCol = 0;
            state.hmdTableRow++;
          } else {
            resetTable(state);
          }
        }
        //#endregion

        //#region Headers, indented code, quotes, callouts
        if (bol && state.header) {
          if (/^(?:---+|===+)\s*$/.test(stream.string) && state.prevLine && state.prevLine.header)
            ans += " line-HyperMD-header-line line-HyperMD-header-line-" + state.header;
          else
            ans += " line-HyperMD-header line-HyperMD-header-" + state.header;
        }
        if (state.indentedCode) ans += " hmd-indented-code";
        if (state.quote) {
          if (!(stream.match(/^\s*>/, false) && !stream.eol())) {
            ans += " line-HyperMD-quote line-HyperMD-quote-" + state.quote + " line-parse-next";
            if (!/^ {0,3}\>/.test(stream.string)) ans += " line-HyperMD-quote-lazy";
          }
          if (bol && (tmp = current.match(/^\s+/))) {
            stream.pos = tmp[0].length;
            return (ans += " hmd-indent-in-quote").trim();
          }
          if (state.quote > prevQuote) {
            if (stream.peek() === "[" && stream.match(/^\[!([^\]]+)\]([+\-]?)(?:\s|$)/))
              ans += " line-HyperMD-callout hmd-callout line-HyperMD-quote line-HyperMD-quote-" + state.quote + " line-parse-next";
          }
        }
        //#endregion

        //#region Lists
        var maxNonCodeIndentation = (state.listStack[state.listStack.length - 1] || 0) + 3;
        var tokenIsIndent = bol && /^\s+$/.test(current) && (state.list !== false || stream.indentation() <= maxNonCodeIndentation);
        var tokenIsListBullet = state.list && ans.includes("formatting-list");
        if (tokenIsListBullet || (tokenIsIndent && (state.list !== false || stream.match(listRE, false)))) {
          var listLevel = (state.listStack && state.listStack.length) || 0;
          if (tokenIsIndent) {
            if (stream.match(listRE, false)) {
              if (state.list === false) listLevel++;
            } else {
              while (listLevel > 0 && stream.pos < state.listStack[listLevel - 1]) listLevel--;
              if (!listLevel) return ans.trim() || null;
              ans += " line-HyperMD-list-line-nobullet line-HyperMD-list-line line-HyperMD-list-line-" + listLevel;
            }
            ans += " hmd-list-indent hmd-list-indent-" + listLevel;
          } else if (tokenIsListBullet) {
            ans += " line-HyperMD-list-line line-HyperMD-list-line-" + listLevel;
          }
        }
        //#endregion

        //#region Markdown links, bare links, footnote refs
        if (wasLinkText !== state.linkText) {
          if (wasLinkText || state.internalLink || state.internalEmbed) {
            // leaving a link
            if (state.hmdLinkType !== LINK_FOOTNOTE) {
              if (state.hmdLinkType in linkStyle) ans += " " + linkStyle[state.hmdLinkType];
              state.hmdLinkType = LINK_NONE;
            }
          } else if ((tmp = stream.match(/^([^\]]+)\](\(| ?\[|\:)?/, false))) {
            // entering a link
            if (tmp[2]) {
              if ((tmp[2] === "[" || tmp[2] === " [") && stream.string.charAt(stream.pos + tmp[0].length) === "]")
                state.hmdLinkType = LINK_BARELINK2;
              else
                state.hmdLinkType = LINK_NORMAL;
            } else if (tmp[1][0] === "^" && !/\s/.test(tmp[1])) {
              state.hmdLinkType = LINK_FOOTREF;
            } else {
              state.hmdLinkType = LINK_BARELINK;
            }
          } else {
            state.hmdLinkType = LINK_BARELINK;   // link text broken by a line end
          }
        }
        if (wasLinkHref !== state.linkHref) {
          if (wasLinkHref) {
            // leaving a href; NB: a NORMAL link has no style entry and adds " undefined"
            if (state.hmdLinkType) {
              ans += " " + linkStyle[state.hmdLinkType];
              state.hmdLinkType = LINK_NONE;
            }
          } else if (current === "[" && stream.peek() !== "]") {
            state.hmdLinkType = LINK_FOOTREF2;   // [text][ref]
          }
        }
        if (state.hmdLinkType !== LINK_NONE && state.hmdLinkType in linkStyle) ans += " " + linkStyle[state.hmdLinkType];
        if (state.inlineFootnote) ans += " footref inline-footnote";
        //#endregion

        //#region Escapes: split "\x" into backslash + escaped char
        if (isEscape && current.length > 1) {
          var escapedLength = current.length - 1;
          var escapedCharStyle = ans.replace("formatting-escape", "escape") + " hmd-escape-char";
          state.hmdOverride = function (stream, state) {
            stream.pos += escapedLength;
            state.hmdOverride = null;
            return escapedCharStyle.trim();
          };
          ans += " hmd-escape-backslash";
          stream.pos -= escapedLength;
          return ans;
        }
        //#endregion

        //#region Tables: create tables and style cell separators
        if (!ans.trim() && modeCfg.table) {
          var isTableSep = false;
          if (current.charAt(0) === "|") {
            stream.pos = stream.start + 1;
            current = "|";
            isTableSep = true;
          }
          // a table must start after a blank line or a heading
          if (!tableType && state.prevLine && state.prevLine.stream && state.prevLine.stream.string.trim() && !state.wasHeading)
            isTableSep = false;
          if (isTableSep) {
            if (!tableType) {
              if (simpleTableRE.test(stream.string)) tableType = TABLE_SIMPLE;
              else if (normalTableRE.test(stream.string)) tableType = TABLE_NORMAL;
              var columns = undefined;
              if (tableType) {
                var nextLine = stream.lookAhead(1);
                if (tableType === TABLE_NORMAL) {
                  if (normalTableRE.test(nextLine)) nextLine = nextLine.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
                  else tableType = TABLE_NONE;
                } else if (tableType === TABLE_SIMPLE) {
                  if (!simpleTableRE.test(nextLine)) tableType = TABLE_NONE;
                }
                if (tableType) {
                  columns = nextLine.split("|");
                  for (var ci = 0; ci < columns.length; ci++) {
                    var col = columns[ci];
                    if (alignRightRE.test(col)) col = "right";
                    else if (alignLeftRE.test(col)) col = "left";
                    else if (alignCenterRE.test(col)) col = "center";
                    else if (alignDefaultRE.test(col)) col = "default";
                    else { tableType = TABLE_NONE; break; }
                    columns[ci] = col;
                  }
                }
              }
              if (tableType) {
                state.hmdTable = tableType;
                state.hmdTableColumns = columns;
                if (textDirection(stream.string) === "rtl") state.hmdTableRTL = true;
                state.hmdTableRow = state.hmdTableCol = 0;
              }
            }
            if (tableType) {
              var colUbound = state.hmdTableColumns.length - 1;
              var row = state.hmdTableRow, colIndex = state.hmdTableCol;
              if (colIndex == 0) {
                ans += " line-HyperMD-table-" + tableType + " line-HyperMD-table-row line-HyperMD-table-row-" + row + " line-parse-next";
                if (state.hmdTableRTL) ans += " line-HyperMD-table-rtl";
              }
              if (tableType === TABLE_NORMAL && ((state.hmdTableCol === 0 && /^\s*\|$/.test(stream.string.slice(0, stream.pos))) || stream.match(/^\s*$/, false))) {
                ans += " hmd-table-sep hmd-table-sep-dummy";
              } else if (state.hmdTableCol < colUbound) {
                ans += " hmd-table-sep hmd-table-sep-" + colIndex;
                state.hmdTableCol += 1;
              }
            }
          }
        }
        //#endregion

        // ":---:" in a delimiter row is not an emoji
        if (tableType && state.hmdTableRow === 1 && ans.includes("emoji")) ans = "";

        //#region <!DOCTYPE>, <![CDATA[ ]]>, <? ?>
        if (inMarkdownInline && current === "<") {
          var htmlEndTag = null;
          if (stream.peek() === "!" && stream.match(/^\![A-Z]+/)) htmlEndTag = ">";
          else if (stream.peek() === "!" && stream.match("![CDATA[")) htmlEndTag = "]]>";
          else if (stream.peek() === "?") htmlEndTag = "?>";
          if (htmlEndTag != null) {
            return enterMode(stream, state, null, {
              endTag: htmlEndTag,
              style: (ans + " comment hmd-cdata-html").trim()
            });
          }
        }
        //#endregion

        //#region #hashtags
        if (modeCfg.hashtag && inMarkdownInline) {
          if (state.hmdHashtag) {
            var endHashtag = false;
            ans = ans.replace(/((formatting )?formatting-em|em) /g, "");
            if (!ans.includes("formatting") && !/^\s*$/.test(current)) {
              tmp = current.match(tagCharsRE);
              var backUpChars = current.length - (tmp ? tmp[0].length : 0);
              if (backUpChars > 0) {
                stream.backUp(backUpChars);
                endHashtag = true;
              }
            }
            if (!endHashtag) endHashtag = stream.eol();
            if (!endHashtag) endHashtag = !tagCharsRE.test(stream.peek());
            if (endHashtag) {
              ans += " hashtag-end tag-" + stream.current().replace(/[^_a-zA-Z0-9\-]/g, "");
              state.hmdHashtag = false;
            }
          } else if (current === "#" && !state.linkText && !state.image &&
                     (bol || /^\s*$/.test(stream.string.charAt(stream.start - 1)))) {
            var rest = stream.string.slice(stream.pos).replace(/\\./g, "");
            tmp = tagCharsRE.exec(rest);
            if (tmp && /[^0-9]/.test(tmp[0])) {
              state.hmdHashtag = true;
              ans += " formatting formatting-hashtag hashtag-begin " + modeCfg.tokenTypeOverrides.hashtag +
                " tag-" + tmp[0].replace(/[^_a-zA-Z0-9\-]/g, "");
            }
          }
        }
        //#endregion
      }

      return ans.trim() || null;
    };

    return newMode;
  }, "hypermd");

  CodeMirror.defineMIME("text/x-hypermd", "hypermd");
}
