import { createContext } from './lib/log-preferences-context.mjs';
import { checkNotifications } from './lib/log-preferences-notifications.mjs';
import { checkStartupHistory } from './lib/log-preferences-startup-history.mjs';
import { checkStorageClear } from './lib/log-preferences-storage-clear.mjs';
import { checkStartupPage } from './lib/log-preferences-startup-page.mjs';
import { checkRetentionLifecycle } from './lib/log-preferences-retention-lifecycle.mjs';
import { checkClearLifecycle } from './lib/log-preferences-clear-lifecycle.mjs';
import { checkRecordIdentities } from './lib/log-preferences-record-identities.mjs';

const context = createContext();
await checkNotifications(context);
await checkStartupHistory(context);
await checkStorageClear(context);
await checkStartupPage(context);
await checkRetentionLifecycle(context);
await checkClearLifecycle(context);
await checkRecordIdentities(context);
