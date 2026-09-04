import { createApplication as createProductionApplication } from '../src/app.js';

// Historical domain tests deliberately exercise pre-R2 identity fixtures. Their
// access substitution is explicit at this test-only composition root; production
// has no environment/header switch that enables it. R2 tests import src/app.js.
export function createApplication(options) {
  return createProductionApplication({...options,requestAccess:()=>undefined});
}
