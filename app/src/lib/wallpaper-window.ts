// Web renders a preview; it cannot access the system wallpaper.
export const wallpaperAvailable = true;
export async function setWallpaperWindow(enabled: boolean): Promise<boolean> {
  return enabled;
}
