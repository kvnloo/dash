const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");

// WebBootstrap needs CanvasKit even when annotation uses tldraw (ShimmerText).
// Export the installed, lockfile-pinned WASM locally instead of contacting a CDN.
const publicDir = path.join(__dirname, "public");
fs.mkdirSync(publicDir, { recursive: true });
fs.copyFileSync(require.resolve("canvaskit-wasm/bin/full/canvaskit.wasm"), path.join(publicDir, "canvaskit.wasm"));

const config = getDefaultConfig(__dirname);
// Expo inlines public flags, but a warm transform cache can retain another variant.
// Namespace it by the actual public inputs without discarding each variant's cache.
const publicEnvironment = Object.keys(process.env).filter(key => key.startsWith("EXPO_PUBLIC_"))
  .sort().map(key => [key, process.env[key]]);
config.cacheVersion += `:${createHash("sha256").update(JSON.stringify(publicEnvironment)).digest("hex")}`;
// `shared/protocol.ts` lives one level up and is imported by both app and server.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "..", "shared")];
// markdown-it pulls Node's `punycode`; polyfill it for React Native.
const punycodePath = require.resolve("punycode/");
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  punycode: punycodePath,
};
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "punycode") {
    return { type: "sourceFile", filePath: punycodePath };
  }
  if (upstreamResolve) return upstreamResolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
