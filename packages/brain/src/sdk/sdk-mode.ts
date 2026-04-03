// Sets SDK mode globally BEFORE config.ts evaluates.
// This file MUST be imported as the first import in cortex.ts.
(globalThis as any).__CLUDE_SDK_MODE = true;
