/** React Native's documented third constructor argument; DOM typings omit it.
 * The caller must reject web before using this (browsers silently ignore headers).
 * See react-native/src/types/globals.d.ts's WebSocket declaration.
 */
export interface HeaderSocketConstructor {
  new (url: string, protocols?: string[], options?: { headers: Record<string, string> }): WebSocket;
}

export function headerSocket(url: string, token: string, NativeSocket: HeaderSocketConstructor = WebSocket): WebSocket {
  return new NativeSocket(url, [], { headers: { Authorization: `Bearer ${token}` } });
}
