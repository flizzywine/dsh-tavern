var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// tavern-plugin/mods/phone/mod.json
var mod_default = {
  format: "dsh-mod",
  schemaVersion: 4,
  experimental: true,
  id: "dsh.phone",
  name: "\u624B\u673A",
  packageName: "dsh-tavern-mod-phone",
  version: "2.0.0",
  hostApi: ">=1.0.0 <2.0.0",
  dependencies: [],
  config: {
    version: 1,
    schema: {
      type: "object",
      properties: {
        clockText: {
          type: "string",
          maxLength: 16,
          userAdjustable: true
        },
        dateText: {
          type: "string",
          maxLength: 64,
          userAdjustable: true
        },
        weekdayText: {
          type: "string",
          maxLength: 64,
          userAdjustable: true
        },
        statusBar: {
          type: "boolean",
          userAdjustable: true
        },
        battery: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          userAdjustable: true
        },
        signal: {
          type: "integer",
          minimum: 0,
          maximum: 4,
          userAdjustable: true
        },
        carrier: {
          type: "string",
          maxLength: 64,
          userAdjustable: true
        },
        cutout: {
          enum: [
            "island",
            "notch",
            "none"
          ],
          type: "string",
          userAdjustable: true
        },
        accentColor: {
          type: "string",
          maxLength: 32,
          userAdjustable: true
        },
        surfaceColor: {
          type: "string",
          maxLength: 32,
          userAdjustable: true
        },
        bodyColor: {
          type: "string",
          maxLength: 32,
          userAdjustable: true
        },
        sound: {
          enum: [
            "drop",
            "chime",
            "pop"
          ],
          type: "string",
          userAdjustable: true
        },
        contacts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              avatarRef: {
                type: "object",
                "x-tavern-asset": {
                  media: "image"
                },
                oneOf: [
                  {
                    type: "object",
                    properties: {},
                    additionalProperties: false
                  },
                  {
                    type: "object",
                    properties: {
                      packId: {
                        type: "string",
                        minLength: 1
                      },
                      kind: {
                        type: "string",
                        minLength: 1
                      },
                      assetId: {
                        type: "string",
                        minLength: 1
                      }
                    },
                    required: [
                      "packId",
                      "kind",
                      "assetId"
                    ],
                    additionalProperties: false
                  }
                ]
              }
            }
          },
          userAdjustable: true
        },
        defaultWallpaperRef: {
          type: "object",
          "x-tavern-asset": {
            media: "image"
          },
          oneOf: [
            {
              type: "object",
              properties: {},
              additionalProperties: false
            },
            {
              type: "object",
              properties: {
                packId: {
                  type: "string",
                  minLength: 1
                },
                kind: {
                  type: "string",
                  minLength: 1
                },
                assetId: {
                  type: "string",
                  minLength: 1
                }
              },
              required: [
                "packId",
                "kind",
                "assetId"
              ],
              additionalProperties: false
            }
          ],
          title: "\u58C1\u7EB8",
          userAdjustable: true
        },
        photos: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              file: {
                type: "string",
                minLength: 1
              },
              name: {
                type: "string",
                maxLength: 64
              }
            },
            required: [
              "file"
            ],
            additionalProperties: false
          },
          title: "\u7167\u7247",
          userAdjustable: true
        },
        wallpaper: {
          type: "object",
          properties: {
            file: {
              type: "string",
              minLength: 1
            }
          },
          additionalProperties: false,
          title: "\u5899\u7EB8",
          userAdjustable: true
        },
        notificationToneRef: {
          type: "object",
          "x-tavern-asset": {
            media: "audio"
          },
          oneOf: [
            {
              type: "object",
              properties: {},
              additionalProperties: false
            },
            {
              type: "object",
              properties: {
                packId: {
                  type: "string",
                  minLength: 1
                },
                kind: {
                  type: "string",
                  minLength: 1
                },
                assetId: {
                  type: "string",
                  minLength: 1
                }
              },
              required: [
                "packId",
                "kind",
                "assetId"
              ],
              additionalProperties: false
            }
          ],
          title: "\u63D0\u793A\u97F3\u7D20\u6750",
          userAdjustable: true
        },
        muted: {
          type: "boolean",
          title: "\u9759\u97F3",
          userAdjustable: true
        },
        volume: {
          type: "number",
          minimum: 0,
          maximum: 1,
          title: "\u97F3\u91CF",
          userAdjustable: true
        }
      },
      additionalProperties: false,
      required: [
        "clockText",
        "dateText",
        "weekdayText",
        "statusBar",
        "battery",
        "signal",
        "carrier",
        "cutout",
        "accentColor",
        "surfaceColor",
        "bodyColor",
        "sound",
        "contacts",
        "defaultWallpaperRef",
        "photos",
        "wallpaper",
        "notificationToneRef",
        "muted",
        "volume"
      ]
    },
    defaults: {
      clockText: "09:41",
      dateText: "",
      weekdayText: "",
      statusBar: true,
      battery: 80,
      signal: 4,
      carrier: "",
      cutout: "island",
      accentColor: "#6f8fd8",
      surfaceColor: "#f4f2ec",
      bodyColor: "#3b3a38",
      sound: "drop",
      contacts: {},
      defaultWallpaperRef: {},
      photos: [],
      wallpaper: {},
      notificationToneRef: {},
      muted: false,
      volume: 1
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
      id: "dsh.phone/wallpaper",
      schemaVersion: 1,
      directorSelectable: true,
      schema: {
        type: "object"
      },
      label: "\u624B\u673A\u58C1\u7EB8"
    }
  ],
  coreAssets: [
    {
      id: "device",
      path: "builtin/device.json"
    },
    {
      id: "view-html",
      path: "view/index.html"
    },
    {
      id: "view-css",
      path: "view/style.css"
    },
    {
      id: "view-script",
      path: "view/index.js"
    },
    {
      id: "view-battery",
      path: "view/battery.js"
    },
    {
      id: "view-dialer",
      path: "view/dialer.js"
    },
    {
      id: "view-photos",
      path: "view/photos.js"
    },
    {
      id: "tone-drop",
      path: "view/assets/message.wav"
    },
    {
      id: "tone-chime",
      path: "view/assets/chime.wav"
    },
    {
      id: "tone-pop",
      path: "view/assets/pop.wav"
    }
  ],
  permissions: [
    "stage.presentation",
    "source.dialogue",
    "stage.state"
  ],
  performances: [
    {
      kind: "dsh.phone.message",
      autoHold: {
        minMs: 0,
        until: "complete"
      },
      regions: [
        "device"
      ],
      backlog: {
        line: {
          label: "\u624B\u673A",
          icon: "M8.5 2h7A2.5 2.5 0 0 1 18 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 19.5v-15A2.5 2.5 0 0 1 8.5 2zM8.75 3.75a1 1 0 0 0-1 1v14.5a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1V4.75a1 1 0 0 0-1-1zM10.5 5h3a.6.6 0 0 1 0 1.2h-3a.6.6 0 0 1 0-1.2z",
          command: "mark",
          voice: {
            when: "/form",
            is: "voice"
          }
        }
      },
      replay: {
        stage: true
      }
    }
  ],
  callVideo: {
    backdrop: "stage",
    remote: {
      head: [0.5, 0.17, 0.32]
    },
    self: {
      head: [0.5, 0.2, 0.34]
    }
  },
  entry: "plugin.mjs",
  prompts: [
    {
      id: "rules",
      model: "director",
      tag: "mod_phone",
      slot: "rules.after-core",
      order: 30,
      byteBudget: 4096,
      when: {},
      markdown: "- Mark each paragraph containing an SMS/chat message or a phone-call line, on kind=line, not narration. Cite its at; keep source text unchanged. Holding a phone alone needs no mark.\n- Infer the channel from surrounding narration: kind=line identifies a speaker, not face-to-face speech. A reply following typing/sending is still a text message; mark its own at. Keep the exchange through intervening narration until the story ends it or returns to in-person speech.\n- Direct: to is the recipient's handle, or $player for the player. The cited line supplies the sender. Mark both directions of NPC and player exchanges, each with its actual recipient. Text uses form=text; calls/voice messages use form=voice.\n- Groups: phone-group defines a stable thread id, name and participants ($player when present). Use only source-established members, never the whole contact roster. Use thread instead of to. Reuse a carried group only if its name and members match the source; otherwise create one. Omission keeps groups."
    }
  ],
  summary: "\u5C06\u5267\u60C5\u4E2D\u7684\u901A\u8BDD\u4E0E\u6D88\u606F\u5448\u73B0\u5728\u624B\u673A\u754C\u9762\u4E2D\u3002"
};

// tavern-plugin/mods/phone/manifest.json
var manifest_default = {
  format: "dsh-mod",
  schemaVersion: 2,
  id: "dsh.phone",
  name: "\u624B\u673A",
  summary: "\u5C06\u539F\u6587\u624B\u673A\u5BF9\u767D\u5448\u73B0\u4E3A\u624B\u673A\u6D88\u606F\u5E76\u4FDD\u7559\u6240\u9009\u58C1\u7EB8",
  relevance: "\u89D2\u8272\u4E4B\u95F4\u7528\u624B\u673A\u6536\u53D1\u6D88\u606F\u3001\u6765\u7535",
  version: "1.7.0",
  apiVersion: 1,
  dependencies: {
    hostApi: 1,
    capabilities: [
      "stage.place",
      "stage.state"
    ]
  },
  modelSlots: [
    {
      id: "call",
      label: "\u901A\u8BDD\u6A21\u578B",
      purpose: "\u4E0E\u8054\u7CFB\u4EBA\u8FDB\u884C\u72EC\u7ACB\u7535\u8BDD\u5BF9\u8BDD",
      kind: "chat",
      fallback: "foreground",
      reasoning: "off"
    }
  ],
  permissions: {
    models: ["call"],
    stage: [
      "place",
      "state"
    ],
    source: [
      "dialogue",
      "avatar",
      "voice-replay"
    ]
  },
  commands: [
    {
      id: "mark",
      op: "mod.dsh.phone.mark",
      dsl: {
        verb: "phone-mark",
        syntax: "phone-mark mark to=<recipient|$player> form=text|voice; groups: thread=<id> instead of to"
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          to: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            description: "Recipient handle or $player."
          },
          thread: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            description: "Existing group id; replaces to."
          },
          form: {
            type: "string",
            enum: [
              "text",
              "voice"
            ],
            description: "text \u7EAF\u6587\u5B57\uFF1Bvoice \u8BED\u97F3\u6C14\u6CE1\uFF0C\u6309\u9700\u64AD\u653E\u89D2\u8272\u914D\u97F3\uFF0C\u53EF\u5C55\u5F00\u539F\u6587\u3002\u7531\u5BFC\u6F14\u6309\u5267\u60C5\u9009\u62E9\u3002"
          }
        },
        required: [
          "form"
        ],
        additionalProperties: false
      },
      persistence: "marker",
      handler: "command",
      promptId: "phone-rule",
      placement: {
        section: "director.commands.presentation",
        order: 30
      },
      caps: {
        perTurn: 40,
        bytes: 2048
      },
      mode: "adds"
    },
    {
      id: "group",
      op: "mod.dsh.phone.group",
      dsl: {
        verb: "phone-group",
        syntax: "phone-group group thread=<id> name=<title> participants=<JSON array>"
      },
      paramsStyle: "flat",
      params: {
        type: "object",
        properties: {
          thread: {
            type: "string",
            minLength: 1,
            maxLength: 64
          },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 80
          },
          participants: {
            type: "array",
            minItems: 2,
            maxItems: 16,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 64
            }
          }
        },
        required: [
          "thread",
          "name",
          "participants"
        ],
        additionalProperties: false
      },
      persistence: "state",
      handler: "command",
      promptId: "phone-rule",
      placement: {
        section: "director.commands.presentation",
        order: 31
      },
      caps: {
        perTurn: 8,
        bytes: 4096
      },
      mode: "adds"
    }
  ],
  prompts: [
    {
      id: "phone-rule",
      target: "director",
      path: "prompts/phone.txt",
      placement: {
        section: "director.rules.presentation",
        order: 30
      }
    }
  ],
  settingsSchema: {
    fields: [
      {
        key: "clockText",
        type: "text",
        label: "\u72B6\u6001\u680F\u6587\u5B57",
        default: "09:41",
        maxLength: 16,
        scope: "global",
        bindable: false
      },
      {
        key: "statusBar",
        type: "toggle",
        label: "\u663E\u793A\u72B6\u6001\u680F",
        default: true,
        scope: "global",
        bindable: false
      },
      {
        key: "battery",
        type: "slider",
        label: "\u88C5\u9970\u7535\u91CF",
        default: 80,
        min: 5,
        max: 100,
        step: 5,
        scope: "global",
        bindable: false
      },
      {
        key: "cutout",
        type: "segmented",
        label: "\u9876\u90E8\u6837\u5F0F",
        default: "island",
        choices: [
          {
            value: "island",
            label: "\u7075\u52A8\u5C9B"
          },
          {
            value: "notch",
            label: "\u5218\u6D77"
          },
          {
            value: "none",
            label: "\u65E0\u5F00\u5B54"
          }
        ],
        scope: "global",
        bindable: false
      },
      {
        key: "accentColor",
        label: "\u5F3A\u8C03\u8272",
        stageToken: "--gal-ui-accent",
        type: "colour",
        default: "auto",
        scope: "global",
        bindable: false
      },
      {
        key: "surfaceColor",
        label: "\u5185\u5BB9\u5E95\u8272",
        stageToken: "--gal-ui-surface",
        type: "colour",
        default: "auto",
        scope: "global",
        bindable: false
      },
      {
        key: "bodyColor",
        label: "\u673A\u8EAB\u989C\u8272",
        stageToken: "--gal-ui-line",
        type: "colour",
        default: "auto",
        scope: "global",
        bindable: false
      },
      {
        key: "sound",
        type: "toggle",
        label: "\u6765\u4FE1\u63D0\u793A\u97F3",
        default: true,
        scope: "global",
        bindable: false
      }
    ],
    sections: [
      {
        id: "appearance",
        title: "\u5916\u89C2",
        fields: [
          "clockText",
          "statusBar",
          "battery",
          "cutout",
          "accentColor",
          "surfaceColor",
          "bodyColor",
          "sound"
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
    { path: "audio-loudness.json", size: 246 },
    {
      path: "runtime.js",
      size: 984
    },
    {
      path: "logic.js",
      size: 395
    },
    {
      path: "package.json",
      size: 128
    },
    {
      path: "prompts/phone.txt",
      size: 1039
    },
    {
      path: "builtin/device.json",
      size: 144
    },
    {
      path: "view/index.html",
      size: 21867
    },
    {
      path: "view/battery.js",
      size: 3583
    },
    {
      path: "view/dialer.js",
      size: 22222
    },
    {
      path: "view/photos.js",
      size: 11279
    },
    {
      path: "view/index.js",
      size: 104942
    },
    {
      path: "view/style.css",
      size: 97773
    },
    {
      path: "view/assets/message.wav",
      size: 13274
    },
    {
      path: "view/assets/chime.wav",
      size: 27386
    },
    {
      path: "view/assets/pop.wav",
      size: 7100
    }
  ],
  license: {
    privateUse: false,
    notes: [
      "First-party phone presentation code: AGPL-3.0; owner-created notification sounds: CC BY-NC-SA 4.0, see LICENSE-ASSETS.md"
    ]
  },
  compatibility: {
    compatible: [],
    incompatible: []
  },
  admission: {
    entryKinds: []
  },
  builtinAssets: [
    {
      id: "device",
      path: "builtin/device.json",
      type: "bundle"
    },
    {
      id: "message",
      path: "view/assets/message.wav",
      type: "audio"
    },
    {
      id: "chime",
      path: "view/assets/chime.wav",
      type: "audio"
    },
    {
      id: "pop",
      path: "view/assets/pop.wav",
      type: "audio"
    }
  ]
};

// tavern-plugin/mods/phone/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  command: () => command,
  configure: () => configure,
  dispose: () => dispose,
  prepare: () => prepare,
  settled: () => settled
});

// tavern-plugin/mods/phone/builtin/device.json
var device_default = {
  ref: {
    modId: "dsh.phone",
    packId: "7a71f7c4-e47f-46c7-a710-275e5c0f0579",
    kind: "device",
    entryId: "phone"
  }
};

// tavern-plugin/mods/phone/logic.js
function withBuiltinPhoneDevice(catalogue) {
  return { ...catalogue, phone: { device: structuredClone(device_default.ref), ...catalogue.phone } };
}
function phoneDevices(catalogue) {
  return catalogue.phone?.device ? [catalogue.phone.device] : [];
}

// tavern-plugin/mods/phone/runtime.js
function configure({ manifest, catalogue }) {
  if (!phoneDevices(catalogue).length) return { commands: [] };
  return { commands: manifest.commands.map((command2) => ({ ...structuredClone(command2), admission: command2.id === "mark" ? { source: "phone.message" } : { phoneGroup: true } })) };
}
function prepare() {
  return null;
}
async function command({ commandId, params }, host) {
  if (commandId === "group") return null;
  if (commandId !== "mark") throw Object.assign(new Error("Unknown phone command; choose mark or group"), { code: "MOD_API_UNSUPPORTED" });
  const device = phoneDevices(await host.library.snapshot({}))[0];
  if (!device) throw Object.assign(new Error("Phone is not available"), { code: "MOD_DISABLED" });
  return host.stage.place({ id: "message", kind: "dsh.phone.message", payload: { device, marker: { op: "phone.message", ...params } } });
}
function settled() {
  return null;
}
function dispose() {
}

// tavern-plugin/mods/phone/presentation.js
import { isDeepStrictEqual } from "node:util";

// tavern-plugin/mods/phone/audio-loudness.json
var audio_loudness_default = {
  "view/assets/message.wav": {
    lufs: -34.7,
    peak: -19,
    v: 1
  },
  "view/assets/chime.wav": {
    lufs: -17.8,
    peak: -6.2,
    v: 1
  },
  "view/assets/pop.wav": {
    lufs: -22,
    peak: -5.8,
    v: 1
  }
};

// tavern-plugin/mods/phone/source-view.js
function phoneViewDocument(files) {
  return files.get("view/index.html").toString("utf8").replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`).replace('<link rel="stylesheet" href="style.css">', () => "<style>" + files.get("view/style.css").toString("utf8") + "</style>").replace(/<script src="([a-z0-9-]+\.js)"><\/script>/g, (_, name2) => "<script>" + files.get("view/" + name2).toString("utf8").replace(/<\/script/gi, "<\\/script") + "</script>");
}
function phonePresentation({ view, settings, document, version, wallpaper = null }) {
  return {
    ref: view.device,
    sourceOnly: true,
    modSource: true,
    state: {},
    mediaPolicy: { music: false, sfx: true },
    definition: {
      modId: "dsh.phone",
      title: "\u624B\u673A",
      thirdParty: true,
      contentIdentity: "dsh.phone:" + version,
      srcDoc: document,
      settings,
      settingAssets: {},
      inlineSettingAssets: wallpaper ? { wallpaper } : {},
      assets: {},
      document: { presentation: {
        open: { width: 280, height: 607, minWidth: 220, minHeight: 477, anchor: "center-card", aspectRatio: 280 / 607 },
        compact: { width: 320, height: 104, minWidth: 220, minHeight: 88, anchor: "top-center" },
        notifications: "changes"
      } }
    }
  };
}

// tavern-plugin/mods/phone/presentation.js
var hasRef = (ref) => ref && Object.keys(ref).length > 0;
async function renderPhone({ catalogue = {}, view }, host, { values }) {
  const devices = phoneDevices(withBuiltinPhoneDevice(catalogue));
  view ||= { device: devices[0] };
  if (!devices.some((ref) => isDeepStrictEqual(ref, view.device))) return [];
  const files = new Map(await Promise.all(mod_default.coreAssets.filter((row) => row.path.startsWith("view/") && !row.path.startsWith("view/assets/")).map(async (row) => [row.path, await host.assets.core(row.id)])));
  const wallpaper = values.wallpaper?.file ? await host.assets.upload("wallpaper") : hasRef(values.defaultWallpaperRef) ? await host.assets.resolve(values.defaultWallpaperRef) : null;
  const sound = !values.muted && values.volume > 0 && values.sound !== "none";
  const item = phonePresentation({
    view,
    document: phoneViewDocument(files),
    version: mod_default.version,
    wallpaper,
    // callVideo: the FaceTime view this mod declares (mod.json); the page offers FaceTime only with it.
    settings: { ...values, sound, ...mod_default.callVideo ? { callVideo: mod_default.callVideo } : {} }
  });
  item.mediaPolicy.sfx = sound;
  for (const [alias, contact] of Object.entries(values.contacts)) {
    if (hasRef(contact.avatarRef)) item.definition.inlineSettingAssets["contact:" + alias] = await host.assets.resolve(contact.avatarRef);
  }
  if (sound) {
    const tone = hasRef(values.notificationToneRef) ? await host.assets.resolve(values.notificationToneRef) : {
      kind: "sfx",
      identity: mod_default.id + ":" + mod_default.version + ":" + values.sound,
      loudness: audio_loudness_default[mod_default.coreAssets.find((row) => row.id === "tone-" + values.sound).path],
      url: "data:audio/wav;base64," + (await host.assets.core("tone-" + values.sound)).toString("base64")
    };
    item.definition.assets.message = { ...tone, volume: values.volume };
  }
  return [item];
}

// tavern-plugin/mods/phone/plugin.mjs
var name = "dsh-tavern-mod-phone";
var inject = ["tavern"];
function apply(ctx) {
  ctx.tavern.registerMod(mod_default, {
    execution: runtime_exports,
    commands: manifest_default.commands,
    prepare: ({ catalogue = {} }) => configure({ manifest: manifest_default, catalogue: withBuiltinPhoneDevice(catalogue) }),
    command: (input, host) => command(input, { ...host, library: { snapshot: async () => withBuiltinPhoneDevice(input.catalogue || {}) } }),
    render: renderPhone,
    dispose
  });
}
export {
  apply,
  inject,
  name
};
