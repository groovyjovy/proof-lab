<script lang="ts" generics="P">
	import type { Snippet } from 'svelte';

	let {
		action,
		payload,
		value,
		options,
		children
	}: {
		action: ((payload: P) => void) | undefined;
		payload: (value: string) => P;
		value: string;
		options: [value: string, label: string][];
		children: Snippet;
	} = $props();
</script>

<label class={['flex items-center gap-2', !action && 'opacity-40']}>
	{@render children()}
	<select
		class="rounded border px-1"
		{value}
		disabled={!action}
		onchange={(e) => action?.(payload(e.currentTarget.value))}
	>
		{#each options as [v, label] (v)}
			<option value={v}>{label}</option>
		{/each}
	</select>
</label>
