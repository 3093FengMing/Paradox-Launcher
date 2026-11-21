export async function checkStartupHistory(context) {
  const { assert, test, fixture, patchPreferences, stored, messages } = context;
  await test('disabled history is not read, including an unsaved retain-logs draft', async () => {
    const f = await fixture();
    patchPreferences(f.launcher, { retain_logs: true });
    f.emitLog({ level: 'info', message: 'live log' });
    const launcher = await f.host.settle();
    assert.equal(f.historyReads.length, 0);
    assert.deepEqual(messages(launcher), ['live log']);
  });

  await test('startup history merges early and concurrent live logs and formats Unix seconds locally', async () => {
    const f = await fixture({ preferences: { retain_logs: true }, holdBootstrap: true });
    f.emitLog({ level: 'info', message: 'before bootstrap' });
    assert.equal(f.historyReads.length, 0);
    f.configReads[0].finish();
    await f.host.settle();
    assert.equal(f.historyReads.length, 1, 'saved retention must request history');
    f.emitLog({ level: 'warning', message: 'during history' });
    f.historyReads[0].resolve([stored('previous session')]);
    const launcher = await f.host.settle();
    assert.deepEqual(messages(launcher), [
      'previous session',
      'before bootstrap',
      'during history',
    ]);
    assert.equal(
      launcher.logs[0].time,
      new Date('2024-01-01T00:00:00Z').toLocaleTimeString('zh-CN', { hour12: false }),
    );
    f.emitLog({ level: 'info', message: 'after history' });
    assert.equal(messages(await f.host.settle()).at(-1), 'after history');
  });

  await test('history merging retains the newest 500 records with live entries at the end', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    assert.equal(f.historyReads.length, 1);
    for (let i = 0; i < 8; i++) f.emitLog({ level: 'info', message: `live ${i}` });
    f.historyReads[0].resolve(Array.from({ length: 500 }, (_, i) => stored(`past ${i}`)));
    const launcher = await f.host.settle();
    assert.equal(launcher.logs.length, 500);
    assert.equal(launcher.logs[0].message, 'past 8');
    assert.deepEqual(
      messages(launcher).slice(-8),
      Array.from({ length: 8 }, (_, i) => `live ${i}`),
    );
  });

  await test('saving retention off invalidates pending history while retaining current live logs', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    assert.equal(f.historyReads.length, 1);
    f.emitLog({ level: 'info', message: 'current session' });
    patchPreferences(f.launcher, { retain_logs: false });
    assert.equal(await (await f.host.settle()).saveSettings(), true);
    f.historyReads[0].resolve([stored('obsolete history')]);
    const launcher = await f.host.settle();
    assert.ok(messages(launcher).includes('current session'));
    assert.ok(!messages(launcher).includes('obsolete history'));
  });

  await test('history read failures remain visible even when completion notifications are disabled', async () => {
    const f = await fixture({ preferences: { retain_logs: true, notifications: false } });
    assert.equal(f.historyReads.length, 1);
    f.historyReads[0].reject(new Error('history unavailable'));
    const launcher = await f.host.settle();
    assert.deepEqual(f.notifications, [{ error: true, message: 'history unavailable' }]);
    assert.deepEqual(messages(launcher), ['history unavailable']);
  });

  for (const outcome of ['success', 'failure']) {
    await test(`unmount ignores a late history ${outcome}`, async () => {
      const f = await fixture({ preferences: { retain_logs: true } });
      assert.equal(f.historyReads.length, 1);
      f.host.unmount();
      if (outcome === 'success') f.historyReads[0].resolve([stored('obsolete')]);
      else f.historyReads[0].reject(new Error('obsolete error'));
      await f.host.settle();
      assert.equal(f.host.updatesAfterUnmount, 0);
      assert.deepEqual(f.notifications, []);
    });
  }
}
