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
  prepare: () => prepare,
  settled: () => settled
});
function prepare() {
  return {};
}
function command() {
}
function settled() {
}
function dispose() {
}

// tavern-plugin/mods/dice/mod.json
var mod_default = {
  format: "dsh-mod",
  schemaVersion: 4,
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
      rollSound: ""
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
      markdown: "## When to roll\n- Roll only for real uncertainty whose outcomes would split the story; otherwise narrate: let it happen, or let the world say no.\n\n## Follow the result\n- Follow the result; never reroll the same attempt. Failure moves the story on.\n- costly = success at a real price (time, injury, relationship, resource, exposure).\n- Make critical/fumble vivid but in tone.\n- Use hidden for what the character can't know (noticing, lies, hidden danger); narrate only what they perceive, never the number.\n\n## Examples\n- Search a quiet study for a diary: no roll, found.\n- Slip in during the guard change: roll hard, fail = alarm.\n- Is she lying? hidden; fail = she looks calm."
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
