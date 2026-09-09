import { CommonActions, createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";

export const debugNavigationRef = createNavigationContainerRef<RootStackParamList>();

type PendingNav = {
  name: keyof RootStackParamList;
  params?: RootStackParamList[keyof RootStackParamList];
};

const pending: PendingNav[] = [];

export function debugNavigate(name: keyof RootStackParamList, params?: RootStackParamList[keyof RootStackParamList]): void {
  if (debugNavigationRef.isReady()) {
    // @ts-expect-error react-navigation overload
    debugNavigationRef.navigate(name, params);
    return;
  }
  pending.push({ name, params });
}

export function debugResetTo(name: keyof RootStackParamList, params?: RootStackParamList[keyof RootStackParamList]): void {
  const action = CommonActions.reset({
    index: 0,
    routes: [{ name, params }],
  });
  if (debugNavigationRef.isReady()) {
    debugNavigationRef.dispatch(action);
    return;
  }
  pending.length = 0;
  pending.push({ name, params });
}

export function flushPendingDebugNavigation(): void {
  if (!debugNavigationRef.isReady()) return;
  while (pending.length > 0) {
    const next = pending.shift();
    if (!next) break;
    // @ts-expect-error react-navigation overload
    debugNavigationRef.navigate(next.name, next.params);
  }
}

export function waitForDebugNavigation(timeoutMs = 10_000): Promise<void> {
  if (debugNavigationRef.isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (debugNavigationRef.isReady()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Debug navigation ref not ready"));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
