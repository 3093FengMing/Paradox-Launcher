import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/task-4/notice-foundation');
await mkdir(artifacts, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
const report = { target: process.env.PARADOX_UI_URL, checks: [], errors: fixture.observedPageErrors };
const settle = () => page.evaluate(() => new Promise((done) =>
  requestAnimationFrame(() => requestAnimationFrame(done))));
const mount = async (options = {}) => {
  await page.evaluate(async (options) => {
    if (!window.mountNoticeFixture) await import('/src/ui-foundation/browser-fixture.tsx');
    window.mountNoticeFixture({ custom: true, ...options });
  }, options);
  await settle();
};
const advance = async (ms) => {
  await page.evaluate((ms) => window.noticeFixture.advance(ms), ms);
  await settle();
};
const publish = async (kind, message) => {
  const id = await page.evaluate(({ kind, message }) =>
    window.noticeFixture.store.publish(kind, message), { kind, message });
  await settle();
  return id;
};
const views = async (count, removeFirst = false) => {
  await page.evaluate(({ count, removeFirst }) => window.noticeFixture.views(count, removeFirst),
    { count, removeFirst });
  await settle();
};
const check = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const presentation = async (root, theme = 'dark', messageSuffix = '') => {
  await page.evaluate(({ root, theme, messageSuffix }) =>
    window.noticeFixture.presentation(root, theme, messageSuffix), { root, theme, messageSuffix });
  await settle();
};

try {
  await mount();
  const host = page.locator('#notice-fixture');
  for (const kind of ['info', 'success', 'warning', 'error']) {
    const id = await publish(kind, `source-${kind}`);
    const notice = host.getByRole(kind === 'error' ? 'alert' : 'status');
    assert.equal(await notice.evaluate((element) => element.tagName), 'SECTION');
    assert.equal(await notice.getAttribute('data-notice-id'), id);
    assert.equal(await notice.getAttribute('data-ui-site'), 'fixture-source-notice');
    assert.equal(await notice.getAttribute('aria-atomic'), 'true');
    assert.equal(await notice.locator('[data-ui-site="fixture-source-message"]').innerText(), `source-${kind}`);
    assert.equal(await host.locator('.ui-notice').count(), 0);
    assert.equal(await host.locator('.fixture-notice-viewport').count(), 1);
    await advance((kind === 'error' ? 5000 : 3000) - 1);
    assert.equal(await notice.count(), 1);
    await advance(1);
    assert.equal(await notice.count(), 0);
  }
  check('source-authored section/message targets preserve notice identity, roles, and store TTL');

  await views(2);
  const dismissId = await publish('warning', 'shared-dismiss');
  const duplicate = host.locator(`[data-notice-id="${dismissId}"]`);
  assert.equal(await duplicate.count(), 2);
  assert.equal(await duplicate.first().getByRole('button', { name: '关闭通知', exact: true }).count(), 1);
  await duplicate.first().getByRole('button', { name: '关闭通知', exact: true }).click();
  assert.equal(await duplicate.count(), 0);
  assert.equal(await page.evaluate(() => window.noticeFixture.store.getSnapshot().length), 0);
  check('source dismiss callback removes the same notice from both viewports');

  // Each case closes one paused viewport while the other owns a different source.
  for (const removedSource of ['pointer', 'focus']) {
    await mount();
    await views(2);
    await page.mouse.move(0, 0);
    await publish('info', `leases-${removedSource}`);
    await advance(1000);
    const a = host.locator('[data-notice-owner="0"]');
    const b = host.locator('[data-notice-owner="1"]');
    if (removedSource === 'pointer') {
      await a.hover();
      await b.getByRole('button', { name: '关闭通知', exact: true }).focus();
    } else {
      await a.getByRole('button', { name: '关闭通知', exact: true }).focus();
      await b.hover();
    }
    await advance(60000);
    assert.equal(await host.getByRole('status').count(), 2);
    if (removedSource === 'pointer') {
      const unchanged = await b.evaluate((element) => {
        const before = window.noticeFixture.store.getSnapshot();
        element.querySelectorAll('button')[1].focus();
        return before === window.noticeFixture.store.getSnapshot();
      });
      assert.equal(unchanged, true, 'within-notice focus must not briefly resume and publish a new snapshot');
    }
    await views(1, true);
    await advance(60000);
    assert.equal(await host.getByRole('status').count(), 1);
    if (removedSource === 'pointer') {
      await page.mouse.move(0, 0);
      await host.getByRole('button', { name: 'Outside notice', exact: true }).focus();
    } else {
      await page.mouse.move(0, 0);
    }
    await advance(1999);
    assert.equal(await host.getByRole('status').count(), 1);
    await advance(1);
    assert.equal(await host.getByRole('status').count(), 0);
    check(`removed ${removedSource} viewport releases only its lease; survivor retains the remaining 2000ms`);
  }

  await mount();
  await publish('success', 'focus-and-hover');
  await advance(1000);
  const combined = host.getByRole('status');
  await combined.hover();
  await combined.getByRole('button', { name: 'Within notice', exact: true }).focus();
  await page.mouse.move(0, 0);
  await advance(60000);
  assert.equal(await combined.count(), 1);
  await host.getByRole('button', { name: 'Outside notice', exact: true }).focus();
  await advance(2000);
  assert.equal(await combined.count(), 0);
  check('custom notice resumes only after pointer and focus both release');

  for (const [source, nextRoot] of [['focus', 'article'], ['focus', null], ['pointer', null]]) {
    await mount({ defaultSecond: true });
    await views(2);
    await page.mouse.move(0, 0);
    await publish('info', `detached-${source}-${nextRoot}`);
    await advance(1000);
    const custom = host.locator('[data-notice-owner="0"]');
    if (source === 'focus') await custom.getByRole('button', { name: 'Within notice', exact: true }).focus();
    else await custom.hover();
    await presentation(nextRoot);
    assert.equal(await host.locator('.ui-notice-viewport').count(), 2, 'the viewports themselves remain mounted');
    if (source === 'focus') assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY');
    if (nextRoot) assert.equal(await host.locator('[data-notice-owner="0"]').evaluate((element) => element.tagName), 'ARTICLE');
    else assert.equal(await host.locator('[data-notice-owner="0"]').count(), 0);
    await page.mouse.move(0, 0);
    await advance(1999);
    assert.equal(await page.evaluate(() => window.noticeFixture.store.getSnapshot().length), 1);
    await advance(1);
    assert.equal(await page.evaluate(() => window.noticeFixture.store.getSnapshot().length), 0,
      'detaching custom markup must resume its remaining 2000ms without unmounting the viewport');
    await advance(60000);
    assert.equal(await host.getByRole('status').count(), 0);
    check(`custom ${source} pause releases when section becomes ${nextRoot ?? 'null'}`);
  }

  for (const source of ['focus', 'pointer']) {
    await mount({ defaultSecond: true });
    await views(2);
    await page.mouse.move(0, 0);
    await publish('info', `stable-root-${source}`);
    await advance(1000);
    const stable = host.locator('[data-notice-owner="0"]');
    if (source === 'focus') await stable.getByRole('button', { name: 'Within notice', exact: true }).focus();
    else await stable.hover();
    await stable.evaluate((element) => { window.noticeStableElement = element; });
    await presentation('section', 'light', ' updated message');
    assert.equal(await stable.evaluate((element) => element === window.noticeStableElement), true);
    assert.equal(await stable.getAttribute('data-notice-theme'), 'light');
    assert.match(await stable.locator('p').innerText(), /updated message$/);
    // Publishing another notice causes a real shared-store snapshot rerender.
    await publish('warning', 'snapshot-rerender');
    await advance(60000);
    assert.equal(await page.evaluate(() => window.noticeFixture.store.getSnapshot().length), 1,
      'same-root presentation and snapshot rerenders must retain the pause');
    assert.equal(await stable.count(), 1);
    if (source === 'focus') await host.getByRole('button', { name: 'Outside notice', exact: true }).focus();
    else await page.mouse.move(0, 0);
    await advance(1999);
    assert.equal(await stable.count(), 1);
    await advance(1);
    assert.equal(await stable.count(), 0);
    check(`same-root theme/message/snapshot rerenders preserve custom ${source} pause`);
  }

  await mount({ defaultSecond: true });
  await views(2);
  await page.mouse.move(0, 0);
  await publish('info', 'other-viewport-retains-pause');
  await advance(1000);
  await host.locator('[data-notice-owner="0"]').getByRole('button', { name: 'Within notice', exact: true }).focus();
  const ordinary = host.locator('[data-notice-view="1"]').getByRole('status');
  await ordinary.hover();
  await presentation(null);
  await advance(60000);
  assert.equal(await ordinary.count(), 1, 'detach cleanup must retain the default viewport pointer lease');
  await page.mouse.move(0, 0);
  await advance(1999);
  assert.equal(await ordinary.count(), 1);
  await advance(1);
  assert.equal(await ordinary.count(), 0);
  check('custom root detach retains the other default viewport pause');

  await mount({ portal: true });
  await publish('error', 'custom-shadow-portal');
  const portalNotice = host.getByRole('alert');
  assert.equal(await portalNotice.evaluate((element) => element.getRootNode() instanceof ShadowRoot), true);
  assert.equal(await portalNotice.getAttribute('data-ui-site'), 'fixture-source-notice');
  await portalNotice.getByRole('button', { name: '关闭通知', exact: true }).focus();
  await advance(60000);
  assert.equal(await portalNotice.count(), 1);
  await views(0);
  await advance(5000);
  await views(1);
  assert.equal(await host.getByRole('alert').count(), 0);
  check('custom markup uses the existing ShadowRoot Portal and unmount releases its focus lease');
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}
