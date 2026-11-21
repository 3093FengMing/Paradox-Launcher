const scriptUrl = new URL('../check-account-experience.mjs', import.meta.url);
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadApp, hookHost, deferred, uiRoot } from './hook-test-host.mjs';
const require = createRequire(new URL('../package.json', scriptUrl));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { I18nextProvider } = require('react-i18next');

const originalAccounts = {
  client_id: '7fd2b4de-f119-4ab8-8d8e-906af5efe6f3',
  active: null,
  accounts: [],
};
const prompt = {
  id: 'account-experience-login',
  user_code: 'TEST-CODE',
  verification_uri: 'https://www.microsoft.com/link',
  expires_at: 2000000000,
};

async function fixture() {
  const host = hookHost();
  const completion = deferred();
  let cancellation = deferred();
  let cancelCalls = 0;
  const errors = [];
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountState: async () => originalAccounts,
          accountRecovery: async () => [],
          beginLogin: async () => prompt,
          completeLogin: () => completion.promise,
          cancelLogin: () => {
            cancelCalls++;
            return cancellation.promise;
          },
        },
      ],
    ]),
  );
  const { useAccounts } = app('hooks/useAccounts.ts');
  const onError = (error) => errors.push(error);
  host.mount(() => useAccounts(onError));
  let accounts = await host.settle();
  const login = accounts.login();
  accounts = await host.settle();
  return {
    host,
    completion,
    login,
    errors,
    get cancellation() {
      return cancellation;
    },
    retryCancellation() {
      cancellation = deferred();
    },
    get cancelCalls() {
      return cancelCalls;
    },
  };
}

export function createContext() {
  return {
    assert,
    resolve,
    loadApp,
    hookHost,
    deferred,
    uiRoot,
    React,
    renderToStaticMarkup,
    I18nextProvider,
    originalAccounts,
    prompt,
    fixture,
  };
}
