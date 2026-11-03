import fixtures from '../../scripts/fixtures/ui-suite/browser-assets.json';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';
import i18n from '../i18n';
import { inspectSuiteAsset, validateSuiteAsset } from '../ui-suite/assets';
import { inspectRaster } from '../ui-suite/asset-raster';
import {
  parseSuiteBundle,
  validateSuiteBundle,
  validateSuiteLibrary,
  validateSuiteLibraryData,
  bundleDigest,
} from '../ui-suite/bundle';
import { decodeBase64, encodeBase64, sha256, utf8 } from '../ui-suite/canonical';
import { encodeSuiteArchive, decodeSuiteArchive } from '../ui-suite/archive';
import type { UiSuiteBundle, UiSuiteLibrary } from '../ui-suite/model';
declare global {
  interface Window {
    suiteAssetFixture: {
      language(value: string): Promise<unknown>;
      run(): Promise<{
        checks: string[];
        failures: string[];
        createdBitmaps: number;
        closedBitmaps: number;
        fontLoads: number;
      }>;
    };
  }
}
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
export function installSuiteAssetsFixture(): void {
  window.suiteAssetFixture = {
    language: (value) => i18n.changeLanguage(value),
    async run() {
      const checks: string[] = [],
        failures: string[] = [];
      const check = async (name: string, fn: () => void | Promise<void>) => {
        try {
          await fn();
          checks.push(name);
        } catch (error) {
          failures.push(name + ': ' + String(error));
        }
      };
      const assert = (value: unknown, message = 'Assertion failed') => {
        if (!value) throw new Error(message);
      };
      const rejects = async (fn: () => Promise<unknown>) => {
        let failed = false;
        try {
          await fn();
        } catch {
          failed = true;
        }
        assert(failed, 'Expected rejection');
      };
      // Native functions are restored by identity; calls explicitly preserve their receiver.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalBitmap = window.createImageBitmap,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        originalFontLoad = FontFace.prototype.load;
      const fontSetSize = document.fonts.size;
      let createdBitmaps = 0,
        closedBitmaps = 0,
        fontLoads = 0;
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        const bitmap = await originalBitmap(...args);
        createdBitmaps++;
        const close = bitmap.close.bind(bitmap);
        bitmap.close = () => {
          closedBitmaps++;
          close();
        };
        return bitmap;
      }) as typeof createImageBitmap;
      FontFace.prototype.load = function () {
        fontLoads++;
        return originalFontLoad.call(this);
      };
      try {
        await check(
          'fix1 oriented JPEG keeps original bytes and accepts displayed dimensions',
          async () => {
            const fixture = fixtures.find((f) => f.name === 'oriented-6.jpg');
            assert(fixture, 'Missing fixed EXIF orientation fixture');
            const data = decodeBase64(fixture!.data),
              header = inspectRaster('image/jpeg', data);
            assert(header.width === 3 && header.height === 2);
            const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
            try {
              assert(bitmap.width === 2 && bitmap.height === 3);
            } finally {
              bitmap.close();
            }
            const b = structuredClone(vectors.bundle) as UiSuiteBundle;
            b.files['oriented-6.jpg'] = {
              encoding: 'base64',
              media_type: 'image/jpeg',
              data: fixture!.data,
            };
            b.manifest.files.push({
              path: 'oriented-6.jpg',
              kind: 'asset',
              media_type: 'image/jpeg',
              bytes: data.length,
              sha256: await sha256(data),
            });
            const accepted = await validateSuiteBundle(b),
              restored = await decodeSuiteArchive(await encodeSuiteArchive(accepted));
            assert(
              JSON.stringify(restored.files['oriented-6.jpg']) ===
                JSON.stringify(b.files['oriented-6.jpg']),
            );
            const library: UiSuiteLibrary = {
              kind: 'paradox-ui-suite-library',
              schema_version: 1,
              revision: 1,
              active_suite_id: null,
              suites: [
                {
                  instance_id: '00d04927-d14e-4f83-8a62-723207634605',
                  manifest: b.manifest,
                  parent_snapshot: null,
                  overlay: b.files,
                  deleted: [],
                },
              ],
            };
            assert((await validateSuiteLibrary(library)).revision === 1);
          },
        );
        for (const shape of ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']) {
          await check('fix1 unitless pathLength grammar ' + shape, async () => {
            for (const value of ['0', '1.5', '2e1'])
              await validateSuiteAsset(
                'a.svg',
                'image/svg+xml',
                utf8(svg(`<${shape} pathLength="${value}"/>`)),
              );
            for (const value of ['1px', '1em', '1%', '-1', '1e999', '1 2', ''])
              await rejects(() =>
                validateSuiteAsset(
                  'a.svg',
                  'image/svg+xml',
                  utf8(svg(`<${shape} pathLength="${value}"/>`)),
                ),
              );
          });
        }
        await check('fix1 stop offset accepts only number or percentage grammar', async () => {
          for (const value of ['0', '.5', '1', '50%', '1e1%'])
            await validateSuiteAsset(
              'a.svg',
              'image/svg+xml',
              utf8(svg(`<linearGradient><stop offset="${value}"/></linearGradient>`)),
            );
          for (const value of ['1px', '1em', '1rem', '1e999', '1 2', ''])
            await rejects(() =>
              validateSuiteAsset(
                'a.svg',
                'image/svg+xml',
                utf8(svg(`<linearGradient><stop offset="${value}"/></linearGradient>`)),
              ),
            );
        });
        for (const f of fixtures) {
          await check('real decode ' + f.name, () =>
            validateSuiteAsset(f.name, f.media, decodeBase64(f.data)),
          );
          if (f.media !== 'image/svg+xml')
            await check('truncated ' + f.name, () =>
              rejects(() => validateSuiteAsset(f.name, f.media, decodeBase64(f.data).slice(0, 16))),
            );
        }
        for (const name of ['pixel.png', 'pixel.jpg', 'pixel.webp', 'TestWOFF.woff']) {
          await check('header-valid but real decoder rejects ' + name, async () => {
            const f = fixtures.find((f) => f.name === name)!,
              original = decodeBase64(f.data);
            let candidate: Uint8Array;
            if (name.endsWith('.png')) candidate = original.slice(0, 33);
            else if (name.endsWith('.jpg')) {
              const view = new DataView(original.buffer);
              let p = 2,
                end = 0;
              while (p < original.length) {
                const marker = original[p + 1],
                  size = view.getUint16(p + 2);
                if ([0xc0, 0xc1, 0xc2].includes(marker)) {
                  end = p + 2 + size;
                  break;
                }
                p += 2 + size;
              }
              assert(end > 0);
              candidate = original.slice(0, end);
            } else if (name.endsWith('.webp')) {
              const view = new DataView(original.buffer);
              let p = 12;
              while (view.getUint32(p) !== 0x56503820)
                p += 8 + view.getUint32(p + 4, true) + (view.getUint32(p + 4, true) % 2);
              candidate = original.slice(0, p + 18);
              const header = new DataView(candidate.buffer);
              header.setUint32(p + 4, 10, true);
              header.setUint32(4, candidate.length - 8, true);
            } else {
              candidate = original.slice();
              candidate.fill(0, 44 + 20 * new DataView(original.buffer).getUint16(12));
            }
            inspectSuiteAsset(name, f.media, candidate);
            const b = structuredClone(vectors.bundle) as UiSuiteBundle;
            b.files[name] = {
              encoding: 'base64',
              media_type: f.media,
              data: encodeBase64(candidate),
            };
            b.manifest.files.push({
              path: name,
              kind: 'asset',
              media_type: f.media,
              bytes: candidate.length,
              sha256: await sha256(candidate),
            });
            parseSuiteBundle(b);
            await bundleDigest(b);
            let published = 'previous';
            await rejects(async () => {
              await validateSuiteBundle(b);
              published = 'candidate';
            });
            assert(published === 'previous');
          });
        }
        const good = [
          svg(
            '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><clipPath id="c"><circle r="4"/></clipPath><mask id="m"><rect width="1" height="1" fill="white"/></mask></defs><path d="M0 0 L1 1 Z" fill="url(#g)" clip-path="url(#c)" mask="url(#m)" style="stroke: rgb(1,2,3); stroke-width: 1.5px"/>',
          ),
          svg('<text xml:space="preserve">hello &amp; 世界<tspan dx="1 2">!</tspan></text>'),
          svg('<path d="M0 0 A1 1 0 012 2 L.5-.2Z"/>'),
        ];
        for (const [i, s] of good.entries())
          await check('static SVG allowed ' + i, () =>
            validateSuiteAsset('a.svg', 'image/svg+xml', utf8(s)),
          );
        const bad = [
          svg('<script/>'),
          svg('<g onload="x"/>'),
          svg('<foreignObject/>'),
          svg('<animate/>'),
          svg('<style/>'),
          svg('<image href="a.png"/>'),
          svg('<use href="#x"/>'),
          svg('<x:g xmlns:x="urn:evil"/>'),
          svg('<path unknown="1"/>'),
          svg('<path fill="url(https://example.com/a) red"/>'),
          svg('<path style="fill:u\\72l(data:text/plain,a)"/>'),
          svg('<path style="--x:red;fill:var(--x)"/>'),
          svg('<path style="@import url(x);"/>'),
          svg('<path style="fill:red!important"/>'),
          svg('<path fill="url(#missing)"/>'),
          svg('<defs><mask id="m"/></defs><path fill="url(#m)"/>'),
          svg('<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>'),
          svg('<mask id="m"><path mask="url(#m)"/></mask>'),
          svg('<g id="x"/><g id="x"/>'),
          svg('<svg/>'),
          svg('<path d="M1"/>'),
          svg('<path d="M0,,0"/>'),
          svg('<path d="M0 0 L1 1,"/>'),
          svg('<g transform="translate(1,,2)"/>'),
          svg('<text x="1,,2">x</text>'),
          svg('<g id="a\u0080"/>'),
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,,0,1,1"/>',
          svg('<rect width="Infinity"/>'),
          '<!DOCTYPE svg [<!ENTITY bad SYSTEM "http://example.com">]>' + svg('<text>&bad;</text>'),
          svg('<path fill="url(&#104;ttps://example.com)"/>'),
          svg('<path xml:base="http://example.com"/>'),
        ];
        for (const [i, s] of bad.entries())
          await check('static SVG rejects ' + i, () =>
            rejects(() => validateSuiteAsset('a.svg', 'image/svg+xml', utf8(s))),
          );
        await check('real archive binary roundtrip and literal digest', async () => {
          const b = vectors.bundle as UiSuiteBundle;
          assert((await bundleDigest(b)) === vectors.digest);
          assert(
            (await bundleDigest(await decodeSuiteArchive(await encodeSuiteArchive(b)))) ===
              vectors.digest,
          );
        });
        await check(
          'header-valid WOFF2 failure keeps previous publication and revision',
          async () => {
            const f = fixtures.find((f) => f.name === 'TestWOFF2.woff2')!,
              bytes = decodeBase64(f.data).slice(0, 444),
              view = new DataView(bytes.buffer);
            view.setUint32(8, 444);
            view.setUint32(20, 364);
            inspectSuiteAsset(f.name, f.media, bytes);
            const b = structuredClone(vectors.bundle) as UiSuiteBundle;
            b.files['bad.woff2'] = {
              encoding: 'base64',
              media_type: f.media,
              data: encodeBase64(bytes),
            };
            b.manifest.files.push({
              path: 'bad.woff2',
              kind: 'asset',
              media_type: f.media,
              bytes: bytes.length,
              sha256: await sha256(bytes),
            });
            parseSuiteBundle(b);
            await bundleDigest(b);
            let published = 'previous';
            await rejects(async () => {
              await validateSuiteBundle(b);
              published = 'bad';
            });
            assert(published === 'previous');
            const library: UiSuiteLibrary = {
              kind: 'paradox-ui-suite-library',
              schema_version: 1,
              revision: 19,
              active_suite_id: null,
              suites: [
                {
                  instance_id: '00d04927-d14e-4f83-8a62-723207634605',
                  manifest: b.manifest,
                  parent_snapshot: null,
                  overlay: b.files,
                  deleted: [],
                },
              ],
            };
            const data = await validateSuiteLibraryData(library);
            assert(data.revision === 19);
            await rejects(() => validateSuiteLibrary(data));
            assert(data.revision === 19);
          },
        );
        await check('candidate mutation cannot change awaited published bytes', async () => {
          const candidate = structuredClone(vectors.bundle) as UiSuiteBundle,
            original = candidate.files['Home.tsx'];
          const pending = validateSuiteBundle(candidate);
          candidate.files['Home.tsx'] = { encoding: 'utf8', text: 'changed during await' };
          const accepted = await pending;
          assert(JSON.stringify(accepted.files['Home.tsx']) === JSON.stringify(original));
        });
        await check('all real bitmap handles closed and fonts never registered', () => {
          assert(createdBitmaps === closedBitmaps);
          assert(createdBitmaps > 0 && fontLoads > 0);
          assert(document.fonts.size === fontSetSize);
        });
      } finally {
        window.createImageBitmap = originalBitmap;
        FontFace.prototype.load = originalFontLoad;
      }
      return { checks, failures, createdBitmaps, closedBitmaps, fontLoads };
    },
  };
}
