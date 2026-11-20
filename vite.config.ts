import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	optimizeDeps: { exclude: ['svelte-maplibre-gl'] },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'model/**/*.test.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'properties',
					environment: 'node',
					include: ['tests/properties/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
					globalSetup: ['tests/properties/global-setup.ts'],
					setupFiles: ['tests/properties/setup.ts'],
					fileParallelism: false,
					testTimeout: 120_000,
					hookTimeout: 120_000
				}
			}
		]
	}
});
