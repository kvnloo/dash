// Metro selects this file on Android/iOS: credential access must not fetch a lazy JS segment.
import { getSecret } from "./secure";
export const loadIdentitySecret = (key: string): Promise<string | null> => getSecret(key);
