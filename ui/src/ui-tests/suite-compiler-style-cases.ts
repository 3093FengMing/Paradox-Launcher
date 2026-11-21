import { createElement } from "react";

import { flushSync } from "react-dom";

import assetFixtures from "../../scripts/fixtures/ui-suite/browser-assets.json";

import { normalizeDraftBundle } from "../ui-suite/bundle";
import { compileSuite, compileSuiteInScope } from "../ui-suite/compiler";
import {
  createSuiteRuntimeScope,
  attachSuiteStyles,
  SuiteInlineStyleContext,
  suiteInlineStyleResolver,
} from "../ui-suite/prepared";

import { source, make, viewProps } from "./suite-compiler-support";
import type { CompilerFixtureContext } from "./suite-compiler-support";

export async function checkSourceAwareStyles(context: CompilerFixtureContext) {
  const { assert, check, host, root, detaches, keep } = context;
  await check(
    "source_aware_styles_roots_targets_and_active_views",
    async () => {
      flushSync(() => root.render(null));
      const font = assetFixtures.find((f) => f.media === "font/woff2")!;
      const b = await make(
        {
          "Home.tsx": source("import './entry.css';export default()=>null"),
          "style.css": source(
            ":root{--suite-root:present}.probe{color:rgb(10,20,30)}",
          ),
          "entry.css": source(".entry{padding-top:19px}"),
          "target.css": source(
            ':scope{color:rgb(40,50,60)}@keyframes pulse{from{opacity:0}to{opacity:1}}@property --owned{syntax:"<number>";inherits:false;initial-value:0}@font-face{font-family:"Scoped Font";src:url("./font.woff2")} .label{animation:pulse 1s;font-family:"Scoped Font";--owned:2}',
          ),
          "position.css": source(":scope{border-top:7px solid red}"),
          "font.woff2": {
            encoding: "base64",
            media_type: font.media,
            data: font.data,
          },
        },
        true,
      );
      b.manifest.overrides = [
        {
          selector: { kind: "type", target: "test.target" },
          enabled: true,
          entry: null,
          stylesheet: "target.css",
        },
        {
          selector: {
            kind: "position",
            target: "test.position",
            locator: {
              version: 1,
              renderRoot: "launcher.main",
              calls: [],
              business: [],
            },
          },
          enabled: true,
          entry: null,
          stylesheet: "position.css",
        },
      ];
      const p = keep(await compileSuite(await normalizeDraftBundle(b)));
      const main = document.createElement("div"),
        editorHost = document.createElement("div");
      host.append(main, editorHost);
      const shadow = editorHost.attachShadow({ mode: "open" });
      main.innerHTML =
        '<div class="probe owned entry position"><span class="label">Main style</span></div><div class="probe outside">Outside</div>';
      shadow.innerHTML =
        '<div class="probe owned entry position"><span class="label">Editor style</span></div><div class="probe outside">Outside</div>';
      const resolveTarget = (selector: { target: string }) =>
        selector.target === "test.target" ? ".owned" : ".position";
      const d1 = attachSuiteStyles(document, p, {
        id: "launcher.main",
        viewIds: new Set(["page.home"]),
        resolveTarget,
      });
      detaches.push(d1);
      const d2 = attachSuiteStyles(shadow, p, {
        id: "launcher.editor",
        viewIds: new Set(),
        resolveTarget,
      });
      detaches.push(d2);
      const owned = main.querySelector(".owned")!,
        outside = main.querySelector(".outside")!,
        editor = shadow.querySelector(".owned")!;
      assert(
        getComputedStyle(owned).color === "rgb(40, 50, 60)" &&
          getComputedStyle(outside).color === "rgb(10, 20, 30)",
        "target CSS contains selector effects",
      );
      assert(
        getComputedStyle(owned).paddingTop === "19px" &&
          getComputedStyle(editor).paddingTop === "0px",
        "only active entry usage installed",
      );
      assert(
        getComputedStyle(owned).borderTopWidth === "7px" &&
          getComputedStyle(editor).borderTopWidth === "0px",
        "position renderRoot mismatch omitted",
      );
      assert(
        getComputedStyle(editor).color === "rgb(40, 50, 60)" &&
          getComputedStyle(editor).getPropertyValue("--suite-root") ===
            "present",
        "editor receives globals/target styles and :host variables",
      );
      const text = shadow.querySelector("style")!.textContent;
      assert(
        text.includes(":host") &&
          !/@keyframes pulse/.test(text) &&
          !text.includes('font-family:"Scoped Font"'),
        "side-effect names scoped",
      );
      if (window.suiteCompilerFixture.capture) {
        await document.fonts.ready;
        await new Promise<void>((resolve) => {
          window.suiteCompilerFixture.resumeCapture = resolve;
          window.suiteCompilerFixture.captureReady = true;
        });
        window.suiteCompilerFixture.captureReady = false;
        delete window.suiteCompilerFixture.resumeCapture;
      }
      d2();
      assert(!shadow.querySelector("style"), "synchronous detach");
      detaches.push(
        attachSuiteStyles(shadow, p, {
          id: "launcher.editor",
          viewIds: new Set(["page.home"]),
          resolveTarget,
        }),
      );
      assert(
        getComputedStyle(editor).paddingTop === "19px",
        "same actual view may render in editor",
      );
      p.dispose();
      assert(
        !shadow.querySelector("style"),
        "dispose detaches installed roots",
      );
      main.remove();
      editorHost.remove();
    },
  );
}

export async function checkInlineStyleIdentity(
  context: CompilerFixtureContext,
) {
  const { assert, check, host, root, keep } = context;
  await check(
    "current_inline_style_metadata_preserves_component_identity",
    async () => {
      const b = await make(
        {
          "view.html": source(
            '<input style="animation-name:pulse;--owned:2;color:var(--color)"/>',
          ),
          "style.css": source(
            '@keyframes pulse{from{opacity:0}to{opacity:1}}@property --owned{syntax:"<number>";inherits:false;initial-value:0}',
          ),
        },
        true,
      );
      for (const id of Object.keys(b.manifest.views))
        b.manifest.views[id] = "view.html";
      for (const route of b.manifest.routes) route.entry = "view.html";
      const scope = createSuiteRuntimeScope();
      const p = keep(
        await compileSuiteInScope(await normalizeDraftBundle(b), scope),
      );
      const show = (prepared: typeof p) =>
        flushSync(() =>
          root.render(
            createElement(
              SuiteInlineStyleContext.Provider,
              { value: suiteInlineStyleResolver(prepared) },
              createElement(prepared.views.get("page.home")!, viewProps),
            ),
          ),
        );
      show(p);
      const input = host.querySelector("input")!;
      input.value = "retained";
      const oldName = input.style.animationName;
      assert(
        oldName.includes("suite-") && !input.style.getPropertyValue("--owned"),
        "HTML inline descriptor references rewritten",
      );
      b.files["style.css"] = source(
        '@keyframes first{from{opacity:0}to{opacity:1}}@keyframes pulse{from{opacity:0}to{opacity:1}}@property --owned{syntax:"<number>";inherits:false;initial-value:0}',
      );
      const next = keep(
        await compileSuiteInScope(await normalizeDraftBundle(b), scope),
      );
      assert(
        input.style.animationName === oldName,
        "pending compile does not publish style maps",
      );
      assert(
        p.views.get("page.home") === next.views.get("page.home"),
        "HTML CSS-only Component reuse",
      );
      show(next);
      assert(
        host.querySelector("input") === input &&
          input.value === "retained" &&
          input.style.animationName !== oldName,
        "activated resolver updates inline style without remount",
      );
      const nameMap = suiteInlineStyleResolver(next)({
        fontWeight: 400,
        content: '"pulse"',
        animationName: "pulse",
      });
      assert(
        nameMap.fontWeight === 400 &&
          nameMap.content === '"pulse"' &&
          nameMap.animationName === input.style.animationName,
        "resolver preserves numeric/literal values",
      );
    },
  );
}
