import test from 'node:test';
import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import {tryChallengeClick} from '../src/challenge-click.ts';

type Control = {role?: string; name?: string; visible: boolean | (() => Promise<boolean>); label?: boolean; associated?: boolean; clicks: number};
class FakeLocator {
  constructor(readonly controls: Control[]) {}
  filter({hasText}: {hasText: RegExp}) { return new FakeLocator(this.controls.filter(c => hasText.test(c.name ?? ''))); }
  async count() { return this.controls.length; }
  nth(index: number) { return new FakeLocator([this.controls[index]!]); }
  async isVisible() {
    const value = this.controls[0]!.visible;
    return typeof value === 'function' ? value() : value;
  }
  async evaluate() { return this.controls[0]!.associated ?? false; }
  async click() { this.controls[0]!.clicks++; }
}
class FakeFrame {
  inspections = 0;
  constructor(readonly address: string, readonly controls: Control[] = [], readonly parent: FakeFrame | null = null) {}
  url() { return this.address; }
  parentFrame() { return this.parent; }
  getByRole(role: string, options?: {name: RegExp}) {
    this.inspections++;
    return new FakeLocator(this.controls.filter(c => c.role === role && (!options?.name || options.name.test(c.name ?? ''))));
  }
  locator(selector: string) {
    this.inspections++;
    return new FakeLocator(this.controls.filter(c => selector === 'label' ? c.label : c.role === 'checkbox'));
  }
}
const checkbox = (visible: Control['visible'] = true): Control => ({role: 'checkbox', visible, clicks: 0});
function run(frames: FakeFrame[], options: {signal?: AbortSignal; timeoutMs?: number} = {}) {
  const events: Record<string, unknown>[] = [];
  const page = {frames: () => frames, mainFrame: () => frames[0]} as unknown as Page;
  return {events, promise: tryChallengeClick(page, (event, values) => events.push({event, ...values}), {timeoutMs: 40, ...options})};
}
const home = () => new FakeFrame('https://whatson.bfi.org.uk/imax/Online/default.asp');

test('searches past a hidden first checkbox and attempts only one visible control', async () => {
  const hidden = checkbox(false), visible = checkbox(), second = checkbox();
  const r = run([home(), new FakeFrame('https://challenges.cloudflare.com/widget', [hidden, visible, second])]);
  await r.promise;
  assert.deepEqual([hidden.clicks, visible.clicks, second.clicks], [0, 1, 0]);
  assert.equal(r.events.at(-1)?.outcome, 'clicked');
});

test('uses a visible label associated with a hidden checkbox', async () => {
  const hidden = checkbox(false);
  const unrelated: Control = {label: true, visible: true, clicks: 0, associated: false};
  const label: Control = {label: true, visible: true, clicks: 0, associated: true};
  const r = run([home(), new FakeFrame('https://challenges.cloudflare.com/widget', [hidden, unrelated, label])]);
  await r.promise;
  assert.deepEqual([hidden.clicks, unrelated.clicks, label.clicks], [0, 0, 1]);
});

test('discovers a blank descendant of a trusted challenge frame', async () => {
  const parent = new FakeFrame('https://challenges.cloudflare.com/widget');
  const visible = checkbox();
  const descendant = new FakeFrame('about:blank', [visible], new FakeFrame('about:srcdoc', [], parent));
  const r = run([home(), parent, descendant]);
  await r.promise;
  assert.equal(visible.clicks, 1);
});

test('ignores foreign origins including lookalike hostnames and their blank children', async () => {
  const foreign = new FakeFrame('https://challenges.cloudflare.com.example.org/widget', [checkbox()]);
  const child = new FakeFrame('about:blank', [checkbox()], foreign);
  const r = run([home(), foreign, child]);
  await r.promise;
  assert.equal(foreign.inspections, 0);
  assert.equal(child.inspections, 0);
  assert.equal(r.events.at(-1)?.outcome, 'checkbox-not-found');
});

test('main frame only clicks explicitly named human verification controls', async () => {
  const ordinary = checkbox(), human = {...checkbox(), name: 'Verify you are human'};
  const r = run([new FakeFrame('https://whatson.bfi.org.uk/', [ordinary, human])]);
  await r.promise;
  assert.deepEqual([ordinary.clicks, human.clicks], [0, 1]);
});

test('abort during a pending visibility inspection prevents a later click', async () => {
  let resolve!: (value: boolean) => void;
  const visible = checkbox(() => new Promise<boolean>(done => {resolve = done;}));
  const controller = new AbortController();
  const r = run([home(), new FakeFrame('https://challenges.cloudflare.com/widget', [visible])], {signal: controller.signal, timeoutMs: 200});
  await new Promise(done => setTimeout(done, 5));
  controller.abort();
  await r.promise;
  resolve(true);
  await new Promise(done => setTimeout(done, 5));
  assert.equal(visible.clicks, 0);
  assert.equal(r.events.at(-1)?.outcome, 'cancelled');
});

test('a stalled inspection is bounded by the search deadline and logs no page content', async () => {
  const visible = checkbox(() => new Promise<boolean>(() => {}));
  const start = performance.now();
  const r = run([home(), new FakeFrame('https://challenges.cloudflare.com/private-token', [visible])], {timeoutMs: 20});
  await r.promise;
  assert.ok(performance.now() - start < 500);
  assert.equal(visible.clicks, 0);
  assert.equal(r.events.at(-1)?.outcome, 'checkbox-not-found');
  assert.ok(!JSON.stringify(r.events).includes('private-token'));
});
