// Run with: node ui/scripts/check-log-preferences.mjs
// Real Hook behavior with controlled IPC completion; no network or sleeps.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { deferred, hookHost, initialConfig, loadApp, uiRoot } from './hook-test-host.mjs';

async function fixture({
  preferences = {},
  holdBootstrap = false,
  holdWrites = false,
  holdSubscription = false,
} = {}) {
  const host = hookHost();
  const configReads = [];
  const historyReads = [];
  const clears = [];
  const writes = [];
  const notifications = [];
  const subscription = deferred();
  let logSequence = 0;
  const server = { config: structuredClone(initialConfig), config_path: 'preferences.json' };
  Object.assign(server.config.settings.personalization, preferences);
  let emitActivity;
  let emitLog;
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          getConfig: () => {
            const response = deferred();
            const snapshot = structuredClone(server);
            configReads.push({ ...response, finish: () => response.resolve(snapshot) });
            if (configReads.length === 1 && !holdBootstrap) response.resolve(snapshot);
            return response.promise;
          },
          saveConfig: (config) => {
            const response = deferred();
            const snapshot = structuredClone(config);
            const write = {
              ...response,
              finish: () => {
                server.config = snapshot;
                response.resolve(structuredClone(snapshot));
              },
            };
            writes.push(write);
            if (!holdWrites) write.finish();
            return response.promise;
          },
          inspectInstances: async () => [],
          subscribe: async (onActivity, onLog) => {
            if (holdSubscription) await subscription.promise;
            emitActivity = onActivity;
            emitLog = onLog;
            return () => {};
          },
          storedLogs: () => {
            const response = deferred();
            historyReads.push(response);
            return response.promise;
          },
          clearStoredLogs: () => {
            const response = deferred();
            clears.push({
              ...response,
              resolve: (boundary = { session: 'current-session', sequence: String(logSequence) }) =>
                response.resolve(boundary),
            });
            return response.promise;
          },
        },
      ],
    ]),
    {
      onNotice: (notice) =>
        notifications.push({ error: notice.kind === 'error', message: notice.message }),
    },
  );
  const { useLauncher } = app('hooks/useLauncher.ts');
  host.mount(useLauncher);
  const launcher = await host.settle();
  return {
    host,
    launcher,
    server,
    configReads,
    historyReads,
    clears,
    writes,
    notifications,
    clock: app.noticeClock,
    subscription,
    emitActivity: (event) => emitActivity(event),
    emitLog: (event) => {
      const record = {
        time: 1704067200,
        id: { session: 'current-session', sequence: String(++logSequence) },
        ...event,
      };
      emitLog(record);
      return record;
    },
  };
}

function patchPreferences(launcher, patch) {
  launcher.patchSettings('personalization', { ...launcher.draft.personalization, ...patch });
}

function stored(message, time = 1704067200) {
  return { level: 'info', message, time };
}

function messages(launcher) {
  return launcher.logs.map((line) => line.message);
}

export function createContext() {
  return { assert, test, fixture, patchPreferences, stored, messages };
}
