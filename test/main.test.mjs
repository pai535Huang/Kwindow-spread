import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, mainSource, makeDesktop, makeWindow, ruleWindow } from './helpers/kwin.js';

test('avoids JS features missing from the KWin QJSEngine', () => {
  assert.equal(mainSource.includes('.flatMap('), false, 'flatMap is missing from KWin QJSEngine');
  assert.equal(mainSource.includes('=>'), false, 'arrow functions are unsafe on older KWin engines');
  assert.equal(mainSource.includes('?.') , false, 'optional chaining is missing from KWin QJSEngine');
  assert.equal(mainSource.includes('??'), false, 'nullish coalescing is missing from KWin QJSEngine');
});

test('leaves the first normal window on the source desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const source = makeDesktop(0);
  const decision = context.getPlacementDecision({
    window: ruleWindow({ desktop: source, title: 'Terminal' }),
    desktops: [source],
    windows: [],
    sourceDesktop: source,
    rules: context.DEFAULT_RULES,
  });

  assert.equal(decision.kind, 'stay');
  assert.equal(decision.reason, 'no-non-empty-desktop');
});

test('moves a new normal window to the desktop after the last non-empty desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2)];
  const existing = ruleWindow({ desktop: desktops[1], title: 'Browser' });

  const decision = context.getPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], title: 'Terminal' }),
    desktops,
    windows: [existing],
    sourceDesktop: desktops[0],
    rules: context.DEFAULT_RULES,
  });

  assert.equal(decision.kind, 'move');
  assert.equal(decision.targetDesktop, desktops[2]);
  assert.equal(decision.reason, 'next-after-last-non-empty');
});

test('requests a new desktop when the last non-empty desktop is the final desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1)];
  const existing = ruleWindow({ desktop: desktops[1], title: 'Browser' });

  const decision = context.getPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], title: 'Editor' }),
    desktops,
    windows: [existing],
    sourceDesktop: desktops[0],
    canCreateDesktop: true,
    rules: context.DEFAULT_RULES,
  });

  assert.equal(decision.kind, 'create-and-move');
  assert.equal(decision.insertIndex, 2);
});

test('keeps portal and file chooser windows on their source desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const source = makeDesktop(0);
  const portalDecision = context.getPlacementDecision({
    window: ruleWindow({ desktop: source, resourceClass: 'xdg-desktop-portal-gtk' }),
    desktops: [source, makeDesktop(1)],
    windows: [ruleWindow({ desktop: source, title: 'Browser' })],
    sourceDesktop: source,
    rules: context.DEFAULT_RULES,
  });
  const chooserDecision = context.getPlacementDecision({
    window: ruleWindow({ desktop: source, role: 'GtkFileChooserDialog', title: 'Open File' }),
    desktops: [source, makeDesktop(1)],
    windows: [ruleWindow({ desktop: source, title: 'Browser' })],
    sourceDesktop: source,
    rules: context.DEFAULT_RULES,
  });

  assert.equal(portalDecision.kind, 'stay');
  assert.equal(portalDecision.reason, 'source-workspace-window');
  assert.equal(chooserDecision.kind, 'stay');
  assert.equal(chooserDecision.reason, 'source-workspace-window');
});

test('places same-group windows on the existing matching desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2)];
  const rules = {
    ...context.DEFAULT_RULES,
    sameDesktopGroups: ['code*, *preview*'],
  };
  const existing = ruleWindow({ desktop: desktops[1], resourceClass: 'code-oss', title: 'Project' });

  const decision = context.getPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], title: 'Markdown Preview' }),
    desktops,
    windows: [existing],
    sourceDesktop: desktops[0],
    rules,
  });

  assert.equal(decision.kind, 'move');
  assert.equal(decision.targetDesktop, desktops[1]);
  assert.equal(decision.reason, 'same-group');
});

test('filters out non-normal top-level windows', () => {
  const { context } = loadScript({ desktops: [] });
  assert.equal(context.shouldTreatAsNormalWindow(ruleWindow({ normalWindow: false })), false);
  assert.equal(context.shouldTreatAsNormalWindow(ruleWindow({ skipTaskbar: true })), false);
  assert.equal(context.shouldTreatAsNormalWindow(ruleWindow({ onAllDesktops: true })), false);
  assert.equal(context.shouldTreatAsNormalWindow(ruleWindow({ transient: true })), false);
  assert.equal(context.shouldTreatAsNormalWindow(ruleWindow({ dialog: true })), false);
  assert.equal(context.shouldTreatAsNormalWindow(ruleWindow({ title: 'App' })), true);
});

test('chooses the nearest non-empty desktop when an active desktop becomes empty', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2), makeDesktop(3)];
  const decision = context.getEmptyDesktopCleanupDecision({
    emptyDesktop: desktops[2],
    activeDesktop: desktops[2],
    desktops,
    windows: [
      ruleWindow({ desktop: desktops[0], title: 'Browser' }),
      ruleWindow({ desktop: desktops[3], title: 'Chat' }),
    ],
  });

  assert.equal(decision.kind, 'activate-and-remove');
  assert.equal(decision.targetDesktop, desktops[0]);
  assert.equal(decision.removeDesktop, desktops[2]);
});

test('moves a freshly added window after the QTimer delay', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ title: 'Browser', desktops: [d1] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = existing;

  const fresh = makeWindow({ title: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);

  assert.equal(h.QTimer.pending, 1);
  h.QTimer.fireAll();

  assert.equal(fresh.desktops[0], d2);
  assert.equal(h.workspace.currentDesktop, d2);
  assert.equal(h.workspace.activeWindow, fresh);
});

test('does not cascade desktop creation for windows added within the move delay', () => {
  const d0 = makeDesktop(0);
  const h = loadScript({ windows: [], desktops: [d0] });
  h.workspace.currentDesktop = d0;

  const a = makeWindow({ title: 'A', desktops: [d0] });
  const b = makeWindow({ title: 'B', desktops: [d0] });
  h.loadWindow(a);
  h.workspace.windowAdded.fire(a);
  h.loadWindow(b);
  h.workspace.windowAdded.fire(b);

  h.QTimer.fireNext();
  h.QTimer.fireNext();

  assert.equal(h.workspace.desktops.length, 2);
  assert.equal(a.desktops[0], d0);
  assert.equal(b.desktops[0], h.workspace.desktops[1]);
});

test('creates a virtual desktop when the target desktop does not exist', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ title: 'Browser', desktops: [d1] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = existing;

  const fresh = makeWindow({ title: 'Editor', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);
  h.QTimer.fireAll();

  assert.equal(h.workspace.desktops.length, 3);
  assert.equal(fresh.desktops[0], h.workspace.desktops[2]);
});

test('keeps focus on the source window when configured', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const focused = makeWindow({ title: 'Editor', desktops: [d0] });
  const other = makeWindow({ title: 'Browser', desktops: [d1] });
  const h = loadScript({
    windows: [focused, other],
    desktops: [d0, d1, d2],
    config: { KeepCurrentFocus: true },
  });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = focused;

  const fresh = makeWindow({ title: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);
  h.QTimer.fireAll();

  assert.equal(fresh.desktops[0], d2);
  assert.equal(h.workspace.activeWindow, focused);
  assert.equal(h.workspace.currentDesktop, d0);
});

test('cancels the pending move when the window closes before the timer fires', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ title: 'Browser', desktops: [d1] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = existing;

  const fresh = makeWindow({ title: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);
  h.unloadWindow(fresh);
  h.workspace.windowRemoved.fire(fresh);

  h.QTimer.fireNext();

  assert.equal(fresh.desktops[0], d0);
});

test('handles close signals only once even when both closed and windowRemoved fire', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const w = makeWindow({ title: 'App', desktops: [d0] });
  const h = loadScript({ windows: [w], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = w;

  h.unloadWindow(w);
  h.workspace.windowRemoved.fire(w);
  const afterFirst = h.QTimer.pending;
  assert.equal(afterFirst, 1);

  h.workspace.windowRemoved.fire(w);
  assert.equal(h.QTimer.pending, afterFirst);
});

test('switches to the nearest non-empty desktop and removes the emptied desktop', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ title: 'Browser', desktops: [d0] });
  const chat = makeWindow({ title: 'Chat', desktops: [d3] });
  const closing = makeWindow({ title: 'Editor', desktops: [d2] });
  const h = loadScript({ windows: [browser, chat, closing], desktops: [d0, d1, d2, d3] });
  h.workspace.currentDesktop = d2;
  h.workspace.activeWindow = closing;

  h.unloadWindow(closing);
  h.workspace.windowRemoved.fire(closing);
  h.QTimer.fireAll();

  assert.equal(h.workspace.currentDesktop, d0);
  assert.ok(![...h.workspace.desktops].includes(d2));
  assert.deepEqual([...h.workspace.desktops], [d0, d1, d3]);
});
