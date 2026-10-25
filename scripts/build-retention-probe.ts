import { mkdir } from "node:fs/promises";
await mkdir(".memory-build", { recursive: true });
const build = await Bun.build({
  entrypoints: ["scripts/reply-retention-browser.ts"], target: "browser", outdir: ".memory-build", naming: "retention.js",
  define: { __DEV__: "false" },
  external: ["expo-*", "react-native-*", "react-native"],
  plugins: [{ name: "storage-adapter", setup(builder) {
    builder.onResolve({ filter: /(^|\/)secure$/ }, () => ({ path: "identity", namespace: "memory-adapter" }));
    builder.onLoad({ filter: /^identity$/, namespace: "memory-adapter" }, () => ({ contents: "export const getSecret=async()=>null; export const setSecret=async()=>{};", loader: "js" }));
    builder.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: "storage", namespace: "memory-adapter" }));
    builder.onLoad({ filter: /^storage$/, namespace: "memory-adapter" }, () => ({ contents: "export default {multiSet: async()=>{},setItem:async()=>{},multiRemove:async()=>{}}", loader: "js" }));
  } }],
});
if (!build.success) { console.error(build.logs); process.exit(1); }
