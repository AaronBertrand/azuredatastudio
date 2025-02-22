/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/tree';
import { IDisposable, dispose, Disposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IListOptions, List, IListStyles, mightProducePrintableCharacter, MouseController } from 'vs/base/browser/ui/list/listWidget';
import { IListVirtualDelegate, IListRenderer, IListMouseEvent, IListEvent, IListContextMenuEvent, IListDragAndDrop, IListDragOverReaction, IKeyboardNavigationLabelProvider, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { append, $, toggleClass, getDomNodePagePosition, removeClass, addClass, hasClass, hasParentWithClass, createStyleSheet, clearNode } from 'vs/base/browser/dom';
import { Event, Relay, Emitter, EventBufferer } from 'vs/base/common/event';
import { StandardKeyboardEvent, IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ITreeModel, ITreeNode, ITreeRenderer, ITreeEvent, ITreeMouseEvent, ITreeContextMenuEvent, ITreeFilter, ITreeNavigator, ICollapseStateChangeEvent, ITreeDragAndDrop, TreeDragOverBubble, TreeVisibility, TreeFilterResult, ITreeModelSpliceEvent, TreeMouseEventTarget } from 'vs/base/browser/ui/tree/tree';
import { ISpliceable } from 'vs/base/common/sequence';
import { IDragAndDropData, StaticDND, DragAndDropData } from 'vs/base/browser/dnd';
import { range, equals, distinctES6 } from 'vs/base/common/arrays';
import { ElementsDragAndDropData } from 'vs/base/browser/ui/list/listView';
import { domEvent } from 'vs/base/browser/event';
import { fuzzyScore, FuzzyScore } from 'vs/base/common/filters';
import { getVisibleState, isFilterResult } from 'vs/base/browser/ui/tree/indexTreeModel';
import { localize } from 'vs/nls';
import { disposableTimeout } from 'vs/base/common/async';
import { isMacintosh } from 'vs/base/common/platform';
import { values } from 'vs/base/common/map';
import { clamp } from 'vs/base/common/numbers';
import { ScrollEvent } from 'vs/base/common/scrollable';
import { SetMap } from 'vs/base/common/collections';

function asTreeDragAndDropData<T, TFilterData>(data: IDragAndDropData): IDragAndDropData {
	if (data instanceof ElementsDragAndDropData) {
		const nodes = (data as ElementsDragAndDropData<ITreeNode<T, TFilterData>>).elements;
		return new ElementsDragAndDropData(nodes.map(node => node.element));
	}

	return data;
}

class TreeNodeListDragAndDrop<T, TFilterData, TRef> implements IListDragAndDrop<ITreeNode<T, TFilterData>> {

	private autoExpandNode: ITreeNode<T, TFilterData> | undefined;
	private autoExpandDisposable: IDisposable = Disposable.None;

	constructor(private modelProvider: () => ITreeModel<T, TFilterData, TRef>, private dnd: ITreeDragAndDrop<T>) { }

	getDragURI(node: ITreeNode<T, TFilterData>): string | null {
		return this.dnd.getDragURI(node.element);
	}

	getDragLabel(nodes: ITreeNode<T, TFilterData>[]): string | undefined {
		if (this.dnd.getDragLabel) {
			return this.dnd.getDragLabel(nodes.map(node => node.element));
		}

		return undefined;
	}

	onDragStart(data: IDragAndDropData, originalEvent: DragEvent): void {
		if (this.dnd.onDragStart) {
			this.dnd.onDragStart(asTreeDragAndDropData(data), originalEvent);
		}
	}

	onDragOver(data: IDragAndDropData, targetNode: ITreeNode<T, TFilterData> | undefined, targetIndex: number | undefined, originalEvent: DragEvent, raw = true): boolean | IListDragOverReaction {
		const result = this.dnd.onDragOver(asTreeDragAndDropData(data), targetNode && targetNode.element, targetIndex, originalEvent);
		const didChangeAutoExpandNode = this.autoExpandNode !== targetNode;

		if (didChangeAutoExpandNode) {
			this.autoExpandDisposable.dispose();
			this.autoExpandNode = targetNode;
		}

		if (typeof targetNode === 'undefined') {
			return result;
		}

		if (didChangeAutoExpandNode && typeof result !== 'boolean' && result.autoExpand) {
			this.autoExpandDisposable = disposableTimeout(() => {
				const model = this.modelProvider();
				const ref = model.getNodeLocation(targetNode);

				if (model.isCollapsed(ref)) {
					model.setCollapsed(ref, false);
				}

				this.autoExpandNode = undefined;
			}, 500);
		}

		if (typeof result === 'boolean' || !result.accept || typeof result.bubble === 'undefined') {
			if (!raw) {
				const accept = typeof result === 'boolean' ? result : result.accept;
				const effect = typeof result === 'boolean' ? undefined : result.effect;
				return { accept, effect, feedback: [targetIndex!] };
			}

			return result;
		}

		if (result.bubble === TreeDragOverBubble.Up) {
			const parentNode = targetNode.parent;
			const model = this.modelProvider();
			const parentIndex = parentNode && model.getListIndex(model.getNodeLocation(parentNode));

			return this.onDragOver(data, parentNode, parentIndex, originalEvent, false);
		}

		const model = this.modelProvider();
		const ref = model.getNodeLocation(targetNode);
		const start = model.getListIndex(ref);
		const length = model.getListRenderCount(ref);

		return { ...result, feedback: range(start, start + length) };
	}

	drop(data: IDragAndDropData, targetNode: ITreeNode<T, TFilterData> | undefined, targetIndex: number | undefined, originalEvent: DragEvent): void {
		this.autoExpandDisposable.dispose();
		this.autoExpandNode = undefined;

		this.dnd.drop(asTreeDragAndDropData(data), targetNode && targetNode.element, targetIndex, originalEvent);
	}
}

function asListOptions<T, TFilterData, TRef>(modelProvider: () => ITreeModel<T, TFilterData, TRef>, options?: IAbstractTreeOptions<T, TFilterData>): IListOptions<ITreeNode<T, TFilterData>> | undefined {
	return options && {
		...options,
		identityProvider: options.identityProvider && {
			getId(el) {
				return options.identityProvider!.getId(el.element);
			}
		},
		dnd: options.dnd && new TreeNodeListDragAndDrop(modelProvider, options.dnd),
		multipleSelectionController: options.multipleSelectionController && {
			isSelectionSingleChangeEvent(e) {
				return options.multipleSelectionController!.isSelectionSingleChangeEvent({ ...e, element: e.element } as any);
			},
			isSelectionRangeChangeEvent(e) {
				return options.multipleSelectionController!.isSelectionRangeChangeEvent({ ...e, element: e.element } as any);
			}
		},
		accessibilityProvider: options.accessibilityProvider && {
			getAriaLabel(e) {
				return options.accessibilityProvider!.getAriaLabel(e.element);
			},
			getAriaLevel(node) {
				return node.depth;
			}
		},
		keyboardNavigationLabelProvider: options.keyboardNavigationLabelProvider && {
			...options.keyboardNavigationLabelProvider,
			getKeyboardNavigationLabel(node) {
				return options.keyboardNavigationLabelProvider!.getKeyboardNavigationLabel(node.element);
			}
		},
		enableKeyboardNavigation: options.simpleKeyboardNavigation,
		ariaProvider: {
			getSetSize(node) {
				return node.parent!.visibleChildrenCount;
			},
			getPosInSet(node) {
				return node.visibleChildIndex + 1;
			}
		}
	};
}

export class ComposedTreeDelegate<T, N extends { element: T }> implements IListVirtualDelegate<N> {

	constructor(private delegate: IListVirtualDelegate<T>) { }

	getHeight(element: N): number {
		return this.delegate.getHeight(element.element);
	}

	getTemplateId(element: N): string {
		return this.delegate.getTemplateId(element.element);
	}

	hasDynamicHeight(element: N): boolean {
		return !!this.delegate.hasDynamicHeight && this.delegate.hasDynamicHeight(element.element);
	}

	setDynamicHeight(element: N, height: number): void {
		if (this.delegate.setDynamicHeight) {
			this.delegate.setDynamicHeight(element.element, height);
		}
	}
}

interface ITreeListTemplateData<T> {
	readonly container: HTMLElement;
	readonly indent: HTMLElement;
	readonly twistie: HTMLElement;
	indentGuidesDisposable: IDisposable;
	readonly templateData: T;
}

export enum RenderIndentGuides {
	None = 'none',
	OnHover = 'onHover',
	Always = 'always'
}

interface ITreeRendererOptions {
	readonly indent?: number;
	readonly renderIndentGuides?: RenderIndentGuides;
}

interface IRenderData<TTemplateData> {
	templateData: ITreeListTemplateData<TTemplateData>;
	height: number;
}

interface Collection<T> {
	readonly elements: T[];
	readonly onDidChange: Event<T[]>;
}

class EventCollection<T> implements Collection<T> {

	private disposables = new DisposableStore();

	get elements(): T[] {
		return this._elements;
	}

	constructor(readonly onDidChange: Event<T[]>, private _elements: T[] = []) {
		onDidChange(e => this._elements = e, null, this.disposables);
	}

	dispose() {
		this.disposables.dispose();
	}
}

class TreeRenderer<T, TFilterData, TTemplateData> implements IListRenderer<ITreeNode<T, TFilterData>, ITreeListTemplateData<TTemplateData>> {

	private static DefaultIndent = 8;

	readonly templateId: string;
	private renderedElements = new Map<T, ITreeNode<T, TFilterData>>();
	private renderedNodes = new Map<ITreeNode<T, TFilterData>, IRenderData<TTemplateData>>();
	private indent: number = TreeRenderer.DefaultIndent;

	private _renderIndentGuides: RenderIndentGuides = RenderIndentGuides.None;
	private renderedIndentGuides = new SetMap<ITreeNode<T, TFilterData>, HTMLDivElement>();
	private activeIndentNodes = new Set<ITreeNode<T, TFilterData>>();
	private indentGuidesDisposable: IDisposable = Disposable.None;

	private disposables: IDisposable[] = [];

	constructor(
		private renderer: ITreeRenderer<T, TFilterData, TTemplateData>,
		onDidChangeCollapseState: Event<ICollapseStateChangeEvent<T, TFilterData>>,
		private activeNodes: Collection<ITreeNode<T, TFilterData>>,
		options: ITreeRendererOptions = {}
	) {
		this.templateId = renderer.templateId;
		this.updateOptions(options);

		Event.map(onDidChangeCollapseState, e => e.node)(this.onDidChangeNodeTwistieState, this, this.disposables);

		if (renderer.onDidChangeTwistieState) {
			renderer.onDidChangeTwistieState(this.onDidChangeTwistieState, this, this.disposables);
		}
	}

	updateOptions(options: ITreeRendererOptions = {}): void {
		if (typeof options.indent !== 'undefined') {
			this.indent = clamp(options.indent, 0, 40);
		}

		if (typeof options.renderIndentGuides !== 'undefined') {
			const renderIndentGuides = options.renderIndentGuides;

			if (renderIndentGuides !== this._renderIndentGuides) {
				this._renderIndentGuides = renderIndentGuides;

				if (renderIndentGuides) {
					const disposables = new DisposableStore();
					this.activeNodes.onDidChange(this._onDidChangeActiveNodes, this, disposables);
					this.indentGuidesDisposable = disposables;

					this._onDidChangeActiveNodes(this.activeNodes.elements);
				} else {
					this.indentGuidesDisposable.dispose();
				}
			}
		}
	}

	renderTemplate(container: HTMLElement): ITreeListTemplateData<TTemplateData> {
		const el = append(container, $('.monaco-tl-row'));
		const indent = append(el, $('.monaco-tl-indent'));
		const twistie = append(el, $('.monaco-tl-twistie'));
		const contents = append(el, $('.monaco-tl-contents'));
		const templateData = this.renderer.renderTemplate(contents);

		return { container, indent, twistie, indentGuidesDisposable: Disposable.None, templateData };
	}

	renderElement(node: ITreeNode<T, TFilterData>, index: number, templateData: ITreeListTemplateData<TTemplateData>, height: number | undefined): void {
		if (typeof height === 'number') {
			this.renderedNodes.set(node, { templateData, height });
			this.renderedElements.set(node.element, node);
		}

		const indent = TreeRenderer.DefaultIndent + (node.depth - 1) * this.indent;
		templateData.twistie.style.marginLeft = `${indent}px`;
		templateData.indent.style.width = `${indent + this.indent - 16}px`;

		this.renderTwistie(node, templateData);

		if (typeof height === 'number') {
			this.renderIndentGuides(node, templateData);
		}

		this.renderer.renderElement(node, index, templateData.templateData, height);
	}

	disposeElement(node: ITreeNode<T, TFilterData>, index: number, templateData: ITreeListTemplateData<TTemplateData>, height: number | undefined): void {
		templateData.indentGuidesDisposable.dispose();

		if (this.renderer.disposeElement) {
			this.renderer.disposeElement(node, index, templateData.templateData, height);
		}

		if (typeof height === 'number') {
			this.renderedNodes.delete(node);
			this.renderedElements.delete(node.element);
		}
	}

	disposeTemplate(templateData: ITreeListTemplateData<TTemplateData>): void {
		this.renderer.disposeTemplate(templateData.templateData);
	}

	private onDidChangeTwistieState(element: T): void {
		const node = this.renderedElements.get(element);

		if (!node) {
			return;
		}

		this.onDidChangeNodeTwistieState(node);
	}

	private onDidChangeNodeTwistieState(node: ITreeNode<T, TFilterData>): void {
		const data = this.renderedNodes.get(node);

		if (!data) {
			return;
		}

		this.renderTwistie(node, data.templateData);
		this._onDidChangeActiveNodes(this.activeNodes.elements);
		this.renderIndentGuides(node, data.templateData);
	}

	private renderTwistie(node: ITreeNode<T, TFilterData>, templateData: ITreeListTemplateData<TTemplateData>) {
		if (this.renderer.renderTwistie) {
			this.renderer.renderTwistie(node.element, templateData.twistie);
		}

		toggleClass(templateData.twistie, 'collapsible', node.collapsible);
		toggleClass(templateData.twistie, 'collapsed', node.collapsible && node.collapsed);

		if (node.collapsible) {
			templateData.container.setAttribute('aria-expanded', String(!node.collapsed));
		} else {
			templateData.container.removeAttribute('aria-expanded');
		}
	}

	private renderIndentGuides(target: ITreeNode<T, TFilterData>, templateData: ITreeListTemplateData<TTemplateData>): void {
		clearNode(templateData.indent);
		templateData.indentGuidesDisposable.dispose();

		if (this._renderIndentGuides === RenderIndentGuides.None) {
			return;
		}

		const disposableStore = new DisposableStore();
		let node = target;

		while (node.parent && node.parent.parent) {
			const parent = node.parent;
			const guide = $<HTMLDivElement>('.indent-guide', { style: `width: ${this.indent}px` });

			if (this.activeIndentNodes.has(parent)) {
				addClass(guide, 'active');
			}

			if (templateData.indent.childElementCount === 0) {
				templateData.indent.appendChild(guide);
			} else {
				templateData.indent.insertBefore(guide, templateData.indent.firstElementChild);
			}

			this.renderedIndentGuides.add(parent, guide);
			disposableStore.add(toDisposable(() => this.renderedIndentGuides.delete(parent, guide)));

			node = parent;
		}

		templateData.indentGuidesDisposable = disposableStore;
	}

	private _onDidChangeActiveNodes(nodes: ITreeNode<T, TFilterData>[]): void {
		if (this._renderIndentGuides === RenderIndentGuides.None) {
			return;
		}

		const set = new Set<ITreeNode<T, TFilterData>>();

		nodes.forEach(node => {
			if (node.collapsible && node.children.length > 0 && !node.collapsed) {
				set.add(node);
			} else if (node.parent) {
				set.add(node.parent);
			}
		});

		this.activeIndentNodes.forEach(node => {
			if (!set.has(node)) {
				this.renderedIndentGuides.forEach(node, line => removeClass(line, 'active'));
			}
		});

		set.forEach(node => {
			if (!this.activeIndentNodes.has(node)) {
				this.renderedIndentGuides.forEach(node, line => addClass(line, 'active'));
			}
		});

		this.activeIndentNodes = set;
	}

	dispose(): void {
		this.renderedNodes.clear();
		this.renderedElements.clear();
		this.indentGuidesDisposable.dispose();
		this.disposables = dispose(this.disposables);
	}
}

class TypeFilter<T> implements ITreeFilter<T, FuzzyScore>, IDisposable {

	private _totalCount = 0;
	get totalCount(): number { return this._totalCount; }
	private _matchCount = 0;
	get matchCount(): number { return this._matchCount; }

	private _pattern: string = '';
	private _lowercasePattern: string = '';
	private disposables: IDisposable[] = [];

	set pattern(pattern: string) {
		this._pattern = pattern;
		this._lowercasePattern = pattern.toLowerCase();
	}

	constructor(
		private tree: AbstractTree<T, any, any>,
		private keyboardNavigationLabelProvider: IKeyboardNavigationLabelProvider<T>,
		private _filter?: ITreeFilter<T, FuzzyScore>
	) {
		tree.onWillRefilter(this.reset, this, this.disposables);
	}

	filter(element: T, parentVisibility: TreeVisibility): TreeFilterResult<FuzzyScore> {
		if (this._filter) {
			const result = this._filter.filter(element, parentVisibility);

			if (this.tree.options.simpleKeyboardNavigation) {
				return result;
			}

			let visibility: TreeVisibility;

			if (typeof result === 'boolean') {
				visibility = result ? TreeVisibility.Visible : TreeVisibility.Hidden;
			} else if (isFilterResult(result)) {
				visibility = getVisibleState(result.visibility);
			} else {
				visibility = result;
			}

			if (visibility === TreeVisibility.Hidden) {
				return false;
			}
		}

		this._totalCount++;

		if (this.tree.options.simpleKeyboardNavigation || !this._pattern) {
			this._matchCount++;
			return { data: FuzzyScore.Default, visibility: true };
		}

		const label = this.keyboardNavigationLabelProvider.getKeyboardNavigationLabel(element);
		const labelStr = label && label.toString();

		if (typeof labelStr === 'undefined') {
			return { data: FuzzyScore.Default, visibility: true };
		}

		const score = fuzzyScore(this._pattern, this._lowercasePattern, 0, labelStr, labelStr.toLowerCase(), 0, true);

		if (!score) {
			if (this.tree.options.filterOnType) {
				return TreeVisibility.Recurse;
			} else {
				return { data: FuzzyScore.Default, visibility: true };
			}

			// DEMO: smarter filter ?
			// return parentVisibility === TreeVisibility.Visible ? true : TreeVisibility.Recurse;
		}

		this._matchCount++;
		return { data: score, visibility: true };
	}

	private reset(): void {
		this._totalCount = 0;
		this._matchCount = 0;
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}

class TypeFilterController<T, TFilterData> implements IDisposable {

	private _enabled = false;
	get enabled(): boolean { return this._enabled; }

	private _pattern = '';
	get pattern(): string { return this._pattern; }

	private _filterOnType: boolean;
	get filterOnType(): boolean { return this._filterOnType; }

	private _empty: boolean = false;
	get empty(): boolean { return this._empty; }

	private _onDidChangeEmptyState = new Emitter<boolean>();
	readonly onDidChangeEmptyState: Event<boolean> = Event.latch(this._onDidChangeEmptyState.event);

	private positionClassName = 'ne';
	private domNode: HTMLElement;
	private messageDomNode: HTMLElement;
	private labelDomNode: HTMLElement;
	private filterOnTypeDomNode: HTMLInputElement;
	private clearDomNode: HTMLElement;
	private keyboardNavigationEventFilter?: IKeyboardNavigationEventFilter;

	private automaticKeyboardNavigation = true;
	private triggered = false;

	private _onDidChangePattern = new Emitter<string>();
	readonly onDidChangePattern = this._onDidChangePattern.event;

	private enabledDisposables: IDisposable[] = [];
	private disposables: IDisposable[] = [];

	constructor(
		private tree: AbstractTree<T, TFilterData, any>,
		model: ITreeModel<T, TFilterData, any>,
		private view: List<ITreeNode<T, TFilterData>>,
		private filter: TypeFilter<T>,
		private keyboardNavigationLabelProvider: IKeyboardNavigationLabelProvider<T>
	) {
		this.domNode = $(`.monaco-list-type-filter.${this.positionClassName}`);
		this.domNode.draggable = true;
		domEvent(this.domNode, 'dragstart')(this.onDragStart, this, this.disposables);

		this.messageDomNode = append(view.getHTMLElement(), $(`.monaco-list-type-filter-message`));

		this.labelDomNode = append(this.domNode, $('span.label'));
		const controls = append(this.domNode, $('.controls'));

		this._filterOnType = !!tree.options.filterOnType;
		this.filterOnTypeDomNode = append(controls, $<HTMLInputElement>('input.filter'));
		this.filterOnTypeDomNode.type = 'checkbox';
		this.filterOnTypeDomNode.checked = this._filterOnType;
		this.filterOnTypeDomNode.tabIndex = -1;
		this.updateFilterOnTypeTitle();
		domEvent(this.filterOnTypeDomNode, 'input')(this.onDidChangeFilterOnType, this, this.disposables);

		this.clearDomNode = append(controls, $<HTMLInputElement>('button.clear'));
		this.clearDomNode.tabIndex = -1;
		this.clearDomNode.title = localize('clear', "Clear");

		this.keyboardNavigationEventFilter = tree.options.keyboardNavigationEventFilter;

		model.onDidSplice(this.onDidSpliceModel, this, this.disposables);
		this.updateOptions(tree.options);
	}

	updateOptions(options: IAbstractTreeOptions<T, TFilterData>): void {
		if (options.simpleKeyboardNavigation) {
			this.disable();
		} else {
			this.enable();
		}

		if (typeof options.filterOnType !== 'undefined') {
			this._filterOnType = !!options.filterOnType;
			this.filterOnTypeDomNode.checked = this._filterOnType;
		}

		if (typeof options.automaticKeyboardNavigation !== 'undefined') {
			this.automaticKeyboardNavigation = options.automaticKeyboardNavigation;
		}

		this.tree.refilter();
		this.render();

		if (!this.automaticKeyboardNavigation) {
			this.onEventOrInput('');
		}
	}

	toggle(): void {
		this.triggered = !this.triggered;

		if (!this.triggered) {
			this.onEventOrInput('');
		}
	}

	private enable(): void {
		if (this._enabled) {
			return;
		}

		const isPrintableCharEvent = this.keyboardNavigationLabelProvider.mightProducePrintableCharacter ? (e: IKeyboardEvent) => this.keyboardNavigationLabelProvider.mightProducePrintableCharacter!(e) : (e: IKeyboardEvent) => mightProducePrintableCharacter(e);
		const onKeyDown = Event.chain(domEvent(this.view.getHTMLElement(), 'keydown'))
			.filter(e => !isInputElement(e.target as HTMLElement) || e.target === this.filterOnTypeDomNode)
			.map(e => new StandardKeyboardEvent(e))
			.filter(this.keyboardNavigationEventFilter || (() => true))
			.filter(() => this.automaticKeyboardNavigation || this.triggered)
			.filter(e => isPrintableCharEvent(e) || ((this.pattern.length > 0 || this.triggered) && ((e.keyCode === KeyCode.Escape || e.keyCode === KeyCode.Backspace) && !e.altKey && !e.ctrlKey && !e.metaKey) || (e.keyCode === KeyCode.Backspace && (isMacintosh ? (e.altKey && !e.metaKey) : e.ctrlKey) && !e.shiftKey)))
			.forEach(e => { e.stopPropagation(); e.preventDefault(); })
			.event;

		const onClear = domEvent(this.clearDomNode, 'click');

		Event.chain(Event.any<MouseEvent | StandardKeyboardEvent>(onKeyDown, onClear))
			.event(this.onEventOrInput, this, this.enabledDisposables);

		this.filter.pattern = '';
		this.tree.refilter();
		this.render();
		this._enabled = true;
		this.triggered = false;
	}

	private disable(): void {
		if (!this._enabled) {
			return;
		}

		this.domNode.remove();
		this.enabledDisposables = dispose(this.enabledDisposables);
		this.tree.refilter();
		this.render();
		this._enabled = false;
		this.triggered = false;
	}

	private onEventOrInput(e: MouseEvent | StandardKeyboardEvent | string): void {
		if (typeof e === 'string') {
			this.onInput(e);
		} else if (e instanceof MouseEvent || e.keyCode === KeyCode.Escape || (e.keyCode === KeyCode.Backspace && (isMacintosh ? e.altKey : e.ctrlKey))) {
			this.onInput('');
		} else if (e.keyCode === KeyCode.Backspace) {
			this.onInput(this.pattern.length === 0 ? '' : this.pattern.substr(0, this.pattern.length - 1));
		} else {
			this.onInput(this.pattern + e.browserEvent.key);
		}
	}

	private onInput(pattern: string): void {
		const container = this.view.getHTMLElement();

		if (pattern && !this.domNode.parentElement) {
			container.append(this.domNode);
		} else if (!pattern && this.domNode.parentElement) {
			this.domNode.remove();
			this.tree.domFocus();
		}

		this._pattern = pattern;
		this._onDidChangePattern.fire(pattern);

		this.filter.pattern = pattern;
		this.tree.refilter();

		if (pattern) {
			this.tree.focusNext(0, true, undefined, node => !FuzzyScore.isDefault(node.filterData as any as FuzzyScore));
		}

		const focus = this.tree.getFocus();

		if (focus.length > 0) {
			const element = focus[0];

			if (this.tree.getRelativeTop(element) === null) {
				this.tree.reveal(element, 0.5);
			}
		}

		this.render();

		if (!pattern) {
			this.triggered = false;
		}
	}

	private onDragStart(): void {
		const container = this.view.getHTMLElement();
		const { left } = getDomNodePagePosition(container);
		const containerWidth = container.clientWidth;
		const midContainerWidth = containerWidth / 2;
		const width = this.domNode.clientWidth;
		const disposables: IDisposable[] = [];
		let positionClassName = this.positionClassName;

		const updatePosition = () => {
			switch (positionClassName) {
				case 'nw':
					this.domNode.style.top = `4px`;
					this.domNode.style.left = `4px`;
					break;
				case 'ne':
					this.domNode.style.top = `4px`;
					this.domNode.style.left = `${containerWidth - width - 6}px`;
					break;
			}
		};

		const onDragOver = (event: DragEvent) => {
			event.preventDefault(); // needed so that the drop event fires (https://stackoverflow.com/questions/21339924/drop-event-not-firing-in-chrome)

			const x = event.screenX - left;
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'none';
			}

			if (x < midContainerWidth) {
				positionClassName = 'nw';
			} else {
				positionClassName = 'ne';
			}

			updatePosition();
		};

		const onDragEnd = () => {
			this.positionClassName = positionClassName;
			this.domNode.className = `monaco-list-type-filter ${this.positionClassName}`;
			this.domNode.style.top = null;
			this.domNode.style.left = null;

			dispose(disposables);
		};

		updatePosition();
		removeClass(this.domNode, positionClassName);

		addClass(this.domNode, 'dragging');
		disposables.push(toDisposable(() => removeClass(this.domNode, 'dragging')));

		domEvent(document, 'dragover')(onDragOver, null, disposables);
		domEvent(this.domNode, 'dragend')(onDragEnd, null, disposables);

		StaticDND.CurrentDragAndDropData = new DragAndDropData('vscode-ui');
		disposables.push(toDisposable(() => StaticDND.CurrentDragAndDropData = undefined));
	}

	private onDidSpliceModel(): void {
		if (!this._enabled || this.pattern.length === 0) {
			return;
		}

		this.tree.refilter();
		this.render();
	}

	private onDidChangeFilterOnType(): void {
		this.tree.updateOptions({ filterOnType: this.filterOnTypeDomNode.checked });
		this.tree.refilter();
		this.tree.domFocus();
		this.render();
		this.updateFilterOnTypeTitle();
	}

	private updateFilterOnTypeTitle(): void {
		if (this.filterOnType) {
			this.filterOnTypeDomNode.title = localize('disable filter on type', "Disable Filter on Type");
		} else {
			this.filterOnTypeDomNode.title = localize('enable filter on type', "Enable Filter on Type");
		}
	}

	private render(): void {
		const noMatches = this.filter.totalCount > 0 && this.filter.matchCount === 0;

		if (this.pattern && this.tree.options.filterOnType && noMatches) {
			this.messageDomNode.textContent = localize('empty', "No elements found");
			this._empty = true;
		} else {
			this.messageDomNode.innerHTML = '';
			this._empty = false;
		}

		toggleClass(this.domNode, 'no-matches', noMatches);
		this.domNode.title = localize('found', "Matched {0} out of {1} elements", this.filter.matchCount, this.filter.totalCount);
		this.labelDomNode.textContent = this.pattern.length > 16 ? '…' + this.pattern.substr(this.pattern.length - 16) : this.pattern;

		this._onDidChangeEmptyState.fire(this._empty);
	}

	shouldAllowFocus(node: ITreeNode<T, TFilterData>): boolean {
		if (!this.enabled || !this.pattern || this.filterOnType) {
			return true;
		}

		if (this.filter.totalCount > 0 && this.filter.matchCount <= 1) {
			return true;
		}

		return !FuzzyScore.isDefault(node.filterData as any as FuzzyScore);
	}

	dispose() {
		this.disable();
		this._onDidChangePattern.dispose();
		this.disposables = dispose(this.disposables);
	}
}

function isInputElement(e: HTMLElement): boolean {
	return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA';
}

function asTreeEvent<T>(event: IListEvent<ITreeNode<T, any>>): ITreeEvent<T> {
	return {
		elements: event.elements.map(node => node.element),
		browserEvent: event.browserEvent
	};
}

function asTreeMouseEvent<T>(event: IListMouseEvent<ITreeNode<T, any>>): ITreeMouseEvent<T> {
	let target: TreeMouseEventTarget = TreeMouseEventTarget.Unknown;

	if (hasParentWithClass(event.browserEvent.target as HTMLElement, 'monaco-tl-twistie', 'monaco-tl-row')) {
		target = TreeMouseEventTarget.Twistie;
	} else if (hasParentWithClass(event.browserEvent.target as HTMLElement, 'monaco-tl-contents', 'monaco-tl-row')) {
		target = TreeMouseEventTarget.Element;
	}

	return {
		browserEvent: event.browserEvent,
		element: event.element ? event.element.element : null,
		target
	};
}

function asTreeContextMenuEvent<T>(event: IListContextMenuEvent<ITreeNode<T, any>>): ITreeContextMenuEvent<T> {
	return {
		element: event.element ? event.element.element : null,
		browserEvent: event.browserEvent,
		anchor: event.anchor
	};
}

export interface IKeyboardNavigationEventFilter {
	(e: StandardKeyboardEvent): boolean;
}

export interface IAbstractTreeOptionsUpdate extends ITreeRendererOptions {
	readonly automaticKeyboardNavigation?: boolean;
	readonly simpleKeyboardNavigation?: boolean;
	readonly filterOnType?: boolean;
	readonly openOnSingleClick?: boolean;
}

export interface IAbstractTreeOptions<T, TFilterData = void> extends IAbstractTreeOptionsUpdate, IListOptions<T> {
	readonly collapseByDefault?: boolean; // defaults to false
	readonly filter?: ITreeFilter<T, TFilterData>;
	readonly dnd?: ITreeDragAndDrop<T>;
	readonly autoExpandSingleChildren?: boolean;
	readonly keyboardNavigationEventFilter?: IKeyboardNavigationEventFilter;
	readonly expandOnlyOnTwistieClick?: boolean | ((e: T) => boolean);
	readonly additionalScrollHeight?: number;
}

function dfs<T, TFilterData>(node: ITreeNode<T, TFilterData>, fn: (node: ITreeNode<T, TFilterData>) => void): void {
	fn(node);
	node.children.forEach(child => dfs(child, fn));
}

/**
 * The trait concept needs to exist at the tree level, because collapsed
 * tree nodes will not be known by the list.
 */
class Trait<T> {

	private nodes: ITreeNode<T, any>[] = [];
	private elements: T[] | undefined;

	private _onDidChange = new Emitter<ITreeEvent<T>>();
	readonly onDidChange = this._onDidChange.event;

	private _nodeSet: Set<ITreeNode<T, any>> | undefined;
	private get nodeSet(): Set<ITreeNode<T, any>> {
		if (!this._nodeSet) {
			this._nodeSet = this.createNodeSet();
		}

		return this._nodeSet;
	}

	constructor(private identityProvider?: IIdentityProvider<T>) { }

	set(nodes: ITreeNode<T, any>[], browserEvent?: UIEvent): void {
		if (equals(this.nodes, nodes)) {
			return;
		}

		this._set(nodes, false, browserEvent);
	}

	private _set(nodes: ITreeNode<T, any>[], silent: boolean, browserEvent?: UIEvent): void {
		this.nodes = [...nodes];
		this.elements = undefined;
		this._nodeSet = undefined;

		if (!silent) {
			const that = this;
			this._onDidChange.fire({ get elements() { return that.get(); }, browserEvent });
		}
	}

	get(): T[] {
		if (!this.elements) {
			this.elements = this.nodes.map(node => node.element);
		}

		return [...this.elements];
	}

	getNodes(): readonly ITreeNode<T, any>[] {
		return this.nodes;
	}

	has(node: ITreeNode<T, any>): boolean {
		return this.nodeSet.has(node);
	}

	onDidModelSplice({ insertedNodes, deletedNodes }: ITreeModelSpliceEvent<T, any>): void {
		if (!this.identityProvider) {
			const set = this.createNodeSet();
			const visit = (node: ITreeNode<T, any>) => set.delete(node);
			deletedNodes.forEach(node => dfs(node, visit));
			this.set(values(set));
			return;
		}

		const deletedNodesIdSet = new Set<string>();
		const deletedNodesVisitor = (node: ITreeNode<T, any>) => deletedNodesIdSet.add(this.identityProvider!.getId(node.element).toString());
		deletedNodes.forEach(node => dfs(node, deletedNodesVisitor));

		const insertedNodesMap = new Map<string, ITreeNode<T, any>>();
		const insertedNodesVisitor = (node: ITreeNode<T, any>) => insertedNodesMap.set(this.identityProvider!.getId(node.element).toString(), node);
		insertedNodes.forEach(node => dfs(node, insertedNodesVisitor));

		const nodes: ITreeNode<T, any>[] = [];
		let silent = true;

		for (const node of this.nodes) {
			const id = this.identityProvider.getId(node.element).toString();
			const wasDeleted = deletedNodesIdSet.has(id);

			if (!wasDeleted) {
				nodes.push(node);
			} else {
				const insertedNode = insertedNodesMap.get(id);

				if (insertedNode) {
					nodes.push(insertedNode);
				} else {
					silent = false;
				}
			}
		}

		this._set(nodes, silent);
	}

	private createNodeSet(): Set<ITreeNode<T, any>> {
		const set = new Set<ITreeNode<T, any>>();

		for (const node of this.nodes) {
			set.add(node);
		}

		return set;
	}
}

class TreeNodeListMouseController<T, TFilterData, TRef> extends MouseController<ITreeNode<T, TFilterData>> {

	constructor(list: TreeNodeList<T, TFilterData, TRef>, private tree: AbstractTree<T, TFilterData, TRef>) {
		super(list);
	}

	protected onPointer(e: IListMouseEvent<ITreeNode<T, TFilterData>>): void {
		if (isInputElement(e.browserEvent.target as HTMLElement)) {
			return;
		}

		const node = e.element;

		if (!node) {
			return super.onPointer(e);
		}

		if (this.isSelectionRangeChangeEvent(e) || this.isSelectionSingleChangeEvent(e)) {
			return super.onPointer(e);
		}

		const onTwistie = hasClass(e.browserEvent.target as HTMLElement, 'monaco-tl-twistie');

		if (!this.tree.openOnSingleClick && e.browserEvent.detail !== 2 && !onTwistie) {
			return super.onPointer(e);
		}

		let expandOnlyOnTwistieClick = false;

		if (typeof this.tree.expandOnlyOnTwistieClick === 'function') {
			expandOnlyOnTwistieClick = this.tree.expandOnlyOnTwistieClick(node.element);
		} else {
			expandOnlyOnTwistieClick = !!this.tree.expandOnlyOnTwistieClick;
		}

		if (expandOnlyOnTwistieClick && !onTwistie) {
			return super.onPointer(e);
		}

		const model = ((this.tree as any).model as ITreeModel<T, TFilterData, TRef>); // internal
		const location = model.getNodeLocation(node);
		const recursive = e.browserEvent.altKey;
		model.setCollapsed(location, undefined, recursive);

		if (expandOnlyOnTwistieClick && onTwistie) {
			return;
		}

		super.onPointer(e);
	}

	protected onDoubleClick(e: IListMouseEvent<ITreeNode<T, TFilterData>>): void {
		const onTwistie = hasClass(e.browserEvent.target as HTMLElement, 'monaco-tl-twistie');

		if (onTwistie) {
			return;
		}

		super.onDoubleClick(e);
	}
}

interface ITreeNodeListOptions<T, TFilterData, TRef> extends IListOptions<ITreeNode<T, TFilterData>> {
	readonly tree: AbstractTree<T, TFilterData, TRef>;
}

/**
 * We use this List subclass to restore selection and focus as nodes
 * get rendered in the list, possibly due to a node expand() call.
 */
class TreeNodeList<T, TFilterData, TRef> extends List<ITreeNode<T, TFilterData>> {

	constructor(
		container: HTMLElement,
		virtualDelegate: IListVirtualDelegate<ITreeNode<T, TFilterData>>,
		renderers: IListRenderer<any /* TODO@joao */, any>[],
		private focusTrait: Trait<T>,
		private selectionTrait: Trait<T>,
		options: ITreeNodeListOptions<T, TFilterData, TRef>
	) {
		super(container, virtualDelegate, renderers, options);
	}

	protected createMouseController(options: ITreeNodeListOptions<T, TFilterData, TRef>): MouseController<ITreeNode<T, TFilterData>> {
		return new TreeNodeListMouseController(this, options.tree);
	}

	splice(start: number, deleteCount: number, elements: ITreeNode<T, TFilterData>[] = []): void {
		super.splice(start, deleteCount, elements);

		if (elements.length === 0) {
			return;
		}

		const additionalFocus: number[] = [];
		const additionalSelection: number[] = [];

		elements.forEach((node, index) => {
			if (this.focusTrait.has(node)) {
				additionalFocus.push(start + index);
			}

			if (this.selectionTrait.has(node)) {
				additionalSelection.push(start + index);
			}
		});

		if (additionalFocus.length > 0) {
			super.setFocus(distinctES6([...super.getFocus(), ...additionalFocus]));
		}

		if (additionalSelection.length > 0) {
			super.setSelection(distinctES6([...super.getSelection(), ...additionalSelection]));
		}
	}

	setFocus(indexes: number[], browserEvent?: UIEvent, fromAPI = false): void {
		super.setFocus(indexes, browserEvent);

		if (!fromAPI) {
			this.focusTrait.set(indexes.map(i => this.element(i)), browserEvent);
		}
	}

	setSelection(indexes: number[], browserEvent?: UIEvent, fromAPI = false): void {
		super.setSelection(indexes, browserEvent);

		if (!fromAPI) {
			this.selectionTrait.set(indexes.map(i => this.element(i)), browserEvent);
		}
	}
}

export abstract class AbstractTree<T, TFilterData, TRef> implements IDisposable {

	protected view: TreeNodeList<T, TFilterData, TRef>;
	private renderers: TreeRenderer<T, TFilterData, any>[];
	protected model: ITreeModel<T, TFilterData, TRef>;
	private focus: Trait<T>;
	private selection: Trait<T>;
	private eventBufferer = new EventBufferer();
	private typeFilterController?: TypeFilterController<T, TFilterData>;
	private focusNavigationFilter: ((node: ITreeNode<T, TFilterData>) => boolean) | undefined;
	private styleElement: HTMLStyleElement;
	protected disposables: IDisposable[] = [];

	get onDidScroll(): Event<ScrollEvent> { return this.view.onDidScroll; }

	get onDidChangeFocus(): Event<ITreeEvent<T>> { return this.eventBufferer.wrapEvent(this.focus.onDidChange); }
	get onDidChangeSelection(): Event<ITreeEvent<T>> { return this.eventBufferer.wrapEvent(this.selection.onDidChange); }
	get onDidOpen(): Event<ITreeEvent<T>> { return Event.map(this.view.onDidOpen, asTreeEvent); }

	get onMouseClick(): Event<ITreeMouseEvent<T>> { return Event.map(this.view.onMouseClick, asTreeMouseEvent); }
	get onMouseDblClick(): Event<ITreeMouseEvent<T>> { return Event.map(this.view.onMouseDblClick, asTreeMouseEvent); }
	get onContextMenu(): Event<ITreeContextMenuEvent<T>> { return Event.map(this.view.onContextMenu, asTreeContextMenuEvent); }

	get onKeyDown(): Event<KeyboardEvent> { return this.view.onKeyDown; }
	get onKeyUp(): Event<KeyboardEvent> { return this.view.onKeyUp; }
	get onKeyPress(): Event<KeyboardEvent> { return this.view.onKeyPress; }

	get onDidFocus(): Event<void> { return this.view.onDidFocus; }
	get onDidBlur(): Event<void> { return this.view.onDidBlur; }

	get onDidChangeCollapseState(): Event<ICollapseStateChangeEvent<T, TFilterData>> { return this.model.onDidChangeCollapseState; }
	get onDidChangeRenderNodeCount(): Event<ITreeNode<T, TFilterData>> { return this.model.onDidChangeRenderNodeCount; }

	private _onWillRefilter = new Emitter<void>();
	readonly onWillRefilter: Event<void> = this._onWillRefilter.event;

	get filterOnType(): boolean { return !!this._options.filterOnType; }
	get onDidChangeTypeFilterPattern(): Event<string> { return this.typeFilterController ? this.typeFilterController.onDidChangePattern : Event.None; }

	get openOnSingleClick(): boolean { return typeof this._options.openOnSingleClick === 'undefined' ? true : this._options.openOnSingleClick; }
	get expandOnlyOnTwistieClick(): boolean | ((e: T) => boolean) { return typeof this._options.expandOnlyOnTwistieClick === 'undefined' ? false : this._options.expandOnlyOnTwistieClick; }

	private _onDidUpdateOptions = new Emitter<IAbstractTreeOptions<T, TFilterData>>();
	readonly onDidUpdateOptions: Event<IAbstractTreeOptions<T, TFilterData>> = this._onDidUpdateOptions.event;

	get onDidDispose(): Event<void> { return this.view.onDidDispose; }

	constructor(
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ITreeRenderer<T, TFilterData, any>[],
		private _options: IAbstractTreeOptions<T, TFilterData> = {}
	) {
		const treeDelegate = new ComposedTreeDelegate<T, ITreeNode<T, TFilterData>>(delegate);

		const onDidChangeCollapseStateRelay = new Relay<ICollapseStateChangeEvent<T, TFilterData>>();
		const onDidChangeActiveNodes = new Relay<ITreeNode<T, TFilterData>[]>();
		const activeNodes = new EventCollection(onDidChangeActiveNodes.event);
		this.disposables.push(activeNodes);

		this.renderers = renderers.map(r => new TreeRenderer<T, TFilterData, any>(r, onDidChangeCollapseStateRelay.event, activeNodes, _options));
		this.disposables.push(...this.renderers);

		let filter: TypeFilter<T> | undefined;

		if (_options.keyboardNavigationLabelProvider) {
			filter = new TypeFilter(this, _options.keyboardNavigationLabelProvider, _options.filter as any as ITreeFilter<T, FuzzyScore>);
			_options = { ..._options, filter: filter as ITreeFilter<T, TFilterData> }; // TODO need typescript help here
			this.disposables.push(filter);
		}

		this.focus = new Trait(_options.identityProvider);
		this.selection = new Trait(_options.identityProvider);
		this.view = new TreeNodeList(container, treeDelegate, this.renderers, this.focus, this.selection, { ...asListOptions(() => this.model, _options), tree: this });

		this.model = this.createModel(this.view, _options);
		onDidChangeCollapseStateRelay.input = this.model.onDidChangeCollapseState;

		this.model.onDidSplice(e => {
			this.focus.onDidModelSplice(e);
			this.selection.onDidModelSplice(e);
		}, null, this.disposables);

		onDidChangeActiveNodes.input = Event.map(Event.any<any>(this.focus.onDidChange, this.selection.onDidChange, this.model.onDidSplice), () => [...this.focus.getNodes(), ...this.selection.getNodes()]);

		if (_options.keyboardSupport !== false) {
			const onKeyDown = Event.chain(this.view.onKeyDown)
				.filter(e => !isInputElement(e.target as HTMLElement))
				.map(e => new StandardKeyboardEvent(e));

			onKeyDown.filter(e => e.keyCode === KeyCode.LeftArrow).on(this.onLeftArrow, this, this.disposables);
			onKeyDown.filter(e => e.keyCode === KeyCode.RightArrow).on(this.onRightArrow, this, this.disposables);
			onKeyDown.filter(e => e.keyCode === KeyCode.Space).on(this.onSpace, this, this.disposables);
		}

		if (_options.keyboardNavigationLabelProvider) {
			this.typeFilterController = new TypeFilterController(this, this.model, this.view, filter!, _options.keyboardNavigationLabelProvider);
			this.focusNavigationFilter = node => this.typeFilterController!.shouldAllowFocus(node);
			this.disposables.push(this.typeFilterController!);
		}

		this.styleElement = createStyleSheet(this.view.getHTMLElement());
		toggleClass(this.getHTMLElement(), 'always', this._options.renderIndentGuides === RenderIndentGuides.Always);
	}

	updateOptions(optionsUpdate: IAbstractTreeOptionsUpdate = {}): void {
		this._options = { ...this._options, ...optionsUpdate };

		for (const renderer of this.renderers) {
			renderer.updateOptions(optionsUpdate);
		}

		this.view.updateOptions({
			enableKeyboardNavigation: this._options.simpleKeyboardNavigation,
			automaticKeyboardNavigation: this._options.automaticKeyboardNavigation
		});

		if (this.typeFilterController) {
			this.typeFilterController.updateOptions(this._options);
		}

		this._onDidUpdateOptions.fire(this._options);

		toggleClass(this.getHTMLElement(), 'always', this._options.renderIndentGuides === RenderIndentGuides.Always);
	}

	get options(): IAbstractTreeOptions<T, TFilterData> {
		return this._options;
	}

	updateWidth(element: TRef): void {
		const index = this.model.getListIndex(element);

		if (index === -1) {
			return;
		}

		this.view.updateWidth(index);
	}

	// Widget

	getHTMLElement(): HTMLElement {
		return this.view.getHTMLElement();
	}

	get contentHeight(): number {
		if (this.typeFilterController && this.typeFilterController.filterOnType && this.typeFilterController.empty) {
			return 100;
		}

		return this.view.contentHeight;
	}

	get onDidChangeContentHeight(): Event<number> {
		let result = this.view.onDidChangeContentHeight;

		if (this.typeFilterController) {
			result = Event.any(result, Event.map(this.typeFilterController.onDidChangeEmptyState, () => this.contentHeight));
		}

		return result;
	}

	get scrollTop(): number {
		return this.view.scrollTop;
	}

	set scrollTop(scrollTop: number) {
		this.view.scrollTop = scrollTop;
	}

	get scrollHeight(): number {
		return this.view.scrollHeight;
	}

	get renderHeight(): number {
		return this.view.renderHeight;
	}

	get firstVisibleElement(): T {
		const index = this.view.firstVisibleIndex;
		const node = this.view.element(index);
		return node.element;
	}

	get lastVisibleElement(): T {
		const index = this.view.lastVisibleIndex;
		const node = this.view.element(index);
		return node.element;
	}

	domFocus(): void {
		this.view.domFocus();
	}

	isDOMFocused(): boolean {
		return this.getHTMLElement() === document.activeElement;
	}

	layout(height?: number, width?: number): void {
		this.view.layout(height, width);
	}

	style(styles: IListStyles): void {
		const suffix = `.${this.view.domId}`;
		const content: string[] = [];

		if (styles.treeIndentGuidesStroke) {
			content.push(`.monaco-list${suffix}:hover .monaco-tl-indent > .indent-guide, .monaco-list${suffix}.always .monaco-tl-indent > .indent-guide  { border-color: ${styles.treeIndentGuidesStroke.transparent(0.4)}; }`);
			content.push(`.monaco-list${suffix} .monaco-tl-indent > .indent-guide.active { border-color: ${styles.treeIndentGuidesStroke}; }`);
		}

		const newStyles = content.join('\n');
		if (newStyles !== this.styleElement.innerHTML) {
			this.styleElement.innerHTML = newStyles;
		}

		this.view.style(styles);
	}

	// Tree navigation

	getParentElement(location: TRef): T {
		return this.model.getParentElement(location);
	}

	getFirstElementChild(location: TRef): T | undefined {
		return this.model.getFirstElementChild(location);
	}

	// Tree

	getNode(location?: TRef): ITreeNode<T, TFilterData> {
		return this.model.getNode(location);
	}

	collapse(location: TRef, recursive: boolean = false): boolean {
		return this.model.setCollapsed(location, true, recursive);
	}

	expand(location: TRef, recursive: boolean = false): boolean {
		return this.model.setCollapsed(location, false, recursive);
	}

	toggleCollapsed(location: TRef, recursive: boolean = false): boolean {
		return this.model.setCollapsed(location, undefined, recursive);
	}

	expandAll(): void {
		this.model.setCollapsed(this.model.rootRef, false, true);
	}

	collapseAll(): void {
		this.model.setCollapsed(this.model.rootRef, true, true);
	}

	isCollapsible(location: TRef): boolean {
		return this.model.isCollapsible(location);
	}

	isCollapsed(location: TRef): boolean {
		return this.model.isCollapsed(location);
	}

	toggleKeyboardNavigation(): void {
		this.view.toggleKeyboardNavigation();

		if (this.typeFilterController) {
			this.typeFilterController.toggle();
		}
	}

	refilter(): void {
		this._onWillRefilter.fire(undefined);
		this.model.refilter();
	}

	setSelection(elements: TRef[], browserEvent?: UIEvent): void {
		const nodes = elements.map(e => this.model.getNode(e));
		this.selection.set(nodes, browserEvent);

		const indexes = elements.map(e => this.model.getListIndex(e)).filter(i => i > -1);
		this.view.setSelection(indexes, browserEvent, true);
	}

	getSelection(): T[] {
		return this.selection.get();
	}

	setFocus(elements: TRef[], browserEvent?: UIEvent): void {
		const nodes = elements.map(e => this.model.getNode(e));
		this.focus.set(nodes, browserEvent);

		const indexes = elements.map(e => this.model.getListIndex(e)).filter(i => i > -1);
		this.view.setFocus(indexes, browserEvent, true);
	}

	focusNext(n = 1, loop = false, browserEvent?: UIEvent, filter = this.focusNavigationFilter): void {
		this.view.focusNext(n, loop, browserEvent, filter);
	}

	focusPrevious(n = 1, loop = false, browserEvent?: UIEvent, filter = this.focusNavigationFilter): void {
		this.view.focusPrevious(n, loop, browserEvent, filter);
	}

	focusNextPage(browserEvent?: UIEvent, filter = this.focusNavigationFilter): void {
		this.view.focusNextPage(browserEvent, filter);
	}

	focusPreviousPage(browserEvent?: UIEvent, filter = this.focusNavigationFilter): void {
		this.view.focusPreviousPage(browserEvent, filter);
	}

	focusLast(browserEvent?: UIEvent, filter = this.focusNavigationFilter): void {
		this.view.focusLast(browserEvent, filter);
	}

	focusFirst(browserEvent?: UIEvent, filter = this.focusNavigationFilter): void {
		this.view.focusFirst(browserEvent, filter);
	}

	getFocus(): T[] {
		return this.focus.get();
	}

	open(elements: TRef[], browserEvent?: UIEvent): void {
		const indexes = elements.map(e => this.model.getListIndex(e));
		this.view.open(indexes, browserEvent);
	}

	reveal(location: TRef, relativeTop?: number): void {
		this.model.expandTo(location);

		const index = this.model.getListIndex(location);

		if (index === -1) {
			return;
		}

		this.view.reveal(index, relativeTop);
	}

	/**
	 * Returns the relative position of an element rendered in the list.
	 * Returns `null` if the element isn't *entirely* in the visible viewport.
	 */
	getRelativeTop(location: TRef): number | null {
		const index = this.model.getListIndex(location);

		if (index === -1) {
			return null;
		}

		return this.view.getRelativeTop(index);
	}

	// List

	private onLeftArrow(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();

		const nodes = this.view.getFocusedElements();

		if (nodes.length === 0) {
			return;
		}

		const node = nodes[0];
		const location = this.model.getNodeLocation(node);
		const didChange = this.model.setCollapsed(location, true);

		if (!didChange) {
			const parentLocation = this.model.getParentNodeLocation(location);

			if (parentLocation === null) {
				return;
			}

			const parentListIndex = this.model.getListIndex(parentLocation);

			this.view.reveal(parentListIndex);
			this.view.setFocus([parentListIndex]);
		}
	}

	private onRightArrow(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();

		const nodes = this.view.getFocusedElements();

		if (nodes.length === 0) {
			return;
		}

		const node = nodes[0];
		const location = this.model.getNodeLocation(node);
		const didChange = this.model.setCollapsed(location, false);

		if (!didChange) {
			if (!node.children.some(child => child.visible)) {
				return;
			}

			const [focusedIndex] = this.view.getFocus();
			const firstChildIndex = focusedIndex + 1;

			this.view.reveal(firstChildIndex);
			this.view.setFocus([firstChildIndex]);
		}
	}

	private onSpace(e: StandardKeyboardEvent): void {
		e.preventDefault();
		e.stopPropagation();

		const nodes = this.view.getFocusedElements();

		if (nodes.length === 0) {
			return;
		}

		const node = nodes[0];
		const location = this.model.getNodeLocation(node);
		const recursive = e.browserEvent.altKey;

		this.model.setCollapsed(location, undefined, recursive);
	}

	protected abstract createModel(view: ISpliceable<ITreeNode<T, TFilterData>>, options: IAbstractTreeOptions<T, TFilterData>): ITreeModel<T, TFilterData, TRef>;

	navigate(start?: TRef): ITreeNavigator<T> {
		return new TreeNavigator(this.view, this.model, start);
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
		this.view.dispose();
	}
}

interface ITreeNavigatorView<T extends NonNullable<any>, TFilterData> {
	readonly length: number;
	element(index: number): ITreeNode<T, TFilterData>;
}

class TreeNavigator<T extends NonNullable<any>, TFilterData, TRef> implements ITreeNavigator<T> {

	private index: number;

	constructor(private view: ITreeNavigatorView<T, TFilterData>, private model: ITreeModel<T, TFilterData, TRef>, start?: TRef) {
		if (start) {
			this.index = this.model.getListIndex(start);
		} else {
			this.index = -1;
		}
	}

	current(): T | null {
		if (this.index < 0 || this.index >= this.view.length) {
			return null;
		}

		return this.view.element(this.index).element;
	}

	previous(): T | null {
		this.index--;
		return this.current();
	}

	next(): T | null {
		this.index++;
		return this.current();
	}

	parent(): T | null {
		if (this.index < 0 || this.index >= this.view.length) {
			return null;
		}

		const node = this.view.element(this.index);

		if (!node.parent) {
			this.index = -1;
			return this.current();
		}

		this.index = this.model.getListIndex(this.model.getNodeLocation(node.parent));
		return this.current();
	}

	first(): T | null {
		this.index = 0;
		return this.current();
	}

	last(): T | null {
		this.index = this.view.length - 1;
		return this.current();
	}
}
