/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debugToolBar';
import * as errors from 'vs/base/common/errors';
import * as browser from 'vs/base/browser/browser';
import * as dom from 'vs/base/browser/dom';
import * as arrays from 'vs/base/common/arrays';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IAction, IRunEvent, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { ActionBar, ActionsOrientation, Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IDebugConfiguration, IDebugService, State } from 'vs/workbench/contrib/debug/common/debug';
import { FocusSessionActionViewItem } from 'vs/workbench/contrib/debug/browser/debugActionViewItems';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Themable } from 'vs/workbench/common/theme';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { registerColor, contrastBorder, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { localize } from 'vs/nls';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { createAndFillInActionBarActions, MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, IMenuService, MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { FocusSessionAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';

const DEBUG_TOOLBAR_POSITION_KEY = 'debug.actionswidgetposition';
const DEBUG_TOOLBAR_Y_KEY = 'debug.actionswidgety';

export const debugToolBarBackground = registerColor('debugToolBar.background', {
	dark: '#333333',
	light: '#F3F3F3',
	hc: '#000000'
}, localize('debugToolBarBackground', "Debug toolbar background color."));
export const debugToolBarBorder = registerColor('debugToolBar.border', {
	dark: null,
	light: null,
	hc: null
}, localize('debugToolBarBorder', "Debug toolbar border color."));

export class DebugToolBar extends Themable implements IWorkbenchContribution {

	private $el: HTMLElement;
	private dragArea: HTMLElement;
	private actionBar: ActionBar;
	private activeActions: IAction[];
	private updateScheduler: RunOnceScheduler;
	private debugToolBarMenu: IMenu;
	private disposeOnUpdate: IDisposable | undefined;

	private isVisible = false;
	private isBuilt = false;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IDebugService private readonly debugService: IDebugService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IThemeService themeService: IThemeService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(themeService);

		this.$el = dom.$('div.debug-toolbar');
		this.$el.style.top = `${layoutService.getTitleBarOffset()}px`;

		this.dragArea = dom.append(this.$el, dom.$('div.drag-area'));

		const actionBarContainer = dom.append(this.$el, dom.$('div.action-bar-container'));
		this.debugToolBarMenu = menuService.createMenu(MenuId.DebugToolBar, contextKeyService);
		this._register(this.debugToolBarMenu);

		this.activeActions = [];
		this.actionBar = this._register(new ActionBar(actionBarContainer, {
			orientation: ActionsOrientation.HORIZONTAL,
			actionViewItemProvider: (action: IAction) => {
				if (action.id === FocusSessionAction.ID) {
					return this.instantiationService.createInstance(FocusSessionActionViewItem, action);
				}
				if (action instanceof MenuItemAction) {
					return new MenuEntryActionViewItem(action, this.keybindingService, this.notificationService, contextMenuService);
				}

				return undefined;
			}
		}));

		this.updateScheduler = this._register(new RunOnceScheduler(() => {
			const state = this.debugService.state;
			const toolBarLocation = this.configurationService.getValue<IDebugConfiguration>('debug').toolBarLocation;
			if (state === State.Inactive || toolBarLocation === 'docked' || toolBarLocation === 'hidden') {
				return this.hide();
			}

			const { actions, disposable } = DebugToolBar.getActions(this.debugToolBarMenu, this.debugService, this.instantiationService);
			if (!arrays.equals(actions, this.activeActions, (first, second) => first.id === second.id)) {
				this.actionBar.clear();
				this.actionBar.push(actions, { icon: true, label: false });
				this.activeActions = actions;
			}
			if (this.disposeOnUpdate) {
				dispose(this.disposeOnUpdate);
			}
			this.disposeOnUpdate = disposable;

			this.show();
		}, 20));

		this.updateStyles();

		this.registerListeners();

		this.hide();
	}

	private registerListeners(): void {
		this._register(this.debugService.onDidChangeState(() => this.updateScheduler.schedule()));
		this._register(this.debugService.getViewModel().onDidFocusSession(() => this.updateScheduler.schedule()));
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onDidConfigurationChange(e)));
		this._register(this.actionBar.actionRunner.onDidRun((e: IRunEvent) => {
			// check for error
			if (e.error && !errors.isPromiseCanceledError(e.error)) {
				this.notificationService.error(e.error);
			}

			// log in telemetry
			if (this.telemetryService) {
				this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: e.action.id, from: 'debugActionsWidget' });
			}
		}));
		this._register(dom.addDisposableListener(window, dom.EventType.RESIZE, () => this.setCoordinates()));

		this._register(dom.addDisposableListener(this.dragArea, dom.EventType.MOUSE_UP, (event: MouseEvent) => {
			const mouseClickEvent = new StandardMouseEvent(event);
			if (mouseClickEvent.detail === 2) {
				// double click on debug bar centers it again #8250
				const widgetWidth = this.$el.clientWidth;
				this.setCoordinates(0.5 * window.innerWidth - 0.5 * widgetWidth, 0);
				this.storePosition();
			}
		}));

		this._register(dom.addDisposableListener(this.dragArea, dom.EventType.MOUSE_DOWN, (event: MouseEvent) => {
			dom.addClass(this.dragArea, 'dragged');

			const mouseMoveListener = dom.addDisposableListener(window, 'mousemove', (e: MouseEvent) => {
				const mouseMoveEvent = new StandardMouseEvent(e);
				// Prevent default to stop editor selecting text #8524
				mouseMoveEvent.preventDefault();
				// Reduce x by width of drag handle to reduce jarring #16604
				this.setCoordinates(mouseMoveEvent.posx - 14, mouseMoveEvent.posy - this.layoutService.getTitleBarOffset());
			});

			const mouseUpListener = dom.addDisposableListener(window, 'mouseup', (e: MouseEvent) => {
				this.storePosition();
				dom.removeClass(this.dragArea, 'dragged');

				mouseMoveListener.dispose();
				mouseUpListener.dispose();
			});
		}));

		this._register(this.layoutService.onTitleBarVisibilityChange(() => this.setYCoordinate()));
		this._register(browser.onDidChangeZoomLevel(() => this.setYCoordinate()));
	}

	private storePosition(): void {
		const left = dom.getComputedStyle(this.$el).left;
		if (left) {
			const position = parseFloat(left) / window.innerWidth;
			this.storageService.store(DEBUG_TOOLBAR_POSITION_KEY, position, StorageScope.GLOBAL);
		}
	}

	protected updateStyles(): void {
		super.updateStyles();

		if (this.$el) {
			this.$el.style.backgroundColor = this.getColor(debugToolBarBackground);

			const widgetShadowColor = this.getColor(widgetShadow);
			this.$el.style.boxShadow = widgetShadowColor ? `0 5px 8px ${widgetShadowColor}` : null;

			const contrastBorderColor = this.getColor(contrastBorder);
			const borderColor = this.getColor(debugToolBarBorder);

			if (contrastBorderColor) {
				this.$el.style.border = `1px solid ${contrastBorderColor}`;
			} else {
				this.$el.style.border = borderColor ? `solid ${borderColor}` : 'none';
				this.$el.style.border = '1px 0';
			}
		}
	}

	private setYCoordinate(y = 0): void {
		const titlebarOffset = this.layoutService.getTitleBarOffset();
		this.$el.style.top = `${titlebarOffset + y}px`;
	}

	private setCoordinates(x?: number, y?: number): void {
		if (!this.isVisible) {
			return;
		}
		const widgetWidth = this.$el.clientWidth;
		if (x === undefined) {
			const positionPercentage = this.storageService.get(DEBUG_TOOLBAR_POSITION_KEY, StorageScope.GLOBAL);
			x = positionPercentage !== undefined ? parseFloat(positionPercentage) * window.innerWidth : (0.5 * window.innerWidth - 0.5 * widgetWidth);
		}

		x = Math.max(0, Math.min(x, window.innerWidth - widgetWidth)); // do not allow the widget to overflow on the right
		this.$el.style.left = `${x}px`;

		if (y === undefined) {
			y = this.storageService.getNumber(DEBUG_TOOLBAR_Y_KEY, StorageScope.GLOBAL, 0);
		}
		const titleAreaHeight = 35;
		if ((y < titleAreaHeight / 2) || (y > titleAreaHeight + titleAreaHeight / 2)) {
			const moveToTop = y < titleAreaHeight;
			this.setYCoordinate(moveToTop ? 0 : titleAreaHeight);
			this.storageService.store(DEBUG_TOOLBAR_Y_KEY, moveToTop ? 0 : 2 * titleAreaHeight, StorageScope.GLOBAL);
		}
	}

	private onDidConfigurationChange(event: IConfigurationChangeEvent): void {
		if (event.affectsConfiguration('debug.hideActionBar') || event.affectsConfiguration('debug.toolBarLocation')) {
			this.updateScheduler.schedule();
		}
	}

	private show(): void {
		if (this.isVisible) {
			this.setCoordinates();
			return;
		}
		if (!this.isBuilt) {
			this.isBuilt = true;
			this.layoutService.getWorkbenchElement().appendChild(this.$el);
		}

		this.isVisible = true;
		dom.show(this.$el);
		this.setCoordinates();
	}

	private hide(): void {
		this.isVisible = false;
		dom.hide(this.$el);
	}

	public static getActions(menu: IMenu, debugService: IDebugService, instantiationService: IInstantiationService): { actions: IAction[], disposable: IDisposable } {
		const actions: IAction[] = [];
		const disposable = createAndFillInActionBarActions(menu, undefined, actions, () => false);
		if (debugService.getViewModel().isMultiSessionView()) {
			actions.push(instantiationService.createInstance(FocusSessionAction, FocusSessionAction.ID, FocusSessionAction.LABEL));
		}

		return {
			actions: actions.filter(a => !(a instanceof Separator)), // do not render separators for now
			disposable
		};
	}

	public dispose(): void {
		super.dispose();

		if (this.$el) {
			this.$el.remove();
			delete this.$el;
		}
		if (this.disposeOnUpdate) {
			dispose(this.disposeOnUpdate);
		}
	}
}
