var WINDOW_CREATED_DELAY_MS = 500;
var WINDOW_CLOSED_DELAY_MS = 150;

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
  sameDesktopGroups: [],
};

var focusMru = [];
var pendingMoves = new Map();
var lastDesktopByWindow = new Map();
var connectedWindows = new Set();
var config = loadConfig();

function loadConfig() {
  return {
    keepCurrentFocus: readBoolConfig('KeepCurrentFocus', false),
    createVirtualDesktops: readBoolConfig('CreateVirtualDesktops', true),
    removeEmptyVirtualDesktops: readBoolConfig('RemoveEmptyVirtualDesktops', true),
    rules: {
      auxiliaryDialogTitles: readStringListConfig('AuxiliaryDialogTitles', []),
      auxiliaryRoles: readStringListConfig('AuxiliaryRoles', []),
      portalIdentifiers: readStringListConfig('PortalIdentifiers', []),
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
    return normalizeStringList(readConfig(name, fallback));
  } catch (error) {
    print('Kwindow-spread: failed to read ' + name + ': ' + error);
    return fallback.slice();
  }
}

function normalizeStringList(value) {
  if (Array.isArray(value))
    return value.map(String).map(trimString).filter(Boolean);

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(trimString)
      .filter(Boolean);
  }

  return [];
}

function trimString(value) {
  return String(value).trim();
}

function connectWorkspaceSignal(names, handler) {
  for (var index = 0; index < names.length; index++) {
    var signal = workspace[names[index]];
    if (signal && typeof signal.connect === 'function') {
      signal.connect(handler);
      return true;
    }
  }

  return false;
}

function getAllWindows() {
  if (typeof workspace.windowList === 'function')
    return workspace.windowList();

  if (typeof workspace.clientList === 'function')
    return workspace.clientList();

  if (Array.isArray(workspace.windows))
    return workspace.windows;

  return [];
}

function getCurrentDesktop() {
  return workspace.currentDesktop || workspace.activeDesktop || null;
}

function getWindowDesktop(window) {
  if (!window)
    return null;

  if (window.desktops && typeof window.desktops.length === 'number' && window.desktops.length > 0)
    return window.desktops[0];

  return window.desktop || lastDesktopByWindow.get(window) || null;
}

function setWindowDesktop(window, desktop) {
  if (!window || !desktop)
    return;

  var desktopsProperty = window.desktops && (Array.isArray(window.desktops)
    || typeof window.desktops.length === 'number'
    || Object.prototype.hasOwnProperty.call(window, 'desktops'));

  if (desktopsProperty)
    window.desktops = [desktop];
  else
    window.desktop = desktop;

  lastDesktopByWindow.set(window, desktop);
}

function getDesktops() {
  if (workspace.desktops && typeof workspace.desktops.length === 'number')
    return workspace.desktops;

  if (typeof workspace.desktops === 'function')
    return workspace.desktops();

  return [];
}

function activateDesktop(desktop) {
  if (!desktop)
    return;

  if (Object.prototype.hasOwnProperty.call(workspace, 'currentDesktop'))
    workspace.currentDesktop = desktop;
  else
    workspace.activeDesktop = desktop;
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
  if (!config.createVirtualDesktops || typeof workspace.createDesktop !== 'function')
    return null;

  var name = 'Desktop ' + (index + 1);
  try {
    workspace.createDesktop(index, name);
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

function recordFocus(window) {
  if (!shouldTreatAsNormalWindow(toRuleWindow(window)))
    return;

  removeFromFocusMru(window);
  focusMru.unshift(window);
  if (focusMru.length > 16)
    focusMru.length = 16;
}

function removeFromFocusMru(window) {
  var index = focusMru.indexOf(window);
  if (index >= 0)
    focusMru.splice(index, 1);
}

function getPreviousFocusWindow() {
  for (var index = 0; index < focusMru.length; index++) {
    var window = focusMru[index];
    if (window && getAllWindows().indexOf(window) >= 0)
      return window;
  }

  return null;
}

function restoreFocus(context) {
  if (context && context.desktop)
    activateDesktop(context.desktop);

  if (context && context.focusWindow && getAllWindows().indexOf(context.focusWindow) >= 0)
    activateWindow(context.focusWindow);
}

var activeTimers = [];

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

  timer.stop();
  var index = activeTimers.indexOf(timer);
  if (index >= 0)
    activeTimers.splice(index, 1);
}

function scheduleMove(window, context) {
  var previous = pendingMoves.get(window);
  if (previous)
    cancelTimer(previous.timer);

  var token = previous ? previous.token + 1 : 1;
  var timer = scheduleTimer(function () {
    if (!pendingMoves.has(window) || pendingMoves.get(window).token !== token)
      return;

    pendingMoves.delete(window);
    moveWindow(window, context);
  }, WINDOW_CREATED_DELAY_MS);

  pendingMoves.set(window, { token: token, timer: timer });
}

function cancelScheduledMove(window) {
  var previous = pendingMoves.get(window);
  if (previous)
    cancelTimer(previous.timer);

  pendingMoves.delete(window);
}

function moveWindow(window, context) {
  var normalizedWindow = toRuleWindow(window);
  if (!shouldTreatAsNormalWindow(normalizedWindow))
    return;

  var desktops = getDesktops();
  var decision = getPlacementDecision({
    window: normalizedWindow,
    desktops: desktops,
    windows: getAllWindows().filter(function (otherWindow) {
      return otherWindow !== window;
    }).map(toRuleWindow),
    sourceDesktop: context.desktop,
    rules: config.rules,
    canCreateDesktop: config.createVirtualDesktops && typeof workspace.createDesktop === 'function',
  });

  if (decision.kind === 'ignore')
    return;

  var targetDesktop = decision.targetDesktop || null;
  if (decision.kind === 'create-and-move')
    targetDesktop = createDesktopAt(decision.insertIndex);

  if (targetDesktop && getWindowDesktop(window) !== targetDesktop)
    setWindowDesktop(window, targetDesktop);

  if (config.keepCurrentFocus) {
    restoreFocus(context);
    return;
  }

  if (decision.kind === 'stay' && decision.reason === 'source-workspace-window')
    return;

  activateWindow(window);
}

function scheduleEmptyDesktopCleanup(emptyDesktop, restorePreviousFocus) {
  scheduleTimer(function () {
    cleanupEmptyDesktop(emptyDesktop, restorePreviousFocus);
  }, WINDOW_CLOSED_DELAY_MS);
}

function cleanupEmptyDesktop(emptyDesktop, restorePreviousFocus) {
  if (!config.removeEmptyVirtualDesktops)
    return;

  var previousWindow = restorePreviousFocus ? getPreviousFocusWindow() : null;
  if (previousWindow) {
    activateWindow(previousWindow);
    removeDesktopIfStillEmpty(emptyDesktop);
    return;
  }

  var decision = getEmptyDesktopCleanupDecision({
    emptyDesktop: emptyDesktop,
    activeDesktop: getCurrentDesktop(),
    desktops: getDesktops(),
    windows: getAllWindows().map(toRuleWindow),
  });

  if (decision.kind === 'activate-and-remove')
    activateDesktop(decision.targetDesktop);

  if (decision.kind === 'activate-and-remove' || decision.kind === 'remove')
    removeDesktopIfStillEmpty(decision.removeDesktop);
}

function removeDesktopIfStillEmpty(desktop) {
  var windows = getAllWindows().map(toRuleWindow);
  if (!desktopHasNormalWindow(desktop, windows, null))
    removeDesktop(desktop);
}

function onWindowAdded(window) {
  if (!window)
    return;

  trackWindow(window);
  scheduleMove(window, {
    desktop: getCurrentDesktop(),
    focusWindow: workspace.activeWindow || null,
  });
}

function onWindowRemoved(window) {
  if (!window || !connectedWindows.has(window))
    return;

  var emptyDesktop = lastDesktopByWindow.get(window) || getWindowDesktop(window);
  var restorePreviousFocus = focusMru[0] === window || workspace.activeWindow === window;
  removeFromFocusMru(window);
  cancelScheduledMove(window);
  connectedWindows.delete(window);
  lastDesktopByWindow.delete(window);
  scheduleEmptyDesktopCleanup(emptyDesktop, restorePreviousFocus);
}

function trackWindow(window) {
  if (!window || connectedWindows.has(window))
    return;

  lastDesktopByWindow.set(window, getWindowDesktop(window));
  connectedWindows.add(window);

  if (window.desktopsChanged && typeof window.desktopsChanged.connect === 'function') {
    window.desktopsChanged.connect(function () {
      lastDesktopByWindow.set(window, getWindowDesktop(window));
    });
  }

  if (window.desktopChanged && typeof window.desktopChanged.connect === 'function') {
    window.desktopChanged.connect(function () {
      lastDesktopByWindow.set(window, getWindowDesktop(window));
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
    role: stringProperty(window, ['windowRole', 'role', 'wmWindowRole']),
    title: stringProperty(window, ['caption', 'title', 'windowTitle']),
    resourceClass: stringProperty(window, ['resourceClass', 'wmClass']),
    resourceName: stringProperty(window, ['resourceName', 'wmClassInstance']),
    appId: stringProperty(window, ['desktopFileName', 'appId']),
    desktop: desktop,
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

function getPlacementDecision(args) {
  var window = args.window;
  if (!shouldTreatAsNormalWindow(window))
    return { kind: 'ignore', reason: 'not-normal-window' };

  var rules = mergeRules(DEFAULT_RULES, args.rules);

  if (shouldStayOnSourceDesktop(window, rules))
    return { kind: 'stay', reason: 'source-workspace-window' };

  var sameGroupDesktop = getSameGroupDesktop(window, args.windows, rules);
  if (sameGroupDesktop)
    return { kind: 'move', targetDesktop: sameGroupDesktop, reason: 'same-group' };

  var lastNonEmptyIndex = getLastNonEmptyDesktopIndex(args.desktops, args.windows, window);
  if (lastNonEmptyIndex < 0)
    return { kind: 'stay', reason: 'no-non-empty-desktop' };

  var targetIndex = lastNonEmptyIndex + 1;
  if (targetIndex < args.desktops.length)
    return { kind: 'move', targetDesktop: args.desktops[targetIndex], reason: 'next-after-last-non-empty' };

  if (args.canCreateDesktop)
    return { kind: 'create-and-move', insertIndex: targetIndex, reason: 'next-after-last-non-empty' };

  return {
    kind: 'move',
    targetDesktop: args.desktops[args.desktops.length - 1] || args.sourceDesktop,
    reason: 'next-after-last-non-empty',
  };
}

function getEmptyDesktopCleanupDecision(args) {
  if (!args.emptyDesktop)
    return { kind: 'none', reason: 'missing-empty-desktop' };

  if (desktopHasNormalWindow(args.emptyDesktop, args.windows, null))
    return { kind: 'none', reason: 'desktop-not-empty' };

  if (args.emptyDesktop !== args.activeDesktop)
    return { kind: 'remove', removeDesktop: args.emptyDesktop };

  var emptyIndex = args.desktops.indexOf(args.emptyDesktop);
  var targetDesktop = getNearestNonEmptyDesktop(args.desktops, args.windows, emptyIndex);
  if (!targetDesktop)
    return { kind: 'none', reason: 'no-non-empty-desktop' };

  return {
    kind: 'activate-and-remove',
    targetDesktop: targetDesktop,
    removeDesktop: args.emptyDesktop,
  };
}

function mergeRules(defaultRules, configuredRules) {
  configuredRules = configuredRules || {};
  return {
    auxiliaryDialogTitles: mergeStringArrays(defaultRules.auxiliaryDialogTitles, configuredRules.auxiliaryDialogTitles),
    auxiliaryRoles: mergeStringArrays(defaultRules.auxiliaryRoles, configuredRules.auxiliaryRoles),
    portalIdentifiers: mergeStringArrays(defaultRules.portalIdentifiers, configuredRules.portalIdentifiers),
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
  return isPortalWindow(window, rules) || hasAuxiliaryDialogRoleOrTitle(window, rules);
}

function isPortalWindow(window, rules) {
  return matchesPatterns(getWindowIdentifiers(window), compilePatterns(rules.portalIdentifiers));
}

function hasAuxiliaryDialogRoleOrTitle(window, rules) {
  if (window.role && matchesPatterns([window.role], compilePatterns(rules.auxiliaryRoles)))
    return true;

  return matchesPatterns([window.title || ''], compilePatterns(rules.auxiliaryDialogTitles));
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

    return window.desktop === desktop && shouldTreatAsNormalWindow(window);
  });
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

function wildcardToRegex(pattern) {
  var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
}

connectWorkspaceSignal(['windowAdded', 'clientAdded'], onWindowAdded);
connectWorkspaceSignal(['windowRemoved', 'clientRemoved'], onWindowRemoved);
connectWorkspaceSignal(['windowActivated', 'clientActivated'], recordFocus);

getAllWindows().forEach(trackWindow);
recordFocus(workspace.activeWindow || null);
