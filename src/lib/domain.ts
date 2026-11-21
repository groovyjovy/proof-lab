export type City = 'A' | 'B';
export const roles = ['admin', 'a-staff', 'b-staff', 'viewer'] as const;
export type Role = (typeof roles)[number];
export type Me = { id: string; name: string; role: Role; canEdit: boolean };

export const roleOf = (value: unknown): Role => roles.find((r) => r === value) ?? 'viewer';
