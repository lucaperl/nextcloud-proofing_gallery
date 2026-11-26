import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import type { MediaItem, PublicGalleryPage } from '../publicTypes.ts'
import { fetchPublicGalleryPage } from '../services/publicGalleryApi.ts'

type PageUrl = (page: number, focusId: number | null) => string

// One server snapshot and one request owner for responses, errors and delayed focus.
export function usePublicGalleryPage(options: {
	initial?: PublicGalleryPage
	url: PageUrl
	apply(page: PublicGalleryPage, focusId: number | null, current: () => boolean): Promise<void>
}) {
	const snapshot = shallowRef(options.initial)
	const status = ref<'loading' | 'ready' | 'error'>(options.initial ? 'ready' : 'loading')
	let controller: AbortController | undefined
	let disposed = false
	const { cancel, reset, ...batches } = usePublicGalleryBatches({
		snapshot, url: options.url, isReady: () => !disposed && status.value === 'ready',
	})

	async function load(page: number, focusId: number | null = null) {
		if (disposed) return
		controller?.abort()
		cancel()
		const request = new AbortController()
		controller = request
		const current = () => !disposed && controller === request && !request.signal.aborted
		status.value = 'loading'
		try {
			const payload = await fetchPublicGalleryPage(options.url(page, focusId), request.signal)
			if (!current()) return
			await options.apply(payload, focusId, current)
			if (current()) status.value = 'ready'
		} catch {
			if (current()) status.value = 'error'
		}
	}

	function replace(page: PublicGalleryPage) {
		cancel()
		snapshot.value = page
		reset(page)
		status.value = 'ready'
	}

	onBeforeUnmount(() => { disposed = true; controller?.abort(); cancel() })
	return { snapshot, replace, load, ...batches, loading: computed(() => status.value === 'loading'), error: computed(() => status.value === 'error') }
}

function usePublicGalleryBatches(options: { snapshot: Ref<PublicGalleryPage | undefined>; url: PageUrl; isReady(): boolean }) {
	const { snapshot } = options
	const prependedItems = shallowRef<MediaItem[]>([])
	const appendedItems = shallowRef<MediaItem[]>([])
	const firstPage = ref(snapshot.value?.page ?? 1)
	const lastPage = ref(firstPage.value)
	const endPage = ref(snapshot.value?.pageCount ?? 1)
	const mediaOffset = ref(snapshot.value?.mediaOffset ?? 0)
	const mediaTotal = ref(snapshot.value?.mediaTotal)
	const appending = ref(false)
	const appendError = ref(false)
	const prependError = ref(false)
	const hasPrevious = computed(() => firstPage.value > 1)
	const hasMore = computed(() => lastPage.value < endPage.value)
	let loadedIds = new Set(snapshot.value?.items.map(item => item.id))
	let controller: AbortController | undefined
	let pending: Promise<boolean> | undefined
	let pendingPage: number | undefined

	function clearRequest() {
		controller = undefined
		pending = undefined
		pendingPage = undefined
		appending.value = false
	}

	function cancel() {
		controller?.abort()
		clearRequest()
		appendError.value = false
		prependError.value = false
	}

	function reset(page: PublicGalleryPage) {
		prependedItems.value = []
		appendedItems.value = []
		loadedIds = new Set(page.items.map(item => item.id))
		firstPage.value = page.page
		lastPage.value = page.page
		endPage.value = page.pageCount
		mediaOffset.value = page.mediaOffset ?? 0
		mediaTotal.value = page.mediaTotal
	}

	function extend(direction: -1 | 1): Promise<boolean> {
		const base = snapshot.value
		const available = direction === 1 ? hasMore.value : hasPrevious.value
		if (!base || !options.isReady() || !available) return Promise.resolve(false)
		const page = direction === 1 ? lastPage.value + 1 : firstPage.value - 1
		if (pending) {
			if (pendingPage === page) return pending
			return pending.then(() => snapshot.value === base ? extend(direction) : false)
		}
		const batchError = direction === 1 ? appendError : prependError
		const url = options.url(page, null)
		const request = new AbortController()
		controller = request
		pendingPage = page
		appending.value = true
		batchError.value = false
		const current = () => controller === request && url === options.url(page, null)
		pending = fetchPublicGalleryPage(url, request.signal).then(payload => {
			if (!current()) return false
			if (payload.path !== base.path || (payload.page !== page && payload.pageCount >= page)) throw new Error('Unexpected gallery page')
			endPage.value = payload.pageCount
			mediaTotal.value = payload.mediaTotal
			if (payload.pageCount < page) return false
			const newItems = payload.items.filter(item => {
				if (loadedIds.has(item.id)) return false
				loadedIds.add(item.id)
				return true
			})
			if (direction === 1) {
				appendedItems.value = appendedItems.value.concat(newItems)
				lastPage.value = page
			} else {
				prependedItems.value = newItems.concat(prependedItems.value)
				firstPage.value = page
				mediaOffset.value = payload.mediaOffset ?? 0
			}
			return true
		}).catch(() => {
			if (current()) batchError.value = true
			return false
		}).finally(() => {
			if (controller === request) clearRequest()
		})
		return pending
	}

	return {
		cancel, reset, append: () => extend(1), prepend: () => extend(-1), appendedItems, prependedItems,
		lastPage, hasMore, hasPrevious, appending, appendError, prependError, mediaTotal, mediaOffset,
	}
}
