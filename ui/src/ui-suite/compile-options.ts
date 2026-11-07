import type { SuiteSourceTransform } from './module-graph';
export interface SuiteCompileOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  transform?: SuiteSourceTransform;
}
export function assertCompileCurrent(options: SuiteCompileOptions): void {
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent()))
    throw new DOMException('Suite compilation was cancelled or superseded.', 'AbortError');
}
