import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScript, mainSource, makeDesktop, makeWindow, ruleWindow } from './helpers/kwin.js';

const configSchemaSource = readFileSync(new URL('../contents/config/main.xml', import.meta.url), 'utf8');
const configUiSource = readFileSync(new URL('../contents/ui/config.ui', import.meta.url), 'utf8');

test('avoids JS features missing from the KWin QJSEngine', () => {
  assert.equal(mainSource.includes('.flatMap('), false, 'flatMap is missing from KWin QJSEngine');
  assert.equal(mainSource.includes('=>'), false, 'arrow functions are unsafe on older KWin engines');
  assert.equal(mainSource.includes('?.') , false, 'optional chaining is missing from KWin QJSEngine');
  assert.equal(mainSource.includes('??'), false, 'nullish coalescing is missing from KWin QJSEngine');
});

test('exposes only the new editable source-desktop application setting', () => {
  assert.equal(configSchemaSource.includes('name="SourceDesktopApplications"'), true);
  assert.equal(configUiSource.includes('name="kcfg_SourceDesktopApplications"'), true);

  ['AuxiliaryDialogTitles', 'AuxiliaryRoles', 'PortalIdentifiers'].forEach((name) => {
    assert.equal(configSchemaSource.includes(name), false);
    assert.equal(configSchemaSource.includes(`kcfg_${name}`), false);
    assert.equal(configUiSource.includes(name), false);
    assert.equal(configUiSource.includes(`kcfg_${name}`), false);
  });
});

test('exposes no optional desktop-creation setting', () => {
  assert.equal(configSchemaSource.includes('name="CreateVirtualDesktops"'), false);
  assert.equal(configUiSource.includes('name="kcfg_CreateVirtualDesktops"'), false);
});

test('models disconnectable Plasma 6 identity signals', () => {
  const window = makeWindow();
  let calls = 0;
  const handler = () => { calls += 1; };
  window.windowClassChanged.connect(handler);
  window.windowClassChanged.fire();
  window.windowClassChanged.disconnect(handler);
  window.windowClassChanged.fire();
  assert.equal(calls, 1);
  assert.equal(window.windowClassChanged.handlerCount, 0);
  assert.equal(window.desktopChanged, undefined);
});

test('leaves the first normal window on the source desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const source = makeDesktop(0);
  const decision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: source, title: 'Terminal' }),
    desktops: [source],
    windows: [],
    sourceDesktop: source,
    spareDesktop: source,
    rules: context.DEFAULT_RULES,
  });

  assert.equal(decision.kind, 'spread');
  assert.equal(decision.targetDesktop, source);
  assert.equal(decision.reason, 'trailing-spare');
});

test('moves a new normal window to the trailing spare desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2)];
  const existing = ruleWindow({ desktop: desktops[1], title: 'Browser' });

  const decision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], title: 'Terminal' }),
    desktops,
    windows: [existing],
    sourceDesktop: desktops[0],
    spareDesktop: desktops[2],
    rules: context.DEFAULT_RULES,
  });

  assert.equal(decision.kind, 'spread');
  assert.equal(decision.targetDesktop, desktops[2]);
  assert.equal(decision.reason, 'trailing-spare');
});

test('selects an existing empty final desktop as the spare', () => {
  const { context } = loadScript({ desktops: [] });
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const browser = ruleWindow({ desktop: d0, desktops: [d0], title: 'Browser' });
  assert.equal(context.getTrailingSpareDesktop([d0, d1], [browser]), d1);
});

test('returns null for missing or empty desktop lists', () => {
  const { context } = loadScript({ desktops: [] });
  assert.equal(context.getTrailingSpareDesktop(undefined, []), null);
  assert.equal(context.getTrailingSpareDesktop([], []), null);
});

test('does not let a non-normal final-desktop window consume the spare', () => {
  const { context } = loadScript({ desktops: [] });
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const auxiliary = ruleWindow({ normalWindow: false, desktop: d1, desktops: [d1] });
  assert.equal(context.getTrailingSpareDesktop([d0, d1], [auxiliary]), d1);
});

test('returns null when the final desktop is occupied', () => {
  const { context } = loadScript({ desktops: [] });
  const d0 = makeDesktop(0);
  const browser = ruleWindow({ desktop: d0, desktops: [d0], title: 'Browser' });
  assert.equal(context.getTrailingSpareDesktop([d0], [browser]), null);
});

test('adds a trailing spare desktop at script startup when the final desktop is occupied', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0] });

  assert.equal(h.workspace.desktops.length, 2);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[1]);
});

test('keeps portal and file chooser windows on their source desktop', () => {
  const { context } = loadScript({ desktops: [] });
  const source = makeDesktop(0);
  const portalDecision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: source, resourceClass: 'xdg-desktop-portal-gtk' }),
    desktops: [source, makeDesktop(1)],
    windows: [ruleWindow({ desktop: source, title: 'Browser' })],
    sourceDesktop: source,
    rules: context.DEFAULT_RULES,
  });
  const chooserDecision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: source, role: 'GtkFileChooserDialog', title: 'Open File' }),
    desktops: [source, makeDesktop(1)],
    windows: [ruleWindow({ desktop: source, title: 'Browser' })],
    sourceDesktop: source,
    rules: context.DEFAULT_RULES,
  });

  assert.equal(portalDecision.kind, 'source');
  assert.equal(portalDecision.targetDesktop, source);
  assert.equal(portalDecision.reason, 'source-workspace-window');
  assert.equal(chooserDecision.kind, 'source');
  assert.equal(chooserDecision.targetDesktop, source);
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

  const decision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], title: 'Markdown Preview' }),
    desktops,
    windows: [existing],
    sourceDesktop: desktops[0],
    rules,
  });

  assert.equal(decision.kind, 'group');
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

test('window add and remove events do not trigger asynchronous D-Bus config refreshes', () => {
  const desktop = makeDesktop(0);
  const h = loadScript({ desktops: [desktop] });
  const titlebarMenu = makeWindow({ normalWindow: false, popupMenu: true, desktops: [desktop] });

  h.loadWindow(titlebarMenu);
  h.workspace.windowAdded.fire(titlebarMenu);
  h.unloadWindow(titlebarMenu);
  h.workspace.windowRemoved.fire(titlebarMenu);

  assert.deepEqual(h.callDBusCalls, []);
});

test('immediate placement uses config loaded at script startup', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = existing;

  h.config.SourceDesktopApplications = '';

  const fresh = makeWindow({ caption: 'Capture', resourceClass: 'spectacle', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);

  assert.equal(fresh.desktops[0], d0);
  assert.equal(h.workspace.desktops.length, 3);
  assert.deepEqual([...h.workspace.desktops].slice(0, 2), [d0, d1]);
  assert.equal(h.context.reservedDesktopByWindow.get(fresh), d1);
  assert.deepEqual([...h.context.config.rules.sourceDesktopApplications], ['spectacle']);
});

test('cleanup removes intermediate empties and retains the trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1, d2, d3] });
  h.workspace.currentDesktop = d0;

  h.context.reconcileTrailingSpareDesktops(false);

  assert.deepEqual([...h.workspace.desktops], [d0, d3]);
  assert.equal(browser.desktops[0], d0);
});

test('keeps every desktop assigned to a multi-desktop window', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const window = makeWindow({ caption: 'Browser', desktops: [d0, d2] });
  const h = loadScript({ windows: [window], desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d0;
  const spare = h.workspace.desktops[3];

  h.context.reconcileTrailingSpareDesktops(false);

  assert.deepEqual([...h.workspace.desktops], [d0, d2, spare]);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), spare);
});

test('reconciliation restores MRU focus before removing an active middle empty', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const previous = makeWindow({ caption: 'Browser', desktops: [d0] });
  const other = makeWindow({ caption: 'Editor', desktops: [d2] });
  const h = loadScript({ windows: [previous, other], desktops: [d0, d1, d2, d3] });
  h.workspace.windowActivated.fire(previous);
  h.workspace.currentDesktop = d1;

  h.context.reconcileTrailingSpareDesktops(true);

  assert.equal(h.workspace.activeWindow, previous);
  assert.equal(h.workspace.currentDesktop, d0);
  assert.deepEqual([...h.workspace.desktops], [d0, d2, d3]);
});

test('reconciliation restores normal MRU focus instead of the latest auxiliary activation', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const previous = makeWindow({ caption: 'Browser', desktops: [d0] });
  const dialog = makeWindow({ caption: 'Dialog', dialog: true, desktops: [d1] });
  const h = loadScript({ windows: [previous, dialog], desktops: [d0, d1, d2] });
  h.workspace.windowActivated.fire(previous);
  h.workspace.windowActivated.fire(dialog);
  h.workspace.currentDesktop = d1;
  h.workspace.activeWindow = dialog;

  h.context.reconcileTrailingSpareDesktops(true);

  assert.equal(h.workspace.activeWindow, previous);
  assert.equal(h.workspace.currentDesktop, d0);
  assert.deepEqual([...h.workspace.desktops], [d0, d2]);
});

test('reconciliation leaves an active trailing spare active', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1] });
  h.workspace.currentDesktop = d1;

  h.context.reconcileTrailingSpareDesktops(false);

  assert.equal(h.workspace.currentDesktop, d1);
  assert.deepEqual([...h.workspace.desktops], [d0, d1]);
});

test('reconciliation activates the nearest occupied desktop before removing an active middle empty', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const d4 = makeDesktop(4);
  const browser = makeWindow({ caption: 'Browser', desktops: [d1] });
  const editor = makeWindow({ caption: 'Editor', desktops: [d3] });
  const h = loadScript({ windows: [browser, editor], desktops: [d0, d1, d2, d3, d4] });
  h.workspace.currentDesktop = d2;

  h.context.reconcileTrailingSpareDesktops(false);

  assert.equal(h.workspace.currentDesktop, d1);
  assert.deepEqual([...h.workspace.desktops], [d1, d3, d4]);
});

test('reconciliation waits for identity reservations and then removes only unrelated empties', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const existing = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2, d3] });
  h.workspace.currentDesktop = d0;

  const lateWindow = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(lateWindow);
  h.workspace.windowAdded.fire(lateWindow);
  const appendedSpare = h.workspace.desktops[4];
  assert.equal(h.context.reservedDesktopByWindow.get(lateWindow), d3);

  h.context.scheduleDesktopReconciliation(false);
  assert.equal(h.QTimer.fireInterval(300), true);
  assert.equal(h.workspace.desktops.includes(d3), true);
  assert.equal(h.context.reservedDesktopByWindow.get(lateWindow), d3);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), appendedSpare);

  lateWindow.caption = 'Document';
  lateWindow.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(lateWindow.desktops[0], d3);
  assert.equal(h.QTimer.fireInterval(300), true);

  assert.deepEqual([...h.workspace.desktops], [d0, d3, appendedSpare]);
  assert.equal(h.context.reservedDesktopByWindow.has(lateWindow), false);
});

test('reactivation removes a window from normal focus history after it becomes a dialog', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const window = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [window], desktops: [d0, d1] });

  h.workspace.windowActivated.fire(window);
  assert.equal(h.context.normalFocusMru.includes(window), true);

  window.dialog = true;
  h.workspace.windowActivated.fire(window);

  assert.equal(h.context.normalFocusMru.includes(window), false);
  assert.equal(h.context.getPreviousNormalFocusWindow(), null);
});

test('normal focus lookup lazily removes a window that became transient without reactivation', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const previous = makeWindow({ caption: 'Browser', desktops: [d0] });
  const stale = makeWindow({ caption: 'Editor', desktops: [d1] });
  const h = loadScript({ windows: [previous, stale], desktops: [d0, d1] });

  h.workspace.windowActivated.fire(previous);
  h.workspace.windowActivated.fire(stale);
  stale.transient = true;

  assert.equal(h.context.getPreviousNormalFocusWindow(), previous);
  assert.equal(h.context.normalFocusMru.includes(stale), false);
});

test('no normal windows converge to the current desktop as the sole spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const h = loadScript({ desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d1;

  h.context.reconcileTrailingSpareDesktops(false);

  assert.deepEqual([...h.workspace.desktops], [d1]);
  assert.equal(h.workspace.currentDesktop, d1);
});

test('disabled cleanup preserves user empties in order but still appends a trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const occupied = makeWindow({ caption: 'Browser', desktops: [d2] });
  const h = loadScript({
    windows: [occupied],
    desktops: [d0, d1, d2],
    config: { RemoveEmptyVirtualDesktops: false },
  });

  const spare = h.workspace.desktops[3];
  h.context.reconcileTrailingSpareDesktops(false);

  assert.deepEqual([...h.workspace.desktops], [d0, d1, d2, spare]);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), spare);
});

test('disabled cleanup keeps desktops after an added-window event', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const internalWindow = makeWindow({ normalWindow: false, caption: 'Internal', desktops: [d0] });
  const h = loadScript({
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });

  h.loadWindow(internalWindow);
  h.workspace.windowAdded.fire(internalWindow);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d0, d1]);
});

test('disabled cleanup appends a spare after a moved window occupies the tail', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const moving = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [moving],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });

  moving.desktops = [d1];
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops].slice(0, 2), [d0, d1]);
  assert.equal(h.workspace.desktops.length, 3);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[2]);
});

test('disabled cleanup keeps desktops after a removed-window event', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const closing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [closing],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });

  h.unloadWindow(closing);
  h.workspace.windowRemoved.fire(closing);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d0, d1]);
});

test('does not change focus or desktops when removal is unavailable', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const occupied = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [occupied], desktops: [d0, d1] });
  h.workspace.currentDesktop = d1;
  h.workspace.activeWindow = occupied;
  delete h.workspace.removeDesktop;

  h.context.reconcileTrailingSpareDesktops(false);

  assert.equal(h.workspace.currentDesktop, d1);
  assert.equal(h.workspace.activeWindow, occupied);
  assert.deepEqual([...h.workspace.desktops], [d0, d1]);
});

test('closing the final normal window retains the current desktop as the sole spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const closing = makeWindow({ caption: 'Editor', desktops: [d1] });
  const h = loadScript({ windows: [closing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d1;

  h.unloadWindow(closing);
  h.workspace.windowRemoved.fire(closing);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d1]);
  assert.equal(h.workspace.currentDesktop, d1);
});

test('immediately consumes an existing trailing spare and appends the next spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = existing;

  const fresh = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);

  assert.equal(fresh.desktops[0], d1);
  assert.equal(h.workspace.currentDesktop, d1);
  assert.equal(h.workspace.activeWindow, fresh);
  assert.equal(h.workspace.desktops.length, 3);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[2]);
});

test('keeps the first normal window on the current spare and appends another', () => {
  const d0 = makeDesktop(0);
  const h = loadScript({ windows: [], desktops: [d0] });
  h.workspace.currentDesktop = d0;

  const fresh = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);

  assert.equal(h.workspace.desktops.length, 2);
  assert.equal(fresh.desktops[0], d0);
  assert.equal(h.workspace.currentDesktop, d0);
  assert.equal(h.workspace.activeWindow, fresh);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[1]);
});

test('rapid windows synchronously consume successive trailing spares', () => {
  const d0 = makeDesktop(0);
  const h = loadScript({ windows: [], desktops: [d0] });
  h.workspace.currentDesktop = d0;

  const first = makeWindow({ caption: 'A', desktops: [d0] });
  h.loadWindow(first);
  h.workspace.windowAdded.fire(first);
  const secondSpare = h.workspace.desktops[1];

  assert.equal(first.desktops[0], d0);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), secondSpare);

  const second = makeWindow({ caption: 'B', desktops: [d0] });
  h.loadWindow(second);
  h.workspace.windowAdded.fire(second);

  assert.equal(second.desktops[0], secondSpare);
  assert.equal(h.workspace.currentDesktop, secondSpare);
  assert.equal(h.workspace.activeWindow, second);
  assert.equal(h.workspace.desktops.length, 3);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[2]);
});

test('reads same-desktop groups from a multi-line config string', () => {
  const h = loadScript({ config: { SameDesktopWindowGroups: 'wechat\nQQ' } });
  assert.deepEqual([...h.context.config.rules.sameDesktopGroups], ['wechat', 'QQ']);
});

test('reads source-desktop application rules from a multi-line config string', () => {
  const h = loadScript({ config: { SourceDesktopApplications: 'spectacle\norg.kde.*' } });

  assert.deepEqual([...h.context.config.rules.sourceDesktopApplications], ['spectacle', 'org.kde.*']);
});

test('keeps windows matching configured source-desktop application identifiers', () => {
  const { context } = loadScript({ desktops: [] });
  const source = makeDesktop(0);
  const rules = {
    ...context.DEFAULT_RULES,
    sourceDesktopApplications: ['spectacle', 'org.kde.*', 'capture?tool'],
  };

  [
    ruleWindow({ desktop: source, resourceClass: 'Spectacle' }),
    ruleWindow({ desktop: source, appId: 'org.kde.gwenview' }),
    ruleWindow({ desktop: source, resourceName: 'capture1tool' }),
  ].forEach((window) => {
    const decision = context.getInitialPlacementDecision({
      window,
      desktops: [source, makeDesktop(1)],
      windows: [ruleWindow({ desktop: source, title: 'Browser' })],
      sourceDesktop: source,
      rules,
    });

    assert.deepEqual({ kind: decision.kind, reason: decision.reason }, {
      kind: 'source',
      reason: 'source-workspace-window',
    });
  });
});

test('does not use a window title to match a source-desktop application rule', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2)];
  const decision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], title: 'Spectacle' }),
    desktops,
    windows: [ruleWindow({ desktop: desktops[1], title: 'Browser' })],
    sourceDesktop: desktops[0],
    spareDesktop: desktops[2],
    rules: {
      ...context.DEFAULT_RULES,
      sourceDesktopApplications: ['spectacle'],
    },
  });

  assert.equal(decision.kind, 'spread');
  assert.equal(decision.targetDesktop, desktops[2]);
  assert.equal(decision.reason, 'trailing-spare');
});

test('treats a comma in a source-desktop application rule as a literal character', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2)];
  const decision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], resourceClass: 'spectacle' }),
    desktops,
    windows: [ruleWindow({ desktop: desktops[1], title: 'Browser' })],
    sourceDesktop: desktops[0],
    spareDesktop: desktops[2],
    rules: {
      ...context.DEFAULT_RULES,
      sourceDesktopApplications: ['spectacle, gwenview'],
    },
  });

  assert.equal(decision.kind, 'spread');
  assert.equal(decision.targetDesktop, desktops[2]);
  assert.equal(decision.reason, 'trailing-spare');
});

test('gives source-desktop application rules precedence over same-desktop groups', () => {
  const { context } = loadScript({ desktops: [] });
  const desktops = [makeDesktop(0), makeDesktop(1), makeDesktop(2)];
  const decision = context.getInitialPlacementDecision({
    window: ruleWindow({ desktop: desktops[0], resourceClass: 'Spectacle' }),
    desktops,
    windows: [ruleWindow({ desktop: desktops[1], resourceClass: 'gwenview' })],
    sourceDesktop: desktops[0],
    rules: {
      ...context.DEFAULT_RULES,
      sourceDesktopApplications: ['spectacle'],
      sameDesktopGroups: ['spectacle, gwenview'],
    },
  });

  assert.deepEqual({ kind: decision.kind, reason: decision.reason }, {
    kind: 'source',
    reason: 'source-workspace-window',
  });
});

test('does not load obsolete advanced rule keys from stored config', () => {
  const h = loadScript({
    config: {
      AuxiliaryDialogTitles: 'custom dialog',
      AuxiliaryRoles: 'custom role',
      PortalIdentifiers: 'custom portal',
    },
  });

  assert.equal('auxiliaryDialogTitles' in h.context.config.rules, false);
  assert.equal('auxiliaryRoles' in h.context.config.rules, false);
  assert.equal('portalIdentifiers' in h.context.config.rules, false);
});

test('falls back to an empty list when the config value is missing', () => {
  const h = loadScript({ config: {} });
  assert.deepEqual([...h.context.config.rules.sameDesktopGroups], []);
});

test('immediately groups a second window while reserving its captured spread target', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const first = makeWindow({ caption: 'WeChat', resourceClass: 'wechat', desktops: [d1] });
  const h = loadScript({
    windows: [first],
    desktops: [d0, d1, d2],
    config: { SameDesktopWindowGroups: 'wechat\nQQ' },
  });
  h.workspace.currentDesktop = d0;

  const second = makeWindow({ caption: 'WeChat', desktops: [d0] });
  h.loadWindow(second);
  h.workspace.windowAdded.fire(second);

  const d3 = h.workspace.desktops[3];
  assert.deepEqual([...h.workspace.desktops], [d0, d1, d2, d3]);
  assert.equal(first.desktops[0], d1);
  assert.equal(second.desktops[0], d1);
  assert.equal(h.workspace.currentDesktop, d1);
  assert.equal(h.workspace.activeWindow, second);
  assert.equal(h.context.reservedDesktopByWindow.get(second), d2);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), d3);
});

test('immediately keeps a source-rule window in place and reserves the existing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = existing;

  const fresh = makeWindow({ caption: 'Capture', resourceClass: 'spectacle', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);

  const d2 = h.workspace.desktops[2];
  assert.equal(h.workspace.desktops.length, 3);
  assert.equal(fresh.desktops[0], d0);
  assert.equal(h.context.reservedDesktopByWindow.get(fresh), d1);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), d2);
});

test('immediately keeps a portal window in place and reserves the existing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;

  const portal = makeWindow({ caption: 'Open File', resourceClass: 'xdg-desktop-portal-gtk', desktops: [d0] });
  h.loadWindow(portal);
  h.workspace.windowAdded.fire(portal);

  const d2 = h.workspace.desktops[2];
  assert.equal(portal.desktops[0], d0);
  assert.deepEqual([...h.workspace.desktops], [d0, d1, d2]);
  assert.equal(h.context.reservedDesktopByWindow.get(portal), d1);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), d2);
});

test('restores prior focus when KWin activates the new window before windowAdded', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const focused = makeWindow({ caption: 'Editor', desktops: [d0] });
  const other = makeWindow({ caption: 'Browser', desktops: [d1] });
  const h = loadScript({
    windows: [focused, other],
    desktops: [d0, d1, d2],
    config: { KeepCurrentFocus: true },
  });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = focused;
  h.workspace.windowActivated.fire(focused);

  const fresh = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.activeWindow = fresh;
  h.workspace.windowActivated.fire(fresh);
  h.workspace.windowAdded.fire(fresh);

  assert.equal(h.workspace.desktops.length, 4);
  assert.equal(fresh.desktops[0], d2);
  assert.equal(h.workspace.activeWindow, focused);
  assert.equal(h.workspace.currentDesktop, d0);
});

[
  ['dialog', { dialog: true }],
  ['transient', { transient: true }],
  ['skip-taskbar', { skipTaskbar: true }],
  ['non-normal client', { normalWindow: false }],
].forEach(([kind, overrides]) => {
  test(`restores a previously activated ${kind} after synchronous placement`, () => {
    const d0 = makeDesktop(0);
    const d1 = makeDesktop(1);
    const d2 = makeDesktop(2);
    const previous = makeWindow({ caption: 'Previous', desktops: [d0], ...overrides });
    const existing = makeWindow({ caption: 'Browser', desktops: [d1] });
    const h = loadScript({
      windows: [previous, existing],
      desktops: [d0, d1, d2],
      config: { KeepCurrentFocus: true },
    });
    h.workspace.currentDesktop = d0;
    h.workspace.activeWindow = previous;
    h.workspace.windowActivated.fire(previous);

    const fresh = makeWindow({ caption: 'Terminal', desktops: [d0] });
    h.loadWindow(fresh);
    h.workspace.activeWindow = fresh;
    h.workspace.windowActivated.fire(fresh);
    h.workspace.windowAdded.fire(fresh);

    assert.equal(fresh.desktops[0], d2);
    assert.equal(h.workspace.activeWindow, previous);
    assert.equal(h.workspace.currentDesktop, d0);
    assert.equal(h.context.normalFocusMru.includes(previous), false);
  });
});

test('handles close signals only once even when both closed and windowRemoved fire', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const w = makeWindow({ caption: 'App', desktops: [d0] });
  const h = loadScript({ windows: [w], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = w;
  h.workspace.windowActivated.fire(w);

  h.unloadWindow(w);
  w.closed.fire();
  const afterFirst = h.QTimer.pending;
  assert.equal(afterFirst, 1);
  assert.equal(h.context.activationMru.includes(w), false);
  assert.equal(h.context.normalFocusMru.includes(w), false);

  h.workspace.windowRemoved.fire(w);
  assert.equal(h.QTimer.pending, afterFirst);
});

test('ignores late desktop-change signals from a removed window', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const closing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [closing], desktops: [d0, d1] });

  h.unloadWindow(closing);
  h.workspace.windowRemoved.fire(closing);
  h.QTimer.fireAll();

  closing.desktopsChanged.fire();

  assert.equal(h.QTimer.pending, 0);
  assert.equal(h.context.lastDesktopByWindow.has(closing), false);
});

test('corrects a late XWayland source rule once', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({
    windows: [browser],
    desktops: [d0, d1],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  h.workspace.currentDesktop = d0;

  const window = makeWindow({ caption: 'Screenshot', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d1);

  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(window.desktops[0], d0);

  window.resourceClass = 'other';
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), false);
  assert.equal(window.desktops[0], d0);
  assert.equal(window.windowClassChanged.handlerCount, 0);
});

test('late title, app ID, and window role can identify source-desktop windows', () => {
  const cases = [
    {
      config: {},
      apply(window) {
        window.caption = 'Open File';
        window.captionChanged.fire();
      },
    },
    {
      config: { SourceDesktopApplications: 'org.example.capture' },
      apply(window) {
        window.desktopFileName = 'org.example.capture';
        window.desktopFileNameChanged.fire();
      },
    },
    {
      config: {},
      apply(window) {
        window.windowRole = 'viewer';
        window.windowRoleChanged.fire();
      },
    },
  ];

  cases.forEach(({ config, apply }) => {
    const d0 = makeDesktop(0);
    const d1 = makeDesktop(1);
    const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
    const h = loadScript({ windows: [existing], desktops: [d0, d1], config });
    const window = makeWindow({ caption: 'Unknown', desktops: [d0] });
    h.loadWindow(window);
    h.workspace.windowAdded.fire(window);
    assert.equal(window.desktops[0], d1);

    apply(window);
    assert.equal(h.QTimer.fireInterval(50), true);
    assert.equal(window.desktops[0], d0);
  });
});

test('coalesces identity changes and corrects a late same-group match', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'WeChat', resourceClass: 'wechat', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { SameDesktopWindowGroups: 'wechat, *preview*' },
  });
  const window = makeWindow({ caption: 'Unknown', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d1);

  window.caption = 'Preview';
  window.captionChanged.fire();
  const replacedDebounce = h.QTimer._timers.find((timer) => timer.interval === 50);
  window.desktopFileName = 'preview';
  window.desktopFileNameChanged.fire();

  assert.equal(replacedDebounce.destroyed, true);
  assert.equal(replacedDebounce.deleteLaterCalls, 1);
  assert.equal(h.QTimer._timers.filter((timer) => timer.interval === 50).length, 1);
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(window.desktops[0], d0);
  assert.equal(h.context.placementStates.has(window), false);
});

test('a window that becomes transient returns to its captured source desktop', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const parent = makeWindow({ caption: 'Parent', desktops: [d0] });
  const h = loadScript({ windows: [parent], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  const window = makeWindow({ caption: 'Child', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d1);

  window.transient = true;
  window.transientFor = parent;
  window.transientChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d0);
});

test('a window that becomes non-normal returns to its captured source desktop', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  const window = makeWindow({ caption: 'Unknown', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d1);

  window.normalWindow = false;
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d0);
  assert.equal(h.context.placementStates.has(window), false);
});

test('late correction does not steal focus back', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const focused = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [focused],
    desktops: [d0, d1],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  const window = makeWindow({ caption: 'Screenshot', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);

  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = focused;
  h.workspace.windowActivated.fire(focused);
  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d0);
  assert.equal(h.workspace.activeWindow, focused);
  assert.equal(h.workspace.currentDesktop, d0);
});

test('a user desktop move cancels late correction', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1, d2],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  const window = makeWindow({ caption: 'Screenshot', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d2);

  window.desktops = [d1];
  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  h.QTimer.fireAll();

  assert.equal(window.desktops[0], d1);
  assert.equal(h.context.placementStates.has(window), false);
  assert.equal(h.context.reservedDesktopByWindow.has(window), false);
});

test('keeps the captured source desktop until the identity deadline settles', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ caption: 'Editor', desktops: [d1] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1, d2],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  h.workspace.currentDesktop = d0;
  const window = makeWindow({ caption: 'Screenshot', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d2);

  assert.equal(h.QTimer.fireInterval(300), true);
  assert.equal(h.workspace.desktops.includes(d0), true);
  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d0);
});

test('identity changes do not advance a spread window to the newly appended spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  const window = makeWindow({ caption: 'Unknown', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const appendedSpare = h.workspace.desktops[2];
  assert.equal(window.desktops[0], d1);

  window.caption = 'Still Unknown';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d1);
  assert.notEqual(window.desktops[0], appendedSpare);
  assert.equal(h.context.placementStates.has(window), true);
});

test('an initially ignored window that becomes normal uses its captured initial target', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  const window = makeWindow({ caption: 'Internal', normalWindow: false, desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const laterSpare = h.workspace.createDesktop(h.workspace.desktops.length, 'Later spare');

  assert.equal(window.desktops[0], d0);
  assert.equal(h.context.placementStates.has(window), true);
  window.normalWindow = true;
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d1);
  assert.notEqual(window.desktops[0], laterSpare);
  assert.equal(h.context.placementStates.has(window), false);
});

test('an initial source-title decision that becomes spread uses its captured initial target', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const laterSpare = h.workspace.createDesktop(h.workspace.desktops.length, 'Later spare');

  assert.equal(window.desktops[0], d0);
  window.caption = 'Document';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d1);
  assert.notEqual(window.desktops[0], laterSpare);
  assert.equal(h.context.placementStates.has(window), false);
});

test('moving a settling window to all desktops cancels late correction', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { SourceDesktopApplications: 'spectacle' },
  });
  const window = makeWindow({ caption: 'Screenshot', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d1);

  window.onAllDesktops = true;
  window.desktops = [];
  assert.equal(h.context.placementStates.has(window), false);
  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  h.QTimer.fireAll();

  assert.equal(window.desktops.length, 0);
  assert.equal(window.onAllDesktops, true);
  assert.equal(h.context.reservedDesktopByWindow.has(window), false);
});

test('moving an all-desktops settling window to one desktop cancels correction', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  const window = makeWindow({
    caption: 'Internal',
    normalWindow: false,
    onAllDesktops: true,
    desktops: [],
  });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(h.context.placementStates.has(window), true);

  window.onAllDesktops = false;
  window.desktops = [d0];

  assert.equal(h.context.placementStates.has(window), false);
  assert.equal(h.context.reservedDesktopByWindow.has(window), false);
  window.normalWindow = true;
  window.windowClassChanged.fire();
  h.QTimer.fireAll();
  assert.equal(window.desktops[0], d0);
});

test('concurrent source windows reserve distinct captured spread targets', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;

  const first = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(first);
  h.workspace.windowAdded.fire(first);
  const d2 = h.workspace.desktops[2];
  const second = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(second);
  h.workspace.windowAdded.fire(second);
  const d3 = h.workspace.desktops[3];

  assert.equal(h.context.placementStates.get(first).initialTarget, d1);
  assert.equal(h.context.placementStates.get(second).initialTarget, d2);
  assert.equal(h.context.reservedDesktopByWindow.get(first), d1);
  assert.equal(h.context.reservedDesktopByWindow.get(second), d2);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), d3);

  first.caption = 'Document A';
  first.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  second.caption = 'Document B';
  second.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(first.desktops[0], d1);
  assert.equal(second.desktops[0], d2);
  assert.equal(h.context.reservedDesktopByWindow.has(first), false);
  assert.equal(h.context.reservedDesktopByWindow.has(second), false);
});

test('temporary reservation desktops do not accumulate when cleanup is disabled', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });
  h.workspace.currentDesktop = d0;

  [
    { caption: 'Open File' },
    { caption: 'Internal', normalWindow: false },
    { caption: 'Save File' },
  ].forEach((overrides) => {
    const window = makeWindow({ desktops: [d0], ...overrides });
    h.loadWindow(window);
    h.workspace.windowAdded.fire(window);
    assert.equal(h.workspace.desktops.length, 3);
    h.unloadWindow(window);
    window.closed.fire();
    assert.deepEqual([...h.workspace.desktops], [d0, d1]);
  });
});

test('reclaims concurrent reservation desktops after deadline and close', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });
  const first = makeWindow({ caption: 'Open File', desktops: [d0] });
  const second = makeWindow({ caption: 'Save File', desktops: [d0] });
  h.loadWindow(first);
  h.workspace.windowAdded.fire(first);
  h.loadWindow(second);
  h.workspace.windowAdded.fire(second);
  assert.equal(h.workspace.desktops.length, 4);

  assert.equal(h.QTimer.fireInterval(1000), true);
  assert.equal(h.workspace.desktops.length, 4);
  h.unloadWindow(second);
  second.closed.fire();

  assert.deepEqual([...h.workspace.desktops], [d0, d1]);
  assert.equal(h.context.reservationCreatedDesktops.size, 0);
});

test('a temporary reservation target becomes permanent when late spread adopts it', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });
  const first = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(first);
  h.workspace.windowAdded.fire(first);
  const d2 = h.workspace.desktops[2];
  const second = makeWindow({ caption: 'Save File', desktops: [d0] });
  h.loadWindow(second);
  h.workspace.windowAdded.fire(second);
  const d3 = h.workspace.desktops[3];
  assert.equal(h.context.reservationCreatedDesktops.has(d2), true);

  second.caption = 'Document';
  second.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(second.desktops[0], d2);
  assert.equal(h.context.reservationCreatedDesktops.has(d2), false);
  h.unloadWindow(first);
  first.closed.fire();

  assert.deepEqual([...h.workspace.desktops], [d0, d1, d2, d3]);
  assert.equal(h.context.reservationCreatedDesktops.has(d3), true);

  h.unloadWindow(second);
  second.closed.fire();
  assert.deepEqual([...h.workspace.desktops], [d0, d1, d2]);
  assert.equal(h.context.reservationCreatedDesktops.has(d2), false);
});

test('ordinary reconciliation clears ownership of a removed temporary reservation desktop', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  h.workspace.currentDesktop = d0;

  const lateWindow = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(lateWindow);
  h.workspace.windowAdded.fire(lateWindow);
  const temporarySpare = h.workspace.desktops[2];
  assert.equal(h.context.reservationCreatedDesktops.has(temporarySpare), true);

  lateWindow.caption = 'Document';
  lateWindow.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(lateWindow.desktops[0], d1);
  assert.equal(h.context.reservationCreatedDesktops.has(temporarySpare), true);

  const userSpare = h.workspace.createDesktop(h.workspace.desktops.length, 'User spare');
  h.context.reconcileTrailingSpareDesktops(false);

  assert.deepEqual([...h.workspace.desktops], [d0, d1, userSpare]);
  assert.equal(h.context.reservationCreatedDesktops.has(temporarySpare), false);
  h.context.reservationCreatedDesktops.forEach((desktop) => {
    assert.equal(h.workspace.desktops.includes(desktop), true);
  });
});

test('a user-occupied temporary reservation desktop is never reclaimed', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const userWindow = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [userWindow],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });
  const first = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(first);
  h.workspace.windowAdded.fire(first);
  const d2 = h.workspace.desktops[2];
  assert.equal(h.context.reservationCreatedDesktops.has(d2), true);

  userWindow.desktops = [d2];
  assert.equal(h.context.reservationCreatedDesktops.has(d2), false);
  h.unloadWindow(first);
  first.closed.fire();

  assert.equal(h.workspace.desktops.includes(d2), true);
  assert.equal(userWindow.desktops[0], d2);
});

test('a decision change without an assignment keeps settling for a later group correction', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ caption: 'WeChat', resourceClass: 'wechat', desktops: [d1] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1, d2],
    config: { SameDesktopWindowGroups: 'wechat, *viewer*' },
  });
  h.workspace.currentDesktop = d0;
  const window = makeWindow({ caption: 'Unknown', normalWindow: false, desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);

  window.normalWindow = true;
  window.caption = 'Open File';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(window.desktops[0], d0);
  assert.equal(h.context.placementStates.has(window), true);

  window.caption = 'Viewer';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);
  assert.equal(window.desktops[0], d1);
  assert.equal(h.context.placementStates.has(window), false);
});

test('identity deadline releases unchanged window state and connections', () => {
  const d0 = makeDesktop(0);
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  const h = loadScript({ desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);

  assert.equal(h.context.placementStates.has(window), true);
  window.caption = 'Still App';
  window.captionChanged.fire();
  const deadline = h.QTimer._timers.find((timer) => timer.interval === 1000);
  const debounce = h.QTimer._timers.find((timer) => timer.interval === 50);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 50), true);
  assert.equal(h.QTimer.fireInterval(1000), true);
  assert.equal(h.context.placementStates.has(window), false);
  assert.equal(deadline.deleteLaterCalls, 1);
  assert.equal(debounce.deleteLaterCalls, 1);
  assert.equal(h.context.reservedDesktopByWindow.has(window), false);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 50), false);
  assert.equal(window.captionChanged.handlerCount, 0);
});

test('closing a settling window cancels timers and disconnects every identity signal', () => {
  const d0 = makeDesktop(0);
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  const h = loadScript({ desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  window.captionChanged.fire();
  const deadline = h.QTimer._timers.find((timer) => timer.interval === 1000);
  const debounce = h.QTimer._timers.find((timer) => timer.interval === 50);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 50), true);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 1000), true);

  h.unloadWindow(window);
  window.closed.fire();
  h.workspace.windowRemoved.fire(window);

  assert.equal(h.context.placementStates.has(window), false);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 50), false);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 1000), false);
  assert.equal(deadline.deleteLaterCalls, 1);
  assert.equal(debounce.deleteLaterCalls, 1);
  assert.equal(h.context.reservedDesktopByWindow.has(window), false);
  [
    window.captionChanged,
    window.desktopFileNameChanged,
    window.windowClassChanged,
    window.windowRoleChanged,
    window.transientChanged,
  ].forEach((signal) => assert.equal(signal.handlerCount, 0));
});

test('places immediately and later cleans intermediate empties while retaining the spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const existing = makeWindow({ caption: 'Browser', desktops: [d2] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2, d3] });
  h.workspace.currentDesktop = d0;

  const fresh = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);

  const appendedSpare = h.workspace.desktops[4];
  assert.equal(fresh.desktops[0], d3);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), appendedSpare);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 300), true);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 1000), true);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d2, d3, appendedSpare]);
});

test('coalesces desktop-change signals and retains one trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const moving = makeWindow({ caption: 'Editor', desktops: [d0] });
  const occupied = makeWindow({ caption: 'Browser', desktops: [d1] });
  const h = loadScript({ windows: [moving, occupied], desktops: [d0, d1, d2, d3] });
  h.workspace.currentDesktop = d1;

  moving.desktops = [d2];
  moving.desktopsChanged.fire();

  assert.equal(h.QTimer.pending, 1);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d1, d2, d3]);
});

test('cleans the source desktop after script placement changes desktops', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ caption: 'Browser', desktops: [d1] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d0;

  const fresh = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(fresh);
  h.workspace.windowAdded.fire(fresh);
  const appendedSpare = h.workspace.desktops[3];

  assert.equal(fresh.desktops[0], d2);
  assert.equal(h.workspace.desktops.length, 4);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 300), true);
  assert.equal(h.QTimer._timers.some((timer) => timer.interval === 1000), true);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d1, fresh.desktops[0], appendedSpare]);
  assert.equal(fresh.desktops[0], h.workspace.desktops[1]);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), appendedSpare);
});

test('closing a window restores previous focus and retains the trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const closing = makeWindow({ caption: 'Editor', desktops: [d2] });
  const h = loadScript({ windows: [browser, closing], desktops: [d0, d1, d2, d3] });
  h.workspace.windowActivated.fire(browser);
  h.workspace.windowActivated.fire(closing);
  h.workspace.currentDesktop = d2;
  h.workspace.activeWindow = closing;

  h.unloadWindow(closing);
  h.workspace.windowRemoved.fire(closing);
  h.QTimer.fireAll();

  assert.equal(h.workspace.currentDesktop, d0);
  assert.equal(h.workspace.activeWindow, browser);
  assert.deepEqual([...h.workspace.desktops], [d0, d3]);
});

test('closing the final window prefers its current desktop over an existing trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const closing = makeWindow({ caption: 'Editor', desktops: [d1] });
  const h = loadScript({ windows: [closing], desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d1;
  h.workspace.activeWindow = closing;

  h.unloadWindow(closing);
  h.workspace.windowRemoved.fire(closing);
  h.QTimer.fireAll();

  assert.deepEqual([...h.workspace.desktops], [d1]);
  assert.equal(h.workspace.currentDesktop, d1);
});
