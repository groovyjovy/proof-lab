<script lang="ts">
	// 地図に見えている範囲を、地図ができたときと、動き終わるたびに知らせる。
	// 地図の子として置く(地図ができてから作られる)。地図の load は背景地図のタイルを読み終えるまで来ないので使わない。
	// 範囲は地図の要素(data-bounds)にも書く。UIの性質テストが一覧の範囲と突き合わせるため(画面はこれを読まない)。
	import { onMount } from 'svelte';
	import { getMapContext } from 'svelte-maplibre-gl';
	import type { Area } from '#lib/app/machine.ts';

	let { onmoved }: { onmoved: (area: Area) => void } = $props();

	const mapCtx = getMapContext();
	const round = (v: number) => Math.round(v * 1e6) / 1e6;

	onMount(() => {
		const map = mapCtx.map;
		if (!map) return;
		const report = () => {
			const b = map.getBounds();
			const area: Area = [
				[round(b.getWest()), round(b.getSouth())],
				[round(b.getEast()), round(b.getNorth())]
			];
			map.getContainer().dataset.bounds = JSON.stringify(area);
			onmoved(area);
		};
		report();
		map.on('moveend', report);
		return () => map.off('moveend', report);
	});
</script>
