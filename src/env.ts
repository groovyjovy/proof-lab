import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'アプリ用の接続先。テーブルの所有者ではない app ロールで接続する' },
	BETTER_AUTH_SECRET: { description: 'Better Auth の署名・暗号化に使う秘密鍵(32文字以上)' },
	BETTER_AUTH_URL: { description: 'アプリの公開URL' }
});
