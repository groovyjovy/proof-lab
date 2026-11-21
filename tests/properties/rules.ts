import fc from 'fast-check';
import { seedUsers } from '../../db/seed.ts';
import { startOracle } from '../../scripts/spec-oracle.ts';
import type { Bbox, City, Received, Role, Seed } from './harness.ts';

// 認可の判断は、Lean の仕様(spec/Spec/Authz.lean)の判断表から引く。テストの中で判断を書き直さない。
// だからここでの性質テストは「PostgreSQL の RLS が、証明済みの仕様と同じ判断をする」ことを確かめる。
type Decision = {
	role: Role;
	canEdit: boolean;
	city: City;
	public: boolean;
	canRead: boolean;
	canWrite: boolean;
	seesOwner: boolean;
};

const oracle = startOracle();
const table = (await oracle.ask({ authzTable: true })) as Decision[];
oracle.close();

function decision(role: Role, city: City, isPublic: boolean) {
	const canEdit = seedUsers.find((u) => u.user === role)?.canEdit;
	const found = table.find(
		(d) => d.role === role && d.canEdit === canEdit && d.city === city && d.public === isPublic
	);
	if (!found) throw new Error(`仕様の判断表に ${role}・${city}・公開 ${isPublic} がない`);
	return found;
}

export const canRead = (role: Role, id: string, seed: Seed) =>
	decision(role, seed.cityOf(id), seed.isPublic(id)).canRead;

export const canWrite = (role: Role, city: City) => decision(role, city, true).canWrite;

export const seesOwner = (role: Role) => decision(role, 'A', true).seesOwner;

/** 仕様では読めないのに届いた地物(P1・P7 は仕様の定理) */
export const unreadable = (role: Role, received: Received[], seed: Seed) =>
	received.filter((f) => !canRead(role, f.id, seed)).map((f) => f.id);

/** 仕様と違う `owner_name` の出し方(P2 は仕様の定理) */
export const ownerMismatch = (role: Role, received: Received[]) =>
	received.filter((f) => 'owner_name' in f.properties !== seesOwner(role)).map((f) => f.id);

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
