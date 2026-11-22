import { installPerformanceBufferTrim } from "./lib/performance-buffer";

// Both bootstraps: bound the performance measure buffer for the whole app lifetime.
installPerformanceBufferTrim(globalThis.performance);
