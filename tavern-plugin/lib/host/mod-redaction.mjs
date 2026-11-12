var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// tavern-plugin/mods/redaction/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  REDACTION_KINDS: () => REDACTION_KINDS,
  command: () => command,
  configure: () => configure,
  dispose: () => dispose,
  prepare: () => prepare
});
var REDACTION_KINDS = ["bar", "glitch"];
var settingsOf = (settings) => ({ kind: settings?.values?.kind === "glitch" ? "glitch" : "bar", guidance: String(settings?.values?.guidance || "").trim() });
function configure({ manifest, settings }) {
  const { kind } = settingsOf(settings);
  return { commands: manifest.commands.map((command2) => ({ ...structuredClone(command2), admission: { nonblank: ["quote"], kind } })) };
}
async function prepare(_input, host) {
  const { guidance } = settingsOf(await host.settings.get({}));
  return guidance ? { sections: [{ id: "redact-guidance", text: "<redaction_guidance>" + guidance.replace(/\s+/g, " ") + "</redaction_guidance>\n" }] } : null;
}
async function command() {
  return null;
}
function dispose() {
}

// tavern-plugin/mods/redaction/mod.json
var mod_default = {
  format: "dsh-tavern-mod",
  schemaVersion: 5,
  experimental: true,
  id: "dsh.redaction",
  name: "\u6570\u636E\u5220\u9664",
  summary: "\u5BFC\u6F14\u628A\u6B63\u6587\u91CC\u7684\u673A\u5BC6\u8BCD\u6D82\u9ED1\u6216\u6362\u6210\u4E71\u7801\uFF0C\u73A9\u5BB6\u70B9\u4E09\u4E0B\u63ED\u5F00\uFF1B\u5B58\u6863\u548C\u4E0B\u4E00\u8F6E\u4E0A\u4E0B\u6587\u91CC\u4ECD\u662F\u539F\u6587\u3002",
  packageName: "dsh-tavern-mod-redaction",
  version: "1.0.0",
  hostApi: ">=1.0.0 <2.0.0",
  dependencies: [],
  config: {
    version: 1,
    schema: {
      type: "object",
      properties: {
        kind: {
          enum: [
            "bar",
            "glitch"
          ],
          type: "string",
          userAdjustable: true
        },
        guidance: {
          type: "string",
          maxLength: 600,
          userAdjustable: true
        }
      },
      additionalProperties: false,
      required: [
        "kind",
        "guidance"
      ]
    },
    defaults: {
      kind: "bar",
      guidance: ""
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
  permissions: [],
  performances: [],
  entry: "plugin.mjs",
  commandPrompts: [
    {
      id: "redact-rule",
      path: "prompts/redaction.txt",
      placement: {
        section: "director.rules.presentation",
        order: 50
      }
    },
    {
      id: "redact-guidance",
      path: "prompts/guidance.txt",
      placement: {
        section: "director.rules.presentation",
        order: 51
      }
    }
  ],
  commands: [
    {
      id: "redact",
      op: "mod.dsh.redaction.redact",
      dsl: {
        verb: "redact",
        syntax: 'redact quote="exact words of this paragraph" [kind=bar|glitch]'
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          quote: {
            type: "string",
            minLength: 1,
            maxLength: 40,
            description: "Copied verbatim from beat.at's text."
          },
          kind: {
            type: "string",
            enum: [
              "bar",
              "glitch"
            ]
          }
        },
        required: [
          "quote"
        ],
        additionalProperties: false
      },
      textMark: {
        quote: "quote"
      },
      persistence: "marker",
      handler: "command",
      promptId: "redact-rule",
      placement: {
        section: "director.commands.presentation",
        order: 50
      },
      caps: {
        perTurn: 24,
        bytes: 512
      },
      mode: "adds"
    }
  ],
  settingsSchema: {
    fields: [
      {
        key: "kind",
        type: "segmented",
        label: "\u9ED8\u8BA4\u6837\u5F0F",
        default: "bar",
        scope: "global",
        choices: [
          {
            value: "bar",
            label: "\u9ED1\u6761"
          },
          {
            value: "glitch",
            label: "\u4E71\u7801"
          }
        ]
      },
      {
        key: "guidance",
        type: "text",
        label: "\u906E\u6321\u6307\u5F15",
        help: "\u5199\u7ED9\u5BFC\u6F14\u770B\uFF1A\u8FD9\u5F20\u5361\u91CC\u54EA\u4E9B\u5185\u5BB9\u8BE5\u906E\uFF0C\u4F8B\u5982\u5F02\u5E38\u7684\u771F\u540D\u3001\u4F24\u4EA1\u4EBA\u6570\u3001\u673A\u6784\u5185\u90E8\u4EE3\u53F7",
        default: "",
        scope: "global",
        maxLength: 600,
        placeholder: "\u5F02\u5E38\u7684\u771F\u540D\u3001\u4F24\u4EA1\u4EBA\u6570\u3001\u673A\u6784\u5185\u90E8\u4EE3\u53F7"
      }
    ],
    sections: [
      {
        id: "redaction",
        title: "\u6570\u636E\u5220\u9664",
        fields: [
          "kind",
          "guidance"
        ]
      }
    ]
  }
};

// tavern-plugin/mods/redaction/plugin.mjs
var name = "dsh-tavern-mod-redaction";
var inject = ["tavern"];
function apply(ctx) {
  ctx.tavern.registerMod(mod_default, { execution: runtime_exports, commands: mod_default.commands });
}
export {
  apply,
  inject,
  name
};
