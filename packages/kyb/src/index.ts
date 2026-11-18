export * from './types.js';

// Providers are NOT re-exported. Apps import the one selected by config:
//   import { makeStubKYBProvider }   from '@proofline/kyb/providers/stub.js'
//   import { makeBaselayerProvider } from '@proofline/kyb/providers/baselayer.js'  (primary)
//   import { makeCobaltProvider }    from '@proofline/kyb/providers/cobalt.js'     (fallback)
