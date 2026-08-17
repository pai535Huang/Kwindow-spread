import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScript, mainSource, makeDesktop, makeWindow, ruleWindow } from './helpers/kwin.js';

const configSchemaSource = readFileSync(new URL('../contents/config/main.xml', import.meta.url), 'utf8');
const configUiSource = readFileSync(new URL('../contents/ui/config.ui', import.meta.url), 'utf8');
const readmeSource = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const metadataSource = readFileSync(new URL('../metadata.json', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const metadata = JSON.parse(metadataSource);
const packageManifest = JSON.parse(packageSource);

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

test('documents Plasma 6 Wayland and the trailing spare desktop', () => {
  assert.match(readmeSource, /Plasma 6.*Wayland/i);
  assert.match(readmeSource, /XWayland/i);
  assert.match(readmeSource, /trailing empty virtual desktop/i);
  assert.match(readmeSource, /without\s+(?:a\s+)?fixed 500 ms delay/i);
  assert.match(readmeSource, /select \*\*Apply\*\*/i);
  assert.match(configUiSource, /Remove extra empty virtual desktops while keeping one trailing spare/);
  assert.equal(
    metadata.KPlugin.Description,
    'Keep a trailing empty virtual desktop ready for ordinary new normal windows.',
  );
});

test('keeps Plasma 6 package metadata and release commands consistent', () => {
  assert.equal(metadata.KPlugin.Id, 'kwindow-spread');
  assert.equal(metadata.KPackageStructure, 'KWin/Script');
  assert.equal(packageManifest.name, metadata.KPlugin.Id);
  assert.equal(packageManifest.version, metadata.KPlugin.Version);
  assert.equal(metadata.KPlugin.Version, '1.1.0');

  assert.match(readmeSource, /kpackagetool6 --type KWin\/Script --install \./);
  assert.match(readmeSource, /kpackagetool6 --type KWin\/Script --upgrade \./);
  assert.match(readmeSource, /kpackagetool6 --type KWin\/Script --remove kwindow-spread/);
});

test('documents a two-apply script reload after updates and configuration changes', () => {
  assert.ok((readmeSource.match(/disable[\s\S]{0,100}\*\*Apply\*\*/gi) || []).length >= 2);
  assert.ok((readmeSource.match(/enable[\s\S]{0,100}\*\*Apply\*\*/gi) || []).length >= 2);
});

test('release files do not advertise obsolete desktop creation or legacy support', () => {
  const releaseSources = [readmeSource, metadataSource, configSchemaSource, configUiSource].join('\n');
  assert.doesNotMatch(releaseSources, /CreateVirtualDesktops/);
  assert.doesNotMatch(releaseSources, /kpackagetool5|On Plasma 5|Use .*Plasma 5/i);
  assert.doesNotMatch(
    readmeSource,
    /next window[^\n]{0,40}(?:refresh|reload)|(?:refresh|reload)[^\n]{0,40}next window/i,
  );
  assert.doesNotMatch(
    readmeSource,
    /500\s*ms\s+(?:before|then)|(?:wait|waiting|waits|delays)\b[^\n]{0,40}\b500\s*ms/i,
  );
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

test('creation failure is attempted at most once per placement operation', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let attempts = 0;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop() {
        attempts += 1;
        throw new Error('desktop limit');
      },
    },
  });
  const window = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(window);

  assert.doesNotThrow(() => h.workspace.windowAdded.fire(window));
  assert.equal(window.desktops[0], d0);
  assert.equal(attempts, 2, 'one startup attempt and one placement attempt');
  assert.match(h.printed.join('\n'), /failed to create virtual desktop/);
});

test('missing desktop creation support falls back to a current desktop object', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: { createDesktop: undefined },
  });
  const window = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(window);

  assert.doesNotThrow(() => h.workspace.windowAdded.fire(window));
  assert.equal(window.desktops[0], d0);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('no-op desktop creation is bounded and keeps placement valid', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let attempts = 0;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop() {
        attempts += 1;
        return makeDesktop(99);
      },
    },
  });
  const window = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);

  assert.equal(attempts, 2, 'one startup attempt and one placement attempt');
  assert.equal(window.desktops[0], d0);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('ignored-window placement also shares one bounded creation attempt', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let attempts = 0;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop() {
        attempts += 1;
      },
    },
  });
  const popup = makeWindow({ normalWindow: false, popupMenu: true, desktops: [d0] });
  h.loadWindow(popup);
  h.workspace.windowAdded.fire(popup);

  assert.equal(attempts, 2, 'one startup attempt and one added-window attempt');
  assert.equal(popup.desktops[0], d0);
});

test('a stale target resolves to the existing trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const stale = makeDesktop(99);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1] });

  assert.equal(h.context.resolveExistingTarget(stale, d0), d1);
});

test('desktop assignment resolves a replaced object by stable id', () => {
  const d0 = Object.assign(makeDesktop(0), { id: 'desktop-0' });
  const replacement = Object.assign(makeDesktop(0, 'Replacement'), { id: 'desktop-0' });
  const window = makeWindow({ caption: 'Terminal', desktops: [d0] });
  const h = loadScript({ desktops: [replacement] });

  h.context.setWindowDesktop(window, d0);

  assert.equal(window.desktops[0], replacement);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('same-id desktop replacement is not treated as a user placement change', () => {
  const stale = Object.assign(makeDesktop(0), { id: 'desktop-0' });
  const replacement = Object.assign(makeDesktop(0, 'Replacement'), { id: 'desktop-0' });
  const h = loadScript({ desktops: [replacement] });

  assert.equal(h.context.sameWindowPlacement(
    { onAllDesktops: false, desktops: [stale] },
    { onAllDesktops: false, desktops: [replacement] },
  ), true);
});

test('desktop creation uses the object confirmed in the workspace snapshot', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let actualDesktop = null;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop(position, name) {
        actualDesktop = makeDesktop(position, name);
        this.desktops.splice(position, 0, actualDesktop);
        return makeDesktop(999, 'Bogus return value');
      },
    },
  });

  assert.equal(h.workspace.desktops[1], actualDesktop);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), actualDesktop);
});

test('creation failure timers drain without retrying forever', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let attempts = 0;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop() {
        attempts += 1;
      },
    },
  });
  const window = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);

  let fired = 0;
  while (h.QTimer.pending > 0 && fired < 10) {
    h.QTimer.fireNext();
    fired += 1;
  }

  assert.equal(h.QTimer.pending, 0);
  assert.equal(fired <= 3, true);
  assert.equal(attempts <= 3, true, 'startup, placement, and one reconciliation attempt');
});

test('a windowAdded operation gets a fresh budget after startup creation failed', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let failCreation = true;
  let calls = 0;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop(position, name) {
        calls += 1;
        if (failCreation) throw new Error('temporarily unavailable');
        const desktop = makeDesktop(position, name);
        this.desktops.splice(position, 0, desktop);
        return desktop;
      },
    },
  });
  failCreation = false;
  const window = makeWindow({ caption: 'Terminal', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);

  assert.equal(calls, 3, 'one startup failure and two successful placement creations');
  assert.equal(window.desktops[0], h.workspace.desktops[1]);
  assert.equal(h.workspace.desktops.length, 3);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[2]);
});

test('createDesktopAt recognizes a newly added object instead of trusting its index', () => {
  const d0 = makeDesktop(0);
  const h = loadScript({ desktops: [d0] });
  let created = null;
  h.workspace.createDesktop = (position, name) => {
    created = makeDesktop(position, name);
    h.workspace.desktops.splice(0, 0, created);
    return makeDesktop(999, 'Bogus return value');
  };

  const result = h.context.createDesktopAt(1);

  assert.equal(result, created);
  assert.equal(h.workspace.desktops.includes(result), true);
});

test('createDesktopAt recognizes creation completed before an exception', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let created = null;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop(position, name) {
        created = makeDesktop(position, name);
        this.desktops.splice(position, 0, created);
        throw new Error('late D-Bus error');
      },
    },
  });

  assert.equal(h.workspace.desktops.includes(created), true);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), created);
  assert.doesNotMatch(h.printed.join('\n'), /failed to create virtual desktop/);
});

test('startup does not report a non-trailing inserted desktop as the spare', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  let misplaced = null;
  const h = loadScript({
    windows: [browser],
    desktops: [d0],
    workspaceOverrides: {
      createDesktop(position, name) {
        misplaced = makeDesktop(position, name);
        this.desktops.splice(0, 0, misplaced);
        return misplaced;
      },
    },
  });

  assert.notEqual(misplaced, null);
  assert.notEqual(h.workspace.desktops[h.workspace.desktops.length - 1], misplaced);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), null);
  assert.equal(h.context.reservationCreatedDesktops.has(misplaced), true);
});

test('ensure retries a misplaced success and returns only the verified trailing spare', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ desktops: [d0] });
  h.loadWindow(browser);
  let calls = 0;
  let misplaced = null;
  let trailing = null;
  h.workspace.createDesktop = (position, name) => {
    calls += 1;
    const desktop = makeDesktop(position, name);
    if (calls === 1) {
      misplaced = desktop;
      h.workspace.desktops.splice(0, 0, desktop);
    } else {
      trailing = desktop;
      h.workspace.desktops.splice(h.workspace.desktops.length, 0, desktop);
    }
    return desktop;
  };
  const budget = h.context.makeDesktopCreationBudget(2);

  const spare = h.context.ensureTrailingSpareDesktop(budget);

  assert.equal(calls, 2);
  assert.equal(budget.calls, 2);
  assert.equal(spare, trailing);
  assert.notEqual(spare, misplaced);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), trailing);
  assert.equal(h.context.reservationCreatedDesktops.has(misplaced), true);
  h.context.reclaimTemporaryReservationDesktops();
  assert.equal(h.workspace.desktops.includes(misplaced), false);
  assert.equal(h.workspace.desktops.includes(trailing), true);
  assert.equal(h.context.reservationCreatedDesktops.size, 0);
});

test('ensure stops at the operation budget when every creation is misplaced', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ desktops: [d0] });
  h.loadWindow(browser);
  let calls = 0;
  h.workspace.createDesktop = (position, name) => {
    calls += 1;
    const desktop = makeDesktop(position, name);
    h.workspace.desktops.splice(0, 0, desktop);
    return desktop;
  };
  const budget = h.context.makeDesktopCreationBudget(2);

  const spare = h.context.ensureTrailingSpareDesktop(budget);

  assert.equal(spare, null);
  assert.equal(calls, 2);
  assert.equal(budget.calls, 2);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), null);
});

test('ensure does not claim or remove ambiguous desktops from one create call', () => {
  const d0 = makeDesktop(0);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ desktops: [d0], config: { RemoveEmptyVirtualDesktops: false } });
  h.loadWindow(browser);
  let misplaced = null;
  let trailing = null;
  h.workspace.createDesktop = (position, name) => {
    misplaced = makeDesktop(position, name + ' misplaced');
    trailing = makeDesktop(position + 1, name + ' trailing');
    h.workspace.desktops.splice(0, 0, misplaced);
    h.workspace.desktops.splice(h.workspace.desktops.length, 0, trailing);
    return misplaced;
  };

  const spare = h.context.ensureTrailingSpareDesktop(h.context.makeDesktopCreationBudget(1));

  assert.equal(spare, trailing);
  assert.equal(h.context.reservationCreatedDesktops.has(misplaced), false);
  assert.equal(h.context.reservationCreatedDesktops.has(trailing), false);
  h.context.reclaimTemporaryReservationDesktops();
  assert.equal(h.workspace.desktops.includes(misplaced), true);
  assert.equal(h.workspace.desktops.includes(trailing), true);
  assert.equal(h.context.reservationCreatedDesktops.size, 0);
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
  const originalRemove = h.workspace.removeDesktop.bind(h.workspace);
  let currentAtRemoval = null;
  let activeAtRemoval = null;
  h.workspace.removeDesktop = (desktop) => {
    if (desktop === d1) {
      currentAtRemoval = h.workspace.currentDesktop;
      activeAtRemoval = h.workspace.activeWindow;
    }
    originalRemove(desktop);
  };

  h.context.reconcileTrailingSpareDesktops(true);

  assert.equal(currentAtRemoval, d0);
  assert.equal(activeAtRemoval, previous);
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
  const dialog = makeWindow({ caption: 'Dialog', dialog: true, desktops: [d1] });
  const h = loadScript({ windows: [occupied, dialog], desktops: [d0, d1] });
  h.workspace.windowActivated.fire(occupied);
  h.workspace.currentDesktop = d1;
  h.workspace.activeWindow = dialog;
  delete h.workspace.removeDesktop;

  h.context.reconcileTrailingSpareDesktops(true);

  assert.equal(h.workspace.currentDesktop, d1);
  assert.equal(h.workspace.activeWindow, dialog);
  assert.deepEqual([...h.workspace.desktops], [d0, d1]);
});

test('one thrown removal does not stop later empty removals', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1, d2, d3] });
  const originalRemove = h.workspace.removeDesktop.bind(h.workspace);
  h.workspace.removeDesktop = (desktop) => {
    if (desktop === d1) throw new Error('busy');
    originalRemove(desktop);
  };

  h.context.reconcileTrailingSpareDesktops(false);

  assert.equal(h.workspace.desktops.includes(d1), true);
  assert.equal(h.workspace.desktops.includes(d2), false);
  assert.equal(h.workspace.desktops.includes(d3), true);
  assert.match(h.printed.join('\n'), /failed to remove virtual desktop/);
});

test('reconciliation recognizes an active desktop removed before removeDesktop throws', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1, d2, d3] });
  h.context.reservationCreatedDesktops.add(d1);
  h.workspace.windowActivated.fire(browser);
  h.workspace.currentDesktop = d1;
  h.workspace.activeWindow = null;
  const originalRemove = h.workspace.removeDesktop.bind(h.workspace);
  let currentAtRemoval = null;
  let activeAtRemoval = null;
  h.workspace.removeDesktop = (desktop) => {
    if (desktop === d1) {
      currentAtRemoval = h.workspace.currentDesktop;
      activeAtRemoval = h.workspace.activeWindow;
    }
    originalRemove(desktop);
    if (desktop === d1) throw new Error('late D-Bus error');
  };

  h.context.reconcileTrailingSpareDesktops(true);

  assert.equal(currentAtRemoval, d0);
  assert.equal(activeAtRemoval, browser);
  assert.deepEqual([...h.workspace.desktops], [d0, d3]);
  assert.equal(h.context.reservationCreatedDesktops.has(d1), false);
  assert.equal(h.workspace.currentDesktop, d0);
  assert.equal(h.workspace.activeWindow, browser);
  assert.equal(h.workspace.desktops.includes(h.workspace.currentDesktop), true);
});

test('one no-op removal does not stop later empty removals', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1, d2, d3] });
  const originalRemove = h.workspace.removeDesktop.bind(h.workspace);
  h.workspace.removeDesktop = (desktop) => {
    if (desktop === d1) return { removed: true };
    return originalRemove(desktop);
  };

  h.context.reconcileTrailingSpareDesktops(false);

  assert.equal(h.workspace.desktops.includes(d1), true);
  assert.equal(h.workspace.desktops.includes(d2), false);
  assert.equal(h.workspace.desktops.includes(d3), true);
  assert.match(h.printed.join('\n'), /failed to remove virtual desktop/);
});

[
  ['no-op', () => {}],
  ['throwing', () => { throw new Error('busy'); }],
].forEach(([failureKind, failRemoval]) => {
  test(`${failureKind} active-desktop removal rolls back the pre-removal focus transition`, () => {
    const d0 = makeDesktop(0);
    const d1 = makeDesktop(1);
    const d2 = makeDesktop(2);
    const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
    const dialog = makeWindow({ caption: 'Dialog', dialog: true, desktops: [d1] });
    const h = loadScript({ windows: [browser, dialog], desktops: [d0, d1, d2] });
    h.workspace.windowActivated.fire(browser);
    h.workspace.currentDesktop = d1;
    h.workspace.activeWindow = dialog;
    let currentAtRemoval = null;
    let activeAtRemoval = null;
    h.workspace.removeDesktop = (desktop) => {
      if (desktop !== d1) return;
      currentAtRemoval = h.workspace.currentDesktop;
      activeAtRemoval = h.workspace.activeWindow;
      failRemoval();
    };

    h.context.reconcileTrailingSpareDesktops(true);

    assert.equal(currentAtRemoval, d0);
    assert.equal(activeAtRemoval, browser);
    assert.equal(h.workspace.desktops.includes(d1), true);
    assert.equal(h.workspace.currentDesktop, d1);
    assert.equal(h.workspace.activeWindow, dialog);
  });
});

test('a replaced removal target is resolved by stable id before removal', () => {
  const d0 = Object.assign(makeDesktop(0), { id: 'desktop-0' });
  const stale = Object.assign(makeDesktop(1), { id: 'desktop-1' });
  const replacement = Object.assign(makeDesktop(1, 'Replacement'), { id: 'desktop-1' });
  const d2 = Object.assign(makeDesktop(2), { id: 'desktop-2' });
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, replacement, d2] });

  h.context.removeDesktopIfStillEmpty(stale);

  assert.equal(h.workspace.desktops.includes(replacement), false);
  assert.equal(h.workspace.desktops.includes(d2), true);
});

test('failed temporary removal retains ownership for a later retry', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1] });
  h.context.reservationCreatedDesktops.add(d1);
  h.workspace.removeDesktop = () => {};

  assert.equal(h.context.removeTemporaryReservationDesktop(d1), false);
  assert.equal(h.context.reservationCreatedDesktops.has(d1), true);
  assert.equal(h.workspace.desktops.includes(d1), true);
});

test('temporary reclaim recognizes removal completed before removeDesktop throws', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const d3 = makeDesktop(3);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1, d2, d3] });
  h.context.reservationCreatedDesktops.add(d1);
  h.context.reservationCreatedDesktops.add(d2);
  h.workspace.currentDesktop = d0;
  h.workspace.activeWindow = browser;
  const originalRemove = h.workspace.removeDesktop.bind(h.workspace);
  h.workspace.removeDesktop = (desktop) => {
    originalRemove(desktop);
    if (desktop === d2) throw new Error('late D-Bus error');
  };

  h.context.reclaimTemporaryReservationDesktops();

  assert.deepEqual([...h.workspace.desktops], [d0, d3]);
  assert.equal(h.context.reservationCreatedDesktops.size, 0);
  assert.equal(h.workspace.currentDesktop, d0);
  assert.equal(h.workspace.activeWindow, browser);
  assert.equal(h.workspace.desktops.includes(h.workspace.currentDesktop), true);
});

test('identity deadline drops ownership for a temporary desktop deleted externally', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1] });
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const temporaryDesktop = h.workspace.desktops[2];
  assert.equal(h.context.reservationCreatedDesktops.has(temporaryDesktop), true);
  h.workspace.removeDesktop(temporaryDesktop);

  assert.equal(h.QTimer.fireInterval(1000), true);

  assert.equal(h.context.reservationCreatedDesktops.size, 0);
  assert.equal(h.context.placementStates.has(window), false);
});

test('reclaim transfers temporary ownership to a same-id replacement', () => {
  const d0 = Object.assign(makeDesktop(0), { id: 'desktop-0' });
  const stale = Object.assign(makeDesktop(1), { id: 'desktop-1' });
  const replacement = Object.assign(makeDesktop(1, 'Replacement'), { id: 'desktop-1' });
  const d2 = Object.assign(makeDesktop(2), { id: 'desktop-2' });
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, replacement, d2] });
  const reservation = {};
  h.context.reservationCreatedDesktops.add(stale);
  h.context.reservedDesktopByWindow.set(reservation, stale);

  h.context.reclaimTemporaryReservationDesktops();

  assert.equal(h.context.reservationCreatedDesktops.has(stale), false);
  assert.equal(h.context.reservationCreatedDesktops.has(replacement), true);
  h.context.reservedDesktopByWindow.delete(reservation);
  h.context.reclaimTemporaryReservationDesktops();
  assert.equal(h.workspace.desktops.includes(replacement), false);
  assert.equal(h.context.reservationCreatedDesktops.size, 0);
});

test('temporary ownership follows same-id replacement objects until occupied', () => {
  const d0 = Object.assign(makeDesktop(0), { id: 'desktop-0' });
  const stale = Object.assign(makeDesktop(1), { id: 'desktop-1' });
  const replacement = Object.assign(makeDesktop(1, 'Replacement'), { id: 'desktop-1' });
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const occupant = makeWindow({ caption: 'Terminal', desktops: [replacement] });
  const h = loadScript({ windows: [browser, occupant], desktops: [d0, replacement] });
  h.context.reservationCreatedDesktops.add(stale);

  h.context.promoteTemporaryDesktopsOccupiedBy(occupant);

  assert.equal(h.context.reservationCreatedDesktops.size, 0);
});

test('a failed active-desktop removal does not cause focus jitter and can be retried', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const browser = makeWindow({ caption: 'Browser', desktops: [d0] });
  const h = loadScript({ windows: [browser], desktops: [d0, d1, d2] });
  h.workspace.currentDesktop = d1;
  h.workspace.activeWindow = null;
  const originalRemove = h.workspace.removeDesktop.bind(h.workspace);
  h.workspace.removeDesktop = (desktop) => {
    if (desktop !== d1) originalRemove(desktop);
  };

  h.context.reconcileTrailingSpareDesktops(false);

  assert.equal(h.workspace.currentDesktop, d1);
  assert.equal(h.workspace.activeWindow, null);
  assert.equal(h.workspace.desktops.includes(d1), true);

  h.workspace.removeDesktop = originalRemove;
  h.context.reconcileTrailingSpareDesktops(false);
  assert.equal(h.workspace.desktops.includes(d1), false);
  assert.equal(h.workspace.currentDesktop, d0);
});

test('closing a settling window still drains state when desktop operations are unavailable', () => {
  const d0 = makeDesktop(0);
  const h = loadScript({
    desktops: [d0],
    workspaceOverrides: { createDesktop: undefined, removeDesktop: undefined },
  });
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(h.context.placementStates.has(window), true);

  h.unloadWindow(window);
  window.closed.fire();
  h.QTimer.fireAll();

  assert.equal(h.context.placementStates.has(window), false);
  assert.equal(h.context.reservedDesktopByWindow.has(window), false);
  assert.equal(h.QTimer.pending, 0);
  assert.equal(window.captionChanged.handlerCount, 0);
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

test('a captured target replaced with the same id uses the current workspace object', () => {
  const d0 = Object.assign(makeDesktop(0), { id: 'desktop-0' });
  const d1 = Object.assign(makeDesktop(1), { id: 'desktop-1' });
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const replacement = Object.assign(makeDesktop(1, 'Replacement'), { id: 'desktop-1' });
  h.workspace.desktops[1] = replacement;

  window.caption = 'Document';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], replacement);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('a removed captured spread target falls back to the current trailing spare', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1] });
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const currentSpare = h.workspace.desktops[2];
  h.workspace.removeDesktop(d1);

  window.caption = 'Document';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], currentSpare);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('a removed late source-rule target preserves the current valid placement', () => {
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
  h.workspace.removeDesktop(d0);

  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d1);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('a removed late same-group target preserves the current valid placement', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const groupMember = makeWindow({ caption: 'WeChat', resourceClass: 'wechat', desktops: [d1] });
  const h = loadScript({
    windows: [groupMember],
    desktops: [d0, d1, d2],
    config: { SameDesktopWindowGroups: 'wechat, *viewer*' },
  });
  const window = makeWindow({ caption: 'Unknown', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  assert.equal(window.desktops[0], d2);
  h.workspace.removeDesktop(d1);

  window.caption = 'Viewer';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], d2);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('late correction falls back safely when both its target and current placement disappeared', () => {
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
  const remainingSpare = h.workspace.desktops[3];
  h.workspace.removeDesktop(d0);
  h.workspace.removeDesktop(d2);

  window.resourceClass = 'spectacle';
  window.windowClassChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(window.desktops[0], remainingSpare);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
});

test('late correction can create a target and then a spare within one operation budget', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2] });
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const occupied = h.workspace.desktops[3];
  existing.desktops = [occupied];
  h.workspace.removeDesktop(d0);
  h.workspace.removeDesktop(d1);
  h.workspace.removeDesktop(d2);
  let calls = 0;
  const originalCreate = h.workspace.createDesktop.bind(h.workspace);
  h.workspace.createDesktop = (position, name) => {
    calls += 1;
    return originalCreate(position, name);
  };

  window.caption = 'Document';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(calls, 2);
  assert.equal(window.desktops[0], h.workspace.desktops[1]);
  assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), h.workspace.desktops[2]);
});

test('late correction does not retry creation after the operation budget records failure', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const d2 = makeDesktop(2);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({ windows: [existing], desktops: [d0, d1, d2] });
  const window = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(window);
  h.workspace.windowAdded.fire(window);
  const occupied = h.workspace.desktops[3];
  existing.desktops = [occupied];
  h.workspace.removeDesktop(d0);
  h.workspace.removeDesktop(d1);
  h.workspace.removeDesktop(d2);
  let calls = 0;
  h.workspace.createDesktop = () => {
    calls += 1;
    throw new Error('desktop limit');
  };

  window.caption = 'Document';
  window.captionChanged.fire();
  assert.equal(h.QTimer.fireInterval(50), true);

  assert.equal(calls, 1);
  assert.equal(h.workspace.desktops.includes(window.desktops[0]), true);
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

test('disabled cleanup treats the active temporary desktop as user-owned', () => {
  const d0 = makeDesktop(0);
  const d1 = makeDesktop(1);
  const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
  const h = loadScript({
    windows: [existing],
    desktops: [d0, d1],
    config: { RemoveEmptyVirtualDesktops: false },
  });

  const sourceWindow = makeWindow({ caption: 'Open File', desktops: [d0] });
  h.loadWindow(sourceWindow);
  h.workspace.windowAdded.fire(sourceWindow);
  const temporaryDesktop = h.workspace.desktops[2];
  assert.equal(h.context.reservationCreatedDesktops.has(temporaryDesktop), true);

  h.workspace.currentDesktop = temporaryDesktop;
  assert.equal(h.QTimer.fireInterval(1000), true);

  assert.equal(h.workspace.desktops.includes(h.workspace.currentDesktop), true);
  assert.equal(h.workspace.desktops.includes(temporaryDesktop), true);
  assert.equal(h.context.reservationCreatedDesktops.has(temporaryDesktop), false);
  assert.equal(h.QTimer.fireInterval(300), true);
  assert.deepEqual([...h.workspace.desktops], [d0, d1, temporaryDesktop]);
  assert.equal(h.workspace.currentDesktop, temporaryDesktop);
});

[
  ['normal MRU', true],
  ['nearest occupied desktop', false],
].forEach(([focusPath, seedMru]) => {
  test(`enabled cleanup leaves an active temporary desktop through ${focusPath}`, () => {
    const d0 = makeDesktop(0);
    const d1 = makeDesktop(1);
    const existing = makeWindow({ caption: 'Editor', desktops: [d0] });
    const h = loadScript({ windows: [existing], desktops: [d0, d1] });
    if (seedMru) h.workspace.windowActivated.fire(existing);

    const sourceWindow = makeWindow({ caption: 'Open File', desktops: [d0] });
    h.loadWindow(sourceWindow);
    h.workspace.windowAdded.fire(sourceWindow);
    const temporaryDesktop = h.workspace.desktops[2];
    h.workspace.currentDesktop = temporaryDesktop;

    assert.equal(h.QTimer.fireInterval(1000), true);
    assert.equal(h.workspace.desktops.includes(h.workspace.currentDesktop), true);
    assert.equal(h.workspace.desktops.includes(temporaryDesktop), true);
    assert.equal(h.context.reservationCreatedDesktops.has(temporaryDesktop), false);

    assert.equal(h.QTimer.fireInterval(300), true);
    assert.equal(h.workspace.currentDesktop, d0);
    assert.equal(h.workspace.desktops.includes(h.workspace.currentDesktop), true);
    assert.deepEqual([...h.workspace.desktops], [d0, temporaryDesktop]);
    assert.equal(h.context.getTrailingSpareDesktop(h.workspace.desktops, h.workspace.windows), temporaryDesktop);
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
