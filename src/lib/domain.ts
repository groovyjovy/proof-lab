export type City = 'A' | 'B';
export const roles = ['admin', 'a-staff', 'b-staff', 'viewer'] as const;
export type Role = (typeof roles)[number];
export type Me = { id: string; name: string; role: Role; canEdit: boolean };

export const roleOf = (value: unknown): Role => roles.find((r) => r === value) ?? 'viewer';

const cityOfRole = (role: Role): City | null =>
	role === 'a-staff' ? 'A' : role === 'b-staff' ? 'B' : null;

/** 読めるか。Lean の仕様(spec/Spec/Authz.lean の readCond)と、それから書き出した RLS と同じ判断。
    画面はこれで、権限が変わったあとに古いタイルの地物を選ばない(P15)。テストの判定もこれを使う。 */
export const canRead = (user: { role: Role }, feature: { city: City; public: boolean }) =>
	user.role === 'admin' ||
	(user.role === 'viewer' && feature.public) ||
	cityOfRole(user.role) === feature.city;

/** 所有者名(owner_name)が見えるか(spec/Spec/Authz.lean の ownerCond)。 */
export const seesOwner = (user: { role: Role }) => user.role !== 'viewer';

/** 書き込めるか。Lean の仕様(spec/Spec/Authz.lean の writeCond)と、それから書き出した RLS と同じ判断。 */
export const canWrite = (
	user: { role: Role; canEdit: boolean },
	feature: { city: City; public: boolean }
) => user.canEdit && (user.role === 'admin' || cityOfRole(user.role) === feature.city);
