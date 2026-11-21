export async function checkClearLifecycle(context) {
  const { assert, test, fixture, stored, messages } = context;
  await test('a successful clear stays empty when effects reconnect later', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    const clearing = f.launcher.clearLogs();
    f.clears[0].resolve();
    await clearing;
    f.host.reconnectEffects();
    f.configReads[1].finish();
    await f.host.settle();
    f.historyReads[0].resolve([stored('obsolete original snapshot')]);
    f.historyReads[1]?.resolve([stored('obsolete reconnected snapshot')]);
    assert.deepEqual(messages(await f.host.settle()), []);
  });

  await test('concurrent clear requests share storage work and cannot erase logs after completion', async () => {
    const f = await fixture();
    const first = f.launcher.clearLogs();
    const second = f.launcher.clearLogs();
    assert.equal(f.clears.length, 1, 'one pending clear must own the disk operation');
    f.clears[0].resolve();
    await first;
    f.emitLog({ level: 'info', message: 'after clear' });
    await second;
    assert.deepEqual(messages(await f.host.settle()), ['after clear']);
    const third = f.launcher.clearLogs();
    assert.equal(f.clears.length, 2, 'completion must release a later deliberate clear');
    f.clears[1].resolve();
    await third;
    assert.deepEqual(messages(await f.host.settle()), []);
  });

  await test('history started during a pending clear cannot restore logs after storage succeeds', async () => {
    const f = await fixture({ preferences: { retain_logs: true }, holdBootstrap: true });
    const clearing = f.launcher.clearLogs();
    f.configReads[0].finish();
    await f.host.settle();
    assert.equal(f.historyReads.length, 1);
    f.clears[0].resolve();
    await clearing;
    f.historyReads[0].resolve([stored('read during clear')]);
    assert.deepEqual(messages(await f.host.settle()), []);
  });

  for (const outcome of ['success', 'failure']) {
    await test(`a reconnected lifecycle ignores an obsolete clear ${outcome}`, async () => {
      const f = await fixture();
      const clearing = f.launcher.clearLogs();
      f.host.reconnectEffects();
      f.configReads[1].finish();
      await f.host.settle();
      f.emitLog({ level: 'info', message: 'new lifecycle log' });
      if (outcome === 'success') f.clears[0].resolve();
      else f.clears[0].reject(new Error('obsolete clear failure'));
      await clearing;
      assert.deepEqual(messages(await f.host.settle()), ['new lifecycle log']);
      assert.deepEqual(f.notifications, []);
    });
  }
}
