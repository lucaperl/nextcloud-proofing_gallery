import { watch } from 'vue'
import type { Ref } from 'vue'
import type PhotoSwipe from 'photoswipe'
import type { MediaItem } from '../types.ts'

// Keep PhotoSwipe's indexed data source and the Vue chrome on the same photo.
export function usePublicLightboxLiveMedia(options: {
	items: () => MediaItem[]
	activeIndex: Ref<number>
	viewer: () => PhotoSwipe | null
	toSlide: (item: MediaItem, index: number) => ReturnType<PhotoSwipe['getItemData']>
	loop: () => boolean
	changed: (item: MediaItem) => void
	close: () => void
}) {
	let syncing = false
	watch(options.items, (items, previous) => {
		const keepsPrefix = previous.every((item, index) => item.id === items[index]?.id && item.etag === items[index]?.etag)
		if (items.length === previous.length && keepsPrefix) return
		const fileId = previous[options.activeIndex.value]?.id
		const index = items.findIndex(item => item.id === fileId)
		if (index < 0) { options.close(); return }
		options.activeIndex.value = index
		const viewer = options.viewer()
		if (!viewer) return
		syncing = true
		try {
			const source = viewer.options.dataSource
			viewer.options.loop = options.loop()
			if (keepsPrefix && Array.isArray(source)) {
				const added = items.slice(previous.length).map((item, addedIndex) => options.toSlide(item, previous.length + addedIndex))
				viewer.options.dataSource = source.concat(added)
				if (index + 1 === previous.length) viewer.refreshSlideContent(index + 1)
				if (index === 0 && options.loop()) viewer.refreshSlideContent(items.length - 1)
				return
			}
			viewer.options.dataSource = items.map(options.toSlide)
			for (let old = 0; old < previous.length; old++) viewer.contentLoader.removeByIndex(old)
			viewer.goTo(index)
			for (const nearby of [index - 1, index, index + 1]) if (nearby >= 0 && nearby < items.length) viewer.refreshSlideContent(nearby)
		} finally { syncing = false }
		options.changed(items[index]!)
	})
	watch(options.loop, loop => {
		const viewer = options.viewer()
		if (!viewer || viewer.options.loop === loop) return
		viewer.options.loop = loop
		if (!loop) return
		const last = options.items().length - 1
		if (options.activeIndex.value === 0) viewer.refreshSlideContent(last)
		if (options.activeIndex.value === last) viewer.refreshSlideContent(0)
	})
	return { get syncing() { return syncing } }
}
