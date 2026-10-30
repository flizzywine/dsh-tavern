var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// tavern-plugin/mods/textcard/mod.json
var mod_default = {
  format: "dsh-mod",
  schemaVersion: 4,
  experimental: true,
  id: "dsh.textcard",
  name: "\u6587\u5B57\u6F14\u51FA",
  packageName: "dsh-tavern-mod-textcard",
  version: "2.0.0",
  hostApi: ">=1.0.0 <2.0.0",
  dependencies: [],
  config: {
    version: 1,
    schema: {
      type: "object",
      properties: {
        intensity: {
          enum: [
            "restrained",
            "standard",
            "intense"
          ],
          type: "string",
          userAdjustable: true
        }
      },
      additionalProperties: false,
      required: [
        "intensity"
      ]
    },
    defaults: {
      intensity: "standard"
    }
  },
  preferences: {
    schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    defaults: {}
  },
  dataVersion: 1,
  assetKinds: [],
  coreAssets: [],
  permissions: [
    "stage.presentation"
  ],
  performances: [
    {
      kind: "dsh.textcard.compound",
      blocking: true,
      autoHold: {
        minMs: 0,
        until: "complete"
      },
      regions: [
        "center-card"
      ],
      backlog: {
        renderer: "textcard",
        role: "notice"
      },
      replay: {
        stage: true
      }
    },
    {
      kind: "dsh.textcard.card",
      blocking: true,
      autoHold: {
        minMs: 0,
        until: "complete"
      },
      regions: [
        "center-card"
      ],
      backlog: {
        renderer: "textcard",
        role: "notice"
      },
      replay: {
        stage: true
      }
    }
  ],
  entry: "plugin.mjs",
  prompts: [
    {
      id: "rules",
      model: "director",
      tag: "mod_textcard",
      slot: "rules.after-core",
      order: 40,
      byteBudget: 4096,
      when: {},
      markdown: '- Follow the request performance budget; one template is one performance. Safe colours, automatic layout/timing; live-once.\n- beat.at is the source paragraph; after follows its last page, before precedes its first. Default after; title before.\n- show: word/name/marker/vertical/punct; one-glyph word is enlarged. title: chapters. sequence: echoes or colour signals.\n- count: seconds to zero; relate: people and directed links; compare: viewpoints; reveal: clues to an answer; repeat: obsession; read: a dossier.\n- People IDs are local keys, names are display text. Link endpoints use those IDs. All strings are nonblank.\n- Example: {"op":"mod.dsh.textcard.count","from":3,"label":"Door closes"}.'
    }
  ],
  summary: "\u7528\u6587\u5B57\u5361\u5448\u73B0\u5267\u60C5\u4E2D\u7684\u91CD\u8981\u63D0\u793A\u4E0E\u62A5\u5E55\u3002"
};

// tavern-plugin/mods/textcard/manifest.json
var manifest_default = {
  format: "dsh-mod",
  schemaVersion: 2,
  id: "dsh.textcard",
  name: "\u6587\u5B57\u6F14\u51FA",
  summary: "\u5BFC\u6F14\u9A71\u52A8\u7684\u7269\u8BED\u5F0F\u6587\u5B57\u5361\uFF1B\u4EC5\u64AD\u653E\u4E00\u6B21\uFF0C\u5B8C\u6574\u4FDD\u7559\u5C65\u5386",
  relevance: "\u60C5\u7EEA\u8F6C\u6298\u3001\u5F3A\u8C03\u3001\u56DE\u5FC6\u3001\u7AE0\u8282\u5207\u6362\u7B49\u9002\u5408\u6587\u5B57\u5361\u6F14\u51FA\u7684\u65F6\u523B",
  version: "2.0.0",
  apiVersion: 1,
  dependencies: {
    hostApi: 1,
    capabilities: [
      "stage.place"
    ]
  },
  permissions: {
    stage: [
      "place"
    ]
  },
  commands: [
    {
      id: "show",
      op: "text.show",
      dsl: {
        verb: "text",
        syntax: 'text show text="words" [preset=word|name|marker|vertical|punct] [sub="caption"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          text: {
            type: "string",
            minLength: 1,
            maxLength: 96,
            description: "Max by preset: word48/name32/marker24/vertical96/punct12."
          },
          preset: {
            type: "string",
            enum: [
              "word",
              "name",
              "marker",
              "vertical",
              "punct"
            ],
            default: "word"
          },
          sub: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "text"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 30
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "title",
      op: "mod.dsh.textcard.title",
      dsl: {
        verb: "tc-title",
        syntax: 'tc-title title text="chapter" [sub="caption"] [placement=before|after]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          text: {
            type: "string",
            minLength: 1,
            maxLength: 48
          },
          sub: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "before"
          }
        },
        required: [
          "text"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 31
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "replaces",
      replaces: "title.play"
    },
    {
      id: "sequence",
      op: "mod.dsh.textcard.sequence",
      dsl: {
        verb: "tc-sequence",
        syntax: 'tc-sequence sequence words=["word",...] [kind=echo|signal] [sub="caption"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          words: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 48
            },
            description: "signal: max24 chars/word."
          },
          kind: {
            type: "string",
            enum: [
              "echo",
              "signal"
            ],
            default: "echo"
          },
          sub: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "words"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 32
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "count",
      op: "mod.dsh.textcard.count",
      dsl: {
        verb: "tc-count",
        syntax: 'tc-count count from=3 [label="deadline"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          from: {
            type: "integer",
            minimum: 0,
            maximum: 60
          },
          label: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "from"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 33
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "relate",
      op: "mod.dsh.textcard.relate",
      dsl: {
        verb: "tc-relate",
        syntax: 'tc-relate relate people=[{id:"p-01",name:"A"},{id:"p-02",name:"B"}] links=[{from:"p-01",to:"p-02",label:"trust"}] [heading="map"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          people: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  minLength: 1,
                  maxLength: 32
                },
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: 32
                }
              },
              required: [
                "id",
                "name"
              ],
              additionalProperties: false
            }
          },
          links: {
            type: "array",
            minItems: 0,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                from: {
                  type: "string",
                  minLength: 1,
                  maxLength: 32
                },
                to: {
                  type: "string",
                  minLength: 1,
                  maxLength: 32
                },
                label: {
                  type: "string",
                  minLength: 1,
                  maxLength: 24
                }
              },
              required: [
                "from",
                "to",
                "label"
              ],
              additionalProperties: false
            },
            description: "Unique people IDs; endpoints must exist and differ."
          },
          heading: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "people",
          "links"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 34
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "compare",
      op: "mod.dsh.textcard.compare",
      dsl: {
        verb: "tc-compare",
        syntax: 'tc-compare compare sides=[{name:"said",text:"safe"},{name:"thought",text:"danger"}] [topic="contrast"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          sides: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  minLength: 1,
                  maxLength: 12
                },
                text: {
                  type: "string",
                  minLength: 1,
                  maxLength: 24
                }
              },
              required: [
                "name",
                "text"
              ],
              additionalProperties: false
            }
          },
          topic: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "sides"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 35
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "reveal",
      op: "mod.dsh.textcard.reveal",
      dsl: {
        verb: "tc-reveal",
        syntax: 'tc-reveal reveal answer="truth" [clues=["hint",...]] [caption="answer"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          clues: {
            type: "array",
            minItems: 1,
            maxItems: 7,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 96
            },
            description: "Omit for automatic prefixes; otherwise clues then answer."
          },
          caption: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "answer"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 36
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "repeat",
      op: "mod.dsh.textcard.repeat",
      dsl: {
        verb: "tc-repeat",
        syntax: 'tc-repeat repeat word="again" [echo="background word"] [label="caption"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          word: {
            type: "string",
            minLength: 1,
            maxLength: 32
          },
          echo: {
            type: "string",
            minLength: 1,
            maxLength: 96,
            description: "Default: word."
          },
          label: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "word"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 37
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    },
    {
      id: "read",
      op: "mod.dsh.textcard.read",
      dsl: {
        verb: "tc-read",
        syntax: 'tc-read read code="CASE-047" body="record" [heading="dossier"] [placement=after|before]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          code: {
            type: "string",
            minLength: 1,
            maxLength: 48
          },
          body: {
            type: "string",
            minLength: 1,
            maxLength: 800
          },
          heading: {
            type: "string",
            minLength: 1,
            maxLength: 96
          },
          placement: {
            type: "string",
            enum: [
              "after",
              "before"
            ],
            default: "after"
          }
        },
        required: [
          "code",
          "body"
        ],
        additionalProperties: false
      },
      persistence: "event",
      handler: "command",
      promptId: "text-rule",
      placement: {
        section: "director.commands.presentation",
        order: 38
      },
      caps: {
        perTurn: 8,
        bytes: 8192,
        group: "textcard"
      },
      mode: "adds"
    }
  ],
  prompts: [
    {
      id: "text-rule",
      target: "director",
      path: "prompts/textcard.txt",
      placement: {
        section: "director.rules.presentation",
        order: 30
      }
    }
  ],
  settingsSchema: {
    fields: [
      {
        key: "intensity",
        type: "segmented",
        label: "\u5F3A\u5EA6",
        default: "standard",
        scope: "global",
        choices: [
          {
            value: "restrained",
            label: "\u514B\u5236"
          },
          {
            value: "standard",
            label: "\u6807\u51C6"
          },
          {
            value: "intense",
            label: "\u6D53\u70C8"
          }
        ]
      }
    ],
    sections: [
      {
        id: "presentation",
        title: "\u6587\u5B57\u6F14\u51FA",
        fields: [
          "intensity"
        ]
      }
    ]
  },
  packSchema: {
    fields: []
  },
  assetKinds: [],
  uiPages: [],
  runtime: {
    entry: "runtime.js"
  },
  defaultPacks: [],
  files: [
    {
      path: "runtime.js",
      size: 1782
    },
    {
      path: "presets.js",
      size: 4272
    },
    {
      path: "prompts/textcard.txt",
      size: 719
    },
    {
      path: "templates.js",
      size: 9762
    }
  ],
  license: {
    privateUse: false
  },
  compatibility: {
    compatible: [],
    incompatible: []
  },
  admission: {
    entryKinds: []
  },
  builtinAssets: []
};

// tavern-plugin/mods/textcard/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  command: () => command,
  commandSchema: () => commandSchema,
  configure: () => configure,
  dispose: () => dispose,
  prepare: () => prepare,
  settled: () => settled,
  validateCommand: () => assertTextcardSemantics
});

// tavern-plugin/mods/textcard/presets.js
var INTENSITIES = Object.freeze({ restrained: { cap: 5, scale: 1.3 }, standard: { cap: 8, scale: 1 }, intense: { cap: 12, scale: 0.75 } });
var MORPHS = Object.freeze({
  "\u660E": ["\u65E5", "\u6708"],
  "\u6797": ["\u6728", "\u6728"],
  "\u68EE": ["\u6728", "\u6728", "\u6728"],
  "\u4F11": ["\u4EBA", "\u6728"],
  "\u597D": ["\u5973", "\u5B50"],
  "\u87F9": ["\u89D2", "\u5200", "\u725B", "\u866B"]
});
var PRESETS = Object.freeze({
  punct: { category: 1, frames: 12, help: "small punctuation card", maxLength: 12 },
  title: { category: 2, frames: 58, help: "framed chapter title", maxLength: 48 },
  name: { category: 3, frames: 18, help: "spaced character name", maxLength: 32 },
  kanji: { category: 4, frames: 20, help: "one giant glyph", maxLength: 1 },
  word: { category: 5, frames: 20, help: "short phrase with whitespace", maxLength: 48 },
  vertical: { category: 6, frames: 30, help: "vertical columns; newline separates columns", maxLength: 96 },
  page: { category: 7, frames: 30, help: "dense paragraph page", maxLength: 800 },
  pattern: { category: 8, frames: 21, help: "repeated text wall; sub is background word", maxLength: 32 },
  split: { category: 9, frames: 72, help: "2-3 white divided panes", minItems: 2, maxItems: 3, maxLength: 24 },
  morph: { category: 10, frames: 48, help: "components assemble preset glyph", maxLength: 1, enum: Object.keys(MORPHS) },
  pair: { category: 11, frames: 4, help: "two words alternate; inversion is safety gated", minItems: 2, maxItems: 2, maxLength: 12, sequence: true, colour: true },
  build: { category: 12, frames: 82, help: "progressive input; final state held", maxItems: 8, maxLength: 96, build: true },
  count: { category: 13, frames: 4, help: "countdown; one digit auto expands, or explicit number words", maxItems: 8, maxLength: 12, sequence: true },
  code: { category: 14, frames: 41, help: "code with dots and bars", maxLength: 48 },
  diagram: { category: 15, frames: 152, help: "2-8 connected label nodes", minItems: 2, maxItems: 8, maxLength: 32 },
  marker: { category: 16, frames: 30, help: "recall/aside/ad/next or custom scene marker", maxLength: 24 },
  colour: { category: 22, frames: 8, help: "same layout with semantic palette", maxItems: 8, maxLength: 24, sequence: true, colour: true },
  oversized: { category: 23, frames: 20, help: "giant cropped word", maxLength: 12 },
  flash: { category: 5, frames: 8, help: "short word sequence on stable ink ground", minItems: 2, maxItems: 8, maxLength: 48, sequence: true }
});
var intensityOf = (settings) => Object.hasOwn(INTENSITIES, settings?.values?.intensity) ? settings.values.intensity : "standard";

// tavern-plugin/mods/textcard/templates.js
var TEXTCARD_COMPOUND_KIND = "dsh.textcard.compound";
var TEXTCARD_TEMPLATE_IDS = Object.freeze(["show", "title", "sequence", "count", "relate", "compare", "reveal", "repeat", "read"]);
var markers = { recall: ["\u56DE\u60F3", "RECALL"], aside: ["\u9591\u8A71\u4F11\u984C", "DIGRESSION"], ad: ["\u4EE5\u4E0B\u5EE3\u544A", "COMMERCIAL"], next: ["\u6B21\u56DE", "NEXT"] };
var punct = { "\u8D64\u9F63": "vermilion", "\u9ED2\u9F63": "ink", "\u9ED1\u9F63": "ink", "\u767D\u9F63": "paper" };
var colourWords = [[/^[\u8d64\u7ea2\u7d05\u6731]/, "vermilion", "RED"], [/^\u767d/, "paper", "WHITE"], [/^[\u9ed1\u9ed2]/, "ink", "BLACK"], [/^[\u91d1\u9ec4\u9ec3]/, "gold", "GOLD"]];
var fail = (path, message) => {
  throw Object.assign(new Error(message), { code: "MOD_API_UNSUPPORTED", path });
};
var length = (value) => [...value].length;
function assertTextcardSemantics(commandId, params) {
  const nonblank = (value, path) => {
    if (typeof value === "string" && !value.trim()) fail(path, "Use nonblank text or omit this optional field.");
    else if (Array.isArray(value)) value.forEach((item, i) => nonblank(item, path + "[" + i + "]"));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) nonblank(item, path + "." + key);
  };
  nonblank(params, "$.params");
  const max = (value, n, path) => {
    if (length(value) > n) fail(path, `Use at most ${n} characters; shorten this text.`);
  };
  if (commandId === "show") max(params.text, { word: 48, name: 32, marker: 24, vertical: 96, punct: 12 }[params.preset || "word"], "$.params.text");
  if (commandId === "sequence" && params.kind === "signal") params.words.forEach((word, i) => max(word, 24, "$.params.words[" + i + "]"));
  if (commandId === "relate") {
    const ids = /* @__PURE__ */ new Set();
    params.people.forEach(({ id }, i) => {
      if (ids.has(id)) fail("$.params.people[" + i + "].id", "Duplicate node " + id + "; use a unique local ID for each person.");
      ids.add(id);
    });
    params.links.forEach((link, i) => {
      for (const key of ["from", "to"]) if (!ids.has(link[key])) fail("$.params.links[" + i + "]." + key, "Unknown node " + link[key] + "; use one of " + [...ids].join(", ") + ".");
      if (link.from === link.to) fail("$.params.links[" + i + "].to", "Use a different node from " + link.from + "; a relationship connects two people.");
    });
  }
}
var ink = (bg) => bg === "figure" ? "auto" : ["ink", "vermilion"].includes(bg) ? "paper" : "ink";
var size = (text) => length(text.replace(/\s/g, "")) <= 2 ? "xl" : length(text.replace(/\s/g, "")) <= 8 ? "l" : "m";
var frame = (style, layout, f, state, { bg = "paper", face = "mincho", size: fontSize = "m", motif = "reading", dir = "h" } = {}) => ({ style, layout, f, bg, fg: ink(bg), type: { face, size: fontSize }, motif, dir, state });
var partition = (total, n) => Array.from({ length: n }, (_, i) => Math.floor((i + 1) * total / n) - Math.floor(i * total / n));
function compileTextcard(commandId, params, intensity = "standard") {
  assertTextcardSemantics(commandId, params);
  const scaled = (f) => Math.max(3, Math.round(f * INTENSITIES[intensity].scale));
  const frames = [], parts = [];
  let graph;
  const add = (...args) => frames.push(frame(...args));
  const remember = (...texts) => parts.push(...texts.filter((text) => text !== void 0));
  const card = (style, text, sub) => {
    const defaults = { word: ["card", 20, "paper", "auto"], kanji: ["card", 20, "paper", "xl"], name: ["name", 18, "figure", "l"], marker: ["marker", 30, "vermilion", "l"], vertical: ["card", 30, "paper", "m"], punct: ["punct", 12, punct[text] || "ink", "xs"], title: ["title", 58, "ink", "m"], oversized: ["card", 20, "vermilion", "crop"] };
    const [layout, f, bg, fontSize] = defaults[style];
    const marker = style === "marker" ? markers[text] : null;
    const shown = marker?.[0] || text;
    add(style, layout, scaled(f), { text: shown, sub: sub || "", size: fontSize === "auto" ? size(shown) : fontSize, ...marker ? { roman: marker[1] } : {}, ...style === "oversized" ? { anchor: "center" } : {} }, { bg, size: fontSize, dir: style === "vertical" ? "v" : "h", motif: style === "title" ? "frame" : style === "name" ? "rule" : "reading" });
    return shown;
  };
  switch (commandId) {
    case "show": {
      let style = params.preset || "word";
      if (style === "word" && length(params.text) === 1) style = "kanji";
      remember(card(style, params.text, params.sub), params.sub);
      break;
    }
    case "title":
      remember(card("title", params.text, params.sub), params.sub);
      break;
    case "sequence": {
      const signal = params.kind === "signal";
      if (!signal && params.words.length === 1) card("word", params.words[0], params.sub);
      else {
        let other = 0;
        for (const text of params.words) {
          const match = signal ? colourWords.find(([pattern]) => pattern.test(text)) : null;
          const bg = signal ? match?.[1] || (other++ % 2 ? "paper" : "figure") : "ink";
          add(signal ? "colour" : "flash", "flash", Math.max(signal ? 9 : 3, scaled(8)), { text, sub: params.sub || match?.[2] || "", size: size(text) }, { bg, size: "auto", motif: signal ? "english" : "none" });
        }
      }
      remember(...params.words, params.sub);
      break;
    }
    case "count": {
      for (let n = params.from; n >= 0; n--) add("count", "flash", n === 0 ? 12 : 24, { text: String(n), sub: params.label || "", size: "xl" }, { bg: "ink", size: "xl", motif: "none" });
      remember(...frames.map((row) => row.state.text), params.label);
      break;
    }
    case "relate": {
      const columns = Math.ceil(params.people.length / 2), rows = Math.ceil(params.people.length / columns);
      const people = params.people.map((person, i) => ({ ...person, x: (i % columns + 0.5) / columns, y: (Math.floor(i / columns) + 0.5) / rows }));
      const links = params.links.map((link) => ({ ...link }));
      graph = { people, links, sub: params.heading || "" };
      const state = (visiblePeople, visibleLinks) => ({ visiblePeople, visibleLinks });
      partition(scaled(24), people.length).forEach((f, i) => add("relate", "relate", f, state(i + 1, 0), { size: "s", motif: "lines" }));
      partition(scaled(24), Math.max(1, links.length)).forEach((f, i) => add("relate", "relate", f, state(people.length, Math.min(i + 1, links.length)), { size: "s", motif: "lines" }));
      add("relate", "relate", scaled(104), state(people.length, links.length), { size: "s", motif: "lines" });
      const names = new Map(people.map((person) => [person.id, person.name]));
      remember(params.heading, ...people.map((person) => person.name), ...links.map((link) => names.get(link.from) + " -> " + names.get(link.to) + ": " + link.label));
      break;
    }
    case "compare": {
      const pair = params.sides.length === 2, n = pair ? { restrained: 4, standard: 6, intense: 8 }[intensity] : 3;
      for (let i = 0; i < n; i++) {
        const bg = pair && Math.floor(i / 2) % 2 ? "paper" : "ink";
        add(pair ? "pair" : "flash", "flash", Math.max(pair ? 9 : 3, scaled(pair ? 4 : 8)), { text: params.sides[i % params.sides.length].name, sub: params.topic || "", size: size(params.sides[i % params.sides.length].name) }, { bg, size: "auto", motif: pair ? "invert" : "none" });
      }
      add("split", "split", scaled(72), { cells: params.sides.length, panes: params.sides.map((side) => side.text), names: params.sides.map((side) => side.name), sub: params.topic || "" }, { size: "xl", motif: "rules" });
      remember(params.topic, ...params.sides.map((side) => side.name + ": " + side.text));
      break;
    }
    case "reveal": {
      const letters = [...params.answer], n = Math.min(8, letters.length);
      const steps = params.clues ? [...params.clues, params.answer] : Array.from({ length: n }, (_, i) => letters.slice(0, Math.ceil((i + 1) * letters.length / n)).join(""));
      const total = scaled(82), early = Math.max(3, Math.floor(total / 2 / Math.max(1, steps.length - 1)));
      steps.forEach((text, i) => {
        const last = i === steps.length - 1, previous = i ? steps[i - 1] : "", committed = last ? text : text.startsWith(previous) ? previous : "";
        add("build", "ime", last ? total - early * (steps.length - 1) : early, { committed, typing: last ? "" : text.slice(committed.length), caret: !last, final: params.answer, sub: params.caption || "" }, { motif: "caret" });
      });
      if (Object.hasOwn(MORPHS, params.answer)) {
        const total2 = scaled(48), first = Math.round(total2 * 34 / 48);
        add("morph", "morph", first, { parts: [...MORPHS[params.answer]], text: params.answer, converge: true, sub: params.caption || "" }, { size: "xl", motif: "gloss" });
        add("morph", "morph", total2 - first, { parts: [], text: params.answer, final: true, sub: params.caption || "" }, { size: "xl", motif: "gloss" });
      }
      remember(...steps, params.caption);
      break;
    }
    case "repeat":
      add("pattern", "wall", scaled(21), { text: params.word, fill: params.echo ?? params.word, sub: params.label || "" }, { size: "s", motif: "drift" });
      card(length(params.word) <= 12 ? "oversized" : "word", params.word, params.label);
      remember(params.word, ...params.echo === void 0 ? [] : [params.echo], params.label);
      break;
    case "read":
      add("code", "code", scaled(41), { text: params.code, sub: params.heading || "" }, { face: "mono", size: "l", motif: "bars" });
      add("page", "page", scaled(30), { text: params.body, sub: params.heading || "" }, { size: "s", dir: "v", motif: "margin" });
      remember(params.heading, params.code, params.body);
      break;
    default:
      fail("$.commandId", "Choose a textcard command: " + TEXTCARD_TEMPLATE_IDS.join(", ") + ".");
  }
  let view, storedFrames = frames;
  if (commandId === "count") {
    const { f, state, ...appearance } = frames[0];
    view = { ...appearance, state: { sub: state.sub, size: state.size } };
    storedFrames = frames.map((row) => ({ f: row.f, state: { text: row.state.text } }));
  }
  return {
    version: 1,
    playback: "live-once",
    template: commandId,
    placement: params.placement || (commandId === "title" ? "before" : "after"),
    intensity,
    fps: 24,
    minColourFrames: 9,
    frames: storedFrames,
    ...view ? { view } : {},
    ...graph ? { graph } : {},
    text: parts.join(" / "),
    history: { kind: "textcard", style: commandId, parts: [...parts], text: parts.join(" / ") }
  };
}

// tavern-plugin/mods/textcard/runtime.js
function commandSchema({ manifest }) {
  return structuredClone(manifest.commands);
}
function configure({ manifest, settings }) {
  const commands = commandSchema({ manifest }), intensity = intensityOf(settings);
  for (const command2 of commands) command2.caps.perTurn = INTENSITIES[intensity].cap;
  return { commands };
}
async function prepare(_input, host) {
  const intensity = intensityOf(await host.settings.get({}));
  return { sections: [{ id: "text-rule", text: '<mod_textcard>\n- Share 8 performances per turn; one template is one performance. Safe colours, automatic layout/timing; live-once.\n- beat.at is the source paragraph; after follows its last page, before precedes its first. Default after; title before.\n- show: word/name/marker/vertical/punct; one-glyph word is enlarged. title: chapters. sequence: echoes or colour signals.\n- count: seconds to zero; relate: people and directed links; compare: viewpoints; reveal: clues to an answer; repeat: obsession; read: a dossier.\n- People IDs are local keys, names are display text. Link endpoints use those IDs. All strings are nonblank.\n- Example: {"op":"mod.dsh.textcard.count","from":3,"label":"Door closes"}.\n</mod_textcard>\n'.replace("Share 8 performances", "Share " + INTENSITIES[intensity].cap + " performances") }] };
}
async function command({ commandId, params }, host) {
  const payload = compileTextcard(commandId, params, intensityOf(await host.settings.get({})));
  return host.stage.place({ id: "text", kind: TEXTCARD_COMPOUND_KIND, payload });
}
function settled() {
  return null;
}
function dispose() {
}

// tavern-plugin/mods/textcard/plugin.mjs
var name = "dsh-tavern-mod-textcard";
var inject = ["tavern"];
function apply(ctx) {
  ctx.tavern.registerMod(mod_default, {
    execution: runtime_exports,
    commands: manifest_default.commands,
    prepare: (_input, _host, config) => configure({ manifest: manifest_default, settings: { values: config.values } }),
    command: (input, host, config) => command(input, { ...host, settings: { get: async () => ({ values: config.values }) } }),
    dispose
  });
}
export {
  apply,
  inject,
  name
};
