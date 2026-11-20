import fc from 'fast-check';
import type { Bbox, City, Received, Role, Seed } from './harness.ts';

const cityOfStaff: Partial<Record<Role, City>> = { 'a-staff': 'A', 'b-staff': 'B' };

export const regionLeaks = (role: Role, received: Received[], seed: Seed) => {
	const own = cityOfStaff[role];
	return own ? received.filter((f) => seed.cityOf(f.id) !== own).map((f) => f.id) : [];
};

export const secretLeaks = (role: Role, received: Received[]) =>
	role === 'viewer' ? received.filter((f) => 'owner_name' in f.properties).map((f) => f.id) : [];

export const privateLeaks = (role: Role, received: Received[], seed: Seed) =>
	role === 'viewer' ? received.filter((f) => !seed.isPublic(f.id)).map((f) => f.id) : [];

export const canWrite = (role: Role, city: City) => role === 'admin' || cityOfStaff[role] === city;

export const bboxIn = ([west, south, east, north]: Bbox) => {
	const x = fc.double({ min: west, max: east, noNaN: true });
	const y = fc.double({ min: south, max: north, noNaN: true });
	return fc
		.tuple(x, x, y, y)
		.map(([x1, x2, y1, y2]): Bbox => [
			Math.min(x1, x2),
			Math.min(y1, y2),
			Math.max(x1, x2),
			Math.max(y1, y2)
		]);
};
