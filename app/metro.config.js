// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// `shared/protocol.ts` lives one level up and is imported by both app and server.
const punycodePath = require.resolve("punycode");
const ripple = path.resolve(__dirname, "vendor/ripple");
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "..", "shared"), ripple];
// markdown-it pulls Node's `punycode`; polyfill it for React Native.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  punycode: punycodePath,
  "@kvnloo/ripple": ripple,
};
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "punycode") {
    return { type: "sourceFile", filePath: punycodePath };
  }
  if (moduleName === "@kvnloo/ripple") {
    return { type: "sourceFile", filePath: path.join(ripple, "src/index.ts") };
  }
  if (upstreamResolve) return upstreamResolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
