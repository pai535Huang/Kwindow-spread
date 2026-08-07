import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const mainSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'contents', 'code', 'main.js'),
  'utf8',
);

export { mainSource };

export function makeSignal() {
  const handlers = [];
  return {
    connect(handler) {
      handlers.push(handler);
      return this;
    },
    fire(...args) {
      for (const handler of handlers.slice()) handler(...args);
    },
  };
}

export function listLike(items = []) {
  const source = [...items];
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'length') return source.length;
      if (prop === Symbol.iterator) return source[Symbol.iterator].bind(source);
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return source[Number(prop)];
      if (prop in source && typeof source[prop] === 'function') return source[prop].bind(source);
      return undefined;
    },
    set(target, prop, value) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        source[Number(prop)] = value;
        return true;
      }
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      return prop === 'length' || prop in source;
    },
    ownKeys() {
      return ['length', ...source.keys()];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop === 'length') return { value: source.length, writable: false, enumerable: true, configurable: false };
      const index = Number(prop);
      if (!Number.isNaN(index) && index >= 0 && index < source.length) {
        return { value: source[index], writable: true, enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
}

export function makeDesktop(index, name = `Desktop ${index + 1}`) {
  return { index, name };
}

function normalizeDesktopList(value) {
  if (!value || typeof value.length !== 'number') return listLike();

  const desktops = [];
  for (let index = 0; index < value.length; index++) desktops.push(value[index]);
  return listLike(desktops);
}

export function makeWindow(overrides = {}) {
  const window = {
    onAllDesktops: false,
    skipTaskbar: false,
    skipPager: false,
    normalWindow: true,
    transient: false,
    transientFor: null,
    dialog: false,
    modal: false,
    role: '',
    title: '',
    resourceClass: '',
    resourceName: '',
    appId: '',
    desktopFileName: '',
    ...overrides,
    desktopsChanged: overrides.desktopsChanged ?? makeSignal(),
    desktopChanged: overrides.desktopChanged ?? makeSignal(),
    closed: overrides.closed ?? makeSignal(),
  };

  let desktops = normalizeDesktopList(overrides.desktops);
  Object.defineProperty(window, 'desktops', {
    enumerable: true,
    configurable: true,
    get() {
      return desktops;
    },
    set(value) {
      desktops = normalizeDesktopList(value);
      window.desktopsChanged.fire();
    },
  });

  return window;
}

export function ruleWindow(overrides = {}) {
  return {
    normalWindow: true,
    skipTaskbar: false,
    skipPager: false,
    onAllDesktops: false,
    transient: false,
    dialog: false,
    role: '',
    title: '',
    resourceClass: '',
    resourceName: '',
    appId: '',
    desktop: null,
    ...overrides,
  };
}

export function loadScript({ config = {}, windows = [], desktops = [] } = {}) {
  const desktopList = listLike(desktops);
  const currentDesktop = desktops[0] ?? null;
  const workspace = {
    desktops: desktopList,
    currentDesktop,
    activeDesktop: currentDesktop,
    activeWindow: null,
    windows,
    windowList() {
      return this.windows;
    },
    createDesktop(position, name) {
      const desktop = makeDesktop(position, name);
      this.desktops.splice(Math.max(0, Math.min(position, this.desktops.length)), 0, desktop);
      return desktop;
    },
    removeDesktop(desktop) {
      const index = this.desktops.indexOf(desktop);
      if (index >= 0) this.desktops.splice(index, 1);
    },
    windowAdded: makeSignal(),
    windowRemoved: makeSignal(),
    windowActivated: makeSignal(),
    clientAdded: makeSignal(),
    clientRemoved: makeSignal(),
    clientActivated: makeSignal(),
  };

  const timers = [];
  function QTimer() {
    const timer = {
      _callbacks: [],
      singleShot: false,
      interval: 0,
      timeout: {
        connect(callback) {
          timer._callbacks.push(callback);
          return timer.timeout;
        },
      },
      start() {
        timers.push(timer);
      },
      stop() {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      },
      _fire() {
        for (const callback of timer._callbacks.slice()) callback();
      },
    };
    return timer;
  }
  QTimer._timers = timers;
  QTimer.fireNext = () => {
    const timer = timers.shift();
    if (timer) timer._fire();
  };
  QTimer.fireAll = () => {
    while (timers.length > 0) QTimer.fireNext();
  };
  Object.defineProperty(QTimer, 'pending', { get: () => timers.length });

  const printed = [];
  const callDBusCalls = [];
  const sandbox = {
    workspace,
    print(...args) {
      printed.push(args.join(' '));
    },
    readConfig(key, fallback) {
      if (key in config) return config[key];
      if (Array.isArray(fallback)) return undefined;
      return fallback;
    },
    QTimer,
    callDBus(...args) {
      callDBusCalls.push(args);
    },
    console,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(mainSource, context, { filename: 'contents/code/main.js' });

  return {
    context,
    workspace,
    QTimer,
    printed,
    callDBusCalls,
    config,
    loadWindow(window) {
      workspace.windows.push(window);
    },
    unloadWindow(window) {
      const index = workspace.windows.indexOf(window);
      if (index >= 0) workspace.windows.splice(index, 1);
    },
  };
}
