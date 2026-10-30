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

// tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs
var require_figure_resolution = __commonJS({
  "tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs"(exports, module) {
    var figureResolution2 = (() => {
      const traditional = "\u91AB\u5B78\u6A13\u9580\u958B\u95DC\u8072\u98A8\u96E8\u96FB\u8ECA\u99AC\u9234\u9418\u66F8\u9928\u5834\u5712\u5EF3\u9593\u7DB2\u6A5F\u9435\u6A4B\u908A\u5EE3\u8FA6\u5EDA\u81E5\u5BE2\u81FA\u71C8\u7246\u6230\u9B25\u528D\u69CD\u64CA\u97FF\u8173\u6B65\u8449\u9CE5\u87F2\u87EC\u8C93\u9F8D\u9748\u85E5\u7149\u7210\u9663\u96F2\u9727\u5CF6\u7063\u6A39\u6797\u7DA0\u7D05\u9EC3\u85CD\u9A5A\u52D5\u975C\u6A02\u6EAB\u6696\u61F8\u8B0E\u96AA\u50B7\u7955\u820A\u5831\u8A71\u8A0A\u865F\u6AC3\u8AB2\u9AD4\u6CF3\u79AE\u71DF\u7926\u7AAF\u7344\u5EDF\u5EE2\u907A\u8DE1\u93AE\u9109\u838A\u8FB2\u5009\u5EAB\u9081\u9032\u50B3\u4F86\u5F8C\u88E1\u9060\u8655\u5074\u9670\u967D\u66C9\u665A\u6642\u9577\u5ECA\u5BE6\u9A57\u8853\u85DD\u8A08\u8166\u98DB\u767C\u9AEE\u6EFF\u89BA\u9E97\u5340\u9130\u8CE3\u8CB7\u8CA8\u6524\u98F2\u7159\u5875\u6EC5\u7206\u5F48\u6BBC\u9396\u9470\u6572\u788E\u843D\u6FFA\u6FD5\u6FE4\u6D6A\u8F5F\u8F4E\u8F2A\u8ECC\u8F1B\u5EE0\u7522\u7D93\u6FDF\u6703\u8B70\u8A13\u7DF4\u8B77\u885B\u968A\u8ECD\u6575\u8056\u6BBF\u570B\u5BAE\u5BEC\u7A84\u570D\u89C0\u6232\u5287\u9662\u5E79";
      const simplified = "\u533B\u5B66\u697C\u95E8\u5F00\u5173\u58F0\u98CE\u96E8\u7535\u8F66\u9A6C\u94C3\u949F\u4E66\u9986\u573A\u56ED\u5385\u95F4\u7F51\u673A\u94C1\u6865\u8FB9\u5E7F\u529E\u53A8\u5367\u5BDD\u53F0\u706F\u5899\u6218\u6597\u5251\u67AA\u51FB\u54CD\u811A\u6B65\u53F6\u9E1F\u866B\u8749\u732B\u9F99\u7075\u836F\u70BC\u7089\u9635\u4E91\u96FE\u5C9B\u6E7E\u6811\u6797\u7EFF\u7EA2\u9EC4\u84DD\u60CA\u52A8\u9759\u4E50\u6E29\u6696\u60AC\u8C1C\u9669\u4F24\u79D8\u65E7\u62A5\u8BDD\u8BAF\u53F7\u67DC\u8BFE\u4F53\u6CF3\u793C\u8425\u77FF\u7A91\u72F1\u5E99\u5E9F\u9057\u8FF9\u9547\u4E61\u5E84\u519C\u4ED3\u5E93\u8FC8\u8FDB\u4F20\u6765\u540E\u91CC\u8FDC\u5904\u4FA7\u9634\u9633\u6653\u665A\u65F6\u957F\u5ECA\u5B9E\u9A8C\u672F\u827A\u8BA1\u8111\u98DE\u53D1\u53D1\u6EE1\u89C9\u4E3D\u533A\u90BB\u5356\u4E70\u8D27\u644A\u996E\u70DF\u5C18\u706D\u7206\u5F39\u58F3\u9501\u94A5\u6572\u788E\u843D\u6E85\u6E7F\u6D9B\u6D6A\u8F70\u8F7F\u8F6E\u8F68\u8F86\u5382\u4EA7\u7ECF\u6D4E\u4F1A\u8BAE\u8BAD\u7EC3\u62A4\u536B\u961F\u519B\u654C\u5723\u6BBF\u56FD\u5BAB\u5BBD\u7A84\u56F4\u89C2\u620F\u5267\u9662\u5E72";
      const conversion = new Map([...traditional].map((c, i) => [c, [...simplified][i]]));
      const traditionalPattern = new RegExp("[" + traditional + "]", "gu");
      const length2 = (value) => [...value].length;
      const codepointCompare2 = (a, b) => {
        const x = [...String(a)], y = [...String(b)];
        for (let i = 0; i < Math.min(x.length, y.length); i++) {
          const d = x[i].codePointAt(0) - y[i].codePointAt(0);
          if (d) return d;
        }
        return x.length - y.length;
      };
      function normalizeCatalogueText2(value) {
        return String(value ?? "").normalize("NFKC").replace(traditionalPattern, (c) => conversion.get(c)).toLowerCase().replace(/\s+/gu, " ").trim();
      }
      function promptHandleStem(value, separator = "_", limit = 24) {
        return [...String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, separator).replace(new RegExp("^" + separator + "|" + separator + "$", "g"), "")].slice(0, limit).join("");
      }
      const speakerKey = (row) => row.actorKey || row.alias;
      const speakerIdentity = (row) => row.ref ? row.ref.packId + "/" + row.ref.figureId : speakerKey(row);
      function speakerStem(row) {
        const aliases = row.aliases || [];
        const readable = aliases.find((value) => /^[a-z][a-z0-9 _-]*$/i.test(value)) || aliases[0];
        return promptHandleStem(normalizeCatalogueText2(readable || !row.ref && row.alias || row.name)) || "speaker";
      }
      function speakerIndex(rows) {
        const peers = /* @__PURE__ */ new Map(), owners = /* @__PURE__ */ new Map(), stems = /* @__PURE__ */ new Set();
        const add = (map, key, value) => {
          if (!map.has(key)) map.set(key, /* @__PURE__ */ new Set());
          map.get(key).add(value);
        };
        for (const other of rows) {
          if (other.enabled === false) continue;
          const stem = speakerStem(other), identity2 = speakerIdentity(other);
          stems.add(stem);
          add(peers, stem, identity2);
          for (const value of [speakerKey(other), other.name, ...other.aliases || []]) add(owners, normalizeCatalogueText2(value), identity2);
        }
        return { peers, owners, stems, sorted: /* @__PURE__ */ new Map() };
      }
      function indexedSpeakerHandle(index, row) {
        const stem = speakerStem(row), key = speakerIdentity(row);
        if (!index.sorted.has(stem)) index.sorted.set(stem, [...index.peers.get(stem) || []].sort(codepointCompare2));
        const peers = index.sorted.get(stem);
        if (peers.length === 1 && ![...index.owners.get(stem) || []].some((identity2) => identity2 !== key)) return stem;
        const rank = peers.indexOf(key) + 1;
        let ordinal = 0, suffix = 0, candidate;
        do {
          candidate = stem + "_" + ++suffix;
          if (!index.stems.has(candidate) && !index.owners.has(candidate)) ordinal++;
        } while (ordinal < rank);
        return candidate;
      }
      function figureSpeakerHandle(rows, row) {
        return indexedSpeakerHandle(speakerIndex(rows), row);
      }
      function resolveFigureName2(rows, segment = {}) {
        const alias = normalizeCatalogueText2(typeof segment === "string" ? segment : segment.alias);
        const name2 = normalizeCatalogueText2(typeof segment === "string" ? "" : segment.name);
        const available = rows.filter((row) => row.enabled !== false);
        const matchesRef = (row, ref) => row.ref && ref && row.ref.packId === ref.packId && row.ref.figureId === ref.figureId;
        const byRef = (ref) => available.find((row) => matchesRef(row, ref));
        if (segment.figureId) {
          const row = byRef(segment);
          return row ? { status: "resolved", actorKey: row.actorKey, ref: row.ref, row } : { status: "unavailable", ref: segment };
        }
        const exact = (value) => available.filter((row) => normalizeCatalogueText2(row.name) === value);
        const named = name2 ? exact(name2) : [];
        const candidates = available.filter((row) => (row.aliases || []).some((value) => normalizeCatalogueText2(value) === alias || name2 && normalizeCatalogueText2(value) === name2));
        const exactMatches = named.length ? named : exact(alias);
        const exactAmbiguous = new Set(exactMatches.map(speakerIdentity)).size > 1;
        const ambiguous = exactAmbiguous || new Set(candidates.map(speakerIdentity)).size > 1;
        const handleMatch = () => {
          const index = speakerIndex(rows);
          return available.find((row) => normalizeCatalogueText2(indexedSpeakerHandle(index, row)) === alias);
        };
        const found = available.find((row) => row.actorKey === alias) || handleMatch() || !exactAmbiguous && exactMatches[0] || !ambiguous && candidates[0];
        if (!found) return { status: ambiguous ? "ambiguous" : "unknown" };
        if (named.length && !named.some((row) => speakerIdentity(row) === speakerIdentity(found))) return { status: "conflict", actorKey: found.actorKey, ref: found.ref };
        return { status: "resolved", actorKey: found.actorKey, ref: found.ref, row: found };
      }
      return { normalizeCatalogueText: normalizeCatalogueText2, codepointCompare: codepointCompare2, promptHandleStem, figureSpeakerHandle, resolveFigureName: resolveFigureName2 };
    })();
    if (typeof window === "undefined" && typeof module !== "undefined") module.exports = figureResolution2;
  }
});

// tavern-plugin/mods/danmaku/mod.json
var mod_default = {
  format: "dsh-mod",
  schemaVersion: 4,
  experimental: true,
  id: "dsh.danmaku",
  name: "\u5F39\u5E55",
  packageName: "dsh-tavern-mod-danmaku",
  version: "2.0.0",
  hostApi: ">=1.0.0 <2.0.0",
  dependencies: [],
  config: {
    version: 1,
    schema: {
      type: "object",
      properties: {
        streamerName: {
          type: "string",
          maxLength: 64,
          userAdjustable: true
        },
        density: {
          enum: [
            "low",
            "standard"
          ],
          type: "string",
          userAdjustable: true,
          title: "\u5F39\u5E55\u5BC6\u5EA6"
        },
        view: {
          enum: [
            "overlay",
            "sidebar",
            "off"
          ],
          type: "string",
          userAdjustable: true,
          title: "\u5F39\u5E55\u663E\u793A"
        },
        aiRatio: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          userAdjustable: true,
          title: "AI \u5F39\u5E55\u6BD4\u4F8B"
        }
      },
      required: [
        "streamerName",
        "density",
        "view",
        "aiRatio"
      ],
      additionalProperties: false
    },
    defaults: {
      streamerName: "",
      density: "standard",
      view: "overlay",
      aiRatio: 25
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
      id: "dsh.danmaku/audience",
      schemaVersion: 1,
      directorSelectable: true,
      schema: {
        type: "object"
      },
      label: "\u89C2\u4F17\u7FA4"
    }
  ],
  coreAssets: [
    {
      id: "basic",
      path: "assets/audience/basic.json"
    }
  ],
  permissions: [
    "stage.presentation",
    "source.dialogue",
    "models.audience",
    "models.memory"
  ],
  performances: [
    {
      kind: "dsh.danmaku.comments",
      autoHold: {
        minMs: 0,
        until: "minimum"
      },
      regions: [],
      backlog: {
        none: "\u5F39\u5E55\u662F\u89C2\u4F17\u7684\u53CD\u5E94\uFF0C\u4E0D\u662F\u5267\u60C5\u6F14\u51FA\uFF1A\u7FFB\u5386\u53F2\u65F6\u8BE5\u9875\u5DF2\u5F55\u5F39\u5E55\u6309\u5F55\u5236\u95F4\u9694\u91CD\u653E\uFF08\u5F39\u5E55\u4F8B\u5916\uFF09"
      },
      replay: {
        none: "\u7FFB\u5230\u90A3\u4E00\u9875\u5373\u6309\u5F55\u5236\u91CD\u653E\u8BE5\u9875\u5F39\u5E55\uFF0C\u4E0D\u9700\u8981\u5355\u72EC\u91CD\u6F14"
      }
    }
  ],
  entry: "plugin.mjs",
  summary: "\u8BA9\u89C2\u4F17\u7528\u5F39\u5E55\u53C2\u4E0E\u5267\u60C5\uFF0C\u4E5F\u53EF\u5C55\u793A\u73A9\u5BB6\u81EA\u5DF1\u7684\u53D1\u8A00\u3002"
};

// tavern-plugin/mods/danmaku/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  command: () => command,
  dispose: () => dispose,
  event: () => event,
  prepare: () => prepare,
  settled: () => settled
});

// tavern-plugin/mods/danmaku/controller.js
import { randomUUID } from "node:crypto";

// tavern-plugin/mods/danmaku/metrics.js
var seedOf = (text) => {
  let seed = 0;
  for (const char of text) seed = Math.imul(seed, 31) + char.codePointAt(0) >>> 0;
  return seed;
};
var identity = (sessionId, author) => {
  const seed = seedOf(JSON.stringify([sessionId, author]));
  return { follows: seed % 8 === 0 || seed % 200 === 0, captain: seed % 200 === 0 };
};
var contributorFor = (sessionId, author) => {
  const revenue = identity(sessionId, author).captain ? 198 : 0;
  return { author, score: revenue, comments: 0, scRevenueCny: 0, captainRevenueCny: revenue };
};
var addComment = (contributor, row) => {
  contributor.comments++;
  contributor.score++;
  if (row.kind === "highlight") {
    contributor.scRevenueCny += row.amount;
    contributor.score += row.amount;
  }
};
var emptyMetricsState = () => ({
  seen: [],
  contributors: [],
  recent: [],
  base: null,
  lastOffset: null,
  elapsedMs: 0,
  rankHour: 0,
  rankThresholds: [],
  snapshot: null
});
function advanceMetrics(previous, batch, { sessionId, turn, groups }) {
  const seen = new Set(previous.seen), fresh = batch.comments.filter((row) => !seen.has(row.id) && seen.add(row.id));
  if (!fresh.length) return previous;
  const state = structuredClone(previous), prior = state.snapshot;
  const elapsedMs = state.elapsedMs + (state.lastOffset === null ? 0 : Math.max(0, batch.offsetMs - state.lastOffset));
  state.lastOffset = batch.offsetMs;
  state.elapsedMs = elapsedMs;
  state.seen = [...seen];
  state.recent = state.recent.filter((at) => at > elapsedMs - 6e4);
  state.recent.push(...fresh.map(() => elapsedMs));
  const heat = Math.round(Math.max(0, Math.min(100, batch.heat)));
  const target = 40 + 32 * groups + 16 * state.recent.filter((at) => at > elapsedMs - 3e4).length + seedOf(sessionId) % 17;
  state.base = state.base === null ? target : state.base + (target - state.base) * (1 - Math.exp(-(elapsedMs - (prior?.elapsedMs ?? 0)) / 15e3));
  const online = Math.round(state.base + 2.4 * heat), sequence = (prior?.sequence ?? 0) + 1, hour = Math.floor(elapsedMs / 36e5) + 1;
  const snapshot = {
    version: 1,
    sessionId,
    turn,
    sequence,
    elapsedMs,
    online,
    peakOnline: Math.max(prior?.peakOnline ?? 0, online),
    onlineDelta: 0,
    danmakuPerMinute: state.recent.length,
    commentCount: (prior?.commentCount ?? 0) + fresh.length,
    likes: prior?.likes ?? 0,
    newFollowers: prior?.newFollowers ?? 0,
    captains: prior?.captains ?? 0,
    scCount: prior?.scCount ?? 0,
    scRevenueCny: prior?.scRevenueCny ?? 0,
    captainRevenueCny: prior?.captainRevenueCny ?? 0,
    revenueCny: 0,
    heat,
    hourlyRank: Math.max(1, Math.min(99, Math.round(300 / (1 + (online + 14 * heat) / 150)))),
    hour,
    onlineSeries: [...prior?.onlineSeries ?? [], { elapsedMs, online }].slice(-30),
    danmakuBuckets: [],
    topContributors: [],
    events: []
  };
  let eventIndex = 0;
  const events = [...prior?.events ?? []];
  const event2 = (type, author, value) => events.push({ id: sessionId + ":" + sequence + ":" + eventIndex++, type, turn, elapsedMs, author, value });
  const authors = new Map(state.contributors.map((row) => [row.author, row]));
  for (const row of fresh) {
    let contributor = authors.get(row.author);
    if (!contributor) {
      contributor = contributorFor(sessionId, row.author);
      authors.set(row.author, contributor);
      const { follows, captain } = identity(sessionId, row.author);
      if (follows) {
        snapshot.newFollowers++;
        event2("follow", row.author, 1);
      }
      if (captain) {
        snapshot.captains++;
        snapshot.captainRevenueCny += 198;
        event2("captain", row.author, 198);
      }
    }
    addComment(contributor, row);
    snapshot.likes += 6 + Math.floor(heat / 5);
    if (row.kind === "highlight") {
      snapshot.scCount++;
      snapshot.scRevenueCny += row.amount;
      event2("sc", row.author, row.amount);
    }
  }
  const milestone = Math.floor(snapshot.likes / 1e3) * 1e3;
  if (milestone > Math.floor((prior?.likes ?? 0) / 1e3) * 1e3) event2("likes-milestone", null, milestone);
  if (state.rankHour !== hour) {
    state.rankHour = hour;
    state.rankThresholds = [];
  }
  const crossed = [50, 30, 20, 10, 5, 3, 1].filter((rank) => snapshot.hourlyRank <= rank && !state.rankThresholds.includes(rank));
  if (crossed.length) {
    state.rankThresholds.push(...crossed);
    event2("rank-milestone", null, crossed.at(-1));
  }
  state.contributors = [...authors.values()];
  snapshot.topContributors = [...state.contributors].sort((a, b) => b.score - a.score || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0)).slice(0, 3);
  snapshot.revenueCny = snapshot.scRevenueCny + snapshot.captainRevenueCny;
  snapshot.onlineDelta = online - (snapshot.onlineSeries.findLast((row) => row.elapsedMs <= elapsedMs - 1e4) || snapshot.onlineSeries[0]).online;
  const bucket = Math.floor(elapsedMs / 1e4) * 1e4;
  snapshot.danmakuBuckets = Array.from({ length: 6 }, (_, index) => ({ startMs: bucket - (5 - index) * 1e4, count: 0 })).filter((row) => row.startMs >= 0);
  for (const at of state.recent) {
    const own = snapshot.danmakuBuckets.find((row) => row.startMs === Math.floor(at / 1e4) * 1e4);
    if (own) own.count++;
  }
  snapshot.events = events.slice(-12);
  state.snapshot = snapshot;
  return state;
}
var metricsBasis = (state) => Object.fromEntries(["base", "lastOffset", "elapsedMs", "rankHour", "rankThresholds"].map((key) => [key, state[key]]));

// tavern-plugin/mods/danmaku/nicknames.js
var words = ["\u56E2\u5B50", "\u5E03\u4E01", "\u4F01\u9E45", "\u661F\u661F", "\u996D\u56E2", "\u54B8\u9C7C", "\u6C7D\u6C34", "\u98CE\u94C3", "\u8584\u8377", "\u4E91\u6735", "\u6708\u4EAE", "\u8611\u83C7", "\u6A58\u5B50", "\u7EB8\u98DE\u673A", "\u79EF\u6728", "\u6D77\u76D0", "\u9EA6\u82BD", "\u96E8\u70B9", "\u4E66\u7B7E", "\u677E\u679C", "\u8C46\u6C99", "\u5C71\u96C0", "\u7AF9\u7B0B", "\u7425\u73C0", "\u8336\u676F", "\u80F6\u7247", "\u96EA\u7CD5", "\u6811\u53F6", "\u6795\u5934", "\u5E74\u7CD5", "\u94C3\u5170", "\u7802\u7CD6"];
var modifiers = ["\u8DEF\u8FC7\u7684", "\u71AC\u591C\u7684", "\u5FEB\u4E50\u7684", "\u8FF7\u8DEF\u7684", "\u4F1A\u53D1\u5149\u7684", "\u4E0D\u60F3\u65E9\u8D77\u7684", "\u8FFD\u756A\u7684", "\u6B63\u5728\u6478\u9C7C\u7684", "\u6162\u534A\u62CD\u7684", "\u6253\u54C8\u6B20\u7684", "\u5468\u672B\u7684", "\u53E3\u888B\u91CC\u7684", "\u6253\u6E38\u620F\u7684", "\u5348\u540E\u7684", "\u521A\u7761\u9192\u7684", "\u542C\u96E8\u7684"];
var actions = ["\u4ECA\u5929\u4E5F\u8981", "\u660E\u5929\u8BB0\u5F97", "\u5076\u5C14\u60F3\u8981", "\u6084\u6084\u5F00\u59CB", "\u5468\u672B\u53EA\u60F3", "\u73B0\u5728\u51C6\u5907", "\u4E0B\u6B21\u4E00\u5B9A", "\u6BCF\u5929\u575A\u6301"];
var endings = ["\u65E9\u7761", "\u770B\u6D77", "\u559D\u8336", "\u542C\u6B4C", "\u53D1\u5446", "\u6563\u6B65", "\u8FFD\u756A", "\u5403\u996D", "\u753B\u753B", "\u770B\u4E91", "\u6478\u9C7C", "\u8BFB\u4E66"];
var latin = ["mint", "cloud", "rice", "yueliang", "moyu", "orange", "paper", "xingxing", "echo", "slow", "soda", "chashui", "rain", "sleepy", "leaf", "wind"];
var handles = ["day", "box", "note", "room", "time", "radio", "walk", "dream", "log", "page", "light", "wave", "tea", "cat", "sky", "moon"];
var fandom = ["\u8FFD\u756A\u4E2D", "\u7B49\u66F4\u65B0", "\u8865\u6863\u5458", "\u5355\u63A8\u4EBA", "\u5E94\u63F4\u90E8", "\u89C2\u5BDF\u65E5\u8BB0", "\u540D\u573A\u9762\u6536\u85CF", "\u7247\u5C3E\u4E0D\u8DF3"];
function viewerNickname(chatId, commentId, group, parentAuthor = null) {
  let seed = 2166136261;
  for (const char of JSON.stringify([chatId, commentId])) seed = Math.imul(seed ^ char.codePointAt(0), 16777619) >>> 0;
  const next = () => {
    seed = seed + 1831565813 >>> 0;
    let value = Math.imul(seed ^ seed >>> 15, seed | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return (value ^ value >>> 14) >>> 0;
  };
  const pick = (values) => values[next() % values.length];
  const allowed = (name2) => name2 !== parentAuthor && name2 !== group.name;
  const pool = group.content.nicknamePool;
  if (next() % 5 === 0 && pool?.length) {
    const name2 = pick(pool);
    if (allowed(name2)) return name2;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const shape = next() % 8;
    const name2 = shape === 0 ? "bili_" + String(1e7 + next() % 9e7) : shape === 1 ? pick(actions) + pick(endings) : shape === 2 ? pick(modifiers) + pick(words) : shape === 3 ? pick(words) + String(10 + next() % 990) : shape === 4 ? pick(latin) + pick(handles) : shape === 5 ? pick(latin) + "_" + pick(handles) : shape === 6 ? pick(words) + pick(["\u30FB", "\u306E"]) + pick(words) : pick(words) + pick(fandom);
    if (allowed(name2)) return name2;
  }
  const number = 1e7 + next() % 89999997;
  for (let step = 0; step < 3; step++) {
    const name2 = "bili_" + String(number + step);
    if (allowed(name2)) return name2;
  }
}

// tavern-plugin/mods/danmaku/audience.js
var SC_AMOUNTS = Object.freeze([30, 50, 100, 500, 1e3, 2e3]);

// tavern-plugin/mods/danmaku/contract.js
var MOD_ID = "dsh.danmaku";
var CADENCE = Object.freeze({ minIntervalMs: 3e3, maxPerMinute: 20, maxInFlight: 1 });
var cadenceForSettings = (settings) => ({
  ...CADENCE,
  minIntervalMs: (settings.minIntervalSeconds ?? CADENCE.minIntervalMs / 1e3) * 1e3,
  maxPerMinute: settings.maxCallsPerMinute ?? CADENCE.maxPerMinute
});
var sourceOf = (context) => Object.fromEntries(["sessionId", "branchId", "sourceKey", "generation", "textVersion"].map((key) => [key, context[key]]));
var sourceKey = (source) => JSON.stringify(["sessionId", "branchId", "sourceKey", "generation", "textVersion"].map((key) => source[key]));
var anchorKey = (anchor) => JSON.stringify([anchor.sourceKey, anchor.part, anchor.paragraph, anchor.charOffset]);
var refKey = (ref) => JSON.stringify([ref.packId, ref.kind, ref.assetId]);
var shortText = (text, max) => [...text].slice(0, max).join("");
var defaultModel = () => ({ selection: "follow-foreground", provider: null, model: null, label: "Follow foreground", available: false });
var invalid = (message) => {
  throw Object.assign(new Error(message), { code: "MOD_RESOURCE_UNAVAILABLE" });
};
function createViewerCounter() {
  let chat, seed = 0, base = null, target = 0, lastAt = 0, recent = [];
  const seen = /* @__PURE__ */ new Set();
  function select(id) {
    if (chat === id) return;
    chat = id;
    seed = 0;
    base = null;
    target = 0;
    lastAt = 0;
    recent = [];
    seen.clear();
    for (const char of id) seed = Math.imul(seed, 31) + char.charCodeAt(0) >>> 0;
  }
  return {
    record(id, comments, at) {
      select(id);
      for (const comment of comments) if (!seen.has(comment.id)) {
        seen.add(comment.id);
        recent.push(at);
        if (seen.size > 1024) seen.delete(seen.values().next().value);
      }
    },
    value(id, groups, at, heat) {
      select(id);
      recent = recent.filter((time) => time > at - 3e4 && time <= at);
      target = 40 + 32 * groups + 16 * recent.length + seed % 17;
      base = base === null ? target : base + (target - base) * (1 - Math.exp(-Math.max(0, at - lastAt) / 15e3));
      lastAt = at;
      return groups ? Math.round(base + 2.4 * heat) : 0;
    },
    moving: () => recent.length > 0 || base !== null && Math.abs(target - base) > 0.5
  };
}
function commentAmount(kind, amount, random = Math.random) {
  if (kind !== "highlight") return null;
  if (amount != null) {
    if (!SC_AMOUNTS.includes(amount)) invalid("SC amount must be an integer CNY tier: 30, 50, 100, 500, 1000 or 2000; correct amount and resubmit");
    return amount;
  }
  const draw = random();
  return SC_AMOUNTS[[0.6, 0.8, 0.92, 0.97, 0.99, 1].findIndex((limit) => draw < limit)];
}
function parseOutput(output) {
  if (typeof output !== "string") return output;
  const text = output.trim(), fence = /^```(?:jsonl|json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  return JSON.parse(fence ? fence[1] : text);
}
function parseCommentLine(output, stream) {
  const text = output.trim();
  if (!stream.started && /^```(?:jsonl|json)?$/i.test(text)) {
    stream.started = true;
    stream.fenced = true;
    return null;
  }
  if (stream.fenced && !stream.closed && text === "```") {
    stream.closed = true;
    return null;
  }
  if (stream.closed) invalid("Expected only one surrounding code fence");
  stream.started = true;
  return parseOutput(text);
}
function parseComments(output, groups, recent, { id, offsetMs, density, random = Math.random, chatId = "", limit = 12 }) {
  let value;
  try {
    value = parseOutput(output);
  } catch (error) {
    if (typeof output !== "string") throw error;
    const text = output.trim().replace(/^```(?:jsonl|json)?\s*\r?\n([\s\S]*?)\r?\n```$/i, "$1"), lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw error;
    value = { comments: lines.slice(0, limit).map((line) => parseOutput(line)) };
  }
  if (value && typeof value.text === "string") value = { comments: [value] };
  if (!Array.isArray(value?.comments) || value.comments.length > 12) invalid("Expected a batch of at most twelve comments");
  const admitted = new Map(groups.map((group) => [refKey(group.ref), group]));
  const seen = new Set(recent.map((row) => row.text));
  let highlighted = false;
  const comments = [];
  for (const row of value.comments.slice(0, limit)) {
    const group = Number.isInteger(row?.group) ? groups[row.group] : row?.group ? admitted.get(refKey(row.group)) : groups.length === 1 ? groups[0] : null;
    if (!group || typeof row.text !== "string" || !row.text.trim() || [...row.text].length > 160 || row.kind !== void 0 && !["comment", "highlight"].includes(row.kind)) invalid("Use a recalled group, short text and comment/highlight kind");
    if (row.mode !== void 0 && !["scroll", "top", "bottom"].includes(row.mode) || row.color !== void 0 && row.color !== null && !/^#[0-9a-f]{6}$/i.test(row.color) || row.size !== void 0 && !["small", "standard", "large"].includes(row.size)) invalid("Invalid comment display hint");
    if (seen.has(row.text)) continue;
    seen.add(row.text);
    const kind = row.kind === "highlight" && !highlighted ? "highlight" : "comment";
    highlighted ||= kind === "highlight";
    comments.push({
      id: id + ":" + comments.length,
      group: structuredClone(group.ref),
      author: viewerNickname(chatId, id + ":" + comments.length, group),
      text: row.text,
      kind,
      amount: commentAmount(kind, row.amount, random),
      source: "model",
      depth: 0,
      ruleId: null,
      replyTo: null,
      revealId: null,
      ...Number.isSafeInteger(row.page) ? { page: row.page } : {},
      mode: row.mode || "scroll",
      color: row.color || null,
      size: row.size || "standard",
      offsetMs: offsetMs + comments.length * (density === "low" ? 2200 : 1200),
      durationMs: kind === "highlight" ? 9e3 : 6500
    });
  }
  return comments;
}
function parseMemory(output) {
  const value = parseOutput(output);
  if (typeof value?.memory !== "string") invalid("Expected a short audience memory");
  return shortText(value.memory.trim(), 300);
}
function historyBatches(batches, anchor, shownAtMs) {
  const own = batches.flatMap((batch) => batch.comments).filter((row) => row.sourcePage?.anchor && anchorKey(row.sourcePage.anchor) === anchorKey(anchor) && Number.isFinite(row.sourcePage.shownAtMs));
  const start = own.length ? Math.min(...own.map((row) => row.sourcePage.shownAtMs)) : Math.min(...batches.map((batch) => batch.offsetMs));
  const shift = Number.isFinite(shownAtMs) && Number.isFinite(start) ? shownAtMs - start : 0;
  if (!shift) return batches;
  const page = (row) => Number.isFinite(row.sourcePage?.shownAtMs) ? { sourcePage: { ...row.sourcePage, shownAtMs: row.sourcePage.shownAtMs + shift } } : {};
  return batches.map((batch) => ({
    ...batch,
    offsetMs: batch.offsetMs + shift,
    heatExpiresAtMs: batch.heatExpiresAtMs + shift,
    comments: batch.comments.map((row) => ({ ...row, offsetMs: row.offsetMs + shift, ...page(row) }))
  }));
}
function projectView({
  context,
  anchor,
  records = [],
  activeTimeMs = 0,
  heat = 0,
  online = 0,
  active = false,
  silent = true,
  waiting = false,
  error = null,
  settings = {},
  model = defaultModel(),
  corpus = false,
  viewport = { width: 0, height: 0 },
  safeRegions = [],
  shownAtMs
}) {
  const view = ["sidebar", "off"].includes(settings.view) ? settings.view : "overlay";
  if (view === "off") active = false;
  const page = silent || view === "off" || !anchor ? [] : records.filter((row) => row.record.type === "batch" && sourceKey(row.record.batch.source) === sourceKey(sourceOf(context)) && anchorKey(row.anchor) === anchorKey(anchor)).map((row) => row.record.batch);
  const batches = context.mode === "history" ? historyBatches(page, anchor, shownAtMs).slice(-20) : page.filter((batch) => batch.offsetMs <= activeTimeMs).slice(-20);
  const items = batches.flatMap((batch) => batch.comments).filter((row) => row.offsetMs <= activeTimeMs).sort((a, b) => a.offsetMs - b.offsetMs || a.id.localeCompare(b.id)).slice(-32);
  const last = batches.filter((batch) => batch.offsetMs <= activeTimeMs).at(-1);
  if (!last) {
    heat = 0;
    online = 0;
  }
  if (context.mode === "history") {
    const remaining = last ? last.heatExpiresAtMs - last.offsetMs : 0;
    heat = remaining > 0 ? Math.round(last.heat * Math.max(0, (last.heatExpiresAtMs - activeTimeMs) / remaining)) : 0;
    online = last ? Math.max(12, Math.round(last.online - (last.heat - heat) * 2.4)) : 0;
  } else if (last) {
    batches[batches.length - 1] = { ...last, online: Math.round(online + (last.heat - heat) * 2.4) };
  }
  return {
    version: 1,
    modId: MOD_ID,
    mode: context.mode,
    active,
    silent,
    view,
    anchor,
    activeTimeMs,
    batches,
    metrics: silent || view === "off" ? null : batches.findLast((batch) => batch.offsetMs <= activeTimeMs && batch.metrics)?.metrics ?? null,
    highlights: items.filter((row) => row.kind === "highlight"),
    heat: silent ? 0 : heat,
    online: silent ? 0 : online,
    viewport,
    safeRegions,
    // 弹幕来源 (stage CONFIG): what this round can draw on - recalled groups with a real corpus, an available audience model.
    sources: { real: !!corpus, ai: !!model.available },
    sidebar: { title: "\u6A21\u62DF\u89C2\u4F17", items, limit: 32 },
    settings: {
      view,
      density: settings.density === "low" ? "low" : "standard",
      area: settings.area ?? "three-quarter",
      opacity: settings.opacity ?? 90,
      fontScale: settings.fontScale ?? 100,
      reducedMotion: !!settings.reducedMotion,
      model,
      commentsPerRequest: settings.commentsPerRequest ?? 6,
      cadence: cadenceForSettings(settings),
      modelSettingsTarget: { modId: MOD_ID, slotId: "audience" }
    },
    status: silent ? "silent" : context.mode === "history" ? "history" : !active ? "paused" : error ? "error" : waiting ? "waiting" : "ready",
    error
  };
}

// tavern-plugin/mods/danmaku/input.js
function compactAudienceInput(input) {
  const result = structuredClone(input), fields = [];
  const add = (object, key) => {
    if (typeof object?.[key] === "string") fields.push({ object, key });
  };
  for (const group of result.groups) {
    for (const key of ["name", "persona", "tone"]) add(group, key);
    for (const key of ["catchphrases", "examples", "presetExamples"]) (group[key] || []).forEach((_, index) => add(group[key], index));
  }
  for (const row of result.recent) for (const key of ["author", "text"]) add(row, key);
  for (const row of result.presented) for (const key of ["text", "visualType"]) add(row, key);
  add(result, "memory");
  add(result.acceptedInput, "text");
  for (const page of result.pages || []) add(page, "text");
  while (Buffer.byteLength(JSON.stringify(result)) > 16e3) {
    fields.sort((a, b) => Buffer.byteLength(b.object[b.key]) - Buffer.byteLength(a.object[a.key]));
    const field = fields[0], value = field?.object[field.key];
    if (!value || [...value].length <= 16) throw Object.assign(new Error("Audience identities exceed the model input budget"), { code: "MOD_RESOURCE_UNAVAILABLE" });
    field.object[field.key] = shortText(value, Math.floor([...value].length / 2));
  }
  return result;
}

// tavern-plugin/mods/danmaku/corpus.js
var import_figure_resolution = __toESM(require_figure_resolution(), 1);
var CORPUS_EXTENSION = "dsh.danmaku.corpus";
var { normalizeCatalogueText: normalize, resolveFigureName } = import_figure_resolution.default;

// tavern-plugin/lib/domain/asset-pack-lexical.js
var import_figure_resolution2 = __toESM(require_figure_resolution(), 1);
var { normalizeCatalogueText, codepointCompare } = import_figure_resolution2.default;
var length = (value) => [...value].length;
var timeOnly = /^(?:清晨|早晨|早上|上午|中午|午后|下午|傍晚|黄昏|夜晚|夜间|深夜|凌晨|白天|日间|早|晚|夜|day|night|morning|noon|afternoon|evening|dawn|dusk)$/u;
function matchOffset(text, word) {
  let offset = text.indexOf(word);
  const han = new RegExp("\\p{Script=Han}", "u").test(word);
  while (offset >= 0) {
    if (han || !/[\p{Script=Latin}\p{N}]/u.test(text[offset - 1] || "") && !/[\p{Script=Latin}\p{N}]/u.test(text[offset + word.length] || "")) return offset;
    offset = text.indexOf(word, offset + 1);
  }
  return -1;
}
function triggerEvidence(item, units, { excludeTimeWords = true, minLength = 2 } = {}) {
  const candidates = /* @__PURE__ */ new Map();
  for (const raw of [item.name, item.label, ...item.keywords || []].filter(Boolean)) {
    const canonical = normalizeCatalogueText(raw);
    for (const surface of [raw, ...item.synonyms?.[raw] || []]) {
      const word = surface === raw ? canonical : normalizeCatalogueText(surface);
      if (length(word) >= minLength && !(excludeTimeWords && timeOnly.test(word))) candidates.set(word, canonical);
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (const [word, canonical] of candidates) for (let i = 0; i < units.length; i++) {
    const offset = matchOffset(units[i], word);
    if (offset < 0) continue;
    if (!groups.has(canonical)) groups.set(canonical, { word, canonical, paragraph: i + 1, offset });
    break;
  }
  const evidence = [...groups.values()].sort((a, b) => codepointCompare(a.canonical, b.canonical));
  return { matched: evidence.length > 0, evidence };
}

// tavern-plugin/mods/danmaku/presets.js
var matches = (keywords, text) => triggerEvidence({ keywords }, [normalizeCatalogueText(text)]).matched;
var presetExamples = (content) => [
  ...(content.triggers || []).flatMap((row) => row.lines),
  ...(content.chains || []).flatMap((row) => row.replies)
].slice(0, 3).map((line) => typeof line === "string" ? line : line.text);
function paceComments(comments, existing, clock, density) {
  const gap = density === "low" ? 1100 : 600, occupied = existing.map((row) => row.offsetMs).sort((a, b) => a - b);
  return comments.map((row) => {
    let offset = Math.max(clock, row.offsetMs);
    for (const used of occupied) {
      if (used + gap <= offset) continue;
      if (offset + gap <= used) break;
      offset = used + gap;
    }
    occupied.push(offset);
    occupied.sort((a, b) => a - b);
    return { ...row, offsetMs: offset };
  });
}
function createAudiencePresets({ now = Date.now, random = Math.random, id, chatId = () => "" }) {
  const cooldowns = /* @__PURE__ */ new Map(), reveals = /* @__PURE__ */ new Set(), posted = /* @__PURE__ */ new Set(), lineages = /* @__PURE__ */ new Map();
  let queue = [];
  const starts = /* @__PURE__ */ new Map();
  const trim = () => {
    for (const [key, at] of starts) if (at <= now() - 6e4) starts.delete(key);
  };
  function enqueue(group, rule, lines, source, depth, replyTo, revealId, due, recent, lineage = { rules: [], texts: [] }, parentAuthor = null) {
    trim();
    if (starts.size >= 12 || queue.length >= 12 || random() >= (rule.probability ?? 1)) return false;
    const candidate = lines[Math.floor(random() * lines.length)];
    const { text, kind = "comment", amount } = typeof candidate === "string" ? { text: candidate } : candidate;
    const normalized = normalizeCatalogueText(text);
    if (lineage.texts.includes(normalized)) return false;
    if (recent.some((row) => row.text === text) || queue.some((row) => row.text === text)) return false;
    const commentId = id(), at = now();
    queue.push({
      id: commentId,
      group: structuredClone(group.ref),
      author: viewerNickname(chatId(), commentId, group, parentAuthor),
      text,
      kind,
      amount: commentAmount(kind, amount, random),
      source,
      depth,
      ruleId: rule.id,
      replyTo,
      revealId,
      mode: "scroll",
      color: null,
      size: "standard",
      offsetMs: due,
      durationMs: kind === "highlight" ? 9e3 : 6500,
      presetTiming: { createdAtMs: at, cooldownUntilMs: source === "preset" ? at + (rule.cooldown ?? 30) * 1e3 : null }
    });
    lineages.set(commentId, { rules: [...lineage.rules, source === "chain" ? rule.id : null].filter(Boolean), texts: [...lineage.texts, normalized] });
    starts.set(commentId, at);
    return true;
  }
  return Object.freeze({
    restore(comments) {
      queue = [];
      lineages.clear();
      for (const row of comments) {
        posted.add(row.id);
        if (row.revealId) reveals.add(row.revealId);
        if (row.presetTiming) {
          starts.set(row.id, row.presetTiming.createdAtMs);
          if (row.presetTiming.cooldownUntilMs !== null) {
            const key = refKey(row.group) + "\0" + row.ruleId;
            cooldowns.set(key, Math.max(cooldowns.get(key) || 0, row.presetTiming.cooldownUntilMs));
          }
        }
      }
      trim();
    },
    reset() {
      queue = [];
      reveals.clear();
      posted.clear();
      lineages.clear();
    },
    pause(comments) {
      queue = [];
      lineages.clear();
      for (const row of comments) posted.add(row.id);
    },
    trigger(revealed, groups, clock, recent) {
      if (!revealed || reveals.has(revealed.id)) return;
      reveals.add(revealed.id);
      if (reveals.size > 256) reveals.delete(reveals.values().next().value);
      for (const group of groups) for (const rule of group.content.triggers || []) {
        const key = refKey(group.ref) + "\0" + rule.id;
        if (now() < (cooldowns.get(key) ?? -Infinity) || !matches(rule.keywords, revealed.text)) continue;
        if (enqueue(group, rule, rule.lines, "preset", 0, null, revealed.id, clock, recent))
          cooldowns.set(key, now() + (rule.cooldown ?? 30) * 1e3);
      }
    },
    observe(comments, groups, clock, recent) {
      for (const parent of comments) {
        if (parent.offsetMs > clock || posted.has(parent.id)) continue;
        posted.add(parent.id);
        if ((parent.depth || 0) >= 5) {
          lineages.delete(parent.id);
          continue;
        }
        const lineage = lineages.get(parent.id) || { rules: [], texts: [normalizeCatalogueText(parent.text)] };
        let replied = false;
        for (const group of groups) {
          for (const rule of group.content.chains || []) if (!lineage.rules.includes(rule.id) && matches([rule.match], parent.text) && enqueue(group, rule, rule.replies, "chain", (parent.depth || 0) + 1, parent.id, null, clock + 600, recent, lineage, parent.author)) {
            replied = true;
            break;
          }
          if (replied) break;
        }
        lineages.delete(parent.id);
      }
    },
    take(groups, clock, recent) {
      const admitted = new Set(groups.map((group) => refKey(group.ref))), texts = new Set(recent.map((row) => row.text)), due = [];
      queue = queue.filter((row) => {
        if (!admitted.has(refKey(row.group)) || texts.has(row.text)) {
          lineages.delete(row.id);
          return false;
        }
        if (row.offsetMs > clock || due.length >= 6) return true;
        texts.add(row.text);
        due.push(row);
        return false;
      });
      return due;
    },
    next(comments, clock) {
      const times = [...queue.map((row) => row.offsetMs), ...comments.filter((row) => !posted.has(row.id) && row.offsetMs > clock).map((row) => row.offsetMs)];
      return times.length ? Math.max(1, Math.min(...times) - clock) : null;
    }
  });
}

// tavern-plugin/mods/danmaku/controller.js
var coolingMs = 3e4;
var DANMAKU_LATE_MS = 12e3;
var HISTORY_SETTLE_MS = 1e3;
function naturalViewerDelay({ id, text }) {
  let seed = 0;
  for (const char of id) seed = Math.imul(seed, 31) + char.codePointAt(0) >>> 0;
  const draw = () => {
    seed = seed + 1831565813 | 0;
    let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
    x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
    return (((x ^ x >>> 14) >>> 0) + 0.5) / 4294967296;
  };
  const length2 = Array.from(text.trim()).length, mode = length2 <= 4 ? 250 + 150 * length2 : 800 + 280 * length2, sigma = 0.28;
  const normal = Math.sqrt(-2 * Math.log(draw())) * Math.cos(2 * Math.PI * draw());
  return Math.min(DANMAKU_LATE_MS - 1e3, mode * Math.exp(sigma * sigma + sigma * normal));
}
var stimulus = /* @__PURE__ */ new Map([["stage.entered", 80], ["text.available", 80], ["page.changed", 80], ["performance.presented", 100], ["player.input", 90]]);
function createDanmakuController({ now = Date.now, id = randomUUID, random = Math.random, viewerDelay = naturalViewerDelay } = {}) {
  const presets = createAudiencePresets({ now, id, random, chatId: () => context?.sessionId ?? "" });
  let context, anchor = null, groups = [], settings = {}, model = defaultModel(), active = false, disposed = false;
  let clock = 0, heatPeak = 0, heatAt = 0, revision = "0", records = [], memory = "", hydrated = false;
  let pending = null, memoryDue = null, memoryDone = false, waiting = false, error = null, lastBatchEnd = 0, generating = false;
  let reactionVersion = 0, textReady = true, page = null, pagePlan = [], ready = [], planned = /* @__PURE__ */ new Set(), stimulusAt = 0;
  const shown = /* @__PURE__ */ new Map();
  const backfilled = /* @__PURE__ */ new Set();
  let starts = [], lastStart = -Infinity, lastInput = null, presented = [], viewport = { width: 0, height: 0 }, safeRegions = [];
  let aiCredit = 0, entryReaction = true;
  const prepared = /* @__PURE__ */ new Map();
  const aiRatio = () => settings.aiRatio ?? 25;
  const hasCorpus = () => groups.some((group) => group.extensions?.[CORPUS_EXTENSION]);
  const seen = /* @__PURE__ */ new Set();
  const heat = () => Math.round(heatPeak * Math.max(0, 1 - (clock - heatAt) / coolingMs));
  const viewers = createViewerCounter();
  let metricsState = emptyMetricsState();
  const online = () => viewers.value(context?.sessionId ?? "", groups.length, now(), heat());
  const displayEnabled = () => active && !disposed && settings.view !== "off" && context?.mode === "live" && groups.length > 0 && hydrated;
  const enabled = () => displayEnabled() && model.available && textReady && aiRatio() > 0;
  const comments = () => records.filter((row) => row.record.type === "batch").flatMap((row) => row.record.batch.comments);
  const targets = () => pagePlan.filter((row) => row.index >= page.index && !planned.has(anchorKey(row.anchor))).slice(0, Math.min(4, settings.commentsPerRequest ?? 6));
  const late = (row, at) => Number.isFinite(row.sourcePage?.shownAtMs) && at - row.sourcePage.shownAtMs > DANMAKU_LATE_MS;
  function tag(rows, sourcePage, timing) {
    return rows.map((row) => ({ ...row, sourcePage: structuredClone(sourcePage), timing }));
  }
  async function release(host, rows, operationId, timing) {
    ready.push(...rows.filter((row) => row.sourcePage.index > page.index));
    rows = rows.filter((row) => row.sourcePage.index <= page.index && shown.has(anchorKey(row.sourcePage.anchor))).map((row) => {
      const shownAtMs = shown.get(anchorKey(row.sourcePage.anchor));
      return { ...row, sourcePage: { ...row.sourcePage, shownAtMs }, offsetMs: Math.max(clock, shownAtMs + Math.round(viewerDelay(row))) };
    }).sort((a, b) => a.offsetMs - b.offsetMs);
    rows = paceComments(rows, comments(), clock, settings.density).filter((row) => !late(row, row.offsetMs));
    if (!rows.length) return;
    for (let start = 0; start < rows.length; start += 12) {
      const batchId = start ? operationId + ":" + start : operationId;
      const record = { type: "batch", batch: { ...batch(batchId, rows.slice(start, start + 12)), timing } };
      await call(host, "host.presentation.publish", { view: result([{ operationId: batchId, anchor, offsetMs: clock, record }]).view });
      await append(host, record, batchId);
    }
    lastBatchEnd = rows.at(-1).offsetMs + (settings.density === "low" ? 2200 : 1200);
  }
  async function call(host, method, args) {
    const reply = await host.request({ requestId: id(), method, args });
    if (!reply.result.ok) throw Object.assign(new Error(reply.result.error.message), reply.result.error);
    return reply.result.value;
  }
  async function cancel(host, keepMemory = true) {
    const old = pending;
    pending = null;
    if (old?.purpose === "memory" && keepMemory) memoryDue = { source: old.source, turn: old.turn };
    if (old?.operationId) await call(host, "host.models.cancel", { operationId: old.operationId });
  }
  async function hydrate(host, hostClock) {
    const saved = await call(host, "host.presentation.read", { anchor });
    revision = saved.revision;
    records = structuredClone(saved.records);
    hydrated = true;
    metricsState = saved.metricsState || emptyMetricsState();
    presets.restore(comments());
    const memories = records.filter((row) => row.record.type === "memory");
    memory = memories.at(-1)?.record.memory || "";
    memoryDone = memories.some((row) => sourceKey(row.record.source) === sourceKey(sourceOf(context)));
    const batches = records.filter((row) => row.record.type === "batch" && anchorKey(row.anchor) === anchorKey(anchor) && sourceKey(row.record.batch.source) === sourceKey(sourceOf(context))).map((row) => row.record.batch);
    const last = batches.at(-1);
    if (last) {
      if (context.mode === "live" && !hostClock) clock = Math.max(clock, last.offsetMs);
      heatAt = last.heatExpiresAtMs - coolingMs;
      heatPeak = last.heatExpiresAtMs > last.offsetMs ? last.heat * coolingMs / (last.heatExpiresAtMs - last.offsetMs) : 0;
      lastBatchEnd = Math.max(0, ...batches.flatMap((batch2) => batch2.comments.map((row) => row.offsetMs + 1200)));
    }
  }
  async function append(host, record, operationId, at = clock) {
    let nextMetrics = metricsState;
    if (record.type === "batch" && context.mode === "live" && !context.sourceKey.startsWith("presentation:") && record.batch.comments.length) {
      nextMetrics = advanceMetrics(metricsState, record.batch, { sessionId: context.sessionId, turn: context.settledTurn, groups: groups.length });
      record = { ...record, batch: { ...record.batch, metricsBasis: metricsBasis(nextMetrics), metrics: nextMetrics.snapshot } };
    }
    const input = { operationId, anchor, offsetMs: at, records: [record], expectedRevision: revision };
    const saved = await call(host, "host.presentation.append", input);
    metricsState = nextMetrics;
    revision = saved.revision;
    records.push({ id: saved.recordIds[0], operationId, anchor: structuredClone(anchor), offsetMs: at, record });
  }
  const batch = (batchId, comments2 = []) => {
    viewers.record(context.sessionId, comments2, now());
    return {
      id: batchId,
      source: sourceOf(context),
      anchor: structuredClone(anchor),
      offsetMs: clock,
      comments: comments2,
      heat: heat(),
      online: online(),
      heatExpiresAtMs: heatAt + coolingMs
    };
  };
  function modelWakeAfterMs() {
    if (!displayEnabled() || pending || error || !textReady) return null;
    if (!enabled()) return targets().length && hasCorpus() ? 1 : null;
    const ahead = targets().length > 0;
    if (!ahead && !memoryDue && aiRatio() < 100) return null;
    if (pagePlan.length && !ahead && !memoryDue) return null;
    if (!ahead && (!memoryDue && (!generating || !heat()) || !generating && !comments().some((row) => row.source === "model"))) return null;
    const at = now(), recent = starts.filter((time) => time > at - 6e4), cadence = cadenceForSettings(settings);
    const rate = Math.max(0, lastStart + cadence.minIntervalMs - at, recent.length >= cadence.maxPerMinute ? recent[0] + 6e4 - at : 0);
    return Math.max(1, rate, ahead || memoryDue ? 0 : lastBatchEnd - clock);
  }
  function wakeAfterMs() {
    if (backfillTarget()) return Math.max(1, page.shownAtMs - clock);
    if (!displayEnabled()) return null;
    const times = [modelWakeAfterMs(), presets.next(comments(), clock), !error && viewers.moving() ? 3e3 : null].filter((value) => value !== null);
    return times.length ? Math.min(...times) : null;
  }
  async function playPresets(host, revealed) {
    if (!displayEnabled() || aiRatio() < 100) return;
    const recent = comments().slice(-40);
    if (revealed) presets.trigger(revealed, groups, clock, recent);
    presets.observe(comments(), groups, clock, recent);
    const due = presets.take(groups, clock, recent);
    if (due.length) {
      const rows = tag(paceComments(due, comments(), clock, settings.density), page, { parsedAt: now() }), batchId = id();
      await append(host, { type: "batch", batch: batch(batchId, rows) }, batchId);
      lastBatchEnd = Math.max(lastBatchEnd, rows.at(-1).offsetMs + (settings.density === "low" ? 1100 : 600));
      presets.observe(comments(), groups, clock, comments().slice(-40));
    }
  }
  function backfillTarget() {
    if (!active || disposed || settings.view === "off" || context?.mode !== "history" || !hydrated || !hasCorpus() || !page) return null;
    const target = pagePlan[0];
    if (!target || anchorKey(target.anchor) !== anchorKey(anchor) || backfilled.has(sourceKey(sourceOf(context)) + anchorKey(anchor)) || records.some((row) => row.record.type === "batch" && anchorKey(row.anchor) === anchorKey(anchor) && sourceKey(row.record.batch.source) === sourceKey(sourceOf(context)))) return null;
    return target;
  }
  async function backfill(host) {
    const target = backfillTarget();
    if (!target || clock < page.shownAtMs) return;
    backfilled.add(sourceKey(sourceOf(context)) + anchorKey(anchor));
    const recent = comments().slice(-80);
    const retrieved = await call(host, "host.danmaku.retrieve", { pages: [target], budget: Math.ceil((settings.commentsPerRequest ?? 6) / 4), recent: recent.map((c) => c.text) });
    const operationId = id(), timing = { backfilledAt: now() };
    const rows = parseComments(retrieved, groups, recent, { id: operationId, offsetMs: clock, density: settings.density, random, chatId: context.sessionId }).map((row) => {
      const origin = retrieved.comments.find((c) => c.text === row.text);
      return tag([{ ...row, source: "real", origin: { window: origin.window, tier: origin.tier } }], { index: target.index, anchor: target.anchor }, timing)[0];
    });
    if (!rows.length) return;
    heatPeak = Math.max(heat(), stimulus.get("page.changed"));
    heatAt = clock;
    await release(host, rows, operationId, timing);
  }
  function result(preview = []) {
    const value = { view: projectView({
      context,
      anchor,
      records: [...records, ...preview],
      activeTimeMs: clock,
      heat: heat(),
      online: online(),
      active: active && !disposed,
      silent: !groups.length,
      waiting,
      error,
      settings,
      model,
      corpus: hasCorpus(),
      viewport,
      safeRegions,
      shownAtMs: page?.shownAtMs
    }), wakeAfterMs: wakeAfterMs() };
    value.view.page = page;
    return structuredClone(value);
  }
  async function request(host) {
    let pages = targets(), ahead = pages.length > 0;
    if (!displayEnabled() || !textReady || pending || error || !enabled() && !(ahead && hasCorpus()) || !ahead && !memoryDue && (!generating || !heat() || clock < lastBatchEnd)) return;
    const at = now(), cadence = cadenceForSettings(settings);
    starts = starts.filter((time) => time > at - 6e4);
    if (at - lastStart < cadence.minIntervalMs || starts.length >= cadence.maxPerMinute) return;
    const firstReaction = !comments().some((row) => row.source === "model");
    if (firstReaction && !generating && !ahead) return;
    if (pagePlan.length && !ahead && !memoryDue) return;
    const purpose = ahead || generating && heat() > 0 && !pagePlan.length ? "comments" : "memory", requestId = id();
    if (purpose === "comments" && !ahead && aiRatio() < 100) return;
    const recent = records.filter((row) => row.record.type === "batch").flatMap((row) => row.record.batch.comments).slice(-24);
    const configuredLimit = settings.commentsPerRequest ?? 6;
    let limit = pages.length ? Math.ceil(configuredLimit * pages.length / 4) : configuredLimit;
    let realExamples = [];
    const reservedPages = pages;
    let spentCredit = 0;
    const restorePlan = () => {
      aiCredit += spentCredit;
      for (const target of reservedPages) planned.delete(anchorKey(target.anchor));
    };
    const hasVisibleReaction = () => comments().some((row) => row.sourcePage && anchorKey(row.sourcePage.anchor) === anchorKey(page.anchor) && !late(row, clock));
    if (ahead && aiRatio() < 100) {
      const freshPages = pages.filter((target) => !prepared.has(anchorKey(target.anchor)));
      const freshLimit = Math.ceil(configuredLimit * freshPages.length / 4);
      aiCredit = Math.min(configuredLimit, aiCredit + freshLimit * aiRatio() / 100);
      let aiLimit = enabled() && aiCredit >= Math.min(3, configuredLimit) ? Math.min(limit, Math.floor(aiCredit)) : 0;
      const realLimit = Math.min(freshLimit, limit - aiLimit);
      const retrieved = hasCorpus() && realLimit ? await call(host, "host.danmaku.retrieve", { pages: freshPages, budget: realLimit, recent: [...comments(), ...ready].slice(-80).map((c) => c.text) }) : { comments: [] };
      for (const target of freshPages) prepared.set(anchorKey(target.anchor), retrieved.comments.filter((row) => row.page === target.index));
      realExamples = pages.flatMap((target) => prepared.get(anchorKey(target.anchor)) || []);
      const operationId = id(), timing = { requestedAt: at, parsedAt: now() };
      let parsed = parseComments(retrieved, groups, [...comments(), ...ready].slice(-80), { id: operationId, offsetMs: clock, density: settings.density, random, chatId: context.sessionId });
      if (entryReaction && enabled() && pages.some((target) => target.index === page.index) && !hasVisibleReaction() && !parsed.some((row) => row.page === page.index)) {
        aiLimit = Math.max(1, aiLimit);
        parsed = parsed.slice(0, limit - aiLimit);
      }
      if (parsed.length) {
        const rows = parsed.map((row) => {
          const target = pages.find((p) => p.index === row.page), origin = realExamples.find((c) => c.text === row.text);
          return tag([{ ...row, source: "real", origin: { window: origin.window, tier: origin.tier } }], { index: target.index, anchor: target.anchor }, timing)[0];
        });
        await release(host, rows, operationId, timing);
      }
      if (hasVisibleReaction()) entryReaction = false;
      for (const target of pages) planned.add(anchorKey(target.anchor));
      spentCredit = aiLimit;
      aiCredit -= aiLimit;
      limit = aiLimit;
      if (!limit) {
        generating = false;
        return;
      }
      pages = pages.slice(0, Math.min(pages.length, limit));
    }
    if (!enabled()) return;
    const own = { requestId, purpose, reactionVersion, groups, limit, source: sourceOf(context), turn: context.settledTurn, anchor: structuredClone(anchor), page: structuredClone(page), pages: structuredClone(pages), requestedAt: at, stimulusAt, operationId: null, stream: {}, lineCount: 0, highlighted: false };
    const previousStart = lastStart, previousMemoryDue = memoryDue;
    pending = own;
    starts.push(at);
    if (purpose === "comments") lastStart = at;
    if (purpose === "memory") memoryDue = null;
    const input = {
      task: purpose,
      commentCount: own.limit,
      groups: groups.map(({ ref, name: name2, content }) => {
        const { persona, tone, catchphrases, examples } = content, samples = presetExamples(content);
        return {
          ref,
          name: name2,
          ...persona ? { persona } : {},
          ...tone ? { tone } : {},
          ...catchphrases.length ? { catchphrases } : {},
          ...examples.length ? { examples } : {},
          ...samples.length ? { presetExamples: samples } : {}
        };
      }),
      memory,
      recent: recent.slice(-8).map(({ text }) => ({ text })),
      waiting,
      acceptedInput: lastInput,
      presented,
      heat: heat(),
      ...purpose === "comments" && pages.length ? { pages: pages.map(({ index, text }) => ({ page: index, text, ...realExamples.some((c) => c.page === index) ? { realExamples: realExamples.filter((c) => c.page === index).map((c) => c.text) } : {} })) } : {}
    };
    try {
      const reply = await call(host, "host.models.request", {
        requestId,
        slotId: purpose === "memory" ? "memory" : "audience",
        purpose,
        input: compactAudienceInput(input),
        maxOutputTokens: purpose === "memory" ? 1024 : 1536 + 256 * own.limit
      });
      own.operationId = reply.operationId;
      if (purpose === "comments") {
        for (const target of pages) planned.add(anchorKey(target.anchor));
        if (pages.some((target) => target.index === page.index)) entryReaction = false;
      }
    } catch (cause) {
      pending = null;
      if (cause.code === "MOD_SOURCE_STALE") {
        starts.pop();
        lastStart = previousStart;
        memoryDue = previousMemoryDue;
        restorePlan();
        return;
      }
      if (cause.code === "MOD_RESOURCE_UNAVAILABLE" && cause.path === "$.requestId") {
        starts.pop();
        lastStart = at;
        memoryDue = previousMemoryDue;
        restorePlan();
        return;
      }
      throw cause;
    }
  }
  async function streamComment(host, payload) {
    const own = pending;
    if (!own || payload.operationId !== own.operationId || own.purpose !== "comments" || error || !displayEnabled() || sourceKey(own.source) !== sourceKey(sourceOf(context)) || own.lineCount >= own.limit) return;
    const row = parseCommentLine(payload.output, own.stream);
    if (!row) return;
    own.lineCount++;
    if (own.highlighted && row.kind === "highlight") row.kind = "comment";
    const batchId = own.requestId + ":line:" + own.lineCount;
    const parsed = parseComments({ comments: [row] }, own.groups, comments().slice(-40), { id: batchId, offsetMs: clock, density: settings.density, random, chatId: context.sessionId }).filter((row2) => groups.some((group) => refKey(group.ref) === refKey(row2.group)));
    own.highlighted ||= parsed.some((row2) => row2.kind === "highlight");
    const target = own.pages.length ? own.pages.find((target2) => target2.index === row.page) : own.page;
    if (!target) throw Object.assign(new Error("Each comment needs a supplied page number"), { code: "MOD_RESOURCE_UNAVAILABLE" });
    const timing = { operationId: own.operationId, requestedAt: own.requestedAt, stimulusAt: own.stimulusAt, parsedAt: now() };
    await release(host, tag(parsed, { index: target.index, anchor: target.anchor }, timing), batchId, timing);
  }
  async function complete(host, payload) {
    if (!pending || payload.operationId !== pending.operationId) return;
    const own = pending;
    pending = null;
    if (!displayEnabled() || sourceKey(own.source) !== sourceKey(sourceOf(context))) return;
    if (payload.status !== "completed") {
      error = payload.error || { code: "MOD_RUNTIME_FAILED", message: "Audience model request failed" };
      return;
    }
    if (own.purpose === "memory") {
      const next = parseMemory(payload.output);
      await append(host, { type: "memory", source: own.source, turn: own.turn, memory: next }, own.requestId);
      memory = next;
      memoryDone = true;
    } else if (!own.stream.started && (generating && heat() > 0 || own.pages.length)) {
      const recent = records.filter((row) => row.record.type === "batch").flatMap((row) => row.record.batch.comments).slice(-40);
      const parsed = parseComments(payload.output, own.groups, recent, { limit: own.limit, id: own.requestId, offsetMs: clock, density: settings.density, random, chatId: context.sessionId }).filter((row) => groups.some((group) => refKey(group.ref) === refKey(row.group)));
      const timing = { operationId: own.operationId, requestedAt: own.requestedAt, stimulusAt: own.stimulusAt, parsedAt: now() };
      const rows = parsed.map((row) => {
        const target = own.pages.length ? own.pages.find((target2) => target2.index === row.page) : own.page;
        if (!target) throw Object.assign(new Error("Each comment needs a supplied page number"), { code: "MOD_RESOURCE_UNAVAILABLE" });
        return tag([row], { index: target.index, anchor: target.anchor }, timing)[0];
      });
      await release(host, rows, own.requestId, timing);
      if (!rows.length) lastBatchEnd = clock + 3e3;
    }
    if (own.purpose === "comments") generating = own.reactionVersion !== reactionVersion;
  }
  return Object.freeze({
    async handle(event2, host) {
      if (seen.has(event2.eventId)) return context ? result() : null;
      seen.add(event2.eventId);
      if (seen.size > 256) seen.delete(seen.values().next().value);
      const wasOff = settings.view === "off";
      const oldContext = context, previousAnchor = anchor, payload = event2.payload || {};
      context = event2.context;
      textReady = payload.pageReady ?? true;
      const changed = oldContext && (sourceKey(sourceOf(oldContext)) !== sourceKey(sourceOf(context)) || oldContext.authorityEpoch !== context.authorityEpoch || oldContext.mode !== context.mode);
      const nextAnchor = payload.anchor || payload.to;
      if (nextAnchor) anchor = { sourceKey: context.sourceKey, part: "body", ...nextAnchor };
      if (changed && !nextAnchor) anchor = null;
      clock = payload.activeTimeMs ?? (changed ? 0 : clock);
      const visit = payload.visit ?? null, samePage = page && !changed && anchor && anchorKey(page.anchor) === anchorKey(anchor);
      const movedPage = anchor && (!samePage || (page.visit ?? null) !== visit);
      if (changed) {
        pagePlan = [];
        ready = [];
        planned.clear();
        prepared.clear();
        shown.clear();
      }
      if (movedPage) {
        const key = anchorKey(anchor);
        shown.set(key, clock + (context.mode === "history" && payload.rapid === true && visit === null ? HISTORY_SETTLE_MS : 0));
        page = { index: payload.pages?.[0]?.index ?? (samePage ? page.index : changed || !page ? 0 : page.index + 1), anchor: structuredClone(anchor), shownAtMs: shown.get(key), visit };
        if (!payload.pages?.length) pagePlan = [];
      }
      if (payload.pages?.length) {
        pagePlan = payload.pages.map((row) => ({ ...row, anchor: { ...anchor, ...row.anchor } }));
        page = { ...page, index: pagePlan[0].index };
      }
      if (payload.danmaku) {
        const wasAvailable = model.available;
        groups = payload.danmaku.groups;
        settings = payload.danmaku.settings || {};
        model = payload.danmaku.model || defaultModel();
        if (!model.available && !hasCorpus() && aiRatio() > 0) error = { code: "MOD_RESOURCE_UNAVAILABLE", message: "Choose an available audience model in global model settings" };
        else if (!wasAvailable) error = null;
      }
      if (payload.viewport) viewport = payload.viewport;
      if (payload.safeRegions) safeRegions = payload.safeRegions;
      if (typeof payload.active === "boolean") active = payload.active;
      if (["stage.left", "session.disposed"].includes(event2.event)) active = false;
      if (event2.event === "session.disposed") disposed = true;
      try {
        const moved = anchor && previousAnchor && anchorKey(anchor) !== anchorKey(previousAnchor);
        const carry = moved && !changed && context.mode === "live" ? records.filter((row) => row.record.type === "batch").map((row) => ({ ...row, anchor: structuredClone(anchor), record: { ...row.record, batch: { ...row.record.batch, anchor: structuredClone(anchor), comments: row.record.batch.comments.filter((comment) => comment.offsetMs > clock && comment.offsetMs <= clock + DANMAKU_LATE_MS && !late(comment, comment.offsetMs)) } } })).filter((row) => row.record.batch.comments.length) : [];
        if (changed || moved) {
          if (changed || pending?.purpose === "memory") await cancel(host, !changed);
          presets.reset();
          hydrated = false;
          records = [];
          heatPeak = 0;
          lastBatchEnd = 0;
          error = null;
          generating = false;
          if (changed) {
            memory = "";
            memoryDone = false;
            memoryDue = null;
            lastInput = null;
            presented = [];
            waiting = false;
          }
        }
        if (!active || settings.view === "off" || context.mode === "history" || !groups.length) {
          await cancel(host);
          ready = [];
          planned.clear();
          prepared.clear();
          heatPeak = 0;
          lastBatchEnd = clock;
          generating = false;
          if (!groups.length) memoryDue = null;
        }
        if (anchor && !hydrated && groups.length) await hydrate(host, payload.activeTimeMs !== void 0);
        await backfill(host);
        for (const row of carry) if (!records.some((saved) => saved.operationId === row.operationId)) records.push(row);
        if (carry.length) lastBatchEnd = Math.max(lastBatchEnd, ...carry.flatMap((row) => row.record.batch.comments).map((row) => row.offsetMs + (settings.density === "low" ? 2200 : 1200)));
        const opened = wasOff && displayEnabled();
        if (event2.event === "stage.entered" || opened) entryReaction = true;
        if (opened && page) {
          shown.set(anchorKey(anchor), clock);
          page = { ...page, shownAtMs: clock };
        }
        if (displayEnabled()) {
          const due = ready.filter((row) => row.sourcePage.index <= page.index);
          ready = ready.filter((row) => row.sourcePage.index > page.index);
          if (due.length) await release(host, due, id() + ":reveal", { releasedAt: now() });
        }
        if (!displayEnabled()) presets.pause(comments());
        if (event2.event === "player.input") lastInput = { inputId: payload.inputId || payload.operationId, text: payload.text || payload.input || "" };
        if (event2.event === "performance.presented" && active) {
          presented.push(Object.fromEntries(["performanceId", "phase", "text", "visualType"].filter((key) => payload[key] !== void 0).map((key) => [key, payload[key]])));
          presented = presented.slice(-6);
        }
        if (event2.event === "generation.started") waiting = true;
        if (event2.event === "generation.ended") waiting = false;
        if ((event2.event === "generation.ended" && payload.status === "completed" || event2.event === "round.committed" || event2.event === "mod.context.changed" && payload.reason === "snapshot" && context.mode === "live") && groups.length > 0 && context.settledTurn > 0 && !memoryDone && pending?.purpose !== "memory") memoryDue = { source: sourceOf(context), turn: context.settledTurn, awaitReaction: event2.event === "mod.context.changed" };
        if (payload.provisional || aiRatio() === 0) memoryDue = null;
        if (aiRatio() === 0) {
          if (pending) await cancel(host, false);
          ready = ready.filter((row) => row.source === "real");
        }
        if (event2.event === "model.output") await streamComment(host, payload);
        if (event2.event === "model.completed") await complete(host, payload);
        const resumed = event2.event === "stage.entered" && records.some((row) => row.record.type === "batch" && anchorKey(row.anchor) === anchorKey(anchor) && sourceKey(row.record.batch.source) === sourceKey(sourceOf(context)));
        const newRound = oldContext?.mode === "live" && context.mode === "live" && context.settledTurn > oldContext.settledTurn;
        const rise = opened ? 80 : resumed ? 0 : stimulus.get(event2.event) || (newRound ? 80 : 0), heatId = "heat:" + event2.eventId;
        if (rise && displayEnabled() && !records.some((row) => row.operationId === heatId)) {
          if (pending?.purpose === "memory") await cancel(host);
          reactionVersion++;
          stimulusAt = now();
          heatPeak = Math.max(heat(), rise);
          heatAt = clock;
          generating = true;
          records.push({ operationId: heatId, anchor: structuredClone(anchor), offsetMs: clock, record: { type: "batch", batch: batch(heatId) } });
        }
        if (event2.event === "mod.context.changed" && payload.reason !== "cadence" && payload.reason !== "snapshot" && model.available) error = null;
        await request(host);
        await playPresets(host, event2.event === "text.revealed" ? payload.revealed : null);
      } catch (cause) {
        error = { code: cause.code || "MOD_RUNTIME_FAILED", message: cause.message };
      }
      return result();
    }
  });
}

// tavern-plugin/mods/danmaku/runtime.js
var sessions = /* @__PURE__ */ new Map();
function prepare() {
  return { sections: [] };
}
function command() {
  throw Object.assign(new Error("Danmaku has no director commands"), { code: "MOD_PERMISSION_DENIED" });
}
function settled() {
  return null;
}
function dispose() {
  sessions.clear();
  return null;
}
async function event(message, host) {
  const key = message.context.sessionId;
  let controller = sessions.get(key);
  if (!controller) {
    controller = createDanmakuController();
    sessions.set(key, controller);
  }
  if (message.payload.host) {
    const { entries, settings, models } = message.payload.host;
    message = { ...message, payload: { ...message.payload, danmaku: { groups: entries, settings, model: models.audience } } };
  }
  const result = await controller.handle(message, host);
  if (message.event === "session.disposed") sessions.delete(key);
  return result;
}

// tavern-plugin/mods/danmaku/plugin.mjs
var name = "dsh-tavern-mod-danmaku";
var inject = ["tavern"];
function apply(ctx) {
  ctx.tavern.registerMod(mod_default, { execution: runtime_exports, commands: [], event, dispose });
}
export {
  apply,
  inject,
  name
};
