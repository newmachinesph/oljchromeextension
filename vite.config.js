import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(projectRoot, 'dist');

/**
 * Assembles a complete, loadable extension into `dist/` after Vite has built
 * the React options page into `dist/options`.
 *
 * The unpacked dev extension is the repo root (its manifest points at
 * `dist/options/...`). For the Chrome Web Store we need a single folder whose
 * root IS the manifest, so this plugin copies the runtime pieces into `dist/`
 * and rewrites the manifest's `dist/options/` paths to `options/`. The result:
 * zip the contents of `dist/` and `manifest.json` sits at the zip root.
 *
 * Deliberately excluded: `src/options` (raw React source — the built page lives
 * in `dist/options`) and `icons/source-1024.png` (the design master, which is
 * kept in `store-assets/`, not `icons/`, so it never lands here).
 */
/**
 * Fail the build when a packaging rewrite matched nothing.
 *
 * Every rewrite here exists because the packaged extension must differ from the
 * unpacked one. A rewrite that silently no-ops after a rename would ship the
 * dev value to the Chrome Web Store — a store build pointed at localhost, which
 * is broken for every user and looks fine from here. Loud is the only safe
 * failure mode.
 */
function assertChanged(before, after, what) {
  if (before === after) {
    throw new Error(`package-extension: nothing to rewrite for ${what} — the source text changed, so this build would ship the dev value`);
  }
}

function packageExtension() {
  return {
    name: 'package-extension',
    apply: 'build',
    closeBundle() {
      // Clear anything a previous packaging run left behind (Vite's
      // emptyOutDir only clears dist/options, not the rest of dist/).
      for (const stale of ['manifest.json', 'icons', 'src', 'vendor']) {
        rmSync(join(distDir, stale), { recursive: true, force: true });
      }

      /*
       * manifest.json: point option-page URLs at the packaged location, and
       * drop the localhost host permission.
       *
       * `http://localhost:3100/*` is how the unpacked extension talks to a dev
       * server. Shipping it asks the Web Store to approve a permission the
       * published extension never uses, which is both a review flag and a
       * promise to users that is not true.
       */
      const manifest = readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8');
      const parsed = JSON.parse(manifest);

      // Parsed, not pattern-matched: the localhost entry is last in the array,
      // and deleting it textually left the previous comma dangling — a manifest
      // that is invalid JSON and will not load at all.
      const before = parsed.host_permissions ?? [];
      parsed.host_permissions = before.filter((h) => !/^http:\/\/localhost(:\d+)?\//.test(h));
      if (parsed.host_permissions.length === before.length) {
        throw new Error('package-extension: no localhost host permission found to strip');
      }

      // Same treatment for externally_connectable: the localhost match exists
      // only so the dev server's connect page can hand tokens to the unpacked
      // extension. The store build must list the production origin alone.
      const ecBefore = parsed.externally_connectable?.matches ?? [];
      parsed.externally_connectable.matches = ecBefore.filter(
        (m) => !/^http:\/\/localhost(:\d+)?\//.test(m),
      );
      if (parsed.externally_connectable.matches.length === ecBefore.length) {
        throw new Error('package-extension: no localhost externally_connectable match found to strip');
      }

      const packagedManifest = JSON.stringify(parsed, null, 2).replaceAll('dist/options/', 'options/');
      assertChanged(manifest, packagedManifest, 'manifest option-page paths');
      JSON.parse(packagedManifest); // never write a manifest we cannot read back
      writeFileSync(join(distDir, 'manifest.json'), packagedManifest);

      // Toolbar/store icons (source master already lives outside icons/).
      cpSync(resolve(projectRoot, 'icons'), join(distDir, 'icons'), {
        recursive: true,
      });

      /*
       * Vendored third-party assets.
       *
       * The manifest names `vendor/winbox/winbox.min.css` in content_scripts
       * and `vendor/winbox/*.js` in web_accessible_resources, so leaving this
       * out did not degrade the package - it made it REFUSE TO INSTALL, with
       * "Could not load css 'vendor/winbox/winbox.min.css' for script". The
       * unpacked dev extension is the repo root, where vendor/ has always been
       * present, so nothing caught it until dist/ was loaded on its own.
       */
      cpSync(resolve(projectRoot, 'vendor'), join(distDir, 'vendor'), {
        recursive: true,
      });

      // Runtime ES modules: background worker, content scripts, core, popup.
      // Skip src/options — that is the React source, already built to dist/options.
      const srcOptions = resolve(projectRoot, 'src', 'options');
      mkdirSync(join(distDir, 'src'), { recursive: true });
      cpSync(resolve(projectRoot, 'src'), join(distDir, 'src'), {
        recursive: true,
        filter: (source) => source !== srcOptions && !source.startsWith(srcOptions + '\\') && !source.startsWith(srcOptions + '/'),
      });

      /*
       * Point the packaged extension at production.
       *
       * The repo root is the unpacked dev extension and talks to a local dev
       * server, which is the right default for the thing you load from disk all
       * day. But that value is a constant in a source file, so packaging it
       * unchanged would upload a Chrome Web Store build whose every AI call,
       * sign-in and checkout goes to http://localhost:3100 — working perfectly
       * on the machine that built it and for nobody else.
       *
       * Doing it here rather than by editing the source keeps "the store build
       * points at production" a property of the build instead of something
       * somebody has to remember before every upload.
       */
      const accountPath = join(distDir, 'src', 'core', 'account.js');
      const account = readFileSync(accountPath, 'utf8');
      const packagedAccount = account.replace(
        /export const API_BASE = '[^']*';.*/,
        "export const API_BASE = 'https://oljextension.site';",
      );
      assertChanged(account, packagedAccount, 'API_BASE');
      writeFileSync(accountPath, packagedAccount);

      /*
       * And again inside the built options page.
       *
       * The rewrite above patches the copy of account.js that the content
       * script loads. It does not touch the options bundle, because Vite
       * compiled that from `src/core/account.js` in the SOURCE tree, where the
       * constant is still the dev localhost - so the value was inlined and
       * minified into the chunk before this plugin ever ran.
       *
       * The effect was a store build where the job board talked to production
       * and the extension's own settings and dashboard talked to the machine
       * that built it: signing in from the options page would simply hang.
       * Patching the emitted asset is the narrow fix; the alternative is
       * threading the value through `define`, which changes how the source
       * reads during development for no gain.
       */
      /*
       * The dock opens each mini app in an iframe pointed at the options page
       * BY PATH, and that path differs between the two layouts: the unpacked
       * dev extension serves it from `dist/options/index.html`, the packaged
       * one from `options/index.html`.
       *
       * The manifest rewrite above already moves `dist/options/` to `options/`
       * - including in web_accessible_resources - but the content scripts name
       * the same path in code, and nothing was rewriting those. So a packaged
       * build framed a URL that does not exist and is not web-accessible, and
       * Chrome refused it with "This page has been blocked by Chrome". Every
       * dock widget, every time.
       *
       * Same shape of fault as API_BASE: a value that is correct for the thing
       * you load from disk and wrong for the thing you upload.
       */
      const contentDir = join(distDir, 'src');
      let rewroteDockPaths = false;
      for (const entry of readdirSync(contentDir, { recursive: true })) {
        const name = String(entry);
        if (!name.endsWith('.js')) continue;
        const filePath = join(contentDir, name);
        const before = readFileSync(filePath, 'utf8');
        const after = before.split('dist/options/').join('options/');
        if (before !== after) {
          writeFileSync(filePath, after);
          rewroteDockPaths = true;
        }
      }
      if (!rewroteDockPaths) {
        throw new Error(
          'package-extension: no source file referenced dist/options/ — either the dock stopped pointing at the options page, or this build would ship an unframeable path',
        );
      }

      const assetsDir = join(distDir, 'options', 'assets');
      let rewroteBundle = false;
      for (const entry of readdirSync(assetsDir)) {
        if (!entry.endsWith('.js')) continue;
        const assetPath = join(assetsDir, entry);
        const asset = readFileSync(assetPath, 'utf8');
        /*
         * Both dev values, not just the API base.
         *
         * The options bundle also carries the widget catalogue - it imports
         * core/dock.js for the dock settings UI - so the Settings descriptor's
         * `page: 'dist/options/index.html'` was inlined here too, pointing at a
         * path the packaged extension does not have. Third time this same
         * substitution has been missed in a new place, which is the argument
         * for doing both in one pass rather than one string at a time.
         */
        const packagedAsset = asset
          .split('http://localhost:3100')
          .join('https://oljextension.site')
          .split('dist/options/')
          .join('options/');
        if (asset !== packagedAsset) {
          writeFileSync(assetPath, packagedAsset);
          rewroteBundle = true;
        }
      }
      // Same reasoning as assertChanged: a silent no-op here ships localhost.
      if (!rewroteBundle) {
        throw new Error(
          'package-extension: no options bundle contained the dev API base — this build would ship localhost in the settings page',
        );
      }
    },
  };
}

/**
 * Builds only the React options page.
 *
 * The content script is deliberately outside this build: it ships as plain ES
 * modules that Chrome loads directly, so the filtering logic never depends on
 * a bundler having run.
 */
export default defineConfig({
  root: 'src/options',
  // Relative URLs: the built page is served from chrome-extension://<id>/, where
  // absolute /assets/... paths would not resolve.
  base: './',
  plugins: [react(), packageExtension()],
  build: {
    outDir: '../../dist/options',
    emptyOutDir: true,
    target: 'chrome110',
  },
});
