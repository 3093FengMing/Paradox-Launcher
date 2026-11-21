import { createContext } from './lib/account-experience-context.mjs';
import { checkRecovery } from './lib/account-experience-recovery.mjs';
import { checkEarlyCancellation } from './lib/account-experience-early-cancellation.mjs';
import { checkUnmount } from './lib/account-experience-unmount.mjs';
import { checkLateCancellation } from './lib/account-experience-late-cancellation.mjs';
import { checkCompletion } from './lib/account-experience-completion.mjs';
import { checkAvatarLifecycle } from './lib/account-experience-avatar-lifecycle.mjs';
import { checkAvatarCrop } from './lib/account-experience-avatar-crop.mjs';
import { checkRender } from './lib/account-experience-render.mjs';

const context = createContext();
await checkRecovery(context);
await checkEarlyCancellation(context);
await checkUnmount(context);
await checkLateCancellation(context);
await checkCompletion(context);
await checkAvatarLifecycle(context);
await checkAvatarCrop(context);
await checkRender(context);

console.log(
  'Account experience regression passed: cancellation lifecycle, expired prompt controls, current identity, cached avatar cropping and late response isolation.',
);
