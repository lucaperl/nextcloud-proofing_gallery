<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { ref, watchEffect } from 'vue'

const props = defineProps<{
	scrollElement: HTMLElement | null
	enabled: boolean
	loading: boolean
	failed: boolean
}>()
const emit = defineEmits<{ load: [] }>()
const button = ref<HTMLButtonElement | null>(null)
const viewportHeight = ref(0)

watchEffect(onCleanup => {
	const root = props.scrollElement
	if (!root) return
	const measure = () => { viewportHeight.value = root.clientHeight }
	measure()
	if (typeof ResizeObserver === 'undefined') return
	const observer = new ResizeObserver(measure)
	observer.observe(root)
	onCleanup(() => observer.disconnect())
})

watchEffect(onCleanup => {
	const target = button.value
	const root = props.scrollElement
	if (!target || !root || !props.enabled || props.loading || props.failed || typeof IntersectionObserver === 'undefined') return
	// Only file records are fetched ahead. Image requests still follow the virtual grid.
	const lookahead = Math.max(1200, Math.min(5200, viewportHeight.value * 6))
	const observer = new IntersectionObserver(entries => {
		if (entries.some(entry => entry.isIntersecting) && props.enabled && !props.loading && !props.failed) emit('load')
	}, { root, rootMargin: `0px 0px ${lookahead}px 0px` })
	observer.observe(target)
	onCleanup(() => observer.disconnect())
}, { flush: 'post' })
</script>

<template>
	<div class="public-gallery__more" aria-live="polite">
		<button ref="button"
			type="button"
			:disabled="loading || !enabled"
			@click="emit('load')">
			{{ loading ? t('proofing_gallery', 'Loading…') : failed ? t('proofing_gallery', 'Try again') : t('proofing_gallery', 'Load more files') }}
		</button>
	</div>
</template>
