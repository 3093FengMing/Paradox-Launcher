/* eslint-disable @typescript-eslint/unbound-method -- Test instrumentation restores native methods by identity. */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import i18n from "../i18n";

import type { PreparedUiSuite } from "../ui-suite/prepared";

import {
  prepareSuiteCss,
  createSuiteStyleRewriter,
} from "../customization/css";

import { viewProps } from "./suite-compiler-support";
import {
  checkAnimationGrammar,
  checkCustomPropertyCascade,
  checkCaseSensitiveStyleIdentities,
  checkRegisteredMirrorDefaults,
  checkActualAmbiguousConsumers,
} from "./suite-compiler-css-animation";
import {
  checkLiteralRegistrationInheritance,
  checkAnimationVariablePositions,
  checkEscapedCustomProperties,
  checkRegistrationRepetition,
  checkTypedRegistrationDefaults,
} from "./suite-compiler-css-registration";
import {
  checkRelativeModules,
  checkDependencyAndCssState,
  checkDeferredInitialization,
  checkPublicModulePolicy,
} from "./suite-compiler-module-cases";
import {
  checkAssetCleanup,
  checkAssetValidationCancellation,
} from "./suite-compiler-asset-cases";
import {
  checkSourceAwareStyles,
  checkInlineStyleIdentity,
} from "./suite-compiler-style-cases";
import { checkHtmlEventProjections } from "./suite-compiler-html-cases";

declare global {
  interface Window {
    suiteCompilerFixture: {
      capture?: boolean;
      captureReady?: boolean;
      resumeCapture?: () => void;
      run(
        language: string,
      ): Promise<{ checks: string[]; failures: string[]; liveUrls: number }>;
      runCssFix1(
        language: string,
      ): Promise<{ checks: string[]; failures: string[]; liveUrls: number }>;
    };
  }
}
export function installSuiteCompilerFixture() {
  window.suiteCompilerFixture = {
    async runCssFix1(language) {
      await i18n.changeLanguage(language);
      const checks: string[] = [],
        failures: string[] = [];
      const host = document.createElement("section");
      host.id = "suite-compiler-acceptance";
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:white;color:black;padding:8px;overflow:auto";
      document.body.append(host);
      const assert = (ok: unknown, message: string) => {
        if (!ok) throw new Error(message);
      };
      const sample = (
        text: string,
        markup = '<div class="probe">CSS fixture</div>',
        target = false,
      ) => {
        const css = prepareSuiteCss(text, {
          sourcePath: "fix1-browser.css",
          resolveAsset: (r) => r,
        });
        const rewrite = createSuiteStyleRewriter([css], "fix1browser");
        const element = document.createElement("div");
        element.className = "fix1-boundary";
        element.innerHTML = markup;
        host.append(element);
        const style = document.createElement("style");
        style.textContent = rewrite.render(
          [css],
          false,
          target ? ".fix1-boundary" : undefined,
        );
        document.head.append(style);
        const inline = (node: HTMLElement, values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(rewrite.inline(values)))
            node.style.setProperty(
              key.startsWith("--") || key.includes("-")
                ? key
                : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
              String(value),
            );
        };
        return {
          element,
          rewrite,
          inline,
          remove() {
            element.remove();
            style.remove();
          },
        };
      };
      const check = (name: string, fn: () => void) => {
        try {
          fn();
          checks.push(name);
        } catch (error) {
          failures.push(name + ": " + String(error));
        }
      };
      try {
        checkAnimationGrammar({ assert, sample, check });
        checkCustomPropertyCascade({ assert, sample, check });
        checkCaseSensitiveStyleIdentities({ assert, sample, check });
        checkRegisteredMirrorDefaults({ assert, sample, check });
        checkActualAmbiguousConsumers({ assert, sample, check });
        checkLiteralRegistrationInheritance({ assert, sample, check });
        checkAnimationVariablePositions({ assert, sample, check });
        checkEscapedCustomProperties({ assert, sample, check });
        checkRegistrationRepetition({ assert, sample, check });
        checkTypedRegistrationDefaults({ assert, sample, check });
        host.replaceChildren();
        const summary = document.createElement("pre");
        summary.style.whiteSpace = "pre-wrap";
        summary.textContent = checks.join("\n");
        host.append(summary);
        if (window.suiteCompilerFixture.capture) {
          await new Promise<void>((resolve) => {
            window.suiteCompilerFixture.resumeCapture = resolve;
            window.suiteCompilerFixture.captureReady = true;
          });
          window.suiteCompilerFixture.captureReady = false;
          delete window.suiteCompilerFixture.resumeCapture;
        }
      } finally {
        host.remove();
      }
      return { checks, failures, liveUrls: 0 };
    },
    async run(language) {
      await i18n.changeLanguage(language);
      const checks: string[] = [],
        failures: string[] = [];
      const assert = (ok: unknown, message: string) => {
        if (!ok) throw Error(message);
      };
      const rejects = async (fn: () => Promise<unknown>, match?: RegExp) => {
        try {
          await fn();
        } catch (e) {
          if (match) assert(match.test(String(e)), String(e));
          return;
        }
        throw Error("Expected rejection");
      };
      const live = new Set<string>();
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        live.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        live.delete(url);
        revoke(url);
      };
      const host = document.createElement("section");
      host.id = "suite-compiler-acceptance";
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:white;color:black;overflow:auto;padding:8px";
      document.body.append(host);
      const root = createRoot(host),
        retained: PreparedUiSuite[] = [],
        detaches: (() => void)[] = [];
      const check = async (name: string, fn: () => Promise<void>) => {
        try {
          await fn();
          checks.push(name);
        } catch (e) {
          failures.push(`${name}: ${String(e)}`);
        }
      };
      const keep = <T extends PreparedUiSuite>(p: T) => {
        retained.push(p);
        return p;
      };
      const render = (p: PreparedUiSuite) =>
        flushSync(() =>
          root.render(createElement(p.views.get("page.home")!, viewProps)),
        );
      try {
        await checkRelativeModules({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkDependencyAndCssState({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkAssetCleanup({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkDeferredInitialization({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkPublicModulePolicy({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkSourceAwareStyles({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkHtmlEventProjections({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkInlineStyleIdentity({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
        await checkAssetValidationCancellation({
          assert,
          rejects,
          check,
          host,
          root,
          live,
          detaches,
          keep,
          render,
        });
      } finally {
        flushSync(() => root.unmount());
        for (const detach of detaches) detach();
        for (const p of retained) p.dispose();
        host.remove();
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
      }
      if (live.size) failures.push(`leakedAssetUrls: ${live.size}`);
      return { checks, failures, liveUrls: live.size };
    },
  };
}
