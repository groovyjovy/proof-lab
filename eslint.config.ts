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
const effectsOnlyInApp = {
	regex: '(^|/)app/effects\\.ts$',
	message:
		'副作用を実行するのは createApp(#lib/app/app.svelte.ts)だけ。副作用は machine.ts の Effect に足し、結果は Reply で返す'
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
		ignores: ['src/lib/app/app.svelte.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector:
						"CallExpression[callee.name='$state'], CallExpression[callee.object.name='$state']",
					message:
						'画面の状態は #lib/app/machine.ts の State に足し、操作(Op)と応答(Reply)で変える。$state を持てるのは src/lib/app/app.svelte.ts だけ(アプリ全体を1つの状態機械にしている。P6)'
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
				{ paths: [authClientOnlyInEffects], patterns: [dbOnlyInAuthz, effectsOnlyInApp] }
			]
		}
	},
	{
		files: ['src/lib/app/app.svelte.ts'],
		rules: {
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
	},
	{
		files: ['src/routes/**/*.svelte'],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{ ...serverOnlyInServer, allowTypeImports: false },
						{
							regex: '(^|/)app/machine\\.ts$',
							allowTypeImports: true,
							message:
								'画面は createApp(#lib/app/app.svelte.ts)の actions でだけ操作する。状態機械の関数は呼ばない(型は使ってよい)。理由: 何を押せるかは状態機械が差し出す'
						}
					]
				}
			],
			'svelte/no-restricted-html-elements': [
				'error',
				{
					elements: ['button', 'input', 'select', 'textarea'],
					message:
						'#lib/ui の ActionButton・ActionCheckbox・ActionSelect・ActionTextInput を使い、action に actions のどれかを渡す。押せるかどうかは、状態機械がその操作を差し出しているかで決まる(差し出していなければ押せなくなる)'
				}
			]
		}
	}
);
