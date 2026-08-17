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
var reservedDesktopByWindow = new Map();
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
  return workspace.currentDesktop || null;
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
    return;

  var state = placementStates.get(window);
  if (state)
    state.expectedPlacement = makeExpectedDesktopPlacement(desktop);

  window.desktops = [desktop];
  lastDesktopByWindow.set(window, desktop);
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
    if (left.desktops[index] !== right.desktops[index])
      return false;
  }
  return true;
}

function getDesktops() {
  return workspace.desktops;
}

function activateDesktop(desktop) {
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

function createDesktopAt(index) {
  if (typeof workspace.createDesktop !== 'function')
    return null;

  try {
    workspace.createDesktop(index, 'Desktop ' + (index + 1));
  } catch (error) {
    print('Kwindow-spread: failed to create virtual desktop: ' + error);
    return null;
  }

  return getDesktops()[index] || null;
}

function removeDesktop(desktop) {
  if (!config.removeEmptyVirtualDesktops || !desktop || typeof workspace.removeDesktop !== 'function')
    return;

  try {
    workspace.removeDesktop(desktop);
  } catch (error) {
    print('Kwindow-spread: failed to remove virtual desktop: ' + error);
  }
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
var emptyDesktopCleanupTimer = null;
var restorePreviousFocusAfterCleanup = false;

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

function ensureTrailingSpareDesktop() {
  var desktops = getDesktops();
  var windows = getAllWindows().map(toRuleWindow);
  var spare = getTrailingSpareDesktop(desktops, windows);
  if (spare)
    return spare;

  return createDesktopAt(desktops.length);
}

function placeWindowImmediately(window, context) {
  var normalizedWindow = toRuleWindow(window);
  var otherWindows = getAllWindows().filter(function (otherWindow) {
    return otherWindow !== window;
  }).map(toRuleWindow);
  var desktops = getDesktops();
  var spare = getTrailingSpareDesktop(desktops, otherWindows);
  if (!spare)
    spare = createDesktopAt(desktops.length);

  var decision = getInitialPlacementDecision({
    window: normalizedWindow,
    desktops: desktops,
    windows: otherWindows,
    sourceDesktop: context.desktop,
    spareDesktop: spare,
    rules: config.rules,
  });
  decision.initialTarget = spare || desktops[desktops.length - 1] || context.desktop;

  if (decision.kind !== 'spread' && decision.initialTarget)
    reservedDesktopByWindow.set(window, decision.initialTarget);

  if (decision.kind === 'ignore') {
    ensureTrailingSpareDesktop();
    return decision;
  }

  if (decision.targetDesktop && getWindowDesktop(window) !== decision.targetDesktop)
    setWindowDesktop(window, decision.targetDesktop);

  ensureTrailingSpareDesktop();
  if (config.keepCurrentFocus)
    restoreFocus(context);
  else if (decision.kind !== 'source')
    activateWindow(window);

  return decision;
}

function beginIdentitySettling(window, context, decision) {
  if (!window || !decision)
    return false;

  var state = {
    sourceDesktop: context.desktop,
    sourceFocusWindow: context.focusWindow,
    initialKind: decision.kind,
    initialTarget: decision.initialTarget,
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
  reservedDesktopByWindow.delete(window);
  placementStates.delete(window);
}

function recheckWindowIdentity(window, atDeadline) {
  var state = placementStates.get(window);
  if (!state || state.corrected || getAllWindows().indexOf(window) < 0) {
    finishIdentitySettling(window);
    scheduleDesktopReconciliation(false);
    return;
  }

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
    target = state.initialTarget;
  } else if (decision.kind === 'ignore' && state.initialKind !== 'ignore') {
    target = state.sourceDesktop;
  } else if ((decision.kind === 'source' || decision.kind === 'group') &&
             (decision.kind !== state.initialKind || decision.targetDesktop !== getWindowDesktop(window))) {
    target = decision.targetDesktop;
  }

  if (target && target !== getWindowDesktop(window)) {
    state.corrected = true;
    setWindowDesktop(window, target);
    ensureTrailingSpareDesktop();
    finishIdentitySettling(window);
    scheduleDesktopReconciliation(false);
    return;
  }

  if (atDeadline) {
    finishIdentitySettling(window);
    scheduleDesktopReconciliation(false);
  }
}

function cleanupAllEmptyDesktops(restorePreviousFocus) {
  if (!config.removeEmptyVirtualDesktops)
    return;

  if (typeof workspace.removeDesktop !== 'function')
    return;

  var desktops = Array.prototype.slice.call(getDesktops());
  if (desktops.length === 0)
    return;

  var windows = getAllWindows().map(toRuleWindow);
  var occupiedDesktops = desktops.filter(function (desktop) {
    return desktopHasNormalWindow(desktop, windows, null);
  });
  var retainedDesktop = null;

  if (occupiedDesktops.length === 0) {
    var currentDesktop = getCurrentDesktop();
    retainedDesktop = desktops.indexOf(currentDesktop) >= 0 ? currentDesktop : desktops[0];
  } else {
    var previousWindow = restorePreviousFocus ? getPreviousNormalFocusWindow() : null;
    if (previousWindow)
      activateWindow(previousWindow);

    var activeDesktop = getCurrentDesktop();
    if (!desktopHasNormalWindow(activeDesktop, windows, null)) {
      var activeIndex = desktops.indexOf(activeDesktop);
      activateDesktop(getNearestNonEmptyDesktop(desktops, windows, activeIndex));
    }
  }

  desktops.forEach(function (desktop) {
    if (desktop !== retainedDesktop)
      removeDesktopIfStillEmpty(desktop);
  });
}

function scheduleDesktopReconciliation(restorePreviousFocus) {
  restorePreviousFocusAfterCleanup = restorePreviousFocusAfterCleanup || !!restorePreviousFocus;
  if (emptyDesktopCleanupTimer)
    return;

  emptyDesktopCleanupTimer = scheduleTimer(function () {
    emptyDesktopCleanupTimer = null;
    var shouldRestorePreviousFocus = restorePreviousFocusAfterCleanup;
    restorePreviousFocusAfterCleanup = false;
    if (placementStates.size > 0) {
      scheduleDesktopReconciliation(shouldRestorePreviousFocus);
      return;
    }
    cleanupAllEmptyDesktops(shouldRestorePreviousFocus);
  }, WINDOW_CLOSED_DELAY_MS);
}

function removeDesktopIfStillEmpty(desktop) {
  if (getDesktops().indexOf(desktop) < 0)
    return;

  var windows = getAllWindows().map(toRuleWindow);
  if (!desktopHasNormalWindow(desktop, windows, null))
    removeDesktop(desktop);
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
      ? window.desktops.indexOf(desktop) >= 0
      : window.desktop === desktop;
    return belongsToDesktop && shouldTreatAsNormalWindow(window);
  });
}

function getTrailingSpareDesktop(desktops, windows) {
  if (!desktops || desktops.length === 0)
    return null;
  var candidate = desktops[desktops.length - 1];
  if (desktopHasNormalWindow(candidate, windows, null) || isDesktopReserved(candidate))
    return null;
  return candidate;
}

function isDesktopReserved(desktop) {
  var reserved = false;
  reservedDesktopByWindow.forEach(function (reservedDesktop) {
    if (reservedDesktop === desktop)
      reserved = true;
  });
  return reserved;
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
ensureTrailingSpareDesktop();
