import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../tavern-plugin/src/client/main.js", import.meta.url), "utf8");
const prepare = source.slice(source.indexOf("async function preparePlayConversation(card)"), source.indexOf("async function importCard(file)"));
const start = source.indexOf('React.useEffect(function () {\n\t\t\t\tif (!openingPicker');
const effect = source.slice(start, source.indexOf("React.useEffect", start + 20));
function harness() {
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const state = { openingPicker: null, busy: false, error: "", calls: 0, timers: [] };
  const context = vm.createContext({
    window: { localStorage: { getItem: () => " 你 " }, setTimeout: fn => { state.timers.push(fn); return 1; }, clearTimeout() {} },
    compatibilityAvailable: false, requestMode: "dsh",
    playPrewarmRef: { current: { begin() {}, cancel() {} } },
    setBusy: value => { state.busy = value; },
    setError: value => { state.error = value; },
    setOpeningPicker: value => { state.openingPicker = typeof value === "function" ? value(state.openingPicker) : value; },
    call: () => { state.calls++; return pending; },
    React: { useEffect: fn => fn() },
  });
  vm.runInContext(prepare, context);
  return { state, resolve, reject, run: () => context.preparePlayConversation({ path: "fixture.json", name: "Fixture" }),
    effect: () => { context.openingPicker = state.openingPicker; vm.runInContext(effect, context); } };
}
test("shows pending picker before RPC completes and does not request initial openings twice", async () => {
  const h = harness();
  const running = h.run();
  assert.equal(h.state.busy, true);
  assert.equal(h.state.openingPicker.preparing, true);
  h.effect();
  assert.equal(h.state.timers.length, 0);
  h.resolve({ openings: [{ id: "first" }], preparationId: "ready" });
  await running;
  assert.equal(h.state.openingPicker.preparing, false);
  assert.equal(h.state.busy, false);
  h.effect();
  assert.equal(h.state.timers.length, 0);
  assert.equal(h.state.calls, 1);
  h.state.openingPicker.userName = "New name";
  h.effect();
  assert.equal(h.state.timers.length, 1);
  await h.state.timers[0]();
  assert.equal(h.state.calls, 2);
  assert.equal(h.state.openingPicker.preparedKey, JSON.stringify(["New name", "dsh"]));
});
test("failed preparation returns to card selection without allowing an empty start", async () => {
  const h = harness();
  const running = h.run();
  h.reject(new Error("fixture failure"));
  await running;
  assert.equal(h.state.openingPicker, null);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.error, "fixture failure");
});
