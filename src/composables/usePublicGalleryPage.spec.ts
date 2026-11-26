import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePublicGalleryPage } from './usePublicGalleryPage.ts'
import type { PublicGalleryPage } from '../publicTypes.ts'
import { createDefaultGallerySettings } from '../domain/gallerySettings.ts'

vi.mock('../services/publicGalleryApi.ts', () => ({ fetchPublicGalleryPage: vi.fn() }))
import { fetchPublicGalleryPage } from '../services/publicGalleryApi.ts'

function page(number: number, total = 169): PublicGalleryPage {
	const offset = (number - 1) * 48
	return {
		gallery: { id: 1, title: 'Gallery', deliveryMode: 'standard', settings: createDefaultGallerySettings() },
		items: Array.from({ length: Math.min(48, Math.max(0, total - offset)) }, (_, index) => ({
			id: offset + index + 1, name: `photo-${offset + index + 1}.jpg`,
			mimeType: 'image/jpeg', size: 1024, modifiedAt: 0, etag: '', folder: false,
		})),
		s: [], total, mediaTotal: total, mediaOffset: offset, limit: 48, offset, page: number, pageSize: 48, pageCount: Math.max(1, Math.ceil(total / 48)),
		focusIndex: null, previousCursor: null, nextCursor: null, path: '', groups: {},
		indexState: { indexed: 0, limit: 5000, limitReached: false, complete: true },
		scope: { startPath: '', viewMode: 'folder', groupDepth: 1 },
	}
}

function harness(initial?: PublicGalleryPage, url = (page: number) => `/page/${page}`) {
	let state!: ReturnType<typeof usePublicGalleryPage>
	const applied = vi.fn(async (page: PublicGalleryPage) => { state.replace(page) })
	const wrapper = mount(defineComponent({ setup() { state = usePublicGalleryPage({ initial, url, apply: applied }); return () => null } }))
	return { state, applied, wrapper }
}
afterEach(() => vi.clearAllMocks())

describe('public page request ownership', () => {
	it('clears a previous error after a successful retry', async () => {
		vi.mocked(fetchPublicGalleryPage).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(2))
		const { state, wrapper } = harness()
		await state.load(1)
		expect(state.error.value).toBe(true)
		await state.load(2)
		expect(state.error.value).toBe(false)
		expect(state.snapshot.value?.page).toBe(2)
		wrapper.unmount()
	})
	it('ignores an older failure that arrives after the new page', async () => {
		let reject!: (error: Error) => void
		vi.mocked(fetchPublicGalleryPage).mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail })).mockResolvedValueOnce(page(2))
		const { state, wrapper } = harness()
		const old = state.load(1)
		await state.load(2)
		reject(new Error('old request failed'))
		await old
		expect(state.error.value).toBe(false)
		expect(state.snapshot.value?.page).toBe(2)
		wrapper.unmount()
	})
	it('cannot apply a response after unmount', async () => {
		let resolve!: (page: PublicGalleryPage) => void
		vi.mocked(fetchPublicGalleryPage).mockImplementationOnce(() => new Promise(complete => { resolve = complete }))
		const { state, applied, wrapper } = harness()
		const loading = state.load(1)
		wrapper.unmount()
		resolve(page(1))
		await loading
		expect(applied).not.toHaveBeenCalled()
	})
})

describe('progressive gallery loading', () => {
	it.each([169, 513])('appends %i photos in order with one request per additional batch', async total => {
		const { state, wrapper } = harness(page(1, total))
		const fetch = vi.mocked(fetchPublicGalleryPage)
		const batches = Array.from({ length: Math.ceil(total / 48) - 1 }, (_, index) => index + 2)
		for (const next of batches) fetch.mockResolvedValueOnce(page(next, total))

		const second = state.append()
		expect(state.append()).toBe(second)
		await second
		for (let index = 1; index < batches.length; index++) await state.append()
		expect(await state.append()).toBe(false)
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(batches.map(next => `/page/${next}`))
		expect(state.snapshot.value?.page).toBe(1)
		const ids = [...state.snapshot.value!.items, ...state.appendedItems.value].map(item => item.id)
		expect(ids).toEqual(Array.from({ length: total }, (_, index) => index + 1))
		wrapper.unmount()
	})

	it('loads an earlier window after a pending later window and preserves the media offset', async () => {
		const { state, wrapper } = harness(page(3))
		let finish!: (page: PublicGalleryPage) => void
		const fetch = vi.mocked(fetchPublicGalleryPage)
		fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(page(2))
		const later = state.append()
		const earlier = state.prepend()
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/page/4'])
		finish(page(4))
		expect(await later).toBe(true)
		expect(await earlier).toBe(true)
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/page/4', '/page/2'])
		expect(state.mediaOffset.value).toBe(48)
		expect(state.mediaTotal.value).toBe(169)
		expect(state.prependedItems.value).toEqual(page(2).items)
		expect(state.appendedItems.value).toEqual(page(4).items)
		expect(state.hasMore.value).toBe(false)
		expect(state.hasPrevious.value).toBe(true)
		wrapper.unmount()
	})

	it('keeps the current photos after an error and retries the same batch', async () => {
		const { state, wrapper } = harness(page(1))
		vi.mocked(fetchPublicGalleryPage).mockResolvedValueOnce(page(2))
			.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(3))
		await state.append()
		expect(await state.append()).toBe(false)
		expect(state.appendedItems.value).toEqual(page(2).items)
		expect(state.appendError.value).toBe(true)
		expect(await state.append()).toBe(true)
		expect(state.appendError.value).toBe(false)
		expect(state.lastPage.value).toBe(3)
		wrapper.unmount()
	})

	it('discards a batch when navigation replaces its base page', async () => {
		const { state, wrapper } = harness(page(1))
		let resolve!: (value: PublicGalleryPage) => void
		const fetch = vi.mocked(fetchPublicGalleryPage)
		fetch.mockImplementationOnce(() => new Promise(complete => { resolve = complete })).mockResolvedValueOnce(page(1, 2))
		const appending = state.append()
		await state.load(1)
		expect(fetch.mock.calls[0][1].aborted).toBe(true)
		resolve(page(2))
		expect(await appending).toBe(false)
		expect(state.appendedItems.value).toEqual([])
		expect(state.hasMore.value).toBe(false)
		wrapper.unmount()
	})

	it('does not apply a batch received while the search term is changing', async () => {
		let search = ''
		const { state, wrapper } = harness(page(1), number => `/page/${number}?q=${search}`)
		let resolve!: (value: PublicGalleryPage) => void
		vi.mocked(fetchPublicGalleryPage).mockImplementationOnce(() => new Promise(complete => { resolve = complete }))
		const appending = state.append()
		search = 'other photos'
		resolve(page(2))
		expect(await appending).toBe(false)
		expect(state.appendedItems.value).toEqual([])
		expect(state.lastPage.value).toBe(1)
		expect(state.appendError.value).toBe(false)
		wrapper.unmount()
	})

	it('deduplicates overlapping batches and resets those ids on a fresh page', async () => {
		const base = page(1)
		const next = page(2)
		const { state, wrapper } = harness(base)
		vi.mocked(fetchPublicGalleryPage).mockResolvedValueOnce({ ...next, items: [base.items[0], ...next.items, next.items[0]] }).mockResolvedValueOnce(next)
		expect(await state.append()).toBe(true)
		expect(state.appendedItems.value).toEqual(next.items)
		state.replace(base)
		expect(await state.append()).toBe(true)
		expect(state.appendedItems.value).toEqual(next.items)
		wrapper.unmount()
	})
})
