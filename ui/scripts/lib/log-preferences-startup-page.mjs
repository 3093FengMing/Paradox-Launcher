export async function checkStartupPage(context) {
  const { assert, test, fixture, patchPreferences } = context;
  await test('first successful configuration fixes startupPage through later saves and reloads', async () => {
    const f = await fixture({ preferences: { startup_page: 'logs' }, holdBootstrap: true });
    assert.equal(f.launcher.startupPage, 'home');
    f.configReads[0].finish();
    let launcher = await f.host.settle();
    assert.equal(launcher.startupPage, 'logs');
    patchPreferences(launcher, { startup_page: 'instances' });
    assert.equal(await (await f.host.settle()).saveSettings(), true);
    launcher = await f.host.settle();
    assert.equal(launcher.startupPage, 'logs');
    f.server.config.settings.personalization.startup_page = 'downloads';
    const reloading = launcher.reloadConfig();
    await f.host.settle();
    f.configReads[1].finish();
    await reloading;
    launcher = await f.host.settle();
    assert.equal(launcher.bootstrap.config.settings.personalization.startup_page, 'downloads');
    assert.equal(launcher.startupPage, 'logs');
  });

  await test('an obsolete bootstrap cannot capture the startup page for the current lifecycle', async () => {
    const f = await fixture({ preferences: { startup_page: 'logs' }, holdBootstrap: true });
    f.server.config.settings.personalization.startup_page = 'accounts';
    f.host.reconnectEffects();
    f.configReads[0].finish();
    await f.host.settle();
    f.configReads[1].finish();
    const launcher = await f.host.settle();
    assert.equal(launcher.startupPage, 'accounts');
  });

  await test('effect reconnect does not overwrite an already captured startup page', async () => {
    const f = await fixture({ preferences: { startup_page: 'content' } });
    assert.equal(f.launcher.startupPage, 'content');
    f.server.config.settings.personalization.startup_page = 'settings';
    f.host.reconnectEffects();
    f.configReads[1].finish();
    const launcher = await f.host.settle();
    assert.equal(launcher.startupPage, 'content');
  });
}
