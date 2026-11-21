<script lang="ts" generics="P">
	import type { Snippet } from 'svelte';

	let {
		action,
		payload,
		checked,
		children
	}: {
		action: ((payload: P) => void) | undefined;
		payload: (checked: boolean) => P;
		checked: boolean;
		children: Snippet;
	} = $props();
</script>

<label class={['flex items-center gap-2', !action && 'opacity-40']}>
	<input
		type="checkbox"
		{checked}
		disabled={!action}
		onchange={(e) => action?.(payload(e.currentTarget.checked))}
	/>
	{@render children()}
</label>
