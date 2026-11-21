<script lang="ts" generics="P">
	import type { Snippet } from 'svelte';

	let {
		action,
		payload,
		value,
		children
	}: {
		action: ((payload: P) => void) | undefined;
		payload: (value: string) => P;
		value: string;
		children: Snippet;
	} = $props();
</script>

<label class={['flex items-center gap-2', !action && 'opacity-40']}>
	<span class="w-10 shrink-0">{@render children()}</span>
	<input
		class="min-w-0 flex-1 rounded border px-1"
		type="text"
		{value}
		disabled={!action}
		oninput={(e) => action?.(payload(e.currentTarget.value))}
	/>
</label>
