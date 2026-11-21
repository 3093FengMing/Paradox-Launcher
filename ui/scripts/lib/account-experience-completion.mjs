export async function checkCompletion(context) {
  const { assert, originalAccounts, prompt, fixture } = context;
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
}
