import { listSensitiveDataClassifications } from './sensitive-data-types.js';

export function createSensitiveDataService() {
  return {
    listClassifications() {
      return listSensitiveDataClassifications();
    },
  };
}
