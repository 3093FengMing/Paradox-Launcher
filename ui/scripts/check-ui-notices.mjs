import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadApp, uiRoot } from './lib/hook-test-host.mjs';
import { createFakeClock } from './lib/fake-clock.mjs';

const runtime = loadApp()('ui-runtime/notices.ts');
const {
  createNoticeStore,
  pauseNoticeForView,
  resumeNoticeForView,
  releaseNoticeView,
  retainNoticeStore,
} = runtime;

await test('public notification presentation shares frozen notices and dismissal with the default viewport', () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const store = createNoticeStore(createFakeClock());
  for (const kind of ['info', 'success', 'warning', 'error']) store.publish(kind, `message-${kind}`);
  const app = loadApp(new Map([
    [resolve(uiRoot, 'src/launcher/compatibility.ts'), {
      useLauncherCompatibility: () => ({ services: { launcher: { notices: store } } }),
    }],
    ['react-i18next', { useTranslation: () => ({ t: (key) => key }) }],
  ]));
  const { UiNotifications } = app('ui-foundation/index.ts');
  const presentations = [];
  const custom = () => renderToStaticMarkup(React.createElement(UiNotifications, {
    className: 'source-stack',
    renderNotice(presentation) {
      presentations.push(presentation);
      const { notice, noticeProps, dismiss, dismissLabel } = presentation;
      return React.createElement('article', {
        ...noticeProps,
        'data-ui-site': 'source-notice',
        'data-notice-id': notice.id,
      }, React.createElement('p', null, notice.message), React.createElement('button', {
        type: 'button', 'aria-label': dismissLabel, onClick: dismiss,
      }, 'Dismiss'));
    },
  }));
  const markup = custom();
  assert.match(markup, /class="ui-notice-viewport source-stack"/);
  assert.equal((markup.match(/<article /g) || []).length, 4);
  assert.equal((markup.match(/role="status"/g) || []).length, 3);
  assert.equal((markup.match(/role="alert"/g) || []).length, 1);
  assert.equal((markup.match(/aria-atomic="true"/g) || []).length, 4);
  assert.equal((markup.match(/data-ui-site="source-notice"/g) || []).length, 4);
  const first = presentations[0];
  assert.equal(first.notice, store.getSnapshot()[0]);
  assert.ok(Object.isFrozen(first.notice));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.noticeProps));
  assert.deepEqual(Object.keys(first).sort(), ['dismiss', 'dismissLabel', 'notice', 'noticeProps']);
  assert.deepEqual(Object.keys(first.noticeProps).sort(), [
    'aria-atomic', 'onBlur', 'onFocus', 'onPointerEnter', 'onPointerLeave', 'ref', 'role',
  ]);
  assert.equal(typeof first.noticeProps.ref, 'function');
  assert.equal(first.dismissLabel, 'notices.dismiss');
  const defaultMarkup = () => renderToStaticMarkup(React.createElement(UiNotifications));
  assert.match(defaultMarkup(), /class="ui-notice ui-notice-info"/);
  assert.match(defaultMarkup(), /<span>message-info<\/span>/);
  first.dismiss();
  assert.equal(store.getSnapshot().length, 3);
  assert.doesNotMatch(custom(), /message-info/);
  assert.doesNotMatch(defaultMarkup(), /message-info/);
  assert.match(defaultMarkup(), /class="ui-notice ui-notice-error"/);
  store.dispose();
});

await test('ttl_pause_sources_and_message_ownership', () => {
  for (const kind of ['info', 'success', 'warning', 'error']) {
    const clock = createFakeClock();
    const store = createNoticeStore(clock);
    const id = store.publish(kind, kind);
    const ttl = kind === 'error' ? 5000 : 3000;
    clock.advance(ttl - 1);
    assert.equal(store.getSnapshot().length, 1);
    clock.advance(1);
    assert.equal(store.getSnapshot().length, 0);
    assert.equal(clock.pendingTimers, 0);
    assert.ok(id);
  }
  const clock = createFakeClock();
  const store = createNoticeStore(clock);
  const id = store.publish('warning', 'paused');
  clock.advance(1000);
  store.pause(id, 'pointer');
  store.pause(id, 'pointer');
  store.pause(id, 'focus');
  assert.equal(store.getSnapshot()[0].remainingMs, 2000);
  clock.advance(60000);
  store.resume(id, 'pointer');
  clock.advance(60000);
  assert.equal(store.getSnapshot().length, 1);
  store.resume(id, 'focus');
  clock.advance(1999);
  assert.equal(store.getSnapshot().length, 1);
  clock.advance(1);
  assert.equal(store.getSnapshot().length, 0);
});

await test('stale callbacks cannot remove newer notices; one timer and stable snapshots', () => {
  const clock = createFakeClock();
  const stale = [];
  const store = createNoticeStore({
    ...clock,
    clearTimeout() {},
    setTimeout(fn, ms) {
      stale.push(fn);
      return clock.setTimeout(fn, ms);
    },
  });
  const old = store.publish('info', 'old');
  clock.advance(2000);
  store.dismiss(old);
  const newer = store.publish('error', 'new');
  stale[0]();
  assert.equal(store.getSnapshot()[0].id, newer);
  clock.advance(4999);
  assert.equal(store.getSnapshot()[0].id, newer);
  clock.advance(1);
  assert.deepEqual(store.getSnapshot(), []);
  const normal = createNoticeStore(clock);
  let changes = 0;
  const unsubscribe = normal.subscribe(() => changes++);
  const first = normal.getSnapshot();
  assert.equal(first, normal.getSnapshot());
  normal.publish('info', 'one');
  normal.publish('error', 'two');
  assert.equal(clock.pendingTimers, 1);
  normal.dispose();
  assert.equal(clock.pendingTimers, 0);
  assert.deepEqual(normal.getSnapshot(), []);
  assert.equal(changes, 3);
  unsubscribe();
});

await test('view closure releases only its pause leases and notice ages with no viewport', () => {
  const clock = createFakeClock();
  const store = createNoticeStore(clock);
  const a = {},
    b = {};
  const id = store.publish('info', 'shared');
  clock.advance(1000);
  pauseNoticeForView(store, a, id, 'pointer');
  pauseNoticeForView(store, b, id, 'pointer');
  pauseNoticeForView(store, b, id, 'focus');
  releaseNoticeView(store, a);
  clock.advance(60000);
  assert.equal(store.getSnapshot().length, 1);
  resumeNoticeForView(store, b, id, 'pointer');
  clock.advance(60000);
  assert.equal(store.getSnapshot().length, 1);
  releaseNoticeView(store, b);
  clock.advance(2000);
  assert.deepEqual(store.getSnapshot(), []);
  const next = store.publish('info', 'public lease');
  store.pause(next, 'pointer');
  pauseNoticeForView(store, a, next, 'pointer');
  releaseNoticeView(store, a);
  clock.advance(60000);
  assert.equal(store.getSnapshot().length, 1);
  store.resume(next, 'pointer');
  clock.advance(3000);
  assert.deepEqual(store.getSnapshot(), []);
});

await test('same-ref cleanup/reconnect retains store; final unmount disposes timers', async () => {
  const clock = createFakeClock();
  const store = createNoticeStore(clock);
  const release = retainNoticeStore(store);
  store.publish('success', 'before reconnect');
  release();
  const releaseAgain = retainNoticeStore(store);
  await Promise.resolve();
  store.publish('success', 'after reconnect');
  assert.equal(store.getSnapshot().length, 2);
  assert.equal(clock.pendingTimers, 1);
  releaseAgain();
  await Promise.resolve();
  assert.equal(clock.pendingTimers, 0);
  assert.deepEqual(store.getSnapshot(), []);
});
