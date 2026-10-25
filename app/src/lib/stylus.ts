export interface StylusButton { pressed: boolean }
export function observeStylus(_button: (event: StylusButton) => void, _selection: (text: string) => void): () => void { return () => {}; }
export async function regionText(_x: number, _y: number, _width: number, _height: number): Promise<string> { return ""; }
