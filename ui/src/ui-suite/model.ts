import type { UiRouteDescriptor } from './routes';
export type { UiRouteDescriptor, UiRouteId } from './routes';
export type UiFile =
  { encoding: 'utf8'; text: string } | { encoding: 'base64'; media_type: string; data: string };
export interface UiFileDescriptor {
  path: string;
  kind: 'ts' | 'tsx' | 'html' | 'css' | 'asset';
  bytes: number;
  sha256: string;
  media_type?: string;
}
export interface BusinessIdentity {
  namespace: string;
  value: string;
}
export interface UiPositionLocator {
  version: 1;
  renderRoot: 'launcher.main' | 'launcher.editor';
  calls: readonly { site: string; key: string | null }[];
  business: readonly BusinessIdentity[];
}
export type UiSelector =
  | { kind: 'position'; target: string; locator: UiPositionLocator }
  | { kind: 'business'; target: string; identity: BusinessIdentity }
  | { kind: 'type'; target: string };
export interface UiTargetOverride {
  selector: UiSelector;
  enabled: boolean;
  stylesheet: string | null;
  entry: string | null;
}
export interface UiSuiteManifest {
  kind: 'paradox-ui-suite';
  schema_version: 1;
  api_version: 1;
  id: string;
  version: string;
  name: string;
  views: Record<string, string>;
  routes: UiRouteDescriptor[];
  styles: string[];
  files: UiFileDescriptor[];
  overrides: UiTargetOverride[];
}
export interface UiSuiteBundle {
  manifest: UiSuiteManifest;
  files: Record<string, UiFile>;
}
export interface UiSuiteRecord {
  instance_id: string;
  manifest: UiSuiteManifest;
  parent_snapshot: { digest: string; bundle: UiSuiteBundle } | null;
  overlay: Record<string, UiFile>;
  deleted: string[];
}
export interface UiSuiteLibrary {
  kind: 'paradox-ui-suite-library';
  schema_version: 1;
  revision: number;
  active_suite_id: string | null;
  suites: UiSuiteRecord[];
}
export const suiteLimits = Object.freeze({
  source: 1_048_576,
  asset: 8_388_608,
  files: 512,
  manifest: 65_536,
  total: 33_554_432,
  records: 16,
  library: 134_217_728,
  dimension: 8192,
  pixels: 33_554_432,
});
