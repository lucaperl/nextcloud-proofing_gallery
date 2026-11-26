<script setup lang="ts">
import { n, t } from '@nextcloud/l10n'
import { defineAsyncComponent } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'

import { groupLabel } from '../domain/publicGalleryMedia.ts'
import type { CollaborationState, MediaItem } from '../publicTypes.ts'
import ProgressiveImage from './ProgressiveImage.vue'
import VirtualMediaGrid from './VirtualMediaGrid.vue'

const PublicMediaListDetails = defineAsyncComponent(() => import('./PublicMediaListDetails.vue'))

const props = defineProps<{
	items: MediaItem[]
	layout: 'grid' | 'masonry' | 'list'
	minItemWidth: number
	targetRowHeight: number
	gap: number
	dimensions: Record<number, { width: number; height: number }>
	scrollElement: HTMLElement | null
	trackVisible: boolean
	continuous: boolean
	leadPhotoId?: number
	showFilenames: boolean
	grouped: boolean
	likes?: CollaborationState['likes']
	selectedIds: number[]
	selecting: boolean
	previewUrl: (item: MediaItem) => string
}>()

const emit = defineEmits<{
	open: [item: MediaItem, event: MouseEvent]
	select: [item: MediaItem]
	dimensions: [item: MediaItem, event: Event]
	'visible-items': [items: MediaItem[]]
}>()

function mediaAccessibleName(item: MediaItem): string {
	const action = item.folder
		? t('proofing_gallery', 'Open folder {name}', { name: item.name })
		: t('proofing_gallery', 'Open {name}', { name: item.name })
	const count = props.likes?.[item.id]?.count ?? 0
	return count ? `${action}. ${n('proofing_gallery', '%n like', '%n likes', count)}` : action
}

function startsGroup(item: MediaItem, index: number): boolean {
	return props.grouped && (index === 0 || props.items[index - 1]?.group !== item.group)
}
</script>

<template>
	<VirtualMediaGrid
		class="media-grid"
		:class="`media-grid--${layout}`"
		:items="items"
		:mode="layout"
		:min-item-width="minItemWidth"
		:target-row-height="targetRowHeight"
		photographic
		:gap="gap"
		:item-dimensions="dimensions"
		:scroll-element="scrollElement"
		:track-visible="trackVisible"
		:aria-label="t('proofing_gallery', 'Gallery files')"
		@visible-items="emit('visible-items', $event)">
		<template #default="{ item, index }">
			<article
				class="media-tile"
				:class="{ 'media-tile--folder': item.folder, 'media-tile--selected': selectedIds.includes(item.id), 'media-tile--lead': item.id === leadPhotoId }">
				<span v-if="startsGroup(item, index)" class="media-tile__group">{{ groupLabel(item.group) }}</span>
				<button
					class="media-tile__open"
					type="button"
					:aria-label="mediaAccessibleName(item)"
					@click="emit('open', item, $event)">
					<ProgressiveImage
						v-if="item.mimeType.startsWith('image/')"
						:src="previewUrl(item)"
						class="media-tile__image"
						direct
						:instant="continuous"
						fetch-priority="low"
						:priority="item.id === leadPhotoId"
						@load="emit('dimensions', item, $event)" />
					<span v-else-if="item.folder" class="media-tile__folder" aria-hidden="true" />
					<span v-else class="media-tile__video" aria-hidden="true">▶</span>
					<span v-if="layout === 'list'" class="media-tile__details" aria-hidden="true">
						<strong v-if="item.folder || showFilenames">{{ item.name }}</strong>
						<span><PublicMediaListDetails :item="item" :dimensions="dimensions" /></span>
					</span>
					<span v-else-if="item.folder || showFilenames" class="media-tile__name" aria-hidden="true">
						{{ item.name }}
					</span>
					<span
						v-if="!item.folder && likes?.[item.id]?.count"
						class="media-tile__likes"
						aria-hidden="true">
						♥ {{ likes[item.id].count }}
					</span>
				</button>
				<button
					v-if="selecting && !item.folder"
					class="media-tile__select"
					:class="{ 'media-tile__select--active': selectedIds.includes(item.id) }"
					type="button"
					:aria-checked="selectedIds.includes(item.id)"
					role="checkbox"
					:aria-label="t('proofing_gallery', 'Select {name}', { name: item.name })"
					@click="emit('select', item)">
					<CheckIcon v-if="selectedIds.includes(item.id)" :size="18" aria-hidden="true" />
				</button>
			</article>
		</template>
	</VirtualMediaGrid>
</template>

<style scoped src="./styles/PublicPhotoGrid.css"></style>
