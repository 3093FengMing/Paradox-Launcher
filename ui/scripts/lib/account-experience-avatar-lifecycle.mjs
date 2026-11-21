export async function checkAvatarLifecycle(context) {
  const { assert, resolve, loadApp, hookHost, deferred, uiRoot } = context;
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
      useAccountAvatar({
        id: 'removed',
        skin_url: 'https://textures.minecraft.net/texture/removed',
      }),
    );
    await host.settle();
    host.unmount();
    held.resolve('late-image');
    await host.settle();
    assert.equal(host.updatesAfterUnmount, 0, 'an avatar response after unmount must be ignored');
  }
}
