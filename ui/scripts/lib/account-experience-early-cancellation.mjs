export async function checkEarlyCancellation(context) {
  const { assert, resolve, loadApp, hookHost, deferred, uiRoot, originalAccounts, prompt } =
    context;
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
}
