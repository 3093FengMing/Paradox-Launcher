export async function checkLateCancellation(context) {
  const { assert, resolve, loadApp, hookHost, deferred, uiRoot, originalAccounts, prompt } =
    context;
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
}
