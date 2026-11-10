import { loop } from '../../domain/routes.js';
export { routePose, hasVehicleClearance } from '../../domain/routes.js';

export const VEHICLE_ROUTES = {
  'TRT-001': loop(-11, -8, -5, -4, 1, 0.8),
  'PUL-001': loop(-11, -0.5, -5, 2, 0.9, 0.65),
  'CAM-001': loop(3.5, 1, 16, 3.2, 1, 1),
};
