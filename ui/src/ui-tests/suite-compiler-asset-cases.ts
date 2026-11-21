import assetFixtures from "../../scripts/fixtures/ui-suite/browser-assets.json";

import { compileSuite, compileSuiteInScope } from "../ui-suite/compiler";
import {
  createSuiteRuntimeScope,
  attachSuiteStyles,
} from "../ui-suite/prepared";

import { encodeBase64, sha256, utf8 } from "../ui-suite/canonical";

import { source, make } from "./suite-compiler-support";
import type { CompilerFixtureContext } from "./suite-compiler-support";

export async function checkAssetCleanup(context: CompilerFixtureContext) {
  const { assert, rejects, check, host, live, detaches, keep, render } =
    context;
  await check("assets_csp_and_failure_cleanup", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1;
    canvas.getContext("2d")!.fillRect(0, 0, 1920, 1);
    const png = {
      encoding: "base64" as const,
      media_type: "image/png",
      data: canvas.toDataURL("image/png").split(",")[1],
    };
    const font = assetFixtures.find((f) => f.media === "font/woff2")!;
    const files = {
      "Home.tsx": source(
        "import image from './wide.png';export default ()=><div className='leased'><img src={image} alt='leased 1920'/><span>Font lease</span></div>",
      ),
      "wide.png": png,
      "font.woff2": {
        encoding: "base64" as const,
        media_type: font.media,
        data: font.data,
      },
      "style.css": source(
        "@font-face{font-family:SuiteTest;src:url('./font.woff2')} .leased{font-family:SuiteTest;--image:url('./wide.png');background-image:var(--image)}",
      ),
    };
    const scope = createSuiteRuntimeScope(),
      p = keep(await compileSuiteInScope(await make(files, true), scope));
    render(p);
    detaches.push(
      attachSuiteStyles(document, p, {
        id: "launcher.main",
        viewIds: new Set(["page.home"]),
        resolveTarget: () => null,
      }),
    );
    const img = host.querySelector("img")!;
    await img.decode();
    assert(img.naturalWidth === 1920, "leased image naturalWidth 1920");
    await document.fonts.ready;
    assert(
      [...document.fonts].some((f) => f.status === "loaded"),
      "leased CSS font loaded",
    );
    const activeDigest = p.digest,
      count = live.size;
    for (const bad of [
      "import './missing';export default()=>null",
      "import './amb';export default()=>null",
      "export default()=> <",
      "export default 42",
      "throw Error('factory failure');export default()=>null",
    ]) {
      const candidate = await make(
        {
          ...files,
          "Home.tsx": source(bad),
          "amb.ts": source(""),
          "amb.tsx": source(""),
        },
        true,
      );
      await rejects(() => compileSuiteInScope(candidate, scope));
      assert(p.digest === activeDigest, "failed compile retains active digest");
      assert(live.size === count, "failed compile no leaked URL");
    }
    const next = keep(
      await compileSuiteInScope(
        await make(
          { ...files, "style.css": source(".leased{color:blue}") },
          true,
        ),
        scope,
      ),
    );
    assert(
      next.views.get("page.home") === p.views.get("page.home"),
      "static asset URL captures retained component",
    );
    p.dispose();
    render(next);
    await host.querySelector("img")!.decode();
    assert(
      live.has(img.src),
      "module asset stays leased after old prepared disposal",
    );
    const changedPng = {
      ...png,
      data: assetFixtures.find((f) => f.media === "image/png")!.data,
    };
    const changed = keep(
      await compileSuiteInScope(
        await make({ ...files, "wide.png": changedPng }, true),
        scope,
      ),
    );
    assert(
      changed.views.get("page.home") !== next.views.get("page.home"),
      "imported bytes invalidate code identity",
    );
    next.dispose();
    changed.dispose();
  });
}

export async function checkAssetValidationCancellation(
  context: CompilerFixtureContext,
) {
  const { assert, rejects, check, live } = context;
  await check("full_asset_gate_and_async_validation_cancellation", async () => {
    (globalThis as Record<string, unknown>).__suiteExecuted = 0;
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const b = await make({
      "Home.tsx": source("globalThis.__suiteExecuted++;export default()=>null"),
    });
    b.files["invalid.svg"] = {
      encoding: "base64",
      media_type: "image/svg+xml",
      data: encodeBase64(svg),
    };
    b.manifest.files.push({
      path: "invalid.svg",
      kind: "asset",
      media_type: "image/svg+xml",
      bytes: svg.length,
      sha256: await sha256(svg),
    });
    const count = live.size;
    await rejects(() => compileSuite(b));
    assert(
      live.size === count &&
        (globalThis as Record<string, unknown>).__suiteExecuted === 0,
      "full XML policy gate before executable resources",
    );
    const png = assetFixtures.find((f) => f.media === "image/png")!;
    const raster = await make({
      "Home.tsx": source("globalThis.__suiteExecuted++;export default()=>null"),
      "pixel.png": {
        encoding: "base64",
        media_type: png.media,
        data: png.data,
      },
    });
    const controller = new AbortController(),
      bitmap = Object.getOwnPropertyDescriptor(window, "createImageBitmap")!
        .value as typeof createImageBitmap;
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      const result = await bitmap(...args);
      controller.abort();
      return result;
    }) as typeof createImageBitmap;
    try {
      await rejects(
        () => compileSuite(raster, controller.signal),
        /Abort|cancel/,
      );
    } finally {
      window.createImageBitmap = bitmap;
    }
    assert(
      live.size === count &&
        (globalThis as Record<string, unknown>).__suiteExecuted === 0,
      "post-validation cancellation before acquisition/initialize",
    );
  });
}
