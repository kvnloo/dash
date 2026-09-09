// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// `shared/protocol.ts` lives one level up and is imported by both app and server.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "..", "shared")];
// markdown-it pulls Node's `punycode`; polyfill it for React Native.
const punycodePath = require.resolve("punycode");
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
