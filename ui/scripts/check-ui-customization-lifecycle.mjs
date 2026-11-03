// The final controller suite preserves StrictMode reads, late compile/save/reset,
// serialized CAS, raw recovery, draft/selection ownership and bounded diagnostics.
// Store TTL/pause/reconnect ownership is exercised by check-ui-notices.mjs.
import './check-ui-editor-lifecycle.mjs';
