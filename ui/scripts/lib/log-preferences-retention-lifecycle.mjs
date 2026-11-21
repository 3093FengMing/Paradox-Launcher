export async function checkRetentionLifecycle(context) {
  const { assert, test, fixture, patchPreferences, stored, messages } = context;
  await test('reconnecting effects does not insert the same restored history twice', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    f.historyReads[0].resolve([stored('one historical record')]);
    assert.deepEqual(messages(await f.host.settle()), ['one historical record']);
    f.host.reconnectEffects();
    f.configReads[1].finish();
    await f.host.settle();
    f.historyReads[1]?.resolve([stored('one historical record')]);
    assert.deepEqual(messages(await f.host.settle()), ['one historical record']);
  });

  await test('saving retention on loads history only after the saved acknowledgement', async () => {
    const f = await fixture({ holdWrites: true });
    patchPreferences(f.launcher, { retain_logs: true });
    const saving = (await f.host.settle()).saveSettings();
    await f.host.settle();
    assert.equal(f.historyReads.length, 0);
    f.writes[0].finish();
    assert.equal(await saving, true);
    await f.host.settle();
    assert.equal(f.historyReads.length, 1);
    f.historyReads[0].resolve([stored('earlier session')]);
    assert.equal(messages(await f.host.settle())[0], 'earlier session');
  });

  await test('reenabling retention after successful restoration does not duplicate history', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    f.historyReads[0].resolve([stored('one historical record')]);
    let launcher = await f.host.settle();
    patchPreferences(launcher, { retain_logs: false });
    await (await f.host.settle()).saveSettings();
    launcher = await f.host.settle();
    patchPreferences(launcher, { retain_logs: true });
    await (await f.host.settle()).saveSettings();
    await f.host.settle();
    f.historyReads[1]?.resolve([stored('one historical record')]);
    launcher = await f.host.settle();
    assert.equal(
      messages(launcher).filter((message) => message === 'one historical record').length,
      1,
    );
  });

  await test('a late historical read failure stays silent after retention is saved off', async () => {
    const f = await fixture({ preferences: { retain_logs: true, notifications: false } });
    patchPreferences(f.launcher, { retain_logs: false });
    await (await f.host.settle()).saveSettings();
    f.historyReads[0].reject(new Error('disabled history failed'));
    const launcher = await f.host.settle();
    assert.deepEqual(f.notifications, []);
    assert.ok(!messages(launcher).includes('disabled history failed'));
  });

  await test('a clear cancels pending history failures while it waits for storage', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    const clearing = f.launcher.clearLogs();
    f.historyReads[0].reject(new Error('cancelled history failed'));
    await f.host.settle();
    assert.deepEqual(f.notifications, []);
    f.clears[0].resolve();
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), []);
  });
}
