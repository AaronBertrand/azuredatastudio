/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./splitview';
import { IDisposable, toDisposable, Disposable, combinedDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as types from 'vs/base/common/types';
import * as dom from 'vs/base/browser/dom';
import { clamp } from 'vs/base/common/numbers';
import { range, firstIndex, pushToStart, pushToEnd } from 'vs/base/common/arrays';
import { Sash, Orientation, ISashEvent as IBaseSashEvent, SashState } from 'vs/base/browser/ui/sash/sash';
import { Color } from 'vs/base/common/color';
import { domEvent } from 'vs/base/browser/event';
export { Orientation } from 'vs/base/browser/ui/sash/sash';

export interface ISplitViewStyles {
	separatorBorder: Color;
}

const defaultStyles: ISplitViewStyles = {
	separatorBorder: Color.transparent
};

export interface ISplitViewOptions {
	orientation?: Orientation; // default Orientation.VERTICAL
	styles?: ISplitViewStyles;
	orthogonalStartSash?: Sash;
	orthogonalEndSash?: Sash;
	inverseAltBehavior?: boolean;
	proportionalLayout?: boolean; // default true
}

/**
 * Only used when `proportionalLayout` is false.
 */
export const enum LayoutPriority {
	Normal,
	Low,
	High
}

export interface IView {
	readonly element: HTMLElement;
	readonly minimumSize: number;
	readonly maximumSize: number;
	readonly onDidChange: Event<number | undefined>;
	readonly priority?: LayoutPriority;
	readonly snap?: boolean;
	layout(size: number, orientation: Orientation): void;
	setVisible?(visible: boolean): void;
}

interface ISashEvent {
	sash: Sash;
	start: number;
	current: number;
	alt: boolean;
}

type ViewItemSize = number | { cachedVisibleSize: number };

abstract class ViewItem {

	private _size: number;
	set size(size: number) {
		this._size = size;
	}

	get size(): number {
		return this._size;
	}

	private _cachedVisibleSize: number | undefined = undefined;
	get cachedVisibleSize(): number | undefined { return this._cachedVisibleSize; }

	get visible(): boolean {
		return typeof this._cachedVisibleSize === 'undefined';
	}

	setVisible(visible: boolean, size?: number): void {
		if (visible === this.visible) {
			return;
		}

		if (visible) {
			this.size = clamp(this._cachedVisibleSize!, this.viewMinimumSize, this.viewMaximumSize);
			this._cachedVisibleSize = undefined;
		} else {
			this._cachedVisibleSize = typeof size === 'number' ? size : this.size;
			this.size = 0;
		}

		dom.toggleClass(this.container, 'visible', visible);

		if (this.view.setVisible) {
			this.view.setVisible(visible);
		}
	}

	get minimumSize(): number { return this.visible ? this.view.minimumSize : 0; }
	get viewMinimumSize(): number { return this.view.minimumSize; }

	get maximumSize(): number { return this.visible ? this.view.maximumSize : 0; }
	get viewMaximumSize(): number { return this.view.maximumSize; }

	get priority(): LayoutPriority | undefined { return this.view.priority; }
	get snap(): boolean { return !!this.view.snap; }

	constructor(
		protected container: HTMLElement,
		private view: IView,
		size: ViewItemSize,
		private disposable: IDisposable
	) {
		if (typeof size === 'number') {
			this._size = size;
			this._cachedVisibleSize = undefined;
		} else {
			this._size = 0;
			this._cachedVisibleSize = size.cachedVisibleSize;
		}

		dom.addClass(container, 'visible');
	}

	layout(): void {
		this.container.scrollTop = 0;
		this.container.scrollLeft = 0;
	}

	layoutView(orientation: Orientation): void {
		this.view.layout(this.size, orientation);
	}

	dispose(): IView {
		this.disposable.dispose();
		return this.view;
	}
}

class VerticalViewItem extends ViewItem {

	layout(): void {
		super.layout();
		this.container.style.height = `${this.size}px`;
		this.layoutView(Orientation.VERTICAL);
	}
}

class HorizontalViewItem extends ViewItem {

	layout(): void {
		super.layout();
		this.container.style.width = `${this.size}px`;
		this.layoutView(Orientation.HORIZONTAL);
	}
}

interface ISashItem {
	sash: Sash;
	disposable: IDisposable;
}

interface ISashDragSnapState {
	readonly index: number;
	readonly limitDelta: number;
	readonly size: number;
}

interface ISashDragState {
	index: number;
	start: number;
	current: number;
	sizes: number[];
	minDelta: number;
	maxDelta: number;
	alt: boolean;
	snapBefore: ISashDragSnapState | undefined;
	snapAfter: ISashDragSnapState | undefined;
	disposable: IDisposable;
}

enum State {
	Idle,
	Busy
}

export type DistributeSizing = { type: 'distribute' };
export type SplitSizing = { type: 'split', index: number };
export type InvisibleSizing = { type: 'invisible', cachedVisibleSize: number };
export type Sizing = DistributeSizing | SplitSizing | InvisibleSizing;

export namespace Sizing {
	export const Distribute: DistributeSizing = { type: 'distribute' };
	export function Split(index: number): SplitSizing { return { type: 'split', index }; }
	export function Invisible(cachedVisibleSize: number): InvisibleSizing { return { type: 'invisible', cachedVisibleSize }; }
}

export class SplitView extends Disposable {

	readonly orientation: Orientation;
	readonly el: HTMLElement;
	private sashContainer: HTMLElement;
	private viewContainer: HTMLElement;
	private size = 0;
	private contentSize = 0;
	private proportions: undefined | number[] = undefined;
	private viewItems: ViewItem[] = [];
	private sashItems: ISashItem[] = [];
	private sashDragState: ISashDragState | undefined;
	private state: State = State.Idle;
	private inverseAltBehavior: boolean;
	private proportionalLayout: boolean;

	private _onDidSashChange = this._register(new Emitter<number>());
	readonly onDidSashChange = this._onDidSashChange.event;

	private _onDidSashReset = this._register(new Emitter<number>());
	readonly onDidSashReset = this._onDidSashReset.event;

	get length(): number {
		return this.viewItems.length;
	}

	get minimumSize(): number {
		return this.viewItems.reduce((r, item) => r + item.minimumSize, 0);
	}

	get maximumSize(): number {
		return this.length === 0 ? Number.POSITIVE_INFINITY : this.viewItems.reduce((r, item) => r + item.maximumSize, 0);
	}

	private _orthogonalStartSash: Sash | undefined;
	get orthogonalStartSash(): Sash | undefined { return this._orthogonalStartSash; }
	set orthogonalStartSash(sash: Sash | undefined) {
		for (const sashItem of this.sashItems) {
			sashItem.sash.orthogonalStartSash = sash;
		}

		this._orthogonalStartSash = sash;
	}

	private _orthogonalEndSash: Sash | undefined;
	get orthogonalEndSash(): Sash | undefined { return this._orthogonalEndSash; }
	set orthogonalEndSash(sash: Sash | undefined) {
		for (const sashItem of this.sashItems) {
			sashItem.sash.orthogonalEndSash = sash;
		}

		this._orthogonalEndSash = sash;
	}

	get sashes(): Sash[] {
		return this.sashItems.map(s => s.sash);
	}

	constructor(container: HTMLElement, options: ISplitViewOptions = {}) {
		super();

		this.orientation = types.isUndefined(options.orientation) ? Orientation.VERTICAL : options.orientation;
		this.inverseAltBehavior = !!options.inverseAltBehavior;
		this.proportionalLayout = types.isUndefined(options.proportionalLayout) ? true : !!options.proportionalLayout;

		this.el = document.createElement('div');
		dom.addClass(this.el, 'monaco-split-view2');
		dom.addClass(this.el, this.orientation === Orientation.VERTICAL ? 'vertical' : 'horizontal');
		container.appendChild(this.el);

		this.sashContainer = dom.append(this.el, dom.$('.sash-container'));
		this.viewContainer = dom.append(this.el, dom.$('.split-view-container'));

		this.style(options.styles || defaultStyles);
	}

	style(styles: ISplitViewStyles): void {
		if (styles.separatorBorder.isTransparent()) {
			dom.removeClass(this.el, 'separator-border');
			this.el.style.removeProperty('--separator-border');
		} else {
			dom.addClass(this.el, 'separator-border');
			this.el.style.setProperty('--separator-border', styles.separatorBorder.toString());
		}
	}

	addView(view: IView, size: number | Sizing, index = this.viewItems.length): void {
		if (this.state !== State.Idle) {
			throw new Error('Cant modify splitview');
		}

		this.state = State.Busy;

		// Add view
		const container = dom.$('.split-view-view');

		if (index === this.viewItems.length) {
			this.viewContainer.appendChild(container);
		} else {
			this.viewContainer.insertBefore(container, this.viewContainer.children.item(index));
		}

		const onChangeDisposable = view.onDidChange(size => this.onViewChange(item, size));
		const containerDisposable = toDisposable(() => this.viewContainer.removeChild(container));
		const disposable = combinedDisposable(onChangeDisposable, containerDisposable);

		let viewSize: ViewItemSize;

		if (typeof size === 'number') {
			viewSize = size;
		} else if (size.type === 'split') {
			viewSize = this.getViewSize(size.index) / 2;
		} else if (size.type === 'invisible') {
			viewSize = { cachedVisibleSize: size.cachedVisibleSize };
		} else {
			viewSize = view.minimumSize;
		}

		const item = this.orientation === Orientation.VERTICAL
			? new VerticalViewItem(container, view, viewSize, disposable)
			: new HorizontalViewItem(container, view, viewSize, disposable);

		this.viewItems.splice(index, 0, item);

		// Add sash
		if (this.viewItems.length > 1) {
			const orientation = this.orientation === Orientation.VERTICAL ? Orientation.HORIZONTAL : Orientation.VERTICAL;
			const layoutProvider = this.orientation === Orientation.VERTICAL ? { getHorizontalSashTop: (sash: Sash) => this.getSashPosition(sash) } : { getVerticalSashLeft: (sash: Sash) => this.getSashPosition(sash) };
			const sash = new Sash(this.sashContainer, layoutProvider, {
				orientation,
				orthogonalStartSash: this.orthogonalStartSash,
				orthogonalEndSash: this.orthogonalEndSash
			});

			const sashEventMapper = this.orientation === Orientation.VERTICAL
				? (e: IBaseSashEvent) => ({ sash, start: e.startY, current: e.currentY, alt: e.altKey })
				: (e: IBaseSashEvent) => ({ sash, start: e.startX, current: e.currentX, alt: e.altKey });

			const onStart = Event.map(sash.onDidStart, sashEventMapper);
			const onStartDisposable = onStart(this.onSashStart, this);
			const onChange = Event.map(sash.onDidChange, sashEventMapper);
			const onChangeDisposable = onChange(this.onSashChange, this);
			const onEnd = Event.map(sash.onDidEnd, () => firstIndex(this.sashItems, item => item.sash === sash));
			const onEndDisposable = onEnd(this.onSashEnd, this);

			const onDidResetDisposable = sash.onDidReset(() => {
				const index = firstIndex(this.sashItems, item => item.sash === sash);
				const upIndexes = range(index, -1);
				const downIndexes = range(index + 1, this.viewItems.length);
				const snapBeforeIndex = this.findFirstSnapIndex(upIndexes);
				const snapAfterIndex = this.findFirstSnapIndex(downIndexes);

				if (typeof snapBeforeIndex === 'number' && !this.viewItems[snapBeforeIndex].visible) {
					return;
				}

				if (typeof snapAfterIndex === 'number' && !this.viewItems[snapAfterIndex].visible) {
					return;
				}

				this._onDidSashReset.fire(index);
			});

			const disposable = combinedDisposable(onStartDisposable, onChangeDisposable, onEndDisposable, onDidResetDisposable, sash);
			const sashItem: ISashItem = { sash, disposable };

			this.sashItems.splice(index - 1, 0, sashItem);
		}

		container.appendChild(view.element);

		let highPriorityIndexes: number[] | undefined;

		if (typeof size !== 'number' && size.type === 'split') {
			highPriorityIndexes = [size.index];
		}

		this.relayout([index], highPriorityIndexes);
		this.state = State.Idle;

		if (typeof size !== 'number' && size.type === 'distribute') {
			this.distributeViewSizes();
		}
	}

	removeView(index: number, sizing?: Sizing): IView {
		if (this.state !== State.Idle) {
			throw new Error('Cant modify splitview');
		}

		this.state = State.Busy;

		if (index < 0 || index >= this.viewItems.length) {
			throw new Error('Index out of bounds');
		}

		// Remove view
		const viewItem = this.viewItems.splice(index, 1)[0];
		const view = viewItem.dispose();

		// Remove sash
		if (this.viewItems.length >= 1) {
			const sashIndex = Math.max(index - 1, 0);
			const sashItem = this.sashItems.splice(sashIndex, 1)[0];
			sashItem.disposable.dispose();
		}

		this.relayout();
		this.state = State.Idle;

		if (sizing && sizing.type === 'distribute') {
			this.distributeViewSizes();
		}

		return view;
	}

	moveView(from: number, to: number): void {
		if (this.state !== State.Idle) {
			throw new Error('Cant modify splitview');
		}

		const cachedVisibleSize = this.getViewCachedVisibleSize(from);
		const sizing = typeof cachedVisibleSize === 'undefined' ? this.getViewSize(from) : Sizing.Invisible(cachedVisibleSize);
		const view = this.removeView(from);
		this.addView(view, sizing, to);
	}

	swapViews(from: number, to: number): void {
		if (this.state !== State.Idle) {
			throw new Error('Cant modify splitview');
		}

		if (from > to) {
			return this.swapViews(to, from);
		}

		const fromSize = this.getViewSize(from);
		const toSize = this.getViewSize(to);
		const toView = this.removeView(to);
		const fromView = this.removeView(from);

		this.addView(toView, fromSize, from);
		this.addView(fromView, toSize, to);
	}

	isViewVisible(index: number): boolean {
		if (index < 0 || index >= this.viewItems.length) {
			throw new Error('Index out of bounds');
		}

		const viewItem = this.viewItems[index];
		return viewItem.visible;
	}

	setViewVisible(index: number, visible: boolean): void {
		if (index < 0 || index >= this.viewItems.length) {
			throw new Error('Index out of bounds');
		}

		const viewItem = this.viewItems[index];
		viewItem.setVisible(visible);

		this.distributeEmptySpace(index);
		this.layoutViews();
		this.saveProportions();
	}

	getViewCachedVisibleSize(index: number): number | undefined {
		if (index < 0 || index >= this.viewItems.length) {
			throw new Error('Index out of bounds');
		}

		const viewItem = this.viewItems[index];
		return viewItem.cachedVisibleSize;
	}

	layout(size: number): void {
		const previousSize = Math.max(this.size, this.contentSize);
		this.size = size;

		if (!this.proportions) {
			const indexes = range(this.viewItems.length);
			const lowPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.Low);
			const highPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.High);

			this.resize(this.viewItems.length - 1, size - previousSize, undefined, lowPriorityIndexes, highPriorityIndexes);
		} else {
			for (let i = 0; i < this.viewItems.length; i++) {
				const item = this.viewItems[i];
				item.size = clamp(Math.round(this.proportions[i] * size), item.minimumSize, item.maximumSize);
			}
		}

		this.distributeEmptySpace();
		this.layoutViews();
	}

	private saveProportions(): void {
		if (this.proportionalLayout && this.contentSize > 0) {
			this.proportions = this.viewItems.map(i => i.size / this.contentSize);
		}
	}

	private onSashStart({ sash, start, alt }: ISashEvent): void {
		const index = firstIndex(this.sashItems, item => item.sash === sash);

		// This way, we can press Alt while we resize a sash, macOS style!
		const disposable = combinedDisposable(
			domEvent(document.body, 'keydown')(e => resetSashDragState(this.sashDragState!.current, e.altKey)),
			domEvent(document.body, 'keyup')(() => resetSashDragState(this.sashDragState!.current, false))
		);

		const resetSashDragState = (start: number, alt: boolean) => {
			const sizes = this.viewItems.map(i => i.size);
			let minDelta = Number.NEGATIVE_INFINITY;
			let maxDelta = Number.POSITIVE_INFINITY;

			if (this.inverseAltBehavior) {
				alt = !alt;
			}

			if (alt) {
				// When we're using the last sash with Alt, we're resizing
				// the view to the left/up, instead of right/down as usual
				// Thus, we must do the inverse of the usual
				const isLastSash = index === this.sashItems.length - 1;

				if (isLastSash) {
					const viewItem = this.viewItems[index];
					minDelta = (viewItem.minimumSize - viewItem.size) / 2;
					maxDelta = (viewItem.maximumSize - viewItem.size) / 2;
				} else {
					const viewItem = this.viewItems[index + 1];
					minDelta = (viewItem.size - viewItem.maximumSize) / 2;
					maxDelta = (viewItem.size - viewItem.minimumSize) / 2;
				}
			}

			let snapBefore: ISashDragSnapState | undefined;
			let snapAfter: ISashDragSnapState | undefined;

			if (!alt) {
				const upIndexes = range(index, -1);
				const downIndexes = range(index + 1, this.viewItems.length);
				const minDeltaUp = upIndexes.reduce((r, i) => r + (this.viewItems[i].minimumSize - sizes[i]), 0);
				const maxDeltaUp = upIndexes.reduce((r, i) => r + (this.viewItems[i].viewMaximumSize - sizes[i]), 0);
				const maxDeltaDown = downIndexes.length === 0 ? Number.POSITIVE_INFINITY : downIndexes.reduce((r, i) => r + (sizes[i] - this.viewItems[i].minimumSize), 0);
				const minDeltaDown = downIndexes.length === 0 ? Number.NEGATIVE_INFINITY : downIndexes.reduce((r, i) => r + (sizes[i] - this.viewItems[i].viewMaximumSize), 0);
				const minDelta = Math.max(minDeltaUp, minDeltaDown);
				const maxDelta = Math.min(maxDeltaDown, maxDeltaUp);
				const snapBeforeIndex = this.findFirstSnapIndex(upIndexes);
				const snapAfterIndex = this.findFirstSnapIndex(downIndexes);

				if (typeof snapBeforeIndex === 'number') {
					const viewItem = this.viewItems[snapBeforeIndex];
					const halfSize = Math.floor(viewItem.viewMinimumSize / 2);

					snapBefore = {
						index: snapBeforeIndex,
						limitDelta: viewItem.visible ? minDelta - halfSize : minDelta + halfSize,
						size: viewItem.size
					};
				}

				if (typeof snapAfterIndex === 'number') {
					const viewItem = this.viewItems[snapAfterIndex];
					const halfSize = Math.floor(viewItem.viewMinimumSize / 2);

					snapAfter = {
						index: snapAfterIndex,
						limitDelta: viewItem.visible ? maxDelta + halfSize : maxDelta - halfSize,
						size: viewItem.size
					};
				}
			}

			this.sashDragState = { start, current: start, index, sizes, minDelta, maxDelta, alt, snapBefore, snapAfter, disposable };
		};

		resetSashDragState(start, alt);
	}

	private onSashChange({ current }: ISashEvent): void {
		const { index, start, sizes, alt, minDelta, maxDelta, snapBefore, snapAfter } = this.sashDragState!;
		this.sashDragState!.current = current;

		const delta = current - start;
		const newDelta = this.resize(index, delta, sizes, undefined, undefined, minDelta, maxDelta, snapBefore, snapAfter);

		if (alt) {
			const isLastSash = index === this.sashItems.length - 1;
			const newSizes = this.viewItems.map(i => i.size);
			const viewItemIndex = isLastSash ? index : index + 1;
			const viewItem = this.viewItems[viewItemIndex];
			const newMinDelta = viewItem.size - viewItem.maximumSize;
			const newMaxDelta = viewItem.size - viewItem.minimumSize;
			const resizeIndex = isLastSash ? index - 1 : index + 1;

			this.resize(resizeIndex, -newDelta, newSizes, undefined, undefined, newMinDelta, newMaxDelta);
		}

		this.distributeEmptySpace();
		this.layoutViews();
	}

	private onSashEnd(index: number): void {
		this._onDidSashChange.fire(index);
		this.sashDragState!.disposable.dispose();
		this.saveProportions();
	}

	private onViewChange(item: ViewItem, size: number | undefined): void {
		const index = this.viewItems.indexOf(item);

		if (index < 0 || index >= this.viewItems.length) {
			return;
		}

		size = typeof size === 'number' ? size : item.size;
		size = clamp(size, item.minimumSize, item.maximumSize);

		if (this.inverseAltBehavior && index > 0) {
			// In this case, we want the view to grow or shrink both sides equally
			// so we just resize the "left" side by half and let `resize` do the clamping magic
			this.resize(index - 1, Math.floor((item.size - size) / 2));
			this.distributeEmptySpace();
			this.layoutViews();
		} else {
			item.size = size;
			this.relayout([index], undefined);
		}
	}

	resizeView(index: number, size: number): void {
		if (this.state !== State.Idle) {
			throw new Error('Cant modify splitview');
		}

		this.state = State.Busy;

		if (index < 0 || index >= this.viewItems.length) {
			return;
		}

		const indexes = range(this.viewItems.length).filter(i => i !== index);
		const lowPriorityIndexes = [...indexes.filter(i => this.viewItems[i].priority === LayoutPriority.Low), index];
		const highPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.High);

		const item = this.viewItems[index];
		size = Math.round(size);
		size = clamp(size, item.minimumSize, Math.min(item.maximumSize, this.size));

		item.size = size;
		this.relayout(lowPriorityIndexes, highPriorityIndexes);
		this.state = State.Idle;
	}

	distributeViewSizes(): void {
		const flexibleViewItems: ViewItem[] = [];
		let flexibleSize = 0;

		for (const item of this.viewItems) {
			if (item.maximumSize - item.minimumSize > 0) {
				flexibleViewItems.push(item);
				flexibleSize += item.size;
			}
		}

		const size = Math.floor(flexibleSize / flexibleViewItems.length);

		for (const item of flexibleViewItems) {
			item.size = clamp(size, item.minimumSize, item.maximumSize);
		}

		const indexes = range(this.viewItems.length);
		const lowPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.Low);
		const highPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.High);

		this.relayout(lowPriorityIndexes, highPriorityIndexes);
	}

	getViewSize(index: number): number {
		if (index < 0 || index >= this.viewItems.length) {
			return -1;
		}

		return this.viewItems[index].size;
	}

	private relayout(lowPriorityIndexes?: number[], highPriorityIndexes?: number[]): void {
		const contentSize = this.viewItems.reduce((r, i) => r + i.size, 0);

		this.resize(this.viewItems.length - 1, this.size - contentSize, undefined, lowPriorityIndexes, highPriorityIndexes);
		this.distributeEmptySpace();
		this.layoutViews();
		this.saveProportions();
	}

	private resize(
		index: number,
		delta: number,
		sizes = this.viewItems.map(i => i.size),
		lowPriorityIndexes?: number[],
		highPriorityIndexes?: number[],
		overloadMinDelta: number = Number.NEGATIVE_INFINITY,
		overloadMaxDelta: number = Number.POSITIVE_INFINITY,
		snapBefore?: ISashDragSnapState,
		snapAfter?: ISashDragSnapState
	): number {
		if (index < 0 || index >= this.viewItems.length) {
			return 0;
		}

		const upIndexes = range(index, -1);
		const downIndexes = range(index + 1, this.viewItems.length);

		if (highPriorityIndexes) {
			for (const index of highPriorityIndexes) {
				pushToStart(upIndexes, index);
				pushToStart(downIndexes, index);
			}
		}

		if (lowPriorityIndexes) {
			for (const index of lowPriorityIndexes) {
				pushToEnd(upIndexes, index);
				pushToEnd(downIndexes, index);
			}
		}

		const upItems = upIndexes.map(i => this.viewItems[i]);
		const upSizes = upIndexes.map(i => sizes[i]);

		const downItems = downIndexes.map(i => this.viewItems[i]);
		const downSizes = downIndexes.map(i => sizes[i]);

		const minDeltaUp = upIndexes.reduce((r, i) => r + (this.viewItems[i].minimumSize - sizes[i]), 0);
		const maxDeltaUp = upIndexes.reduce((r, i) => r + (this.viewItems[i].maximumSize - sizes[i]), 0);
		const maxDeltaDown = downIndexes.length === 0 ? Number.POSITIVE_INFINITY : downIndexes.reduce((r, i) => r + (sizes[i] - this.viewItems[i].minimumSize), 0);
		const minDeltaDown = downIndexes.length === 0 ? Number.NEGATIVE_INFINITY : downIndexes.reduce((r, i) => r + (sizes[i] - this.viewItems[i].maximumSize), 0);
		const minDelta = Math.max(minDeltaUp, minDeltaDown, overloadMinDelta);
		const maxDelta = Math.min(maxDeltaDown, maxDeltaUp, overloadMaxDelta);

		let snapped = false;

		if (snapBefore) {
			const snapView = this.viewItems[snapBefore.index];
			const visible = delta >= snapBefore.limitDelta;
			snapped = visible !== snapView.visible;
			snapView.setVisible(visible, snapBefore.size);
		}

		if (!snapped && snapAfter) {
			const snapView = this.viewItems[snapAfter.index];
			const visible = delta < snapAfter.limitDelta;
			snapped = visible !== snapView.visible;
			snapView.setVisible(visible, snapAfter.size);
		}

		if (snapped) {
			return this.resize(index, delta, sizes, lowPriorityIndexes, highPriorityIndexes, overloadMinDelta, overloadMaxDelta);
		}

		delta = clamp(delta, minDelta, maxDelta);

		for (let i = 0, deltaUp = delta; i < upItems.length; i++) {
			const item = upItems[i];
			const size = clamp(upSizes[i] + deltaUp, item.minimumSize, item.maximumSize);
			const viewDelta = size - upSizes[i];

			deltaUp -= viewDelta;
			item.size = size;
		}

		for (let i = 0, deltaDown = delta; i < downItems.length; i++) {
			const item = downItems[i];
			const size = clamp(downSizes[i] - deltaDown, item.minimumSize, item.maximumSize);
			const viewDelta = size - downSizes[i];

			deltaDown += viewDelta;
			item.size = size;
		}

		return delta;
	}

	private distributeEmptySpace(lowPriorityIndex?: number): void {
		const contentSize = this.viewItems.reduce((r, i) => r + i.size, 0);
		let emptyDelta = this.size - contentSize;

		const indexes = range(this.viewItems.length - 1, -1);
		const lowPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.Low);
		const highPriorityIndexes = indexes.filter(i => this.viewItems[i].priority === LayoutPriority.High);

		for (const index of highPriorityIndexes) {
			pushToStart(indexes, index);
		}

		for (const index of lowPriorityIndexes) {
			pushToEnd(indexes, index);
		}

		if (typeof lowPriorityIndex === 'number') {
			pushToEnd(indexes, lowPriorityIndex);
		}

		for (let i = 0; emptyDelta !== 0 && i < indexes.length; i++) {
			const item = this.viewItems[indexes[i]];
			const size = clamp(item.size + emptyDelta, item.minimumSize, item.maximumSize);
			const viewDelta = size - item.size;

			emptyDelta -= viewDelta;
			item.size = size;
		}
	}

	private layoutViews(): void {
		// Save new content size
		this.contentSize = this.viewItems.reduce((r, i) => r + i.size, 0);

		// Layout views
		this.viewItems.forEach(item => item.layout());

		// Layout sashes
		this.sashItems.forEach(item => item.sash.layout());

		// Update sashes enablement
		let previous = false;
		const collapsesDown = this.viewItems.map(i => previous = (i.size - i.minimumSize > 0) || previous);

		previous = false;
		const expandsDown = this.viewItems.map(i => previous = (i.maximumSize - i.size > 0) || previous);

		const reverseViews = [...this.viewItems].reverse();
		previous = false;
		const collapsesUp = reverseViews.map(i => previous = (i.size - i.minimumSize > 0) || previous).reverse();

		previous = false;
		const expandsUp = reverseViews.map(i => previous = (i.maximumSize - i.size > 0) || previous).reverse();

		this.sashItems.forEach(({ sash }, index) => {
			const min = !(collapsesDown[index] && expandsUp[index + 1]);
			const max = !(expandsDown[index] && collapsesUp[index + 1]);

			if (min && max) {
				const upIndexes = range(index, -1);
				const downIndexes = range(index + 1, this.viewItems.length);
				const snapBeforeIndex = this.findFirstSnapIndex(upIndexes);
				const snapAfterIndex = this.findFirstSnapIndex(downIndexes);

				if (typeof snapBeforeIndex === 'number' && !this.viewItems[snapBeforeIndex].visible) {
					sash.state = SashState.Minimum;
				} else if (typeof snapAfterIndex === 'number' && !this.viewItems[snapAfterIndex].visible) {
					sash.state = SashState.Maximum;
				} else {
					sash.state = SashState.Disabled;
				}
			} else if (min && !max) {
				sash.state = SashState.Minimum;
			} else if (!min && max) {
				sash.state = SashState.Maximum;
			} else {
				sash.state = SashState.Enabled;
			}
			// }
		});
	}

	private getSashPosition(sash: Sash): number {
		let position = 0;

		for (let i = 0; i < this.sashItems.length; i++) {
			position += this.viewItems[i].size;

			if (this.sashItems[i].sash === sash) {
				return position;
			}
		}

		return 0;
	}

	private findFirstSnapIndex(indexes: number[]): number | undefined {
		// visible views first
		for (const index of indexes) {
			const viewItem = this.viewItems[index];

			if (!viewItem.visible) {
				continue;
			}

			if (viewItem.snap) {
				return index;
			}
		}

		// then, hidden views
		for (const index of indexes) {
			const viewItem = this.viewItems[index];

			if (viewItem.visible && viewItem.maximumSize - viewItem.minimumSize > 0) {
				return undefined;
			}

			if (!viewItem.visible && viewItem.snap) {
				return index;
			}
		}

		return undefined;
	}

	dispose(): void {
		super.dispose();

		this.viewItems.forEach(i => i.dispose());
		this.viewItems = [];

		this.sashItems.forEach(i => i.disposable.dispose());
		this.sashItems = [];
	}
}
