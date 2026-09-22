import * as esbuild from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageAliases = {
  "@tessera/protocol": resolve(__dirname, "../../packages/protocol/src/index.ts"),
  "@tessera/layout-core": resolve(__dirname, "../../packages/layout-core/src/index.ts"),
  "@tessera/rules-engine": resolve(__dirname, "../../packages/rules-engine/src/index.ts"),
};

async function bundle() {
  // 1. Standalone KWin Script Adapter
  await esbuild.build({
    entryPoints: [resolve(__dirname, "src/index.ts")],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    alias: packageAliases,
    target: "es2022",
    format: "iife",
    outfile: resolve(__dirname, "../../dist/kwin-adapter.js"),
    sourcemap: true,
    treeShaking: true,
  });

  // 2. QML Layouts Bridge for contents/code/layouts.js
  await esbuild.build({
    entryPoints: [resolve(__dirname, "src/qml-compat.ts")],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    alias: packageAliases,
    target: "es2022",
    format: "iife",
    globalName: "LayoutsModule",
    footer: {
      js: "var Layouts = LayoutsModule.Layouts;"
    },
    outfile: resolve(__dirname, "../../contents/code/layouts.js"),
    sourcemap: false,
    treeShaking: true,
  });

  // 3. QML Rules Bridge for contents/code/rules.js
  await esbuild.build({
    entryPoints: [resolve(__dirname, "src/qml-rules-compat.ts")],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    alias: packageAliases,
    target: "es2022",
    format: "iife",
    globalName: "RulesEngineModule",
    footer: {
      js: "var RuleEngine = RulesEngineModule.RuleEngine;"
    },
    outfile: resolve(__dirname, "../../contents/code/rules.js"),
    sourcemap: false,
    treeShaking: true,
  });

  // 4. QML Reconciler Bridge for contents/code/reconciler.js
  await esbuild.build({
    entryPoints: [resolve(__dirname, "src/qml-reconciler-compat.ts")],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    alias: packageAliases,
    target: "es2022",
    format: "iife",
    globalName: "ReconcilerModule",
    footer: {
      js: "var ReconcilerBridge = ReconcilerModule.ReconcilerBridge;\nvar RuntimeCoordinator = ReconcilerModule.RuntimeCoordinator;"
    },
    outfile: resolve(__dirname, "../../contents/code/reconciler.js"),
    sourcemap: false,
    treeShaking: true,
  });

  console.log("✅ Successfully built standalone KWin Adapter and updated layouts.js, rules.js, and reconciler.js");
}

bundle().catch((err) => {
  console.error(err);
  process.exit(1);
});
