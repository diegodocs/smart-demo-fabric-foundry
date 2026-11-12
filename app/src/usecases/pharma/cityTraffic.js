import { hasVehicleClearance, loop, routePose } from '../../domain/routes.js';
import { PHARMA_LAYOUT } from './layout.js';

export const CITY_ROADS = {
  left: 4, shortcut: 32, right: 68, north: -17, south: PHARMA_LAYOUT.cityRoadZ, width: 6, radius: 4,
};
export const CITY_TRAFFIC_ROUTES = [
  loop(CITY_ROADS.left, CITY_ROADS.north, CITY_ROADS.shortcut, CITY_ROADS.south, CITY_ROADS.radius, 0),
  loop(CITY_ROADS.left, CITY_ROADS.north, CITY_ROADS.right, CITY_ROADS.south, CITY_ROADS.radius, 0),
];
export const CITY_TRAFFIC_COUNT = 3;
export const CITY_CAR_RADIUS = 1.9;
const JUNCTION_DISTANCE = CITY_ROADS.shortcut - CITY_ROADS.radius - CITY_ROADS.left - CITY_ROADS.radius;
const SHORT_MERGE_DISTANCE = CITY_TRAFFIC_ROUTES[0].segments.slice(0, 4)
  .reduce((distance, segment) => distance + segment.length, 0);
const MERGE_DISTANCES = [SHORT_MERGE_DISTANCE, SHORT_MERGE_DISTANCE + 2 * (CITY_ROADS.right - CITY_ROADS.shortcut)];
// Reserve the shared merge so cars approaching from both loops cannot block each other.
const MERGE_CLEARANCE = 12;

const inMerge = (routeIndex, distance) => Math.abs(distance - MERGE_DISTANCES[routeIndex]) < MERGE_CLEARANCE;

export function cityTruckObstacles(trucks) {
  return trucks.flatMap(({ x, z, heading }) => [-4, -2, 0, 2, 4].map((offset) => ({
    x: x + Math.sin(heading) * offset,
    z: z + Math.cos(heading) * offset,
    radius: 2.6,
  })));
}

const chooseRoute = (random) => Math.floor(random() * CITY_TRAFFIC_ROUTES.length);
const targetSpeed = (random) => 1.8 + random() * 1.6;
const nextChange = (random) => 3 + random() * 6;

export function createCityTraffic(obstacles = [], random = Math.random) {
  const cars = [];
  for (let index = 0; index < CITY_TRAFFIC_COUNT; index++) {
    let car;
    for (let attempt = 0; attempt < 100; attempt++) {
      const routeIndex = chooseRoute(random);
      const route = CITY_TRAFFIC_ROUTES[routeIndex];
      const distance = random() * route.length;
      const pose = routePose(route, distance);
      if (inMerge(routeIndex, distance) && cars.some((other) => inMerge(other.routeIndex, other.distance))) continue;
      if (!hasVehicleClearance(pose, CITY_CAR_RADIUS, [
        ...obstacles, ...cars.map((other) => ({ ...other, radius: CITY_CAR_RADIUS })),
      ])) continue;
      const speed = targetSpeed(random);
      car = { routeIndex, distance, ...pose, speed, targetSpeed: speed, changeIn: nextChange(random), travelled: 0 };
      break;
    }
    if (!car) throw new Error('Não foi possível posicionar os três carros da Smart City sem sobreposição.');
    cars.push(car);
  }
  return cars;
}

export function stepCityTraffic(cars, dt, obstacles = [], random = Math.random) {
  if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error('Intervalo de tráfego inválido (0..1 s).');
  for (const car of cars) {
    car.travelled = 0;
    car.changeIn -= dt;
    if (car.changeIn <= 0) {
      car.targetSpeed = targetSpeed(random);
      car.changeIn = nextChange(random);
    }
    const speed = Math.min(car.targetSpeed, car.speed + dt);
    const distance = speed * dt;
    let routeIndex = car.routeIndex;
    let nextDistance = car.distance + distance;
    const previousRoute = CITY_TRAFFIC_ROUTES[routeIndex];
    const crossingJunction = car.distance < JUNCTION_DISTANCE && nextDistance >= JUNCTION_DISTANCE;
    if (crossingJunction) {
      car.pendingRoute ??= chooseRoute(random);
      routeIndex = car.pendingRoute;
    }
    if (nextDistance >= previousRoute.length) {
      nextDistance -= previousRoute.length;
    }
    if (!inMerge(car.routeIndex, car.distance) && inMerge(routeIndex, nextDistance)
      && cars.some((other) => other !== car && inMerge(other.routeIndex, other.distance))) {
      car.speed = 0;
      continue;
    }
    const pose = routePose(CITY_TRAFFIC_ROUTES[routeIndex], nextDistance);
    const otherCars = cars.filter((other) => other !== car)
      .map((other) => ({ x: other.x, z: other.z, radius: CITY_CAR_RADIUS }));
    if (!hasVehicleClearance(pose, CITY_CAR_RADIUS, [...obstacles, ...otherCars])) {
      car.speed = 0;
      continue;
    }
    Object.assign(car, pose, { routeIndex, distance: nextDistance, speed, travelled: distance });
    if (crossingJunction) delete car.pendingRoute;
  }
}
