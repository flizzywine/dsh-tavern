var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// tavern-plugin/mods/dice/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  command: () => command,
  dispose: () => dispose,
  prepare: () => prepare
});
function prepare() {
  return {};
}
function command() {
}
function dispose() {
}

// tavern-plugin/mods/dice/mod.json
var mod_default = {
  format: "dsh-tavern-mod",
  schemaVersion: 5,
  experimental: true,
  id: "dsh.dice",
  name: "AI\u68C0\u5B9A",
  packageName: "dsh-tavern-mod-dice",
  version: "2.0.0",
  hostApi: ">=1.0.0 <2.0.0",
  dependencies: [],
  permissions: [],
  coreAssets: [],
  assetKinds: [],
  dataVersion: 1,
  performances: [],
  entry: "plugin.mjs",
  config: {
    version: 1,
    schema: {
      type: "object",
      properties: {
        sound: {
          type: "boolean",
          userAdjustable: true,
          title: "\u9AB0\u5B50\u97F3\u6548"
        },
        rollSound: {
          type: "string",
          maxLength: 48,
          "x-skin-asset": true,
          userAdjustable: false,
          title: "\u63B7\u9AB0\u97F3\u6548"
        },
        dice: {
          type: "object",
          maxProperties: 16,
          propertyNames: {
            pattern: "^[A-Za-z][\\w-]{0,31}$"
          },
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            properties: {
              body: {
                type: "string",
                pattern: "^#[0-9a-fA-F]{6}$"
              },
              ink: {
                type: "string",
                pattern: "^#[0-9a-fA-F]{6}$"
              },
              markInk: {
                type: "string",
                pattern: "^#[0-9a-fA-F]{6}$"
              },
              texture: {
                type: "string",
                maxLength: 48,
                "x-skin-asset": true
              },
              faces: {
                type: "object",
                maxProperties: 100,
                propertyNames: {
                  pattern: "^[0-9]{1,4}$"
                },
                additionalProperties: {
                  type: "string",
                  maxLength: 48,
                  "x-skin-asset": true
                }
              }
            }
          },
          userAdjustable: false,
          title: "\u9AB0\u5B50\u5916\u89C2"
        },
        tones: {
          type: "object",
          additionalProperties: false,
          properties: {
            great: {
              type: "string",
              pattern: "^#[0-9a-fA-F]{6}$"
            },
            good: {
              type: "string",
              pattern: "^#[0-9a-fA-F]{6}$"
            },
            mixed: {
              type: "string",
              pattern: "^#[0-9a-fA-F]{6}$"
            },
            bad: {
              type: "string",
              pattern: "^#[0-9a-fA-F]{6}$"
            },
            terrible: {
              type: "string",
              pattern: "^#[0-9a-fA-F]{6}$"
            }
          },
          userAdjustable: false,
          title: "\u7ED3\u679C\u989C\u8272"
        },
        toneSounds: {
          type: "object",
          additionalProperties: false,
          properties: {
            great: {
              type: "string",
              maxLength: 48,
              "x-skin-asset": true
            },
            good: {
              type: "string",
              maxLength: 48,
              "x-skin-asset": true
            },
            mixed: {
              type: "string",
              maxLength: 48,
              "x-skin-asset": true
            },
            bad: {
              type: "string",
              maxLength: 48,
              "x-skin-asset": true
            },
            terrible: {
              type: "string",
              maxLength: 48,
              "x-skin-asset": true
            }
          },
          userAdjustable: false,
          title: "\u7ED3\u679C\u97F3\u6548"
        },
        result: {
          type: "object",
          additionalProperties: false,
          properties: {
            seal: {
              type: "string",
              enum: [
                "stamp",
                "plain",
                "none"
              ]
            },
            frame: {
              type: "string",
              maxLength: 48,
              "x-skin-asset": true
            },
            card: {
              type: "string",
              enum: [
                "line",
                "ledger"
              ]
            },
            tagColors: {
              type: "object",
              maxProperties: 16,
              propertyNames: {
                maxLength: 24
              },
              additionalProperties: {
                type: "string",
                pattern: "^#[0-9a-fA-F]{6}$"
              }
            }
          },
          userAdjustable: false,
          title: "\u7ED3\u679C\u9875"
        },
        cues: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "at"
            ],
            properties: {
              at: {
                type: "string",
                enum: [
                  "declare",
                  "throw",
                  "land",
                  "rest",
                  "count",
                  "drop",
                  "headline",
                  "tier",
                  "ask",
                  "choose",
                  "resolve",
                  "change",
                  "file"
                ]
              },
              action: {
                type: "string",
                minLength: 1,
                maxLength: 40
              },
              outcome: {
                type: "string",
                minLength: 1,
                maxLength: 40
              },
              tone: {
                type: "string",
                enum: [
                  "great",
                  "good",
                  "mixed",
                  "bad",
                  "terrible"
                ]
              },
              look: {
                type: "string",
                minLength: 1,
                maxLength: 40
              },
              mark: {
                type: "boolean"
              },
              state: {
                type: "string",
                enum: [
                  "kept",
                  "dropped",
                  "changed"
                ]
              },
              choice: {
                type: "string",
                minLength: 1,
                maxLength: 80
              },
              effect: {
                type: "string",
                enum: [
                  "shake-1",
                  "shake-2",
                  "shake-3",
                  "flash",
                  "flash-red",
                  "glitch",
                  "shock",
                  "heartbeat",
                  "blackout"
                ]
              },
              sound: {
                type: "string",
                maxLength: 48,
                "x-skin-asset": true
              },
              show: {
                type: "string",
                enum: [
                  "converge"
                ]
              },
              hold: {
                type: "boolean"
              }
            }
          },
          userAdjustable: false,
          title: "\u6548\u679C\u6302\u70B9"
        },
        shows: {
          type: "object",
          additionalProperties: false,
          properties: {
            converge: {
              type: "object",
              additionalProperties: false,
              properties: {
                paper: {
                  type: "string",
                  pattern: "^#[0-9a-fA-F]{6}$"
                },
                ink: {
                  type: "string",
                  pattern: "^#[0-9a-fA-F]{6}$"
                },
                mark: {
                  type: "string",
                  pattern: "^#[0-9a-fA-F]{6}$"
                }
              }
            }
          },
          userAdjustable: false,
          title: "\u6F14\u51FA\u914D\u8272"
        }
      },
      additionalProperties: false,
      required: [
        "sound",
        "rollSound"
      ]
    },
    defaults: {
      sound: true,
      rollSound: "",
      dice: {},
      tones: {},
      toneSounds: {},
      result: {},
      cues: [],
      shows: {}
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
  prompts: [
    {
      id: "rules",
      model: "foreground",
      tag: "dice",
      slot: "rules.after-core",
      order: 200,
      byteBudget: 2048,
      when: {},
      markdown: "## When to roll\n- Roll only for real uncertainty whose outcomes would split the story; otherwise narrate: let it happen, or let the world say no.\n\n## Follow the result\n- Follow the result; never reroll the same attempt. Failure moves the story on.\n- costly = success at a real price (time, injury, relationship, resource, exposure).\n- Make critical/fumble vivid but in tone.\n- Use hidden for what the character can't know (noticing, lies, hidden danger); narrate only what they perceive, never the number.\n- After a roll, keep writing this turn's story; the narration before and after the roll is one turn.\n\n## Examples\n- Search a quiet study for a diary: no roll, found.\n- Slip in during the guard change: roll hard, fail = alarm.\n- Is she lying? hidden; fail = she looks calm."
    }
  ],
  summary: "\u5728\u5267\u60C5\u9700\u8981\u5224\u5B9A\u65F6\u63B7\u9AB0\u5B50\uFF0C\u5C55\u793A\u5B9E\u9645\u7ED3\u679C\u3002"
};

// tavern-plugin/mods/dice/plugin.mjs
var name = "dsh-tavern-mod-dice";
var inject = ["tavern"];
function apply(ctx) {
  ctx.tavern.registerMod(mod_default, { execution: runtime_exports, commands: [] });
}
export {
  apply,
  inject,
  name
};
