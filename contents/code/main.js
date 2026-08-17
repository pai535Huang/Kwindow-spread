var WINDOW_CLOSED_DELAY_MS = 300;
var IDENTITY_DEBOUNCE_MS = 50;
var IDENTITY_DEADLINE_MS = 1000;

var DEFAULT_RULES = {
  auxiliaryDialogTitles: [
    'file chooser',
    'file picker',
    'choose (file|folder|directory)',
    'open (file|folder|directory)',
    'save (file|as)',
    'select (file|folder|directory)',
    '选择(文件|文件夹|目录)',
    '打开(文件|文件夹|目录)',
    '保存',
  ],
  auxiliaryRoles: [
    'dialog',
    'file.?chooser',
    'file.?picker',
    'viewer',
    'history',
  ],
  portalIdentifiers: [
    'xdg-desktop-portal',
  ],
  sourceDesktopApplications: [],
  sameDesktopGroups: [],
};

var activationMru = [];
var normalFocusMru = [];
var lastDesktopByWindow = new Map();
var connectedWindows = new Set();
var placementStates = new Map();
var config = loadConfig();

function loadConfig() {
  return {
    keepCurrentFocus: readBoolConfig('KeepCurrentFocus', false),
    removeEmptyVirtualDesktops: readBoolConfig('RemoveEmptyVirtualDesktops', true),
    rules: {
      sourceDesktopApplications: readStringListConfig('SourceDesktopApplications', []),
      sameDesktopGroups: readStringListConfig('SameDesktopWindowGroups', []),
    },
  };
}

function readBoolConfig(name, fallback) {
  try {
    return !!readConfig(name, fallback);
  } catch (error) {
    print('Kwindow-spread: failed to read ' + name + ': ' + error);
    return fallback;
  }
}

function readStringListConfig(name, fallback) {
  try {
    return normalizeStringList(readConfig(name, ''));
  } catch (error) {
    print('Kwindow-spread: failed to read ' + name + ': ' + error);
    return fallback.slice();
  }
}

function normalizeStringList(value) {
  if (Array.isArray(value))
    return value.map(String).map(trimString).filter(Boolean);

  if (typeof value === 'string')
    return value.split(/\r?\n/).map(trimString).filter(Boolean);

  if (value !== null && value !== undefined)
    return String(value).split(/\r?\n/).map(trimString).filter(Boolean);

  return [];
}

function trimString(value) {
  return String(value).trim();
}

function getAllWindows() {
  return workspace.windowList();
}

function getCurrentDesktop() {
  return resolveDesktopReference(workspace.currentDesktop, getDesktops()) || null;
}

function getWindowDesktop(window) {
  if (!window)
    return null;

  if (window.desktops && typeof window.desktops.length === 'number' && window.desktops.length > 0)
    return window.desktops[0];

  return lastDesktopByWindow.get(window) || null;
}

function getWindowDesktops(window) {
  return window && window.desktops ? Array.prototype.slice.call(window.desktops) : [];
}

function setWindowDesktop(window, desktop) {
  if (!window || !desktop)
    return false;

  desktop = resolveDesktopReference(desktop, getDesktops());
  if (!desktop)
    return false;

  var state = placementStates.get(window);
  if (state)
    state.expectedPlacement = makeExpectedDesktopPlacement(desktop);

  window.desktops = [desktop];
  lastDesktopByWindow.set(window, desktop);
  return true;
}

function getWindowPlacement(window) {
  return {
    onAllDesktops: !!(window && window.onAllDesktops),
    desktops: getWindowDesktops(window),
  };
}

function makeExpectedDesktopPlacement(desktop) {
  return {
    onAllDesktops: false,
    desktops: desktop ? [desktop] : [],
  };
}

function sameWindowPlacement(left, right) {
  if (!left || !right || left.onAllDesktops !== right.onAllDesktops)
    return false;
  if (left.desktops.length !== right.desktops.length)
    return false;

  for (var index = 0; index < left.desktops.length; index++) {
    if (!sameDesktopIdentity(left.desktops[index], right.desktops[index]))
      return false;
  }
  return true;
}

function getDesktops() {
  return workspace.desktops;
}

function getDesktopStableId(desktop) {
  if (!desktop)
    return '';
  try {
    if (desktop.id !== null && desktop.id !== undefined && String(desktop.id) !== '')
      return String(desktop.id);
  } catch (error) {
    return '';
  }
  return '';
}

function sameDesktopIdentity(left, right) {
  if (left === right)
    return true;
  var leftId = getDesktopStableId(left);
  var rightId = getDesktopStableId(right);
  return leftId !== '' && leftId === rightId;
}

function resolveDesktopReference(target, desktops) {
  if (!target || !desktops)
    return null;
  for (var index = 0; index < desktops.length; index++) {
    if (desktops[index] === target)
      return desktops[index];
  }
  for (var idIndex = 0; idIndex < desktops.length; idIndex++) {
    if (sameDesktopIdentity(desktops[idIndex], target))
      return desktops[idIndex];
  }
  return null;
}

function resolveExistingTarget(target, fallback, creationBudget) {
  var desktops = Array.prototype.slice.call(getDesktops());
  var resolved = resolveDesktopReference(target, desktops);
  if (resolved)
    return resolved;

  var spare = getTrailingSpareDesktop(desktops, getAllWindows().map(toRuleWindow));
  if (!spare)
    spare = ensureTrailingSpareDesktop(creationBudget || makeDesktopCreationBudget(1));
  resolved = resolveDesktopReference(spare, getDesktops());
  if (resolved)
    return resolved;

  resolved = resolveDesktopReference(fallback, getDesktops());
  if (resolved)
    return resolved;

  desktops = Array.prototype.slice.call(getDesktops());
  return desktops.length > 0 ? desktops[desktops.length - 1] : null;
}

function resolveRuleTarget(target, currentPlacement, creationBudget) {
  return resolveDesktopReference(target, getDesktops()) ||
    resolveDesktopReference(currentPlacement, getDesktops()) ||
    resolveExistingTarget(null, null, creationBudget);
}

function activateDesktop(desktop) {
  desktop = resolveDesktopReference(desktop, getDesktops());
  if (!desktop)
    return;

  workspace.currentDesktop = desktop;
}

function activateWindow(window) {
  if (!window)
    return;

  var desktop = getWindowDesktop(window);
  if (desktop)
    activateDesktop(desktop);

  workspace.activeWindow = window;
}

function makeDesktopCreationBudget(maxCalls) {
  return {
    failed: false,
    calls: 0,
    maxCalls: Math.max(1, maxCalls || 1),
  };
}

function findCreatedDesktops(before, after) {
  var created = [];
  if (after.length <= before.length)
    return created;
  for (var index = 0; index < after.length; index++) {
    if (!resolveDesktopReference(after[index], before))
      created.push(after[index]);
  }
  return created;
}

function findCreatedDesktop(before, after) {
  var created = findCreatedDesktops(before, after);
  return created.length > 0 ? created[0] : null;
}

function createDesktopAt(index, creationBudget) {
  creationBudget = creationBudget || makeDesktopCreationBudget(1);
  if (creationBudget.failed || creationBudget.calls >= creationBudget.maxCalls)
    return null;
  creationBudget.calls++;

  var before = Array.prototype.slice.call(getDesktops());
  if (typeof workspace.createDesktop !== 'function') {
    creationBudget.failed = true;
    print('Kwindow-spread: failed to create virtual desktop: operation unavailable');
    return null;
  }

  var operationError = null;
  try {
    workspace.createDesktop(index, 'Desktop ' + (index + 1));
  } catch (error) {
    operationError = error;
  }

  var after = Array.prototype.slice.call(getDesktops());
  var candidate = findCreatedDesktop(before, after);
  if (candidate) {
    if (operationError)
      print('Kwindow-spread: created virtual desktop despite operation error: ' + operationError);
    return candidate;
  }

  creationBudget.failed = true;
  if (operationError)
    print('Kwindow-spread: failed to create virtual desktop: ' + operationError);
  else
    print('Kwindow-spread: failed to create virtual desktop: workspace did not add a desktop');
  return null;
}

function removeDesktop(desktop) {
  if (!config.removeEmptyVirtualDesktops || !desktop || typeof workspace.removeDesktop !== 'function')
    return false;

  var requestedDesktop = desktop;
  desktop = resolveDesktopReference(desktop, getDesktops());
  if (!desktop)
    return false;

  return performDesktopRemoval(requestedDesktop, desktop, 'virtual desktop');
}

function performDesktopRemoval(requestedDesktop, resolvedDesktop, description) {
  var operationError = null;
  try {
    workspace.removeDesktop(resolvedDesktop);
  } catch (error) {
    operationError = error;
  }

  if (!resolveDesktopReference(requestedDesktop, getDesktops())) {
    if (operationError)
      print('Kwindow-spread: removed ' + description + ' despite operation error: ' + operationError);
    return true;
  }

  if (operationError)
    print('Kwindow-spread: failed to remove ' + description + ': ' + operationError);
  else
    print('Kwindow-spread: failed to remove ' + description + ': workspace kept the desktop');
  return false;
}

function recordActivation(window) {
  if (!window || getAllWindows().indexOf(window) < 0)
    return;

  removeFromActivationMru(window);
  activationMru.unshift(window);
  if (activationMru.length > 16)
    activationMru.length = 16;

  removeFromNormalFocusMru(window);
  if (!shouldTreatAsNormalWindow(toRuleWindow(window)))
    return;

  normalFocusMru.unshift(window);
  if (normalFocusMru.length > 16)
    normalFocusMru.length = 16;
}

function removeFromActivationMru(window) {
  var index = activationMru.indexOf(window);
  if (index >= 0)
    activationMru.splice(index, 1);
}

function removeFromNormalFocusMru(window) {
  var index = normalFocusMru.indexOf(window);
  if (index >= 0)
    normalFocusMru.splice(index, 1);
}

function getPreviousActivationWindow(ignoredWindow) {
  for (var index = 0; index < activationMru.length; index++) {
    var window = activationMru[index];
    if (window && window !== ignoredWindow && getAllWindows().indexOf(window) >= 0)
      return window;
  }

  return null;
}

function getPreviousNormalFocusWindow() {
  var previousWindow = null;
  var windows = getAllWindows();
  for (var index = 0; index < normalFocusMru.length;) {
    var window = normalFocusMru[index];
    if (!window || windows.indexOf(window) < 0 || !shouldTreatAsNormalWindow(toRuleWindow(window))) {
      normalFocusMru.splice(index, 1);
      continue;
    }

    if (!previousWindow)
      previousWindow = window;
    index++;
  }

  return previousWindow;
}

function restoreFocus(context) {
  if (context && context.desktop)
    activateDesktop(context.desktop);

  if (context && context.focusWindow && getAllWindows().indexOf(context.focusWindow) >= 0)
    activateWindow(context.focusWindow);
}

var activeTimers = [];
var desktopReconciliationTimer = null;
var restorePreviousFocusAfterReconciliation = false;

function scheduleTimer(callback, delayMs) {
  var timer = new QTimer();
  timer.singleShot = true;
  timer.interval = delayMs;
  timer.timeout.connect(function () {
    cancelTimer(timer);
    callback();
  });
  timer.start();
  activeTimers.push(timer);
  return timer;
}

function cancelTimer(timer) {
  if (!timer)
    return;

  var index = activeTimers.indexOf(timer);
  if (index < 0)
    return;

  activeTimers.splice(index, 1);
  timer.stop();
  if (typeof timer.deleteLater === 'function')
    timer.deleteLater();
}

function ensureTrailingSpareDesktop(creationBudget) {
  creationBudget = creationBudget || makeDesktopCreationBudget(1);
  while (true) {
    var desktops = Array.prototype.slice.call(getDesktops());
    var windows = getAllWindows().map(toRuleWindow);
    var spare = getTrailingSpareDesktop(desktops, windows);
    if (spare)
      return spare;
    if (creationBudget.failed || creationBudget.calls >= creationBudget.maxCalls)
      return null;

    var created = createDesktopAt(desktops.length, creationBudget);
    var refreshedDesktops = Array.prototype.slice.call(getDesktops());
    var verifiedSpare = getTrailingSpareDesktop(
      refreshedDesktops,
      getAllWindows().map(toRuleWindow)
    );
    if (verifiedSpare)
      return verifiedSpare;
    if (!created)
      return null;
  }
}

function placeWindowImmediately(window, context) {
  var normalizedWindow = toRuleWindow(window);
  var otherWindows = getAllWindows().filter(function (otherWindow) {
    return otherWindow !== window;
  }).map(toRuleWindow);
  var creationBudget = makeDesktopCreationBudget(2);
  var desktops = getDesktops();
  var decision = getRulePlacementDecision({
    window: normalizedWindow,
    windows: otherWindows,
    sourceDesktop: context.desktop,
    rules: config.rules,
  });
  var currentPlacement = resolveDesktopReference(getWindowDesktop(window), getDesktops());
  if (decision.kind === 'ignore')
    return decision;

  if (decision.kind === 'spread') {
    var spare = getTrailingSpareDesktop(desktops, otherWindows);
    if (!spare)
      spare = ensureTrailingSpareDesktop(creationBudget);
    decision.targetDesktop = resolveExistingTarget(spare, currentPlacement || context.desktop, creationBudget);
  } else if (decision.targetDesktop) {
    decision.targetDesktop = resolveRuleTarget(decision.targetDesktop, currentPlacement, creationBudget);
  }

  if (decision.targetDesktop && getWindowDesktop(window) !== decision.targetDesktop)
    setWindowDesktop(window, decision.targetDesktop);

  if (decision.kind === 'spread')
    ensureTrailingSpareDesktop(creationBudget);
  if (config.keepCurrentFocus)
    restoreFocus(context);
  else if (decision.kind !== 'source')
    activateWindow(window);

  return decision;
}

function beginIdentitySettling(window, context, decision) {
  if (!window || !decision || decision.kind === 'ignore')
    return false;

  var state = {
    sourceDesktop: context.desktop,
    sourceFocusWindow: context.focusWindow,
    initialKind: decision.kind,
    expectedPlacement: getWindowPlacement(window),
    corrected: false,
    debounceTimer: null,
    deadlineTimer: null,
    connections: [],
  };
  placementStates.set(window, state);

  [
    'captionChanged',
    'desktopFileNameChanged',
    'windowClassChanged',
    'windowRoleChanged',
    'transientChanged',
  ].forEach(function (name) {
    var signal = window[name];
    if (!signal || typeof signal.connect !== 'function')
      return;

    var handler = function () { scheduleIdentityRecheck(window); };
    signal.connect(handler);
    state.connections.push({ signal: signal, handler: handler });
  });

  state.deadlineTimer = scheduleTimer(function () {
    state.deadlineTimer = null;
    recheckWindowIdentity(window, true);
  }, IDENTITY_DEADLINE_MS);
  return true;
}

function scheduleIdentityRecheck(window) {
  var state = placementStates.get(window);
  if (!state || state.corrected)
    return;

  cancelTimer(state.debounceTimer);
  state.debounceTimer = scheduleTimer(function () {
    state.debounceTimer = null;
    recheckWindowIdentity(window, false);
  }, IDENTITY_DEBOUNCE_MS);
}

function finishIdentitySettling(window) {
  var state = placementStates.get(window);
  if (!state)
    return;

  cancelTimer(state.debounceTimer);
  cancelTimer(state.deadlineTimer);
  state.connections.forEach(function (connection) {
    if (typeof connection.signal.disconnect === 'function')
      connection.signal.disconnect(connection.handler);
  });
  placementStates.delete(window);
}

function recheckWindowIdentity(window, atDeadline) {
  var state = placementStates.get(window);
  if (!state || state.corrected || getAllWindows().indexOf(window) < 0) {
    finishIdentitySettling(window);
    scheduleDesktopReconciliation(false);
    return;
  }

  var creationBudget = makeDesktopCreationBudget(2);
  var otherWindows = getAllWindows().filter(function (otherWindow) {
    return otherWindow !== window;
  }).map(toRuleWindow);
  var decision = getRulePlacementDecision({
    window: toRuleWindow(window),
    windows: otherWindows,
    sourceDesktop: state.sourceDesktop,
    rules: config.rules,
  });
  var target = null;
  if (decision.kind === 'spread' && state.initialKind !== 'spread') {
    target = getTrailingSpareDesktop(getDesktops(), otherWindows);
    if (!target)
      target = ensureTrailingSpareDesktop(creationBudget);
  } else if (decision.kind === 'ignore' && state.initialKind !== 'ignore') {
    target = state.sourceDesktop;
  } else if ((decision.kind === 'source' || decision.kind === 'group') &&
             (decision.kind !== state.initialKind || decision.targetDesktop !== getWindowDesktop(window))) {
    target = decision.targetDesktop;
  }

  var currentPlacement = resolveDesktopReference(getWindowDesktop(window), getDesktops());
  if (target && decision.kind !== 'spread')
    target = resolveRuleTarget(target, currentPlacement, creationBudget);
  else if (target)
    target = resolveDesktopReference(target, getDesktops());

  if (target && target !== currentPlacement) {
    if (!setWindowDesktop(window, target)) {
      if (atDeadline) {
        finishIdentitySettling(window);
        scheduleDesktopReconciliation(false);
      }
      return;
    }
    state.corrected = true;
    ensureTrailingSpareDesktop(creationBudget);
    finishIdentitySettling(window);
    scheduleDesktopReconciliation(false);
    return;
  }

  if (atDeadline) {
    finishIdentitySettling(window);
    scheduleDesktopReconciliation(false);
  }
}

function reconcileTrailingSpareDesktops(restorePreviousFocus) {
  var creationBudget = makeDesktopCreationBudget(1);
  var desktops = Array.prototype.slice.call(getDesktops());
  if (desktops.length === 0)
    return null;

  var windows = getAllWindows().map(toRuleWindow);
  var occupiedDesktops = desktops.filter(function (desktop) {
    return desktopHasNormalWindow(desktop, windows, null);
  });

  if (occupiedDesktops.length === 0) {
    var currentDesktop = getCurrentDesktop();
    var retainedDesktop = desktops.indexOf(currentDesktop) >= 0 ? currentDesktop : desktops[0];
    if (config.removeEmptyVirtualDesktops && typeof workspace.removeDesktop === 'function') {
      desktops.forEach(function (desktop) {
        if (desktop !== retainedDesktop)
          removeDesktopIfStillEmpty(desktop);
      });
    }
    return retainedDesktop;
  }

  var spare = ensureTrailingSpareDesktop(creationBudget);
  if (!config.removeEmptyVirtualDesktops || typeof workspace.removeDesktop !== 'function')
    return spare;

  desktops = Array.prototype.slice.call(getDesktops());
  var previousWindow = restorePreviousFocus ? getPreviousNormalFocusWindow() : null;
  var activeDesktop = getCurrentDesktop();
  var activeIndex = desktops.indexOf(activeDesktop);
  var activeDesktopIsEmpty = !desktopHasNormalWindow(activeDesktop, windows, null);
  var removeActiveDesktop = !sameDesktopIdentity(activeDesktop, spare) && activeDesktopIsEmpty;

  if (!removeActiveDesktop && restorePreviousFocus) {
    if (previousWindow)
      activateWindow(previousWindow);
    else if (activeDesktopIsEmpty)
      activateDesktop(getNearestNonEmptyDesktop(desktops, windows, activeIndex));
  }

  desktops.forEach(function (desktop) {
    if (sameDesktopIdentity(desktop, spare))
      return;

    if (removeActiveDesktop && sameDesktopIdentity(desktop, activeDesktop))
      removeActiveDesktopIfStillEmpty(desktop, previousWindow, desktops, windows, activeIndex);
    else
      removeDesktopIfStillEmpty(desktop);
  });
  return spare;
}

function removeActiveDesktopIfStillEmpty(desktop, previousWindow, desktops, windows, activeIndex) {
  var originalDesktop = getCurrentDesktop();
  var originalActiveWindow = workspace.activeWindow || null;

  if (previousWindow)
    activateWindow(previousWindow);
  else
    activateDesktop(getNearestNonEmptyDesktop(desktops, windows, activeIndex));

  if (sameDesktopIdentity(getCurrentDesktop(), desktop)) {
    restoreDesktopRemovalFocus(originalDesktop, originalActiveWindow);
    return false;
  }

  var removed = removeDesktopIfStillEmpty(desktop);
  if (!removed)
    restoreDesktopRemovalFocus(originalDesktop, originalActiveWindow);
  return removed;
}

function restoreDesktopRemovalFocus(desktop, activeWindow) {
  if (resolveDesktopReference(desktop, getDesktops()))
    activateDesktop(desktop);

  if (!activeWindow) {
    workspace.activeWindow = null;
    return;
  }
  if (getAllWindows().indexOf(activeWindow) >= 0)
    workspace.activeWindow = activeWindow;
}

function scheduleDesktopReconciliation(restorePreviousFocus) {
  restorePreviousFocusAfterReconciliation = restorePreviousFocusAfterReconciliation || !!restorePreviousFocus;
  if (desktopReconciliationTimer)
    return;

  desktopReconciliationTimer = scheduleTimer(function () {
    desktopReconciliationTimer = null;
    var shouldRestorePreviousFocus = restorePreviousFocusAfterReconciliation;
    restorePreviousFocusAfterReconciliation = false;
    if (placementStates.size > 0) {
      scheduleDesktopReconciliation(shouldRestorePreviousFocus);
      return;
    }
    reconcileTrailingSpareDesktops(shouldRestorePreviousFocus);
  }, WINDOW_CLOSED_DELAY_MS);
}

function removeDesktopIfStillEmpty(desktop) {
  desktop = resolveDesktopReference(desktop, getDesktops());
  if (!desktop)
    return false;

  var windows = getAllWindows().map(toRuleWindow);
  if (!desktopHasNormalWindow(desktop, windows, null))
    return removeDesktop(desktop);
  return false;
}

function onWindowAdded(window) {
  if (!window)
    return;

  var activeWindow = workspace.activeWindow || null;
  var context = {
    desktop: getCurrentDesktop(),
    focusWindow: activeWindow && activeWindow !== window
      ? activeWindow
      : getPreviousActivationWindow(window),
  };
  trackWindow(window);
  var decision = placeWindowImmediately(window, context);
  if (!beginIdentitySettling(window, context, decision))
    scheduleDesktopReconciliation(false);
}

function onWindowRemoved(window) {
  if (!window || !connectedWindows.has(window))
    return;

  var restorePreviousFocus = normalFocusMru[0] === window || workspace.activeWindow === window;
  removeFromActivationMru(window);
  removeFromNormalFocusMru(window);
  finishIdentitySettling(window);
  connectedWindows.delete(window);
  lastDesktopByWindow.delete(window);
  scheduleDesktopReconciliation(restorePreviousFocus);
}

function onWindowDesktopChanged(window) {
  if (!connectedWindows.has(window))
    return;

  var state = placementStates.get(window);
  if (state && !sameWindowPlacement(getWindowPlacement(window), state.expectedPlacement))
    finishIdentitySettling(window);

  lastDesktopByWindow.set(window, getWindowDesktop(window));
  scheduleDesktopReconciliation(false);
}

function trackWindow(window) {
  if (!window || connectedWindows.has(window))
    return;

  lastDesktopByWindow.set(window, getWindowDesktop(window));
  connectedWindows.add(window);

  if (window.desktopsChanged && typeof window.desktopsChanged.connect === 'function') {
    window.desktopsChanged.connect(function () {
      onWindowDesktopChanged(window);
    });
  }

  if (window.closed && typeof window.closed.connect === 'function')
    window.closed.connect(function () { onWindowRemoved(window); });
}

function toRuleWindow(window) {
  var desktop = getWindowDesktop(window);
  return {
    normalWindow: boolProperty(window, 'normalWindow', isLikelyNormalWindow(window)),
    skipTaskbar: boolProperty(window, 'skipTaskbar', false),
    skipPager: boolProperty(window, 'skipPager', false),
    onAllDesktops: boolProperty(window, 'onAllDesktops', false),
    transient: boolProperty(window, 'transient', false) || !!(window && window.transientFor),
    dialog: boolProperty(window, 'dialog', false) || boolProperty(window, 'modal', false),
    role: stringProperty(window, ['windowRole']),
    title: stringProperty(window, ['caption']),
    resourceClass: stringProperty(window, ['resourceClass']),
    resourceName: stringProperty(window, ['resourceName']),
    appId: stringProperty(window, ['desktopFileName']),
    desktop: desktop,
    desktops: getWindowDesktops(window),
  };
}

function boolProperty(object, name, fallback) {
  if (!object || typeof object[name] === 'undefined')
    return fallback;

  return !!object[name];
}

function stringProperty(object, names) {
  for (var index = 0; index < names.length; index++) {
    var value = object ? object[names[index]] : null;
    if (typeof value === 'function')
      value = value.call(object);
    if (typeof value === 'string' && value !== '')
      return value;
  }

  return '';
}

function isLikelyNormalWindow(window) {
  if (!window)
    return false;

  var excluded = [
    'desktopWindow',
    'dock',
    'toolbar',
    'menu',
    'utility',
    'splash',
    'dropdownMenu',
    'popupMenu',
    'tooltip',
    'notification',
    'criticalNotification',
    'appletPopup',
  ];

  for (var index = 0; index < excluded.length; index++) {
    if (window[excluded[index]])
      return false;
  }

  return true;
}

function shouldTreatAsNormalWindow(window) {
  if (!window)
    return false;

  if (window.onAllDesktops || window.skipTaskbar || window.skipPager)
    return false;

  if (window.transient || window.dialog)
    return false;

  return window.normalWindow === true;
}

function getRulePlacementDecision(args) {
  var window = args.window;
  if (!shouldTreatAsNormalWindow(window))
    return { kind: 'ignore', reason: 'not-normal-window' };

  var rules = mergeRules(DEFAULT_RULES, args.rules);
  if (shouldStayOnSourceDesktop(window, rules))
    return { kind: 'source', targetDesktop: args.sourceDesktop, reason: 'source-workspace-window' };

  var sameGroupDesktop = getSameGroupDesktop(window, args.windows, rules);
  if (sameGroupDesktop)
    return { kind: 'group', targetDesktop: sameGroupDesktop, reason: 'same-group' };

  return { kind: 'spread', reason: 'trailing-spare' };
}

function getInitialPlacementDecision(args) {
  var decision = getRulePlacementDecision(args);
  if (decision.kind !== 'spread')
    return decision;
  return {
    kind: 'spread',
    targetDesktop: args.spareDesktop || args.desktops[args.desktops.length - 1] || args.sourceDesktop,
    reason: 'trailing-spare',
  };
}

function mergeRules(defaultRules, configuredRules) {
  configuredRules = configuredRules || {};
  return {
    auxiliaryDialogTitles: mergeStringArrays(defaultRules.auxiliaryDialogTitles, configuredRules.auxiliaryDialogTitles),
    auxiliaryRoles: mergeStringArrays(defaultRules.auxiliaryRoles, configuredRules.auxiliaryRoles),
    portalIdentifiers: mergeStringArrays(defaultRules.portalIdentifiers, configuredRules.portalIdentifiers),
    sourceDesktopApplications: mergeStringArrays(defaultRules.sourceDesktopApplications, configuredRules.sourceDesktopApplications),
    sameDesktopGroups: mergeStringArrays(defaultRules.sameDesktopGroups, configuredRules.sameDesktopGroups),
  };
}

function mergeStringArrays(defaultValues, configuredValues) {
  if (!Array.isArray(configuredValues))
    return defaultValues.slice();

  return defaultValues.concat(configuredValues.filter(function (value) {
    return typeof value === 'string' && value.trim() !== '';
  }));
}

function shouldStayOnSourceDesktop(window, rules) {
  return isPortalWindow(window, rules) || hasAuxiliaryDialogRoleOrTitle(window, rules) || matchesSourceDesktopApplication(window, rules);
}

function isPortalWindow(window, rules) {
  return matchesPatterns(getWindowIdentifiers(window), compilePatterns(rules.portalIdentifiers));
}

function hasAuxiliaryDialogRoleOrTitle(window, rules) {
  if (window.role && matchesPatterns([window.role], compilePatterns(rules.auxiliaryRoles)))
    return true;

  return matchesPatterns([window.title || ''], compilePatterns(rules.auxiliaryDialogTitles));
}

function matchesSourceDesktopApplication(window, rules) {
  return matchesPatterns(getWindowIdentifiers(window), compileUserWildcardPatterns(rules.sourceDesktopApplications));
}

function getSameGroupDesktop(window, windows, rules) {
  var matchingGroup = getMatchingGroup(window, rules);
  if (!matchingGroup)
    return null;

  for (var index = 0; index < windows.length; index++) {
    var otherWindow = windows[index];
    if (otherWindow === window || !shouldTreatAsNormalWindow(otherWindow))
      continue;

    if (matchesPatterns(getWorkspaceGroupingValues(otherWindow), matchingGroup))
      return otherWindow.desktop;
  }

  return null;
}

function getMatchingGroup(window, rules) {
  var values = getWorkspaceGroupingValues(window);
  var groups = rules.sameDesktopGroups || [];
  for (var index = 0; index < groups.length; index++) {
    var group = compileUserPatternGroup(groups[index]);
    if (group.length > 0 && matchesPatterns(values, group))
      return group;
  }

  return null;
}

function getWorkspaceGroupingValues(window) {
  return [window.appId, window.resourceClass, window.resourceName, window.title].filter(nonEmptyString);
}

function getWindowIdentifiers(window) {
  return [window.appId, window.resourceClass, window.resourceName].filter(nonEmptyString);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function matchesPatterns(values, patterns) {
  return values.some(function (value) {
    return patterns.some(function (pattern) {
      return pattern.test(value);
    });
  });
}

function getLastNonEmptyDesktopIndex(desktops, windows, ignoredWindow) {
  for (var index = desktops.length - 1; index >= 0; index--) {
    if (desktopHasNormalWindow(desktops[index], windows, ignoredWindow))
      return index;
  }

  return -1;
}

function desktopHasNormalWindow(desktop, windows, ignoredWindow) {
  return windows.some(function (window) {
    if (window === ignoredWindow)
      return false;

    var belongsToDesktop = window.desktops && typeof window.desktops.indexOf === 'function'
      ? window.desktops.some(function (windowDesktop) { return sameDesktopIdentity(windowDesktop, desktop); })
      : sameDesktopIdentity(window.desktop, desktop);
    return belongsToDesktop && shouldTreatAsNormalWindow(window);
  });
}

function getTrailingSpareDesktop(desktops, windows) {
  if (!desktops || desktops.length === 0)
    return null;
  var candidate = desktops[desktops.length - 1];
  return desktopHasNormalWindow(candidate, windows, null) ? null : candidate;
}

function getNearestNonEmptyDesktop(desktops, windows, startIndex) {
  for (var index = startIndex - 1; index >= 0; index--) {
    if (desktopHasNormalWindow(desktops[index], windows, null))
      return desktops[index];
  }

  for (var rightIndex = startIndex + 1; rightIndex < desktops.length; rightIndex++) {
    if (desktopHasNormalWindow(desktops[rightIndex], windows, null))
      return desktops[rightIndex];
  }

  return null;
}

function compilePatterns(patterns) {
  var compiled = [];
  patterns = patterns || [];

  for (var index = 0; index < patterns.length; index++) {
    var pattern = patterns[index];
    if (typeof pattern !== 'string')
      continue;

    try {
      compiled.push(new RegExp(pattern, 'i'));
    } catch (error) {
      print('Kwindow-spread: ignoring invalid pattern ' + pattern + ': ' + error);
    }
  }

  return compiled;
}

function compileUserPatternGroup(group) {
  if (typeof group !== 'string')
    return [];

  var compiled = [];
  var aliases = group.split(',');
  for (var index = 0; index < aliases.length; index++) {
    var pattern = trimString(aliases[index]);
    if (!pattern)
      continue;

    try {
      compiled.push(new RegExp(wildcardToRegex(pattern), 'i'));
    } catch (error) {
      print('Kwindow-spread: ignoring invalid user pattern ' + pattern + ': ' + error);
    }
  }

  return compiled;
}

function compileUserWildcardPatterns(patterns) {
  if (!Array.isArray(patterns))
    return [];

  var compiled = [];
  for (var index = 0; index < patterns.length; index++) {
    if (typeof patterns[index] !== 'string')
      continue;

    var pattern = trimString(patterns[index]);
    if (!pattern)
      continue;

    try {
      compiled.push(new RegExp(wildcardToRegex(pattern), 'i'));
    } catch (error) {
      print('Kwindow-spread: ignoring invalid user pattern ' + pattern + ': ' + error);
    }
  }

  return compiled;
}

function wildcardToRegex(pattern) {
  var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
}

workspace.windowAdded.connect(onWindowAdded);
workspace.windowRemoved.connect(onWindowRemoved);
workspace.windowActivated.connect(recordActivation);

getAllWindows().forEach(trackWindow);
recordActivation(workspace.activeWindow || null);
ensureTrailingSpareDesktop(makeDesktopCreationBudget(1));
