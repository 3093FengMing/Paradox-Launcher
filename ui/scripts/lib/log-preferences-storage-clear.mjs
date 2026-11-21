export async function checkStorageClear(context) {
  const { assert, test, fixture, stored, messages } = context;
  await test('clear waits for real storage success and then removes existing memory logs', async () => {
    const f = await fixture();
    f.emitLog({ level: 'info', message: 'clear me' });
    const launcher = await f.host.settle();
    const clearing = launcher.clearLogs();
    assert.equal(f.clears.length, 1, 'clear must call storage even when retention is disabled');
    assert.ok(clearing instanceof Promise, 'clear exposes completion to its caller');
    assert.deepEqual(
      messages(await f.host.settle()),
      ['clear me'],
      'failed storage must not be disguised as a successful clear',
    );
    f.clears[0].resolve();
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), []);
  });

  await test('clear failure reports the error and preserves logs for retry', async () => {
    const f = await fixture({ preferences: { notifications: false } });
    f.emitLog({ level: 'info', message: 'keep me' });
    const clearing = (await f.host.settle()).clearLogs();
    assert.equal(f.clears.length, 1);
    f.clears[0].reject(new Error('cannot clear storage'));
    await clearing;
    const launcher = await f.host.settle();
    assert.deepEqual(messages(launcher), ['keep me', 'cannot clear storage']);
    assert.deepEqual(f.notifications, [{ error: true, message: 'cannot clear storage' }]);
  });

  await test('a late startup history response cannot restore cleared logs', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    assert.equal(f.historyReads.length, 1);
    f.emitLog({ level: 'info', message: 'old live' });
    const clearing = (await f.host.settle()).clearLogs();
    assert.equal(f.clears.length, 1);
    f.clears[0].resolve();
    await clearing;
    f.emitLog({ level: 'info', message: 'new live' });
    f.historyReads[0].resolve([stored('stale history')]);
    assert.deepEqual(messages(await f.host.settle()), ['new live']);
  });

  for (const outcome of ['success', 'failure']) {
    await test(`unmount ignores a late clear ${outcome}`, async () => {
      const f = await fixture();
      const clearing = f.launcher.clearLogs();
      assert.equal(f.clears.length, 1);
      f.host.unmount();
      if (outcome === 'success') f.clears[0].resolve();
      else f.clears[0].reject(new Error('obsolete clear'));
      await clearing;
      assert.equal(f.host.updatesAfterUnmount, 0);
      assert.deepEqual(f.notifications, []);
    });
  }
}
