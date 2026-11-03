import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadApp, hookHost, deferred, uiRoot } from './lib/hook-test-host.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
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

{
  const host = hookHost();
  const completion = deferred();
  const recoveryRead = deferred();
  const cleanup = deferred();
  const errors = [];
  let reads = 0;
  let clears = 0;
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountState: async () => originalAccounts,
          accountRecovery: () =>
            ++reads === 1 ? Promise.resolve(['prior-orphan']) : recoveryRead.promise,
          beginLogin: async (id) => ({ ...prompt, id }),
          completeLogin: () => completion.promise,
          clearAccountRecovery: (id) => {
            assert.equal(id, 'new-orphan');
            clears++;
            return cleanup.promise;
          },
        },
      ],
    ]),
  );
  const { useAccounts } = app('hooks/useAccounts.ts');
  const onError = (error) => errors.push(error);
  host.mount(() => useAccounts(onError));
  let accounts = await host.settle();
  assert.deepEqual(
    accounts.recovery,
    ['prior-orphan'],
    'cross-process orphan credentials must be visible after loading',
  );
  const login = accounts.login();
  await host.settle();
  completion.reject('auth.errors.rollback');
  accounts = await host.settle();
  assert.equal(
    accounts.pending,
    true,
    'a failed login must finish reading recovery before releasing the operation',
  );
  recoveryRead.resolve(['prior-orphan', 'new-orphan']);
  assert.equal(await login, false);
  accounts = await host.settle();
  assert.deepEqual(accounts.recovery, ['prior-orphan', 'new-orphan']);
  assert.deepEqual(errors, ['auth.errors.rollback']);
  const clearing = accounts.clearRecovery('new-orphan');
  accounts = await host.settle();
  assert.equal(accounts.pending, true);
  await accounts.clearRecovery('new-orphan');
  assert.equal(clears, 1, 'rapid cleanup clicks must serialize the credential mutation');
  assert.deepEqual(
    accounts.recovery,
    ['prior-orphan', 'new-orphan'],
    'recovery remains visible until the vault acknowledges cleanup',
  );
  cleanup.resolve(['prior-orphan']);
  assert.equal(await clearing, true);
  accounts = await host.settle();
  assert.deepEqual(accounts.recovery, ['prior-orphan']);
  assert.equal(accounts.pending, false);
  assert.equal(
    accounts.state,
    originalAccounts,
    'orphan cleanup must not change the selected launch identity',
  );
}

for (const outcome of ['cancelled', 'network', 'successful']) {
  const host = hookHost();
  const beginning = deferred();
  const cancellation = deferred();
  const completing = deferred();
  const errors = [];
  let requestId;
  let cancelCalls = 0;
  let completeCalls = 0;
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountState: async () => originalAccounts,
          accountRecovery: async () => [],
          beginLogin: (id) => {
            requestId = id;
            return beginning.promise;
          },
          completeLogin: () => {
            completeCalls++;
            return completing.promise;
          },
          cancelLogin: (id) => {
            assert.equal(id, requestId);
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
  assert.equal(
    typeof requestId,
    'string',
    'the client must assign identity before requesting a device code',
  );
  assert.equal(accounts.pending, true);
  assert.equal(accounts.loginPending, true);
  assert.equal(accounts.prompt, null);
  const cancel = accounts.cancel();
  accounts = await host.settle();
  assert.equal(
    accounts.cancelling,
    true,
    'requesting the device code must be cancellable before a prompt arrives',
  );
  assert.equal(cancelCalls, 1);
  cancellation.resolve();
  await cancel;
  accounts = await host.settle();
  assert.equal(
    accounts.pending,
    true,
    'begin cancellation acknowledgment must await the final begin result',
  );
  assert.equal(accounts.cancelling, true);
  if (outcome === 'successful') {
    beginning.resolve({ ...prompt, id: requestId });
    accounts = await host.settle();
    assert.equal(accounts.cancelling, true);
    completing.reject('auth.errors.cancelled');
  } else beginning.reject(`auth.errors.${outcome}`);
  assert.equal(await login, false);
  accounts = await host.settle();
  assert.equal(accounts.pending, false);
  assert.equal(accounts.loginPending, false);
  assert.equal(accounts.cancelling, false);
  assert.equal(accounts.prompt, null);
  assert.equal(completeCalls, outcome === 'successful' ? 1 : 0);
  assert.deepEqual(errors, outcome === 'network' ? ['auth.errors.network'] : []);
}

for (const stage of ['begin', 'complete']) {
  const host = hookHost();
  const beginning = deferred();
  const completing = deferred();
  let requestId;
  let cancelCalls = 0;
  let completeCalls = 0;
  const errors = [];
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountState: async () => originalAccounts,
          accountRecovery: async () => [],
          beginLogin: (id) => {
            requestId = id;
            return beginning.promise;
          },
          completeLogin: () => {
            completeCalls++;
            return completing.promise;
          },
          cancelLogin: async (id) => {
            assert.equal(id, requestId);
            cancelCalls++;
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
  await host.settle();
  if (stage === 'complete') {
    beginning.resolve({ ...prompt, id: requestId });
    await host.settle();
  }
  host.unmount();
  assert.equal(
    cancelCalls,
    1,
    `${stage}: unmount must cancel the backend request even before a prompt is available`,
  );
  if (stage === 'begin') beginning.resolve({ ...prompt, id: requestId });
  else completing.reject('auth.errors.cancelled');
  assert.equal(await login, false);
  await host.settle();
  assert.equal(
    completeCalls,
    stage === 'complete' ? 1 : 0,
    'a late device-code response after unmount cannot start polling',
  );
  assert.equal(host.updatesAfterUnmount, 0);
  assert.deepEqual(errors, []);
}

for (const repeatedCancellation of ['successful', 'failed']) {
  const host = hookHost();
  const beginning = deferred();
  const firstCancel = deferred();
  const secondCancel = deferred();
  const retryCancel = deferred();
  const completing = deferred();
  let requestId;
  let cancelCalls = 0;
  let completeCalls = 0;
  const errors = [];
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountState: async () => originalAccounts,
          accountRecovery: async () => [],
          beginLogin: (id) => {
            requestId = id;
            return beginning.promise;
          },
          completeLogin: () => {
            completeCalls++;
            return completing.promise;
          },
          cancelLogin: (id) => {
            assert.equal(id, requestId);
            cancelCalls++;
            return [firstCancel, secondCancel, retryCancel][cancelCalls - 1].promise;
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
  await host.settle();
  const earlyCancel = accounts.cancel();
  firstCancel.resolve();
  await earlyCancel;
  beginning.resolve({ ...prompt, id: requestId });
  accounts = await host.settle();
  assert.equal(
    cancelCalls,
    2,
    'a device code arriving after early cancellation must be cancelled again before polling',
  );
  assert.equal(completeCalls, 0, 'polling must wait for the second cancellation acknowledgement');
  assert.equal(accounts.cancelling, true);
  assert.equal(
    accounts.prompt,
    null,
    'a late prompt cannot expose authorization controls before cancellation acknowledgement',
  );
  if (repeatedCancellation === 'successful') secondCancel.resolve();
  else secondCancel.reject('auth.errors.network');
  accounts = await host.settle();
  assert.equal(completeCalls, 1, 'the final completion result owns the remaining login state');
  assert.equal(accounts.pending, true);
  assert.equal(accounts.cancelling, repeatedCancellation === 'successful');
  assert.deepEqual(errors, repeatedCancellation === 'failed' ? ['auth.errors.network'] : []);
  let retry;
  if (repeatedCancellation === 'failed') {
    retry = accounts.cancel();
    accounts = await host.settle();
    assert.equal(
      cancelCalls,
      3,
      'failed repeat cancellation must allow retry while final completion remains pending',
    );
    assert.equal(accounts.cancelling, true);
  }
  completing.reject('auth.errors.cancelled');
  assert.equal(await login, false);
  accounts = await host.settle();
  assert.equal(accounts.pending, false);
  assert.equal(accounts.cancelling, false);
  assert.equal(accounts.prompt, null);
  if (retry) {
    retryCancel.reject('auth.errors.service');
    await retry;
    assert.deepEqual(
      errors,
      ['auth.errors.network'],
      'late retry failure must not replace the completed cancellation',
    );
  }
}

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

{
  const f = await fixture();
  let accounts = await f.host.settle();
  const cancellation = accounts.cancel();
  accounts = await f.host.settle();
  assert.equal(accounts.cancelling, true, 'the UI must show cancellation while IPC is held');
  f.cancellation.resolve();
  await cancellation;
  accounts = await f.host.settle();
  assert.equal(
    accounts.cancelling,
    true,
    'cancellation acknowledgment must keep the cancelling UI until rollback completes',
  );
  await accounts.cancel();
  assert.equal(
    f.cancelCalls,
    1,
    'an acknowledged cancellation must not issue another request before the final result',
  );
  f.completion.reject('auth.errors.cancelled');
  assert.equal(await f.login, false);
  accounts = await f.host.settle();
  assert.equal(accounts.cancelling, false);
  assert.equal(accounts.pending, false);
  assert.equal(accounts.prompt, null);
  assert.deepEqual(f.errors, []);
}

{
  const f = await fixture();
  let accounts = await f.host.settle();
  const cancellation = accounts.cancel();
  f.cancellation.reject('auth.errors.network');
  await cancellation;
  accounts = await f.host.settle();
  assert.equal(accounts.cancelling, false, 'failed cancellation must restore the retry control');
  assert.equal(accounts.pending, true);
  assert.equal(accounts.prompt.id, prompt.id);
  assert.deepEqual(f.errors, ['auth.errors.network']);
  f.retryCancellation();
  const retry = accounts.cancel();
  accounts = await f.host.settle();
  assert.equal(accounts.cancelling, true);
  f.completion.resolve({ ...originalAccounts, active: 'complete-account' });
  assert.equal(await f.login, true);
  accounts = await f.host.settle();
  assert.equal(
    accounts.cancelling,
    false,
    'completion owns the final state even before cancel acknowledgment',
  );
  f.cancellation.reject('auth.errors.service');
  await retry;
  accounts = await f.host.settle();
  assert.equal(accounts.state.active, 'complete-account');
  assert.equal(accounts.cancelling, false);
  assert.deepEqual(f.errors, ['auth.errors.network']);
}

{
  const host = hookHost();
  const first = deferred();
  const second = deferred();
  const apiCalls = [];
  const rendererCalls = [];
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountSkin: (id) => {
            apiCalls.push(id);
            return id === 'first' ? first.promise : second.promise;
          },
        },
      ],
      [
        resolve(uiRoot, 'src/lib/account-avatar.ts'),
        {
          createAccountAvatar: async (skin) => {
            rendererCalls.push(skin);
            if (skin === 'invalid-image') throw new Error('invalid image');
            return `avatar:${skin}`;
          },
        },
      ],
    ]),
  );
  const { useAvatarCache } = app('launcher/controllers/avatars.ts');
  const avatarServices = {
    api: { ...app('api.ts'), desktop: true },
    accounts: {
      state: { accounts: [] },
      getLaunchState() {
        return { state: this.state };
      },
    },
  };
  const useAccountAvatar = (account) => {
    avatarServices.accounts.state = { accounts: account ? [account] : [] };
    const cache = useAvatarCache(avatarServices);
    return account ? (cache[account.id] ?? null) : null;
  };
  let changeAccount;
  host.mount(() => {
    const [account, setAccount] = host.hooks.useState({
      id: 'first',
      skin_url: 'https://textures.minecraft.net/texture/first',
    });
    changeAccount = setAccount;
    return useAccountAvatar(account);
  });
  assert.equal(await host.settle(), null);
  changeAccount({ id: 'second', skin_url: 'https://textures.minecraft.net/texture/second' });
  assert.equal(await host.settle(), null);
  first.resolve('old-image');
  await host.settle();
  assert.equal(await host.settle(), null);
  second.resolve('new-image');
  assert.equal(
    await host.settle(),
    'avatar:new-image',
    'a late old skin must not replace the current account avatar',
  );
  assert.deepEqual(apiCalls, ['first', 'second']);
  assert.ok(rendererCalls.includes('new-image'));
  changeAccount(null);
  assert.equal(
    await host.settle(),
    null,
    'offline identity must not retain the previous online avatar',
  );
  host.unmount();
  await host.settle();
  assert.equal(host.updatesAfterUnmount, 0);
}

for (const response of [null, 'invalid-image']) {
  const host = hookHost();
  const held = deferred();
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [resolve(uiRoot, 'src/api.ts'), { accountSkin: () => held.promise }],
      [
        resolve(uiRoot, 'src/lib/account-avatar.ts'),
        {
          createAccountAvatar: async () => {
            throw new Error('invalid image');
          },
        },
      ],
    ]),
  );
  const { useAvatarCache } = app('launcher/controllers/avatars.ts');
  const avatarServices = {
    api: { ...app('api.ts'), desktop: true },
    accounts: {
      state: { accounts: [] },
      getLaunchState() {
        return { state: this.state };
      },
    },
  };
  const useAccountAvatar = (account) => {
    avatarServices.accounts.state = { accounts: account ? [account] : [] };
    const cache = useAvatarCache(avatarServices);
    return account ? (cache[account.id] ?? null) : null;
  };
  host.mount(() =>
    useAccountAvatar({ id: 'broken', skin_url: 'https://textures.minecraft.net/texture/broken' }),
  );
  assert.equal(await host.settle(), null);
  held.resolve(response);
  assert.equal(await host.settle(), null, 'missing or corrupt skin data must keep the fallback');
  host.unmount();
  assert.equal(host.updatesAfterUnmount, 0);
}

{
  const host = hookHost();
  const held = deferred();
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [resolve(uiRoot, 'src/api.ts'), { accountSkin: () => held.promise }],
      [
        resolve(uiRoot, 'src/lib/account-avatar.ts'),
        { createAccountAvatar: async () => 'avatar:late' },
      ],
    ]),
  );
  const { useAvatarCache } = app('launcher/controllers/avatars.ts');
  const avatarServices = {
    api: { ...app('api.ts'), desktop: true },
    accounts: {
      state: { accounts: [] },
      getLaunchState() {
        return { state: this.state };
      },
    },
  };
  const useAccountAvatar = (account) => {
    avatarServices.accounts.state = { accounts: account ? [account] : [] };
    const cache = useAvatarCache(avatarServices);
    return account ? (cache[account.id] ?? null) : null;
  };
  host.mount(() =>
    useAccountAvatar({ id: 'removed', skin_url: 'https://textures.minecraft.net/texture/removed' }),
  );
  await host.settle();
  host.unmount();
  held.resolve('late-image');
  await host.settle();
  assert.equal(host.updatesAfterUnmount, 0, 'an avatar response after unmount must be ignored');
}

{
  const app = loadApp();
  const { createAccountAvatar } = app('lib/account-avatar.ts');
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  let width = 64;
  let height = 64;
  const draws = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (_image, ...coordinates) => draws.push(coordinates) }),
    toDataURL: () => 'data:image/png;base64,YXZhdGFy',
  };
  globalThis.Image = class {
    naturalWidth = width;
    naturalHeight = height;
    set src(_data) {
      queueMicrotask(() => this.onload());
    }
  };
  globalThis.document = { createElement: () => canvas };
  try {
    assert.equal(
      await createAccountAvatar('data:image/png;base64,c2tpbg=='),
      'data:image/png;base64,YXZhdGFy',
    );
    assert.equal(canvas.width, 8);
    assert.equal(canvas.height, 8);
    assert.deepEqual(
      draws,
      [
        [8, 8, 8, 8, 0, 0, 8, 8],
        [40, 8, 8, 8, 0, 0, 8, 8],
      ],
      'compose the face and head overlay instead of showing the entire skin sheet',
    );
    height = 32;
    assert.equal(
      await createAccountAvatar('data:image/png;base64,c2tpbg=='),
      'data:image/png;base64,YXZhdGFy',
    );
    width = 128;
    await assert.rejects(createAccountAvatar('data:image/png;base64,c2tpbg=='), /dimensions/);
    await assert.rejects(
      createAccountAvatar('https://textures.minecraft.net/texture/remote'),
      /cached skin/,
    );
    await assert.rejects(createAccountAvatar('data:text/html;base64,c2tpbg=='), /cached skin/);
  } finally {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  }
}

{
  const app = loadApp(
    new Map([
      [resolve(uiRoot, 'src/components/account-avatar.css'), {}],
      [resolve(uiRoot, 'src/api.ts'), { desktop: true }],
    ]),
  );
  const i18n = app('i18n.ts').default;
  const AccountsPage = app('pages/AccountsPage.tsx').default;
  const AppSidebar = app('components/AppSidebar.tsx').default;
  const contexts = app('launcher/public/context.ts');
  const account = {
    id: 'online-account',
    name: 'OnlinePlayer',
    skin_url: 'https://textures.minecraft.net/texture/private',
  };
  const actions = {
    select: async () => true,
    logout: async () => true,
    reload: async () => true,
    configure: async () => true,
    login: async () => true,
    refresh: async () => true,
    cancelLogin: async () => {},
    openLoginPage: async () => {},
    copyLoginCode: async () => {},
    patchClientId() {},
    beginLogout() {},
    cancelLogout() {},
    confirmLogout: async () => true,
  };
  const props = {
    username: 'OfflinePlayer',
    draftUsername: 'OfflinePlayer',
    busy: false,
    saving: false,
    onUsernameChange: () => {},
    onSave: () => {},
    onError: () => {},
  };
  function render(Component, values) {
    const accounts = values.accounts ?? { state: { accounts: [account] } };
    const snapshot = {
      accounts: {
        clientIdDraft: accounts.state.client_id ?? '',
        removingId: null,
        promptActionPending: null,
        promptExpired: !!accounts.prompt && accounts.prompt.expires_at <= Date.now() / 1000,
        ...accounts,
      },
      config: { value: { settings: { offline_username: 'OfflinePlayer' } } },
      settings: { draft: { offline_username: 'OfflinePlayer' }, saving: false },
      activity: null,
      downloads: { active: false, pending: [] },
      window: { desktop: true },
      avatars: {},
    };
    return renderToStaticMarkup(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(
          contexts.LauncherActionsContext.Provider,
          { value: { accounts: actions, settings: { patch() {} } } },
          React.createElement(
            contexts.LauncherSnapshotContext.Provider,
            { value: snapshot },
            React.createElement(Component, values),
          ),
        ),
      ),
    );
  }
  for (const language of ['en-US', 'zh-CN']) {
    await i18n.changeLanguage(language);
    const state = { ...originalAccounts, active: account.id, accounts: [account] };
    const beginMarkup = render(AccountsPage, {
      ...props,
      accounts: {
        ...actions,
        state,
        recovery: [],
        ready: true,
        loading: false,
        loadError: null,
        pending: true,
        loginPending: true,
        cancelling: false,
        prompt: null,
      },
    });
    const beginButtons = [...beginMarkup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.ok(
      beginButtons.some(
        (match) => !match[1].includes('disabled') && match[2].includes(i18n.t('common.cancel')),
      ),
      'a held device-code request must show a working cancel control',
    );
    const markup = render(AccountsPage, {
      ...props,
      accounts: {
        ...actions,
        state,
        recovery: [],
        ready: true,
        loading: false,
        loadError: null,
        pending: true,
        cancelling: true,
        prompt,
      },
    });
    const buttons = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.ok(
      buttons.some(
        (match) => match[1].includes('disabled') && match[2].includes(i18n.t('auth.cancelling')),
      ),
    );
    assert.ok(
      buttons.some(
        (match) => match[1].includes('disabled') && match[2].includes(i18n.t('auth.copyCode')),
      ),
    );
    assert.ok(!markup.includes(account.skin_url), 'render only locally cached avatar data');
    const expiredMarkup = render(AccountsPage, {
      ...props,
      accounts: {
        ...actions,
        state,
        recovery: [],
        ready: true,
        loading: false,
        loadError: null,
        pending: true,
        cancelling: false,
        prompt: { ...prompt, expires_at: 1 },
      },
    });
    assert.ok(expiredMarkup.includes(i18n.t('auth.codeExpired')));
    const sidebar = render(AppSidebar, {
      routes: app('lib/navigation.ts').builtinRoutes,
      config: { settings: { offline_username: 'OfflinePlayer' }, profiles: [] },
      account,
      page: 'home',
      immersive: true,
      desktop: true,
      hasErrors: false,
      onNavigate: () => {},
    });
    assert.ok(sidebar.includes('OnlinePlayer'));
    assert.ok(sidebar.includes(i18n.t('auth.microsoftIdentity')));
    assert.ok(!sidebar.includes('OfflinePlayer'));
  }
}

console.log(
  'Account experience regression passed: cancellation lifecycle, expired prompt controls, current identity, cached avatar cropping and late response isolation.',
);
