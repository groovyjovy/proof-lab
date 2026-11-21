<script lang="ts" generics="P">
	import type { Snippet } from 'svelte';

	let {
		action,
		payload,
		class: className,
		children
	}: {
		action: ((payload: P) => void) | undefined;
		payload?: () => P;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<button
	class={[className, 'disabled:cursor-not-allowed disabled:opacity-40']}
	disabled={!action}
	onclick={() => action?.(payload?.() as P)}
>
	{@render children()}
</button>
