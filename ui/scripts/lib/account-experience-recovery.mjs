export async function checkRecovery(context) {
  const { assert, resolve, loadApp, hookHost, deferred, uiRoot, originalAccounts, prompt } =
    context;
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
}
