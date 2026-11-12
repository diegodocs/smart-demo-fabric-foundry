import { PHARMA_LAYOUT, pharmaRoute } from './layout.js';

function positionAlong(points, distance) {
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (distance <= length || index === points.length - 1) {
      const progress = length ? Math.min(1, distance / length) : 1;
      return {
        x: start.x + (end.x - start.x) * progress,
        z: start.z + (end.z - start.z) * progress,
        heading: length ? Math.atan2(end.x - start.x, end.z - start.z) : null,
      };
    }
    distance -= length;
  }
  return { ...points[0], heading: null };
}

export function createTruckMotion(x, z, heading) {
  return { x, z, heading, connected: false, sampleTime: 0, points: [], length: 0, startedAt: 0, duration: 0, targetHeading: heading };
}

export function updateTruckMotion(motion, reading, now) {
  const previousX = motion.x, previousZ = motion.z;
  if (reading.commLost || !Number.isFinite(reading.positionX) || !Number.isFinite(reading.positionZ)
    || !Number.isFinite(reading.lastSeen)) {
    motion.connected = false;
    return { x: motion.x, z: motion.z, heading: motion.heading, travelled: 0 };
  }
  if (!motion.connected) {
    Object.assign(motion, {
      x: reading.positionX, z: reading.positionZ,
      heading: Number.isFinite(reading.heading) ? reading.heading : motion.heading,
      connected: true, sampleTime: reading.lastSeen, duration: 0, points: [],
    });
    return { x: motion.x, z: motion.z, heading: motion.heading, travelled: 0 };
  }
  if (motion.duration > 0) {
    const progress = Math.max(0, Math.min(1, (now - motion.startedAt) / motion.duration));
    const pose = positionAlong(motion.points, motion.length * progress);
    motion.x = pose.x;
    motion.z = pose.z;
    motion.heading = progress >= 1 ? motion.targetHeading : pose.heading ?? motion.heading;
  }
  if (reading.lastSeen > motion.sampleTime) {
    if (reading.isRunning === false || !(reading.speedKmh > 0)) {
      Object.assign(motion, {
        x: reading.positionX, z: reading.positionZ,
        heading: Number.isFinite(reading.heading) ? reading.heading : motion.heading,
        sampleTime: reading.lastSeen, duration: 0, points: [],
      });
      return { x: motion.x, z: motion.z, heading: motion.heading, travelled: 0 };
    }
    const start = { x: motion.x, z: motion.z };
    const end = { x: reading.positionX, z: reading.positionZ };
    const diagonal = Math.abs(start.x - end.x) > 1e-6 && Math.abs(start.z - end.z) > 1e-6;
    const highway = [start, end].some((point) => Math.abs(point.z - PHARMA_LAYOUT.roadZ) < 1e-6);
    const cityStreet = !highway && [start, end].some((point) => Math.abs(point.z - PHARMA_LAYOUT.cityRoadZ) < 1e-6);
    const points = diagonal ? pharmaRoute(start, end, cityStreet ? PHARMA_LAYOUT.cityRoadZ : PHARMA_LAYOUT.roadZ) : [start, end];
    const length = points.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point.x - points[index].x, point.z - points[index].z), 0);
    const interval = reading.lastSeen - motion.sampleTime;
    Object.assign(motion, {
      points, length, startedAt: now,
      duration: Math.max(250, Math.min(20000, interval)),
      sampleTime: reading.lastSeen,
      targetHeading: Number.isFinite(reading.heading) ? reading.heading : motion.heading,
    });
  }
  return {
    x: motion.x, z: motion.z, heading: motion.heading,
    travelled: Math.hypot(motion.x - previousX, motion.z - previousZ),
  };
}
