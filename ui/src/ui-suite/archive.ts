import { Inflate, Zip, ZipDeflate } from 'fflate/browser';
import { inspectSuiteZip, inspectSuiteDeflate, suiteCrc32 } from './archive-structure';
import type { SuiteZipEntry } from './archive-structure';
import { suiteLimits as L } from './model';
import type { UiFile, UiSuiteBundle } from './model';
import { canonicalSuiteJson, decodeUtf8, encodeBase64, utf8 } from './canonical';
import { parseSuiteManifest, suiteFileBytes, validateSuiteBundle } from './bundle';
export async function decodeSuiteArchive(bytes: Uint8Array): Promise<UiSuiteBundle> {
  if (bytes.byteLength > L.total) throw new Error('ZIP input exceeds limit');
  const owned = bytes.slice(),
    entries = inspectSuiteZip(owned),
    counts = new Map<SuiteZipEntry, number>();
  let remaining = L.total;
  // All ranges are proved before any dependency inflation/allocation.
  for (const e of entries) {
    const maximum = Math.min(remaining, e.path === 'suite.json' ? L.manifest : L.asset),
      compressed = owned.subarray(e.dataStart, e.dataEnd),
      count =
        e.method === 0 ? compressed.length : inspectSuiteDeflate(compressed, maximum).outputBytes;
    if (count > maximum || count !== e.claimedBytes) throw new Error('ZIP actual count mismatch');
    counts.set(e, count);
    remaining -= count;
  }
  let actualTotal = 0;
  function decode(e: SuiteZipEntry): Uint8Array {
    const expected = counts.get(e)!,
      chunks: Uint8Array[] = [];
    let actual = 0;
    let failure: Error | undefined;
    const receive = (chunk: Uint8Array) => {
      if (failure) throw failure;
      if (chunk.length > expected - actual || chunk.length > L.total - actualTotal) {
        failure = new Error('ZIP decoded budget mismatch');
        throw failure;
      }
      actual += chunk.length;
      actualTotal += chunk.length;
      chunks.push(chunk.slice());
    };
    try {
      if (e.method === 0) receive(owned.subarray(e.dataStart, e.dataEnd));
      else {
        const inflater = new Inflate(receive);
        for (let p = e.dataStart; p < e.dataEnd; p += 65536) {
          if (failure) throw failure;
          inflater.push(owned.subarray(p, Math.min(e.dataEnd, p + 65536)), p + 65536 >= e.dataEnd);
        }
      }
      if (actual !== expected) throw new Error('ZIP decoded count mismatch');
      const data = new Uint8Array(actual);
      let p = 0;
      for (const c of chunks) {
        data.set(c, p);
        p += c.length;
      }
      if (suiteCrc32(data) !== e.crc32) throw new Error('ZIP decoded CRC mismatch');
      return data;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      chunks.length = 0;
      throw error;
    }
  }
  const manifestEntry = entries.find((e) => e.path === 'suite.json')!,
    manifest = parseSuiteManifest(JSON.parse(decodeUtf8(decode(manifestEntry))));
  const byName = new Map(entries.filter((e) => e !== manifestEntry).map((e) => [e.path, e]));
  if (byName.size !== manifest.files.length) throw new Error('ZIP manifest coverage mismatch');
  for (const d of manifest.files) {
    const e = byName.get(d.path);
    if (!e || counts.get(e) !== d.bytes || d.bytes > (d.kind === 'asset' ? L.asset : L.source))
      throw new Error('ZIP descriptor count mismatch');
  }
  const files = Object.create(null) as Record<string, UiFile>;
  for (const d of manifest.files) {
    const data = decode(byName.get(d.path)!);
    files[d.path] =
      d.kind === 'asset'
        ? { encoding: 'base64', media_type: d.media_type!, data: encodeBase64(data) }
        : { encoding: 'utf8', text: decodeUtf8(data) };
  }
  return validateSuiteBundle({ manifest, files });
}
export async function encodeSuiteArchive(bundle: UiSuiteBundle): Promise<Uint8Array> {
  const owned = await validateSuiteBundle(bundle),
    chunks: Uint8Array[] = [];
  let size = 0,
    finished = false,
    failure: Error | undefined;
  const zip = new Zip((error, chunk, final) => {
    if (failure) return;
    if (error) {
      failure = error;
      return;
    }
    if (chunk.length > L.total - size) {
      failure = new Error('ZIP output exceeds limit');
      return;
    }
    size += chunk.length;
    chunks.push(chunk.slice());
    finished = final;
  });
  const checkFailure = () => {
    if (failure) throw failure;
  };
  try {
    for (const [path, data] of [
      ['suite.json', utf8(canonicalSuiteJson(owned.manifest))],
      ...Object.entries(owned.files).map(([p, f]) => [p, suiteFileBytes(f)]),
    ] as [string, Uint8Array][]) {
      checkFailure();
      const file = new ZipDeflate(path, { level: 6 });
      file.mtime = new Date(2000, 0, 1);
      zip.add(file);
      for (let p = 0; p < data.length; p += 65536) {
        checkFailure();
        file.push(data.subarray(p, Math.min(data.length, p + 65536)), p + 65536 >= data.length);
      }
      if (!data.length) file.push(data, true);
    }
    zip.end();
    checkFailure();
    if (!finished) throw new Error('ZIP output incomplete');
    const result = new Uint8Array(size);
    let p = 0;
    for (const c of chunks) {
      result.set(c, p);
      p += c.length;
    }
    return result;
  } catch (error) {
    chunks.length = 0;
    throw error;
  }
}
