import { onBeforeUnmount, ref } from 'vue'
import type { Ref } from 'vue'
import { continuationStorageKey, loadPublicGalleryContinuation, safelyStore } from '../domain/publicGalleryPreferences.ts'
import type { usePublicGalleryPage } from './usePublicGalleryPage.ts'

export function usePublicGalleryScroll(options: {
	token: string
	preview: boolean
	enabled: Ref<boolean>
	pageState: ReturnType<typeof usePublicGalleryPage>
	location(): { path: string; page: number; photoId: number | null }
}) {
	const { pageState } = options
	const continuation = ref(options.preview ? null : loadPublicGalleryContinuation(options.token))
	const continueVisible = ref(!!(continuation.value && continuation.value.scrollY > 240))
	const restoring = ref(false)
	let scrollTimer: number | undefined

	function rememberPosition(scrollY: number, fileId: number | null) {
		const { path, page } = options.location()
		continuation.value = { scrollY, fileId, path, page, lastPage: options.enabled.value ? pageState.lastPage.value : undefined }
		if (!options.preview) safelyStore(() => localStorage.setItem(continuationStorageKey(options.token), JSON.stringify(continuation.value)))
	}

	function onContentScroll(event: CustomEvent<{ scrollTop: number }>) {
		if (options.preview || restoring.value) return
		const { scrollTop } = event.detail
		window.clearTimeout(scrollTimer)
		scrollTimer = window.setTimeout(() => {
			rememberPosition(scrollTop, options.location().photoId ?? continuation.value?.fileId ?? null)
		}, 80)
	}

	async function restoreBatches(lastPage: number | undefined) {
		if (lastPage === undefined || !options.enabled.value) return
		restoring.value = true
		try {
			while (pageState.lastPage.value < lastPage) {
				if (!options.enabled.value || !await pageState.append()) break
			}
		} finally {
			restoring.value = false
		}
	}

	onBeforeUnmount(() => window.clearTimeout(scrollTimer))
	return { continuation, continueVisible, rememberPosition, onContentScroll, restoreBatches, restoring }
}
