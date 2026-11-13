import { installReanimatedGcGuard } from "./lib/reanimated-gc-guard";

// Native only (bootstrap.tsx). Metro resolves react-native-reanimated to src/, so this
// deep path is the same module instance Reanimated's AnimatedComponent uses.
installReanimatedGcGuard(() => require("react-native-reanimated/src/PropsRegistryGarbageCollector"));
