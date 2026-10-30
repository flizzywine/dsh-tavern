var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tavern-plugin/mods/timer/activity.cjs
var require_activity = __commonJS({
  "tavern-plugin/mods/timer/activity.cjs"(exports, module) {
    "use strict";
    function timerActivityRuns2(timer, activity) {
      return !!timer && timer.status === "running" && !timer.suspended && activity.live === true && activity.stageOpen !== false && !activity.playerPaused;
    }
    if (typeof module !== "undefined" && typeof window === "undefined") module.exports = { timerIsActive: timerActivityRuns2 };
  }
});

// tavern-plugin/mods/timer/state.cjs
var require_state = __commonJS({
  "tavern-plugin/mods/timer/state.cjs"(exports, module) {
    "use strict";
    var timerActivityOwner = typeof module !== "undefined" && typeof window === "undefined" ? require_activity() : { timerIsActive: (timer, activity) => timerActivityRuns(timer, activity) };
    var timerIsActive = (timer, activity) => timerActivityOwner.timerIsActive(timer, activity);
    var TIMER_MOD_ID = "dsh.timer";
    var TIMER_MAX_MS = 864e5;
    var timerFail = (path, message) => {
      throw Object.assign(new Error(message), { code: "ARG_INVALID", path });
    };
    function validateTimerCommand2(id, params) {
      if (!["start", "add", "pause", "resume", "stop"].includes(id)) timerFail("$.set", "Choose start, add, pause, resume or stop.");
      if (id === "add" && params.sec === void 0) timerFail("$.sec", "Provide seconds to add.");
      if (!["start", "add"].includes(id)) return;
      const ms = (params.sec ?? 60) * 1e3;
      if (params.sec !== void 0 && typeof params.sec !== "number" || !Number.isFinite(ms) || ms < 1 || ms > TIMER_MAX_MS) timerFail("$.sec", "Use 0.001 to 86400 seconds; omit for asset default.");
      if (params.mode !== void 0 && !["story", "reply"].includes(params.mode)) timerFail("$.mode", "Choose story or reply.");
      for (const [field, max] of [["label", 80], ["onTimeout", 160]]) {
        const value = params[field];
        if (value !== void 0 && (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\u0000-\u001f]/u.test(value))) timerFail("$." + field, "Use bounded nonblank single-line text, or omit.");
      }
      if (params.onTimeout && params.mode === "story") timerFail("$.onTimeout", "A fallback action requires reply mode.");
    }
    function reduceTimerCommand(previous, id, params = {}, boundary = {}) {
      validateTimerCommand2(id, params);
      if (id === "stop") return null;
      if (id === "start") {
        const durationMs = Math.round((params.sec ?? 60) * 1e3);
        return {
          instanceId: JSON.stringify([boundary.sourceKey, boundary.generation ?? 0, boundary.turn, boundary.at, boundary.entryOrdinal ?? 0, boundary.opOrdinal ?? 0]),
          revision: 0,
          durationMs,
          remainingMs: durationMs,
          status: "running",
          mode: params.mode ?? "story",
          label: params.label ?? "",
          look: params.look ?? "default",
          ref: structuredClone(params.ref || null),
          onTimeout: params.onTimeout ? { fallbackAction: params.onTimeout } : {},
          onTimeup: structuredClone(params.onTimeup || null),
          ...params.pauseOnChoices === true ? { pauseOnChoices: true } : {}
        };
      }
      if (!previous) return previous;
      if (id === "add") {
        const ms = Math.round(params.sec * 1e3);
        if (previous.durationMs + ms > TIMER_MAX_MS) timerFail("$.sec", "The total timer budget cannot exceed 86400 seconds.");
        return {
          ...previous,
          durationMs: previous.durationMs + ms,
          remainingMs: previous.remainingMs + ms,
          status: previous.status === "expired" ? "running" : previous.status,
          revision: previous.revision + 1,
          command: { id: "add", ms }
        };
      }
      if (previous.status === "expired") return previous;
      const status = id === "pause" ? "paused" : "running";
      return previous.status === status ? previous : { ...previous, status, revision: previous.revision + 1, command: { id } };
    }
    function timerTimeupFact(timer) {
      return timer.mode === "reply" ? "\u73A9\u5BB6\u5728\u65F6\u9650\u5185\u6CA1\u6709\u56DE\u5E94" : (timer.label || "\u5012\u8BA1\u65F6") + "\u65F6\u95F4\u8017\u5C3D";
    }
    function timerCheckpoint2(timer, previous) {
      if (!timer) return null;
      if (previous?.instanceId === timer.instanceId) return {
        ...previous,
        commandRevision: timer.revision,
        status: previous.status === "expired" ? "expired" : timer.status
      };
      return {
        instanceId: timer.instanceId,
        commandRevision: timer.revision,
        remainingMs: timer.remainingMs,
        status: timer.status,
        elapsedMs: 0,
        event: null,
        playerPaused: false
      };
    }
    function advanceTimer2(timer, checkpoint, elapsedMs, activity = {}) {
      const before = timerCheckpoint2(timer, checkpoint);
      if (!before) return { checkpoint: null, event: null };
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > TIMER_MAX_MS) timerFail("$.elapsedMs", "Provide elapsed active milliseconds from 0 to 86400000.");
      if (before.status === "expired" || !timerActivityOwner.timerIsActive({ ...timer, status: before.status }, { ...activity, playerPaused: before.playerPaused || activity.playerPaused }) || !elapsedMs)
        return { checkpoint: before, event: null };
      const consumed = Math.min(before.remainingMs, elapsedMs), remainingMs = before.remainingMs - consumed;
      const event = remainingMs === 0 ? {
        type: "timer.timeup",
        id: "timer.timeup:" + timer.instanceId,
        instanceId: timer.instanceId,
        mode: timer.mode,
        label: timer.label,
        ref: timer.ref,
        look: timer.look,
        onTimeup: timer.onTimeup,
        fact: timerTimeupFact(timer)
      } : null;
      return { checkpoint: { ...before, remainingMs, elapsedMs: before.elapsedMs + consumed, status: event ? "expired" : before.status, event: before.event || event }, event };
    }
    function formatTimer(remainingMs) {
      const ms = Math.max(0, Math.floor(remainingMs));
      return String(Math.floor(ms / 6e4)).padStart(2, "0") + ":" + String(Math.floor(ms / 1e3) % 60).padStart(2, "0") + ":" + String(ms % 1e3).padStart(3, "0");
    }
    if (typeof module !== "undefined") module.exports = { TIMER_MOD_ID, TIMER_MAX_MS, validateTimerCommand: validateTimerCommand2, reduceTimerCommand, timerIsActive, timerTimeupFact, timerCheckpoint: timerCheckpoint2, advanceTimer: advanceTimer2, formatTimer };
  }
});

// tavern-plugin/mods/timer/countdown.cjs
var require_countdown = __commonJS({
  "tavern-plugin/mods/timer/countdown.cjs"(exports, module) {
    "use strict";
    var { reduceTimerCommand, timerCheckpoint: timerCheckpoint2 } = require_state();
    var countdownFail = (path, message) => {
      throw Object.assign(new Error(message), { code: "ARG_INVALID", path });
    };
    var sameRef = (a, b) => ["packId", "kind", "assetId"].every((key) => a?.[key] === b?.[key]);
    function countdownBudget(state, budgetKey) {
      return state?.timer?.budgetKey === budgetKey ? state.timer : state?.budgets?.find((timer) => timer.budgetKey === budgetKey) || null;
    }
    function countdownWithProgress2(timer, checkpoint) {
      if (!timer || checkpoint?.instanceId !== timer.instanceId) return timer;
      const saved = timerCheckpoint2(timer, checkpoint);
      return { ...timer, remainingMs: saved.remainingMs, status: saved.status };
    }
    function reduceCountdown2(state = {}, intent, boundary = {}, checkpoint = null) {
      const { operation, budgetKey } = intent;
      if (!["start", "resume", "release"].includes(operation)) countdownFail("$.operation", "Choose start, resume or release.");
      if (typeof budgetKey !== "string" || !budgetKey.trim() || budgetKey.length > 160 || /[\u0000-\u001f]/u.test(budgetKey))
        countdownFail("$.budgetKey", "Provide a bounded, nonblank topic key. Reuse it to resume the same topic.");
      const current = countdownWithProgress2(state.timer, checkpoint);
      const budgets = (state.budgets || []).map((timer2) => countdownWithProgress2(timer2, checkpoint));
      const previous = countdownBudget({ timer: current, budgets }, budgetKey);
      if (operation === "release") {
        if (!["stop", "freeze"].includes(intent.policy)) countdownFail("$.policy", "Choose stop or freeze.");
        if (!current || current.budgetKey !== budgetKey) return state;
        if (intent.policy === "freeze") return { ...state, timer: { ...current, suspended: true }, budgets };
        return { ...state, timer: null, budgets: [...budgets, { ...current, suspended: true }] };
      }
      if (operation === "start" && previous) countdownFail("$.budgetKey", "This topic already has a budget. Resume it; use a new topic key only for a new topic.");
      if (operation === "resume" && !previous) countdownFail("$.budgetKey", "This topic has no budget. Start it with the timer entry duration or an explicit duration.");
      if (operation === "resume" && intent.params?.sec !== void 0) countdownFail("$.sec", "A duration override is only valid for a new topic; resuming preserves its remaining time.");
      if (previous && intent.params?.ref && !sameRef(previous.ref, intent.params.ref)) countdownFail("$.ref", "Resume this topic with its original timer entry.");
      if (current && !sameRef(current.ref, intent.params?.ref || previous?.ref)) countdownFail("$.ref", "The main timer has another entry. Release it before acquiring this entry.");
      const archived = budgets.filter((timer2) => timer2.budgetKey !== budgetKey);
      if (current && current.budgetKey !== budgetKey) {
        if (!current.budgetKey) countdownFail("$.budgetKey", "Stop the independent timer before starting a topic budget.");
        archived.push({ ...current, suspended: true });
      }
      const timer = previous ? { ...previous, suspended: false } : { ...reduceTimerCommand(null, "start", intent.params, boundary), budgetKey, suspended: false };
      return { ...state, timer, budgets: archived };
    }
    module.exports = { countdownBudget, countdownWithProgress: countdownWithProgress2, reduceCountdown: reduceCountdown2 };
  }
});

// tavern-plugin/mods/timer/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  command: () => command,
  commandSchema: () => commandSchema,
  configure: () => configure,
  dispose: () => dispose,
  prepare: () => prepare,
  settled: () => settled,
  validateCommand: () => validateCommand
});
var import_state = __toESM(require_state(), 1);
function commandSchema({ manifest }) {
  const commands = structuredClone(manifest.commands);
  for (const schema of Object.values(commands[0].params.properties)) if (schema.enum) delete schema.type;
  return commands;
}
function configure({ manifest, catalogue }) {
  const choices = catalogue.packs.flatMap((pack) => pack.entries.map((entry) => ({ ref: entry.ref, look: entry.look || "default", seconds: entry.seconds ?? 60, mode: entry.mode || "story", label: entry.label || "", onTimeout: entry.onTimeout || "", onTimeup: entry.onTimeup || null, pauseOnChoices: entry.pauseOnChoices === true })));
  return { commands: manifest.commands.map((command2) => ({ ...command2, admission: { timer: { choices } } })) };
}
function validateCommand(_id, params) {
  (0, import_state.validateTimerCommand)(params.set ?? "start", params);
}
function prepare() {
  return null;
}
async function command(_input, host) {
  return { accepted: true, state: await host.stage.state.get() };
}
function settled() {
  return null;
}
function dispose() {
}

// tavern-plugin/mods/timer/mod.json
var mod_default = {
  format: "dsh-mod",
  schemaVersion: 4,
  experimental: true,
  id: "dsh.timer",
  name: "\u8BA1\u65F6\u5668",
  packageName: "dsh-tavern-mod-timer",
  version: "2.0.0",
  hostApi: ">=1.0.0 <2.0.0",
  dependencies: [],
  config: {
    version: 1,
    schema: {
      type: "object",
      properties: {
        defaultSeconds: {
          type: "number",
          minimum: 1e-3,
          maximum: 86400,
          userAdjustable: true
        },
        defaultMode: {
          enum: [
            "story",
            "reply"
          ],
          type: "string",
          userAdjustable: true
        },
        look: {
          type: "string",
          enum: [
            "pill",
            "plate"
          ],
          userAdjustable: false
        },
        format: {
          type: "string",
          enum: [
            "m:ss",
            "mm:ss:mmm"
          ],
          userAdjustable: false
        },
        plate: {
          type: "string",
          maxLength: 48,
          "x-skin-asset": true,
          userAdjustable: false
        },
        digits: {
          type: "string",
          maxLength: 48,
          "x-skin-asset": true,
          userAdjustable: false
        },
        glyphs: {
          type: [
            "object",
            "null"
          ],
          properties: {
            cell: {
              type: "number",
              minimum: 0.1,
              maximum: 1024
            },
            columns: {
              type: "integer",
              minimum: 1,
              maximum: 32
            },
            rows: {
              type: "integer",
              minimum: 1,
              maximum: 32
            },
            scale: {
              type: "number",
              minimum: 0.01,
              maximum: 16
            },
            top: {
              type: "number",
              minimum: -8192,
              maximum: 8192
            },
            ascent: {
              type: "number",
              minimum: -8192,
              maximum: 8192
            },
            label: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "number",
                minimum: -8192,
                maximum: 8192
              }
            },
            spacing: {
              type: "number",
              minimum: -8192,
              maximum: 8192
            },
            chars: {
              type: "object",
              maxProperties: 16,
              propertyNames: {
                pattern: "^[0-9:]$"
              },
              additionalProperties: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "number",
                  minimum: -8192,
                  maximum: 8192
                }
              }
            }
          },
          required: [
            "cell",
            "columns",
            "rows",
            "scale",
            "top",
            "ascent",
            "label",
            "spacing",
            "chars"
          ],
          additionalProperties: false,
          userAdjustable: false
        },
        placement: {
          type: "object",
          properties: {
            canvas: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: {
                type: "number",
                minimum: 1,
                maximum: 8192
              }
            },
            box: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "number",
                minimum: -8192,
                maximum: 8192
              }
            }
          },
          required: [
            "canvas",
            "box"
          ],
          additionalProperties: false,
          userAdjustable: false
        },
        pauseButton: {
          type: "boolean",
          title: "\u6682\u505C\u6309\u94AE",
          userAdjustable: true
        },
        urgentPulse: {
          type: "boolean",
          title: "\u6700\u540E 10 \u79D2\u63D0\u9192",
          userAdjustable: true
        },
        hideWhenExpired: {
          type: "boolean",
          userAdjustable: false
        }
      },
      required: [
        "defaultSeconds",
        "defaultMode",
        "look",
        "format",
        "plate",
        "digits",
        "glyphs",
        "placement",
        "pauseButton",
        "urgentPulse",
        "hideWhenExpired"
      ],
      additionalProperties: false
    },
    defaults: {
      defaultSeconds: 60,
      defaultMode: "story",
      look: "pill",
      format: "m:ss",
      plate: "",
      digits: "",
      glyphs: null,
      placement: {
        canvas: [
          1920,
          1080
        ],
        box: [
          1600,
          40,
          280,
          80
        ]
      },
      pauseButton: true,
      urgentPulse: true,
      hideWhenExpired: false
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
  assetKinds: [
    {
      id: "dsh.timer/timer",
      schemaVersion: 1,
      directorSelectable: true,
      schema: {
        type: "object",
        properties: {
          seconds: {
            type: "number",
            minimum: 1e-3,
            maximum: 86400
          },
          look: {
            type: "string"
          }
        },
        additionalProperties: true
      },
      label: "\u5012\u8BA1\u65F6"
    }
  ],
  coreAssets: [
    {
      id: "default",
      path: "assets/default.svg"
    }
  ],
  permissions: [
    "stage.state",
    "stage.presentation"
  ],
  performances: [
    {
      kind: "dsh.timer.countdown",
      autoHold: {
        minMs: 0,
        until: "minimum"
      },
      regions: [
        "hud"
      ],
      backlog: {
        none: "\u5012\u8BA1\u65F6\u662F\u6301\u7EED\u7684\u754C\u9762\u72B6\u6001\uFF0C\u4E0D\u662F\u4E00\u6B21\u6027\u6F14\u51FA\uFF1B\u65F6\u95F4\u5230\u65F6\u7684\u81EA\u52A8\u56DE\u5E94\u4F5C\u4E3A\u4E0B\u4E00\u8F6E\u7684\u8F93\u5165\u51FA\u73B0\u5728\u5C65\u5386"
      },
      replay: {
        none: "\u5012\u8BA1\u65F6\u6309\u4FDD\u5B58\u7684\u5E27\u663E\u793A\uFF1B\u53EA\u6709\u7247\u6BB5\u5BFC\u51FA\u56DE\u653E\u6574\u8F6E\u65F6\u7528\u4E0D\u4FDD\u5B58\u7684\u79C1\u6709\u65F6\u949F"
      }
    }
  ],
  entry: "plugin.mjs",
  api: {
    operations: [
      "start",
      "resume",
      "release",
      "read",
      "phase",
      "advance"
    ],
    resource: "instance-exclusive"
  },
  summary: "\u4E3A\u5267\u60C5\u4E0E\u8FA9\u8BBA\u6F14\u51FA\u63D0\u4F9B\u53EF\u6682\u505C\u3001\u7EE7\u7EED\u7684\u5012\u8BA1\u65F6\u3002"
};

// tavern-plugin/mods/timer/manifest.json
var manifest_default = {
  format: "dsh-mod",
  schemaVersion: 2,
  id: "dsh.timer",
  name: "\u8BA1\u65F6\u5668",
  summary: "\u9605\u8BFB\u5012\u8BA1\u65F6\u4E0E\u56DE\u590D\u65F6\u9650",
  relevance: "Visible countdown and reply deadline",
  version: "1.0.0",
  apiVersion: 1,
  dependencies: {
    hostApi: 1,
    capabilities: [
      "stage.state"
    ]
  },
  permissions: {
    stage: [
      "state"
    ]
  },
  provides: [{ id: "dsh.timer.countdown", version: "1.0.0", contract: "countdown/1", operations: ["start", "resume", "release", "read"], handler: "countdown", resource: { scope: "chat-branch", key: "timer/main", policy: "exclusive" } }],
  commands: [
    {
      id: "set",
      resourceUse: { capability: "dsh.timer.countdown", access: "control" },
      op: "mod.dsh.timer.set",
      mode: "adds",
      dsl: {
        verb: "timer",
        positional: "set",
        syntax: "timer <set> [key=value]"
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          set: {
            type: "string",
            enum: [
              "start",
              "add",
              "pause",
              "resume",
              "stop"
            ]
          },
          sec: {
            type: "number",
            minimum: 1e-3,
            maximum: 86400
          },
          ref: {
            type: "string",
            maxLength: 160
          },
          mode: {
            type: "string",
            enum: [
              "story",
              "reply"
            ]
          },
          label: {
            type: "string",
            maxLength: 80
          },
          onTimeout: {
            type: "string",
            maxLength: 160
          }
        },
        required: [],
        additionalProperties: false
      },
      persistence: "state",
      handler: "command",
      promptId: "timer-rule",
      placement: {
        section: "director.commands.presentation",
        order: 50
      },
      caps: {
        perTurn: 8,
        bytes: 1024
      }
    }
  ],
  prompts: [
    {
      id: "timer-rule",
      target: "director",
      path: "prompts/timer.txt",
      placement: {
        section: "director.rules.presentation",
        order: 50
      }
    }
  ],
  settingsSchema: {
    fields: [],
    sections: []
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
    { path: "activity.cjs", size: 443 },
    { path: "countdown.cjs", size: 3604 },
    {
      path: "runtime.js",
      size: 1125
    },
    {
      path: "state.cjs",
      size: 5530
    },
    {
      path: "package.json",
      size: 172
    },
    {
      path: "prompts/timer.txt",
      size: 80
    },
    {
      path: "assets/default.svg",
      size: 493
    },
    {
      path: "catalogue.js",
      size: 448
    },
    {
      path: "assets/plate.svg",
      size: 183266
    },
    {
      path: "assets/plate-digits.svg",
      size: 6426
    }
  ],
  license: {
    privateUse: false
  },
  compatibility: {
    compatible: [],
    incompatible: []
  },
  builtinAssets: [
    {
      id: "default",
      path: "assets/default.svg",
      type: "image"
    },
    {
      id: "plate",
      path: "assets/plate.svg",
      type: "image"
    },
    {
      id: "plate-digits",
      path: "assets/plate-digits.svg",
      type: "image"
    }
  ],
  admission: {
    entryKinds: [
      "timers"
    ]
  }
};

// tavern-plugin/mods/timer/plugin.mjs
var import_countdown = __toESM(require_countdown(), 1);
var import_state2 = __toESM(require_state(), 1);
var name = "dsh-tavern-mod-timer";
var inject = ["tavern"];
function reduceClock(state, action, boundary) {
  if (action.operation === "advance") {
    const value = (0, import_state2.advanceTimer)(state.timer, state.checkpoint, action.elapsedMs, action.activity);
    return { ...state, checkpoint: value.checkpoint };
  }
  if (action.operation === "phase") return { ...state, phase: action.phase };
  if (action.operation === "read") return state;
  const progressed = { ...state, timer: (0, import_countdown.countdownWithProgress)(state.timer, state.checkpoint) };
  const params = action.operation === "start" ? { sec: boundary.config?.defaultSeconds, mode: boundary.config?.defaultMode, ...action.params } : action.params;
  const next = (0, import_countdown.reduceCountdown)(
    progressed,
    { operation: action.operation, budgetKey: action.budgetKey, params, policy: action.policy || action.releasePolicy || "freeze" },
    { ...boundary, sourceKey: JSON.stringify([boundary.sourceKey, action.instanceId]) },
    state.checkpoint
  );
  return { ...next, phase: action.operation === "release" ? "released" : "entry", checkpoint: (0, import_state2.timerCheckpoint)(next.timer, state.checkpoint) };
}
function apply(ctx) {
  ctx.tavern.registerMod(mod_default, { execution: runtime_exports, commands: manifest_default.commands, api: reduceClock });
}
export {
  apply,
  inject,
  name,
  reduceClock
};
