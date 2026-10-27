// Vendored @tldraw/assets 5.5.2. Bundled data URLs work offline in Expo DOM
// (including file origins) and cannot silently fall back to the tldraw CDN.
import { defaultEditorAssetUrls, iconTypes, LANGUAGES } from "tldraw";
import bundled from "./tldraw-assets/bundled.json";

const files: Record<string, string> = bundled;
const asset = (name: string): string => {
  const uri = files[name];
  if (!uri) throw new Error(`Missing bundled tldraw asset: ${name}`);
  return uri;
};
export const annotationAssetUrls = {
  fonts: Object.fromEntries(Object.entries(defaultEditorAssetUrls.fonts ?? {}).map(([key, uri]) => [key, asset(`fonts/${uri?.split("/").at(-1)}`)])),
  icons: Object.fromEntries(iconTypes.map(name => [name, `${asset("icons/icon/0_merged.svg")}#${name}`])),
  translations: Object.fromEntries(LANGUAGES.map(language => [language.locale, asset("translations/en.json")])),
};
