import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import matlab from "highlight.js/lib/languages/matlab";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import rust from "highlight.js/lib/languages/rust";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import scala from "highlight.js/lib/languages/scala";
import perl from "highlight.js/lib/languages/perl";
import julia from "highlight.js/lib/languages/julia";
import fortran from "highlight.js/lib/languages/fortran";

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Node as ProseMirrorNode } from "prosemirror-model";

hljs.registerLanguage("python", python);
hljs.registerLanguage("r", r);
hljs.registerLanguage("matlab", matlab);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("java", java);
hljs.registerLanguage("go", go);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("perl", perl);
hljs.registerLanguage("julia", julia);
hljs.registerLanguage("fortran", fortran);

interface Token {
  text: string;
  classes: string[];
}

function parseHljsHtml(html: string): Token[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<pre><code>${html}</code></pre>`, "text/html");
  const code = doc.querySelector("code");
  if (!code) return [];

  const tokens: Token[] = [];

  function walk(node: Node, parentClasses: string[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text) tokens.push({ text, classes: parentClasses });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const ownClasses = Array.from(el.classList);
      const inherited = parentClasses.length > 0
        ? [...parentClasses, ...ownClasses]
        : ownClasses;
      for (const child of el.childNodes) {
        walk(child, inherited);
      }
    }
  }

  for (const child of code.childNodes) {
    walk(child, []);
  }

  return tokens;
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return true;

    const lang = (node.attrs.language as string) || "";
    const text = node.textContent;

    if (!lang || !text || !hljs.getLanguage(lang)) return false;

    try {
      const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
      const tokens = parseHljsHtml(result.value);

      let offset = pos + 1;
      for (const token of tokens) {
        const from = offset;
        const to = offset + token.text.length;
        if (token.classes.length > 0) {
          decos.push(Decoration.inline(from, to, { class: token.classes.join(" ") }));
        }
        offset = to;
      }
    } catch {
      // Ignore highlighting errors
    }

    return false;
  });

  return DecorationSet.create(doc, decos);
}

const highlightKey = new PluginKey<DecorationSet>("highlight");

export function buildHighlightPlugin(): Plugin {
  return new Plugin({
    key: highlightKey,
    state: {
      init(_, { doc }) {
        return buildDecorations(doc);
      },
      apply(tr, old) {
        if (!tr.docChanged) return old.map(tr.mapping, tr.doc);
        return buildDecorations(tr.doc);
      },
    },
    props: {
      decorations(state) {
        return highlightKey.getState(state);
      },
    },
  });
}
