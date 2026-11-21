export async function checkNotifications(context) {
  const { assert, test, fixture, patchPreferences, messages } = context;
  await test('saved notification preference suppresses completion while errors remain visible', async () => {
    const f = await fixture({ preferences: { notifications: false } });
    f.launcher.notify('ordinary completion');
    f.emitActivity({ action: 'launch', status: 'finished', message: 'game finished' });
    f.launcher.reportError(new Error('controlled failure'));
    f.emitActivity({ action: 'launch', status: 'error', message: 'game failed' });
    const launcher = await f.host.settle();
    assert.deepEqual(f.notifications, [
      { error: true, message: 'controlled failure' },
      { error: true, message: 'game failed' },
    ]);
    assert.ok(messages(launcher).includes('controlled failure'));
  });

  await test('an unsaved notification draft cannot change current completion behavior', async () => {
    const f = await fixture();
    patchPreferences(f.launcher, { notifications: false });
    (await f.host.settle()).notify('draft completion');
    assert.deepEqual(f.notifications, [{ error: false, message: 'draft completion' }]);
  });

  await test('translated last-message-only dedup uses strict 1000ms and does not refresh on suppression', async () => {
    const f = await fixture();
    f.launcher.notify('auth.errors.invalid', true);
    const translated = f.notifications.at(-1).message;
    f.clock.advance(999);
    f.launcher.notify(translated, true);
    assert.equal(f.notifications.length, 1);
    f.clock.advance(1);
    f.launcher.notify(translated, true);
    assert.equal(f.notifications.length, 2);
    f.launcher.notify('A');
    f.launcher.notify('B');
    f.launcher.notify('A');
    assert.deepEqual(
      f.notifications.slice(-3).map((notice) => notice.message),
      ['A', 'B', 'A'],
    );
    f.launcher.notify('A', true);
    assert.equal(f.notifications.at(-1).error, true);
    const before = f.notifications.length;
    f.launcher.reportError('A');
    f.launcher.reportError('A');
    assert.equal(f.notifications.length, before);
    assert.equal(messages(await f.host.settle()).filter((message) => message === 'A').length, 2);
    f.clock.advance(5000);
    assert.equal(f.launcher.notices.getSnapshot().length, 0);
  });

  await test('notification preference changes at save acknowledgement and can be reenabled', async () => {
    const f = await fixture({ holdWrites: true });
    patchPreferences(f.launcher, { notifications: false });
    const saving = (await f.host.settle()).saveSettings();
    (await f.host.settle()).notify('before acknowledgement');
    f.writes[0].finish();
    assert.equal(await saving, true);
    let launcher = await f.host.settle();
    launcher.notify('suppressed after save');
    assert.deepEqual(f.notifications, [{ error: false, message: 'before acknowledgement' }]);
    f.server.config.settings.personalization.notifications = true;
    const enabling = launcher.reloadConfig();
    await f.host.settle();
    f.configReads[1].finish();
    await enabling;
    launcher = await f.host.settle();
    launcher.notify('suppressed after save');
    assert.equal(
      f.notifications.at(-1).message,
      'suppressed after save',
      'suppressed toasts must not enter the deduplication window',
    );
  });
}
