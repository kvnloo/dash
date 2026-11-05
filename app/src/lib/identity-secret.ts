// Non-native entry stays importable by boundary tests; native uses identity-secret.native.ts.
export async function loadIdentitySecret(key: string): Promise<string | null> {
  return (await import("./secure")).getSecret(key);
}
