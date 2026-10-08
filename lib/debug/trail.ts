"use client";

/**
 * A black box for freezes that lock the whole tab (DevTools can't save a trace then). Off unless this browser has
 * `localStorage["angler:debug"] = "1"`. Once a second, and on every request and socket, it writes the last moments to
 * `localStorage["angler:debug:trail"]`: memory, page size, open sockets, active timers, listeners added, requests in
 * flight and the market shown. After a freeze, reopen the tab and read that key. Request paths only: query strings
 * (wallet addresses) are never recorded, and nothing leaves the browser.
 */

const KEY = "angler:debug:trail";
const MAX_ENTRIES = 90;

type Entry = Record<string, unknown>;

export function startTrail() {
  const started = performance.now();
  const entries: Entry[] = [];
  let pending = 0;
  let sockets = 0;
  let timers = 0;
  const listeners = new Map<string, number>();
  const recentRequests: string[] = [];
  let longTasks: number[] = [];

  const write = (entry: Entry) => {
    entries.push({ s: Math.round((performance.now() - started) / 100) / 10, ...entry });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {}
  };

  const pathOf = (input: RequestInfo | URL) => {
    try {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      return url.host === location.host ? url.pathname : `${url.host}${url.pathname}`;
    } catch {
      return "?";
    }
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    pending += 1;
    recentRequests.push(path);
    if (recentRequests.length > 12) recentRequests.shift();
    write({ fetch: path, pending });
    return nativeFetch(input, init).finally(() => {
      pending -= 1;
    });
  };

  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      sockets += 1;
      write({ socket: pathOf(url), sockets });
      this.addEventListener("close", () => {
        sockets -= 1;
      });
    }
  } as typeof WebSocket;

  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    timers += 1;
    return nativeSetInterval(handler, timeout, ...args);
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) timers -= 1;
    nativeClearInterval(id);
  }) as typeof window.clearInterval;

  const nativeAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type: string, ...rest: unknown[]) {
    listeners.set(type, (listeners.get(type) ?? 0) + 1);
    return (nativeAdd as (...args: unknown[]) => void).call(this, type, ...rest);
  };

  try {
    new PerformanceObserver((list) => {
      for (const task of list.getEntries()) longTasks.push(Math.round(task.duration));
    }).observe({ type: "longtask" });
  } catch {}

  const tick = () => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const topListeners = [...listeners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    write({
      heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
      dom: document.getElementsByTagName("*").length,
      market: document.querySelector('button[aria-label*="Search markets"]')?.getAttribute("aria-label")?.replace(". Search markets", "") ?? null,
      page: location.pathname,
      pending,
      sockets,
      timers,
      listeners: Object.fromEntries(topListeners),
      longTasksMs: longTasks,
      recent: recentRequests.slice(-6),
    });
    longTasks = [];
  };
  tick();
  nativeSetInterval(tick, 1000);
}
