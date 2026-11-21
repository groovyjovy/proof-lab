<script lang="ts">
	import 'svelte-maplibre-gl/vite';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type {
		ErrorEvent,
		ExpressionSpecification,
		MapGeoJSONFeature,
		MapMouseEvent,
		StyleSpecification
	} from 'maplibre-gl';
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
	import ActionTextInput from '#lib/ui/ActionTextInput.svelte';
	import MapArea from '#lib/ui/MapArea.svelte';
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
	const draft = $derived(screen && 'draft' in screen ? screen.draft : null);
	const tilesUrl = $derived(
		`${page.url.origin}/tiles/{z}/{x}/{y}?v=${session?.tiles ?? 0}&as=${encodeURIComponent(session?.me.id ?? '')}`
	);
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

	function onMapError(e: ErrorEvent) {
		if ('status' in e.error && e.error.status === 412)
			machine.notify({ type: '地図の本人が変わった' });
	}

	/** タイルから届いた地物を、状態機械が使う形(id・市・公開)にする。形が違えば、地物がないことにする。 */
	function featureOf(hit: MapGeoJSONFeature | undefined) {
		const p = hit?.properties;
		if (typeof hit?.id !== 'number' || (p?.city !== 'A' && p?.city !== 'B')) return null;
		if (typeof p.public !== 'boolean') return null;
		return { ref: { id: hit.id, city: p.city as City, public: p.public }, properties: p };
	}

	function onMapClick(e: MapMouseEvent) {
		const [hit] = e.target.queryRenderedFeatures(e.point, { layers: clickable });
		actions.地図をクリック?.({ at: [e.lngLat.lng, e.lngLat.lat], feature: featureOf(hit) });
	}
</script>

<!-- 地図はタブのもので、ログインと関係なく出しておく(状態機械の MapView と同じ) -->
<MapLibre
	class="h-dvh w-full"
	style={basemap}
	center={[141.35, 43.05]}
	zoom={12}
	autoloadGlobalCss={false}
	cursor={screen?.kind === '描画中' ? 'crosshair' : undefined}
	onclick={onMapClick}
	onerror={onMapError}
>
	<NavigationControl />
	<MapArea onmoved={(area) => machine.notify({ type: '地図が動いた', area })} />
	{#if session}
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
	{/if}
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
			<ActionButton
				class="mt-2 w-full rounded border px-2 py-0.5 text-xs"
				action={actions.編集を始める}
			>
				編集を始める
			</ActionButton>
		</Popup>
	{/if}
</MapLibre>

{#if !session}
	<main
		class="absolute inset-x-0 top-24 z-10 mx-auto max-w-sm space-y-4 rounded bg-white/95 p-4 shadow"
		data-app={app.kind}
	>
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
		{:else if session.screen.kind === '編集中'}
			{@const e = session.screen.edit}
			<p>地物 {e.ref.id} を編集(版 {e.version})</p>
			<ActionTextInput action={actions.名前を変える} payload={(name) => ({ name })} value={e.name}>
				名前
			</ActionTextInput>
			<ActionTextInput action={actions.備考を変える} payload={(note) => ({ note })} value={e.note}>
				備考
			</ActionTextInput>
			<div class="flex gap-2">
				<ActionButton
					class="flex-1 rounded bg-green-600 px-3 py-1.5 text-white"
					action={actions.編集を保存}
					payload={() => ({ key: crypto.randomUUID() })}
				>
					保存する
				</ActionButton>
				<ActionButton class="rounded border px-3 py-1.5" action={actions.取消}>やめる</ActionButton>
			</div>
			{#if session.screen.notice === '更新失敗'}
				<p class="text-red-600">保存できませんでした(権限がない可能性があります)</p>
			{/if}
		{:else if session.screen.kind === '更新結果不明'}
			<p class="text-red-600">
				保存されたか分かりません(応答が届きませんでした)。再送しても、二重に効くことはありません。
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
		{:else if session.screen.kind === '競合'}
			{@const e = session.screen.edit}
			<p class="text-red-600">
				ほかの人が先に保存していました。上書きはしません。読み直してから、編集し直してください。
			</p>
			<p class="text-gray-600">あなたの編集: 名前「{e.name}」・備考「{e.note}」</p>
			<div class="flex gap-2">
				<ActionButton
					class="flex-1 rounded bg-green-600 px-3 py-1.5 text-white"
					action={actions.読み直す}
				>
					読み直す
				</ActionButton>
				<ActionButton class="rounded border px-3 py-1.5" action={actions.取消}>やめる</ActionButton>
			</div>
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

	<!-- 見えている範囲の地物の一覧。検索中は、前の一覧を薄くして出しておく(どの範囲の一覧かは data-search-area) -->
	<section
		class="absolute bottom-8 left-3 z-10 max-h-64 w-72 overflow-auto rounded bg-white/95 p-3 text-sm shadow"
		data-search={app.kind === 'ログアウト中'
			? '止めている'
			: session.search.pending
				? '検索中'
				: (session.search.shown?.kind ?? 'なし')}
		data-search-area={session.search.shown && JSON.stringify(session.search.shown.query.area)}
	>
		<h2 class="font-bold">
			この範囲の地物
			{#if session.search.pending}<span class="text-xs font-normal text-gray-500">(更新中…)</span
				>{/if}
		</h2>
		{#if session.search.shown?.kind === '見つかった'}
			<div class:opacity-50={session.search.pending || app.kind === 'ログアウト中'}>
				<p class="text-xs text-gray-500">{session.search.shown.hits.length} 件</p>
				<ul>
					{#each session.search.shown.hits as h (h.ref.id)}
						<li data-hit-city={h.ref.city} data-hit-public={h.ref.public}>
							{String(h.properties.name)}
							<span class="text-xs text-gray-500"
								>({h.ref.city}市・{h.ref.public ? '公開' : '非公開'})</span
							>
						</li>
					{/each}
				</ul>
			</div>
		{:else if session.search.shown?.kind === '検索できない'}
			<p class="text-red-600">一覧を読み込めませんでした。地図を動かすと読み直します。</p>
		{:else if !session.search.pending}
			<p class="text-gray-500">地図を動かすと、見えている範囲の地物を表示します。</p>
		{/if}
	</section>
{/if}
