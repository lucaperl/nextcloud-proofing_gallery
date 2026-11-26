import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { PublicGalleryPage } from '../publicTypes.ts'

function pageChanged(previous: PublicGalleryPage | undefined, next: PublicGalleryPage): boolean {
	return !previous || previous.total !== next.total || previous.items.length !== next.items.length
		|| previous.items.some((item, index) => item.id !== next.items[index]?.id || item.etag !== next.items[index]?.etag)
}

// Poll only while visible, preserving the chunks already read while scrolling.
export function usePublicLiveUpdates(options: {
	snapshot: Ref<PublicGalleryPage | undefined>
	preserveWindow: () => boolean
	enabled: () => boolean
	busy: () => boolean
	url: () => string
	photoId: () => number | null
	apply: (page: PublicGalleryPage, photoId: number | null) => void
}) {
	const updateAvailable = ref(false)
	watch(options.snapshot, () => { updateAvailable.value = false })
	let timer: ReturnType<typeof setInterval> | undefined
	let controller: AbortController | undefined
	async function refresh() {
		if (!options.enabled() || options.busy() || document.hidden || controller) return
		const url = options.url()
		const preserveWindow = options.preserveWindow()
		const photoId = options.photoId()
		const requestUrl = new URL(url, window.location.href)
		if (!preserveWindow && photoId !== null) requestUrl.searchParams.set('focusId', String(photoId))
		const request = new AbortController()
		controller = request
		try {
			const response = await fetch(requestUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: request.signal })
			if (!response.ok) return
			const page = await response.json() as PublicGalleryPage
			if (document.hidden || options.busy() || url !== options.url() || preserveWindow !== options.preserveWindow()) return
			if (preserveWindow) {
				updateAvailable.value = pageChanged(options.snapshot.value, page)
			} else if (photoId === options.photoId()) options.apply(page, photoId)
		} catch { /* A transient outage keeps the last successful page and retries next tick. */ } finally { if (controller === request) controller = undefined }
	}
	function visibilityChanged() {
		if (document.hidden) controller?.abort()
		else void refresh()
	}
	onMounted(() => {
		if (!options.enabled()) return
		timer = setInterval(() => void refresh(), 5000)
		document.addEventListener('visibilitychange', visibilityChanged)
	})
	onBeforeUnmount(() => {
		clearInterval(timer)
		controller?.abort()
		document.removeEventListener('visibilitychange', visibilityChanged)
	})
	return { refresh, updateAvailable }
}
