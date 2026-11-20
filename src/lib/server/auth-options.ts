import type { BetterAuthOptions } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import type { Pool } from 'pg';

const ac = createAccessControl(defaultStatements);

export const roles = {
	admin: ac.newRole(adminAc.statements),
	'a-staff': ac.newRole({}),
	'b-staff': ac.newRole({}),
	viewer: ac.newRole({})
};

export type Role = keyof typeof roles;

export const authOptions = (config: { pool: Pool; secret: string; baseURL: string }) =>
	({
		database: config.pool,
		secret: config.secret,
		baseURL: config.baseURL,
		emailAndPassword: { enabled: true },
		session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
		user: {
			additionalFields: {
				canEdit: { type: 'boolean', required: false, defaultValue: false, input: false }
			}
		},
		plugins: [admin({ ac, roles, defaultRole: 'viewer' })]
	}) satisfies BetterAuthOptions;
