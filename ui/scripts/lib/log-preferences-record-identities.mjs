export async function checkRecordIdentities(context) {
  const { assert, test, fixture, stored, messages } = context;
  await test('overlapping disk history and live events render each shared identity only once', async () => {
    const f = await fixture({ preferences: { retain_logs: true }, holdBootstrap: true });
    const first = f.emitLog({ level: 'info', message: 'repeated game message' });
    const second = f.emitLog({ level: 'info', message: 'repeated game message' });
    f.configReads[0].finish();
    await f.host.settle();
    f.historyReads[0].resolve([stored('legacy history'), first, second]);
    const launcher = await f.host.settle();
    assert.deepEqual(messages(launcher), [
      'legacy history',
      'repeated game message',
      'repeated game message',
    ]);
  });

  await test('a delayed live event already in the disk snapshot does not create a duplicate', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    const first = { ...stored('same text'), id: { session: 'current-session', sequence: '1' } };
    f.historyReads[0].resolve([first]);
    await f.host.settle();
    f.emitLog(first);
    f.emitLog({ ...first, id: { ...first.id, sequence: '2' } });
    assert.deepEqual(messages(await f.host.settle()), ['same text', 'same text']);
  });

  await test('clear acknowledgement preserves records after its server boundary and rejects late older events', async () => {
    const f = await fixture();
    const old = f.emitLog({ level: 'info', message: 'old record' });
    const clearing = (await f.host.settle()).clearLogs();
    const fresh = f.emitLog({ level: 'info', message: 'after server clear' });
    f.clears[0].resolve(old.id);
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), ['after server clear']);
    f.emitLog(old);
    f.emitLog(fresh);
    f.emitLog({ level: 'info', message: 'after server clear' });
    assert.deepEqual(messages(await f.host.settle()), ['after server clear', 'after server clear']);
  });

  await test('a server clear removes prior sessions and legacy history without clearing newer records', async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    f.historyReads[0].resolve([
      stored('legacy without identity'),
      { ...stored('earlier process'), id: { session: 'previous-session', sequence: '999999' } },
    ]);
    const clearing = (await f.host.settle()).clearLogs();
    f.emitLog({ level: 'info', message: 'new record' });
    f.clears[0].resolve({ session: 'current-session', sequence: '0' });
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), ['new record']);
  });

  await test('clear sequence comparisons preserve precision beyond JavaScript safe integers', async () => {
    const f = await fixture();
    f.emitLog({
      ...stored('before boundary'),
      id: { session: 'current-session', sequence: '9007199254740992' },
    });
    const clearing = (await f.host.settle()).clearLogs();
    f.emitLog({
      ...stored('after boundary'),
      id: { session: 'current-session', sequence: '9007199254740993' },
    });
    f.clears[0].resolve({ session: 'current-session', sequence: '9007199254740992' });
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), ['after boundary']);
  });

  await test('a local error reported during a pending clear remains visible after acknowledgement', async () => {
    const f = await fixture();
    f.launcher.reportError(new Error('old local error'));
    const clearing = (await f.host.settle()).clearLogs();
    f.launcher.reportError(new Error('new local error'));
    f.clears[0].resolve({ session: 'current-session', sequence: '0' });
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), ['new local error']);
  });

  await test('startup history waits until live subscription is established so no records fall into a gap', async () => {
    const f = await fixture({ preferences: { retain_logs: true }, holdSubscription: true });
    assert.equal(
      f.historyReads.length,
      0,
      'take the snapshot only after live delivery is established',
    );
    f.subscription.resolve();
    await f.host.settle();
    assert.equal(f.historyReads.length, 1);
    const live = f.emitLog({ level: 'info', message: 'overlapping live record' });
    f.historyReads[0].resolve([stored('before subscription'), live]);
    assert.deepEqual(messages(await f.host.settle()), [
      'before subscription',
      'overlapping live record',
    ]);
  });

  for (const timing of ['before snapshot', 'after snapshot']) {
    await test(`an old live record arriving ${timing} cannot evict newer retained records`, async () => {
      const f = await fixture({ preferences: { retain_logs: true } });
      const oldest = { ...stored('record 1'), id: { session: 'current-session', sequence: '1' } };
      if (timing === 'before snapshot') f.emitLog(oldest);
      f.historyReads[0].resolve(
        Array.from({ length: 500 }, (_, i) => ({
          ...stored(`record ${i + 2}`),
          id: { session: 'current-session', sequence: String(i + 2) },
        })),
      );
      await f.host.settle();
      if (timing === 'after snapshot') f.emitLog(oldest);
      const launcher = await f.host.settle();
      assert.equal(launcher.logs.length, 500);
      assert.equal(launcher.logs[0].message, 'record 2');
      assert.equal(launcher.logs.at(-1).message, 'record 501');
    });
  }
}
