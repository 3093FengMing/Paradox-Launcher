export async function checkSchemaPaths(context) {
  const {
    assert,
    test,
    bundle,
    descriptors,
    parseSuiteBundle,
    bundleDigest,
    validateSuiteBundle,
    normalizeDraftBundle,
    canonicalSuiteJson,
    resolveSuitePath,
    suitePathCollisionKey,
    plain,
  } = context;
  await test('paths_and_actual_inflate_budget: exact limits, Unicode and root containment', () => {
    const f = new Map([
      ['Home.tsx', {}],
      ['a/index.ts', {}],
      ['a.ts', {}],
      ['a.tsx', {}],
    ]);
    assert.equal(resolveSuitePath('x.ts', './Home', f), 'Home.tsx');
    assert.throws(() => resolveSuitePath('x.ts', './a', f));
    for (const p of [
      '../outside.ts',
      '/Home.tsx',
      'C:/Home.tsx',
      './CON.ts',
      './e\u0301.ts',
      './x?.ts',
    ])
      assert.throws(() => resolveSuitePath('x.ts', p, f), p);
    for (const [a, b] of [
      ['A', 'a'],
      ['Σ', 'ς'],
      ['ẞ', 'ß'],
      ['𐐀', '𐐨'],
    ])
      assert.equal(suitePathCollisionKey(a), suitePathCollisionKey(b));
    for (const [a, b] of [
      ['ß', 'ss'],
      ['İ', 'i'],
      ['ı', 'i'],
    ])
      assert.notEqual(suitePathCollisionKey(a), suitePathCollisionKey(b));
  });
  await test('canonical domain rejects accessors, sparse arrays, hostile extensions without invoking them', () => {
    let calls = 0;
    for (const value of [
      {
        get a() {
          calls++;
          return 1;
        },
      },
      Array(1),
      [undefined],
      { a: NaN },
      { a: 1.5 },
      { a: 9007199254740992 },
      { a: '\ud800' },
      new Date(),
      Object.assign([], { bad: 1 }),
    ])
      assert.throws(() => canonicalSuiteJson(value));
    assert.equal(calls, 0);
    const cycle = {};
    cycle.x = cycle;
    assert.throws(() => canonicalSuiteJson(cycle));
    assert.equal(canonicalSuiteJson(-0), '0');
    assert.equal(
      canonicalSuiteJson({ 2: 2, 10: 10, nested: { '😀': 2, '\ue000': 1 } }),
      '{"10":10,"2":2,"nested":{"":1,"😀":2}}',
    );
  });
  await test('strict schema, descriptors, hostile keys, references and original byte limits', () => {
    for (const mutate of [
      (b) => (b.bad = 1),
      (b) => (b.manifest.schema_version = 2),
      (b) => (b.manifest.id = 'X'),
      (b) => (b.manifest.id += '\n'),
      (b) => (b.manifest.files[0].sha256 += '\n'),
      (b) => (b.manifest.views['extra\n'] = 'Home.tsx'),
      (b) => (b.manifest.routes[0].order = 0.5),
      (b) => (b.manifest.routes[0].order = 1000001),
      (b) => (b.manifest.views['page.home'] = 'Other.tsx'),
      (b) => delete b.manifest.views['tool.editor'],
      (b) => b.manifest.files[0].bytes++,
      (b) => (b.files['home.tsx'] = b.files['Home.tsx']),
      (b) => (b.files['suite.json'] = { encoding: 'utf8', text: '' }),
      (b) => (b.files['CON.ts'] = { encoding: 'utf8', text: '' }),
      (b) =>
        (b.manifest.overrides = [
          {
            selector: { kind: 'type', target: 'x', owner: 1 },
            enabled: true,
            stylesheet: null,
            entry: null,
          },
        ]),
    ]) {
      const b = bundle();
      mutate(b);
      assert.throws(() => parseSuiteBundle(b));
    }
    const b = bundle({ 'a.ts': { encoding: 'utf8', text: 'é'.repeat(524288) } });
    assert.doesNotThrow(() => parseSuiteBundle(b));
    b.files['a.ts'].text += 'a';
    descriptors(b);
    assert.throws(() => parseSuiteBundle(b));
  });
  await test('sync parse is not SHA/decoder acceptance; async owns exact candidate', async () => {
    const b = bundle();
    b.manifest.files[0].sha256 = '0'.repeat(64);
    parseSuiteBundle(b);
    await assert.rejects(() => validateSuiteBundle(b));
    await assert.rejects(() => bundleDigest(b));
    const candidate = bundle(),
      expected = plain(candidate);
    const pending = validateSuiteBundle(candidate);
    candidate.files['Home.tsx'].text = 'changed';
    assert.deepEqual(plain(await pending), expected);
    const draft = bundle();
    draft.files['Home.tsx'].text = 'new';
    assert.equal((await normalizeDraftBundle(draft)).manifest.files[0].bytes, 3);
  });
}
