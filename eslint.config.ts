import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

const authClientOnlyInEffects = {
	name: '#lib/auth-client.ts',
	message: 'ログイン・ログアウトは machine.ts の Effect に足し、#lib/app/effects.ts から呼ぶ'
};
const dbOnlyInAuthz = {
	regex: '(^|/)db\\.ts$',
	message:
		'DB は scopedDb(#lib/server/authz)を通して使う。理由: P1(接続ごとにユーザーを渡し、RLS で行を絞る)'
};
const serverOnlyInServer = {
	regex: '(^|/)server/',
	message:
		'画面のコードは src/lib/server を import しない(型も)。共有する型は #lib/domain.ts に置く。理由: P1・P2(認可と出口の判断はサーバーにだけ置く)'
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: { 'no-undef': 'off' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		files: ['src/**/*.svelte', 'src/**/*.svelte.ts'],
		ignores: ['src/routes/+page.svelte'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector:
						"CallExpression[callee.name='$state'], CallExpression[callee.object.name='$state']",
					message:
						'画面の状態は #lib/app/machine.ts の State に足し、Event で変える。$state を持てるのは src/routes/+page.svelte だけ(アプリ全体を1つの状態機械にしている。P6)'
				}
			]
		}
	},
	{
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		ignores: ['src/lib/app/effects.ts', 'src/**/*.test.ts'],
		rules: {
			'no-restricted-globals': [
				'error',
				...['fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
					name,
					message: `${name} は #lib/app/effects.ts でだけ使う。副作用は machine.ts の Effect に足し、結果は Event で返す(L1)`
				}))
			],
			'no-restricted-imports': [
				'error',
				{ paths: [authClientOnlyInEffects], patterns: [dbOnlyInAuthz] }
			]
		}
	},
	{
		files: ['src/lib/server/auth.ts', 'src/lib/server/authz/**'],
		rules: { 'no-restricted-imports': ['error', { paths: [authClientOnlyInEffects] }] }
	},
	{
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		ignores: [
			'src/lib/server/**',
			'src/**/*.server.ts',
			'src/routes/**/+server.ts',
			'src/**/*.test.ts'
		],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{ patterns: [{ ...serverOnlyInServer, allowTypeImports: false }] }
			]
		}
	}
);
