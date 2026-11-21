<script lang="ts">
	import 'svelte-maplibre-gl/vite';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { ExpressionSpecification, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
	import {
		CircleLayer,
		FillLayer,
		GeoJSONSource,
		LineLayer,
		MapLibre,
		NavigationControl,
		Popup,
		VectorTileSource
	} from 'svelte-maplibre-gl';
	import { page } from '$app/state';
	import { createApp } from '#lib/app/app.svelte.ts';
	import type { City } from '#lib/domain.ts';
	import ActionButton from '#lib/ui/ActionButton.svelte';
	import ActionCheckbox from '#lib/ui/ActionCheckbox.svelte';
	import ActionSelect from '#lib/ui/ActionSelect.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const basemap: StyleSpecification = {
		version: 8,
		sources: {
			gsi: {
				type: 'raster',
				tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
				tileSize: 256,
				attribution:
					'<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>'
			}
		},
		layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }]
	};

	const cityColor: ExpressionSpecification = [
		'match',
		['get', 'city'],
		'A',
		'#2563eb',
		'B',
		'#ea580c',
		'#6b7280'
	];
	const isPolygon: ExpressionSpecification = ['==', ['geometry-type'], 'Polygon'];
	const isPoint: ExpressionSpecification = ['==', ['geometry-type'], 'Point'];
	const clickable = ['feature-fill', 'feature-circle'];

	const labels: Record<string, string> = {
		name: '名前',
		city: '市',
		public: '公開',
		owner_name: '所有者名',
		note: '備考',
		version: '版'
	};

	const demoUsers = [
		{ email: 'admin@example.com', label: '管理者' },
		{ email: 'a-staff@example.com', label: 'A市職員' },
		{ email: 'b-staff@example.com', label: 'B市職員' },
		{ email: 'viewer@example.com', label: '閲覧者' }
	];

	// svelte-ignore state_referenced_locally
	const machine = createApp(data.me);
	const app = $derived(machine.state);
	const actions = $derived(machine.actions);

	const session = $derived(
		app.kind === 'ログイン済み' ? app : app.kind === 'ログアウト中' ? app.from : null
	);
	const screen = $derived(session?.screen);
	const draft = $derived(screen && screen.kind !== '閲覧' ? screen.draft : null);
	const tilesUrl = $derived(`${page.url.origin}/tiles/{z}/{x}/{y}?v=${session?.tiles ?? 0}`);
	const sketch = $derived.by(() => {
		const points = draft?.points ?? [];
		return {
			type: 'FeatureCollection' as const,
			features: [
				...(points.length >= 3
					? [
							{
								type: 'Feature' as const,
								properties: {},
								geometry: { type: 'Polygon' as const, coordinates: [[...points, points[0]]] }
							}
						]
					: []),
				...points.map((p) => ({
					type: 'Feature' as const,
					properties: {},
					geometry: { type: 'Point' as const, coordinates: p }
				}))
			]
		};
	});

	function onMapClick(e: MapMouseEvent) {
		const [hit] = e.target.queryRenderedFeatures(e.point, { layers: clickable });
		actions.地図をクリック?.({
			at: [e.lngLat.lng, e.lngLat.lat],
			feature: hit?.properties ?? null
		});
	}
</script>

{#if !session}
	<main class="mx-auto mt-24 max-w-sm space-y-4 p-4" data-app={app.kind}>
		<h1 class="text-xl font-bold">WebGIS 認可の実験</h1>
		<p class="text-sm text-gray-600">
			{app.kind === 'ログイン中' ? 'ログインしています…' : 'デモユーザーを選んでログインします。'}
		</p>
		<div class="grid grid-cols-2 gap-2">
			{#each demoUsers as u (u.email)}
				<ActionButton
					class="rounded border border-gray-300 px-3 py-2 hover:bg-gray-100"
					action={actions.ログインを押す}
					payload={() => ({ email: u.email })}
				>
					{u.label}
				</ActionButton>
			{/each}
		</div>
		{#if app.kind === '未ログイン' && app.error}
			<p class="text-sm text-red-600">ログインできませんでした: {app.error}</p>
		{/if}
	</main>
{:else}
	<MapLibre
		class="h-dvh w-full"
		style={basemap}
		center={[141.35, 43.05]}
		zoom={12}
		autoloadGlobalCss={false}
		cursor={screen?.kind === '描画中' ? 'crosshair' : undefined}
		onclick={onMapClick}
	>
		<NavigationControl />
		<VectorTileSource tiles={[tilesUrl]} minzoom={8} maxzoom={16}>
			<FillLayer
				id="feature-fill"
				sourceLayer="features"
				filter={isPolygon}
				paint={{ 'fill-color': cityColor, 'fill-opacity': ['case', ['get', 'public'], 0.45, 0.15] }}
			/>
			<LineLayer
				sourceLayer="features"
				filter={isPolygon}
				paint={{ 'line-color': cityColor, 'line-width': 1.5 }}
			/>
			<CircleLayer
				id="feature-circle"
				sourceLayer="features"
				filter={isPoint}
				paint={{
					'circle-color': cityColor,
					'circle-radius': 6,
					'circle-opacity': ['case', ['get', 'public'], 1, 0.45],
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 1.5
				}}
			/>
		</VectorTileSource>
		<GeoJSONSource data={sketch}>
			<FillLayer filter={isPolygon} paint={{ 'fill-color': '#16a34a', 'fill-opacity': 0.3 }} />
			<LineLayer filter={isPolygon} paint={{ 'line-color': '#16a34a', 'line-width': 2 }} />
			<CircleLayer filter={isPoint} paint={{ 'circle-color': '#16a34a', 'circle-radius': 4 }} />
		</GeoJSONSource>
		{#if screen?.kind === '閲覧' && screen.selected}
			<Popup
				lnglat={screen.selected.at}
				closeOnClick={false}
				onclose={() => actions.ポップアップを閉じる?.()}
			>
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
					{#each Object.entries(screen.selected.properties) as [key, value] (key)}
						<dt class="text-gray-500">{labels[key] ?? key}</dt>
						<dd>{String(value)}</dd>
					{/each}
				</dl>
			</Popup>
		{/if}
	</MapLibre>

	<section
		class="absolute top-3 left-3 z-10 w-72 space-y-2 rounded bg-white/95 p-3 text-sm shadow"
		data-app={app.kind}
		data-screen={session.screen.kind}
		data-role={session.me.role}
		data-draft-key={draft?.key}
		data-draft-points={draft?.points.length}
	>
		<div class="flex items-center justify-between gap-2">
			<span>
				{session.me.name}({session.me.role}{session.me.canEdit ? '' : '・編集不可'})
			</span>
			<ActionButton
				class="text-xs text-gray-500 underline disabled:no-underline"
				action={actions.ログアウトを押す}
			>
				{app.kind === 'ログアウト中' ? 'ログアウト中…' : 'ログアウト'}
			</ActionButton>
		</div>
		{#if session.screen.kind === '閲覧'}
			<p class="text-gray-600">地物をクリックすると属性を表示します。</p>
			<ActionButton
				class="w-full rounded bg-green-600 px-3 py-1.5 text-white"
				action={actions.描画開始}
				payload={() => ({ key: crypto.randomUUID() })}
			>
				ポリゴンを描く
			</ActionButton>
		{:else if session.screen.kind === '描画中'}
			{@const d = session.screen.draft}
			<p>地図をクリックして点を追加({d.points.length} 点)</p>
			<ActionSelect
				action={actions.市を選ぶ}
				payload={(value) => ({ city: value as City })}
				value={d.city}
				options={[
					['A', 'A市'],
					['B', 'B市']
				]}
			>
				市
			</ActionSelect>
			<ActionCheckbox
				action={actions.公開を選ぶ}
				payload={(checked) => ({ public: checked })}
				checked={d.public}
			>
				公開する
			</ActionCheckbox>
			<div class="flex gap-2">
				<ActionButton
					class="flex-1 rounded bg-green-600 px-3 py-1.5 text-white"
					action={actions.確定}
				>
					確定して保存
				</ActionButton>
				<ActionButton class="rounded border px-3 py-1.5" action={actions.取消}>取消</ActionButton>
			</div>
			{#if session.screen.notice === '保存失敗'}
				<p class="text-red-600">保存できませんでした(権限がない可能性があります)</p>
			{/if}
		{:else if session.screen.kind === '結果不明'}
			<p class="text-red-600">
				保存されたか分かりません(応答が届きませんでした)。再送しても地物が二重にできることはありません。
			</p>
			<div class="flex gap-2">
				<ActionButton
					class="flex-1 rounded bg-green-600 px-3 py-1.5 text-white"
					action={actions.再送}
				>
					再送する
				</ActionButton>
				<ActionButton class="rounded border px-3 py-1.5" action={actions.取消}>やめる</ActionButton>
			</div>
			{#if session.screen.notice === '再送失敗'}
				<p class="text-red-600">再送できませんでした(権限がない可能性があります)</p>
			{/if}
		{:else}
			<p>{session.screen.kind}…</p>
		{/if}
	</section>
{/if}
