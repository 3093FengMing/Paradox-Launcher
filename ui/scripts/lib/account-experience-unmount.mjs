export async function checkUnmount(context) {
  const { assert, resolve, loadApp, hookHost, deferred, uiRoot, originalAccounts, prompt } =
    context;
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
}
