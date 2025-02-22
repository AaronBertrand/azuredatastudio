/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/workbench/browser/style';

import { localize } from 'vs/nls';
import { Event, Emitter, setGlobalLeakWarningThreshold } from 'vs/base/common/event';
import { addClasses, addClass, removeClasses } from 'vs/base/browser/dom';
import { runWhenIdle } from 'vs/base/common/async';
import { getZoomLevel } from 'vs/base/browser/browser';
import { mark } from 'vs/base/common/performance';
import { onUnexpectedError, setUnexpectedErrorHandler } from 'vs/base/common/errors';
import { Registry } from 'vs/platform/registry/common/platform';
import { isWindows, isLinux, isWeb, isNative } from 'vs/base/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IEditorInputFactoryRegistry, Extensions as EditorExtensions } from 'vs/workbench/common/editor';
import { IActionBarRegistry, Extensions as ActionBarExtensions } from 'vs/workbench/browser/actions';
import { getSingletonServiceDescriptors } from 'vs/platform/instantiation/common/extensions';
import { Position, Parts, IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IStorageService, WillSaveStateReason, StorageScope, IWillSaveStateEvent } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { LifecyclePhase, ILifecycleService, WillShutdownEvent, BeforeShutdownEvent } from 'vs/platform/lifecycle/common/lifecycle';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { NotificationService } from 'vs/workbench/services/notification/common/notificationService';
import { NotificationsCenter } from 'vs/workbench/browser/parts/notifications/notificationsCenter';
import { NotificationsAlerts } from 'vs/workbench/browser/parts/notifications/notificationsAlerts';
import { NotificationsStatus } from 'vs/workbench/browser/parts/notifications/notificationsStatus';
import { registerNotificationCommands } from 'vs/workbench/browser/parts/notifications/notificationsCommands';
import { NotificationsToasts } from 'vs/workbench/browser/parts/notifications/notificationsToasts';
import { IEditorService, IResourceEditor } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { setARIAContainer } from 'vs/base/browser/ui/aria/aria';
import { readFontInfo, restoreFontInfo, serializeFontInfo } from 'vs/editor/browser/config/configuration';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { ILogService } from 'vs/platform/log/common/log';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { WorkbenchContextKeysHandler } from 'vs/workbench/browser/contextkeys';
import { coalesce } from 'vs/base/common/arrays';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { Layout } from 'vs/workbench/browser/layout';

export class Workbench extends Layout {

	private readonly _onBeforeShutdown = this._register(new Emitter<BeforeShutdownEvent>());
	readonly onBeforeShutdown: Event<BeforeShutdownEvent> = this._onBeforeShutdown.event;

	private readonly _onShutdown = this._register(new Emitter<void>());
	readonly onShutdown: Event<void> = this._onShutdown.event;

	private readonly _onWillShutdown = this._register(new Emitter<WillShutdownEvent>());
	readonly onWillShutdown: Event<WillShutdownEvent> = this._onWillShutdown.event;

	constructor(
		parent: HTMLElement,
		private readonly serviceCollection: ServiceCollection,
		logService: ILogService
	) {
		super(parent);

		this.registerErrorHandler(logService);
	}

	private registerErrorHandler(logService: ILogService): void {

		// Listen on unhandled rejection events
		window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {

			// See https://developer.mozilla.org/en-US/docs/Web/API/PromiseRejectionEvent
			onUnexpectedError(event.reason);

			// Prevent the printing of this event to the console
			event.preventDefault();
		});

		// Install handler for unexpected errors
		setUnexpectedErrorHandler(error => this.handleUnexpectedError(error, logService));

		// Inform user about loading issues from the loader
		interface AnnotatedLoadingError extends Error {
			phase: 'loading';
			moduleId: string;
			neededBy: string[];
		}
		interface AnnotatedFactoryError extends Error {
			phase: 'factory';
			moduleId: string;
		}
		interface AnnotatedValidationError extends Error {
			phase: 'configuration';
		}
		type AnnotatedError = AnnotatedLoadingError | AnnotatedFactoryError | AnnotatedValidationError;
		(<any>window).require.config({
			onError: (err: AnnotatedError) => {
				if (err.phase === 'loading') {
					onUnexpectedError(new Error(localize('loaderErrorNative', "Failed to load a required file. Please restart the application to try again. Details: {0}", JSON.stringify(err))));
				}
				console.error(err);
			}
		});
	}

	private previousUnexpectedError: { message: string | undefined, time: number } = { message: undefined, time: 0 };
	private handleUnexpectedError(error: unknown, logService: ILogService): void {
		const message = toErrorMessage(error, true);
		if (!message) {
			return;
		}

		const now = Date.now();
		if (message === this.previousUnexpectedError.message && now - this.previousUnexpectedError.time <= 1000) {
			return; // Return if error message identical to previous and shorter than 1 second
		}

		this.previousUnexpectedError.time = now;
		this.previousUnexpectedError.message = message;

		// Log it
		logService.error(message);
	}

	startup(): IInstantiationService {
		try {

			// Configure emitter leak warning threshold
			setGlobalLeakWarningThreshold(175);

			// ARIA
			setARIAContainer(document.body);

			// Services
			const instantiationService = this.initServices(this.serviceCollection);

			instantiationService.invokeFunction(async accessor => {
				const lifecycleService = accessor.get(ILifecycleService);
				const storageService = accessor.get(IStorageService);
				const configurationService = accessor.get(IConfigurationService);

				// Layout
				this.initLayout(accessor);

				// Registries
				this.startRegistries(accessor);

				// Context Keys
				this._register(instantiationService.createInstance(WorkbenchContextKeysHandler));

				// Register Listeners
				this.registerListeners(lifecycleService, storageService, configurationService);

				// Render Workbench
				this.renderWorkbench(instantiationService, accessor.get(INotificationService) as NotificationService, storageService, configurationService);

				// Workbench Layout
				this.createWorkbenchLayout(instantiationService);

				// Layout
				this.layout();

				// Restore
				try {
					await this.restoreWorkbench(accessor.get(IEditorService), accessor.get(IEditorGroupsService), accessor.get(IViewletService), accessor.get(IPanelService), accessor.get(ILogService), lifecycleService);
				} catch (error) {
					onUnexpectedError(error);
				}
			});

			return instantiationService;
		} catch (error) {
			onUnexpectedError(error);

			throw error; // rethrow because this is a critical issue we cannot handle properly here
		}
	}

	private initServices(serviceCollection: ServiceCollection): IInstantiationService {

		// Layout Service
		serviceCollection.set(IWorkbenchLayoutService, this);

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// NOTE: DO NOT ADD ANY OTHER SERVICE INTO THE COLLECTION HERE.
		// CONTRIBUTE IT VIA WORKBENCH.DESKTOP.MAIN.TS AND registerSingleton().
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		// All Contributed Services
		const contributedServices = getSingletonServiceDescriptors();
		for (let [id, descriptor] of contributedServices) {
			serviceCollection.set(id, descriptor);
		}

		const instantiationService = new InstantiationService(serviceCollection, true);

		// Wrap up
		instantiationService.invokeFunction(accessor => {
			const lifecycleService = accessor.get(ILifecycleService);

			// TODO@Sandeep debt around cyclic dependencies
			const configurationService = accessor.get(IConfigurationService) as any;
			if (typeof configurationService.acquireInstantiationService === 'function') {
				setTimeout(() => {
					configurationService.acquireInstantiationService(instantiationService);
				}, 0);
			}

			// Signal to lifecycle that services are set
			lifecycleService.phase = LifecyclePhase.Ready;
		});

		return instantiationService;
	}

	private startRegistries(accessor: ServicesAccessor): void {
		Registry.as<IActionBarRegistry>(ActionBarExtensions.Actionbar).start(accessor);
		Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).start(accessor);
		Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).start(accessor);
	}

	private registerListeners(
		lifecycleService: ILifecycleService,
		storageService: IStorageService,
		configurationService: IConfigurationService
	): void {

		// Lifecycle
		this._register(lifecycleService.onBeforeShutdown(event => this._onBeforeShutdown.fire(event)));
		this._register(lifecycleService.onWillShutdown(event => this._onWillShutdown.fire(event)));
		this._register(lifecycleService.onShutdown(() => {
			this._onShutdown.fire();
			this.dispose();
		}));

		// Configuration changes
		this._register(configurationService.onDidChangeConfiguration(() => this.setFontAliasing(configurationService)));

		// Storage
		this._register(storageService.onWillSaveState(e => this.storeFontInfo(e, storageService)));
	}

	private fontAliasing: 'default' | 'antialiased' | 'none' | 'auto' | undefined;
	private setFontAliasing(configurationService: IConfigurationService) {
		const aliasing = configurationService.getValue<'default' | 'antialiased' | 'none' | 'auto'>('workbench.fontAliasing');
		if (this.fontAliasing === aliasing) {
			return;
		}

		this.fontAliasing = aliasing;

		// Remove all
		const fontAliasingValues: (typeof aliasing)[] = ['antialiased', 'none', 'auto'];
		removeClasses(this.container, ...fontAliasingValues.map(value => `monaco-font-aliasing-${value}`));

		// Add specific
		if (fontAliasingValues.some(option => option === aliasing)) {
			addClass(this.container, `monaco-font-aliasing-${aliasing}`);
		}
	}

	private restoreFontInfo(storageService: IStorageService, configurationService: IConfigurationService): void {

		// Restore (native: use storage service, web: use browser specific local storage)
		const storedFontInfoRaw = isNative ? storageService.get('editorFontInfo', StorageScope.GLOBAL) : window.localStorage.getItem('editorFontInfo');
		if (storedFontInfoRaw) {
			try {
				const storedFontInfo = JSON.parse(storedFontInfoRaw);
				if (Array.isArray(storedFontInfo)) {
					restoreFontInfo(storedFontInfo);
				}
			} catch (err) {
				/* ignore */
			}
		}

		readFontInfo(BareFontInfo.createFromRawSettings(configurationService.getValue('editor'), getZoomLevel()));
	}

	private storeFontInfo(e: IWillSaveStateEvent, storageService: IStorageService): void {
		if (e.reason === WillSaveStateReason.SHUTDOWN) {
			const serializedFontInfo = serializeFontInfo();
			if (serializedFontInfo) {
				const serializedFontInfoRaw = JSON.stringify(serializedFontInfo);

				isNative ? storageService.store('editorFontInfo', serializedFontInfoRaw, StorageScope.GLOBAL) : window.localStorage.setItem('editorFontInfo', serializedFontInfoRaw);
			}
		}
	}

	private renderWorkbench(instantiationService: IInstantiationService, notificationService: NotificationService, storageService: IStorageService, configurationService: IConfigurationService): void {

		// State specific classes
		const platformClass = isWindows ? 'windows' : isLinux ? 'linux' : 'mac';
		const workbenchClasses = coalesce([
			'monaco-workbench',
			platformClass,
			isWeb ? 'web' : undefined,
			...this.getLayoutClasses()
		]);

		addClasses(this.container, ...workbenchClasses);
		addClass(document.body, platformClass); // used by our fonts

		if (isWeb) {
			addClass(document.body, 'web');
		}

		// Apply font aliasing
		this.setFontAliasing(configurationService);

		// Warm up font cache information before building up too many dom elements
		this.restoreFontInfo(storageService, configurationService);

		// Create Parts
		[
			{ id: Parts.TITLEBAR_PART, role: 'contentinfo', classes: ['titlebar'] },
			{ id: Parts.ACTIVITYBAR_PART, role: 'navigation', classes: ['activitybar', this.state.sideBar.position === Position.LEFT ? 'left' : 'right'] },
			{ id: Parts.SIDEBAR_PART, role: 'complementary', classes: ['sidebar', this.state.sideBar.position === Position.LEFT ? 'left' : 'right'] },
			{ id: Parts.EDITOR_PART, role: 'main', classes: ['editor'], options: { restorePreviousState: this.state.editor.restoreEditors } },
			{ id: Parts.PANEL_PART, role: 'complementary', classes: ['panel', this.state.panel.position === Position.BOTTOM ? 'bottom' : 'right'] },
			{ id: Parts.STATUSBAR_PART, role: 'contentinfo', classes: ['statusbar'] }
		].forEach(({ id, role, classes, options }) => {
			const partContainer = this.createPart(id, role, classes);

			if (!configurationService.getValue('workbench.useExperimentalGridLayout')) {
				// TODO@Ben cleanup once moved to grid
				// Insert all workbench parts at the beginning. Issue #52531
				// This is primarily for the title bar to allow overriding -webkit-app-region
				this.container.insertBefore(partContainer, this.container.lastChild);
			}

			this.getPart(id).create(partContainer, options);
		});

		// Notification Handlers
		this.createNotificationsHandlers(instantiationService, notificationService);

		// Add Workbench to DOM
		this.parent.appendChild(this.container);
	}

	private createPart(id: string, role: string, classes: string[]): HTMLElement {
		const part = document.createElement('div');
		addClasses(part, 'part', ...classes);
		part.id = id;
		part.setAttribute('role', role);

		return part;
	}

	private createNotificationsHandlers(instantiationService: IInstantiationService, notificationService: NotificationService): void {

		// Instantiate Notification components
		const notificationsCenter = this._register(instantiationService.createInstance(NotificationsCenter, this.container, notificationService.model));
		const notificationsToasts = this._register(instantiationService.createInstance(NotificationsToasts, this.container, notificationService.model));
		this._register(instantiationService.createInstance(NotificationsAlerts, notificationService.model));
		const notificationsStatus = instantiationService.createInstance(NotificationsStatus, notificationService.model);

		// Visibility
		this._register(notificationsCenter.onDidChangeVisibility(() => {
			notificationsStatus.update(notificationsCenter.isVisible);
			notificationsToasts.update(notificationsCenter.isVisible);
		}));

		// Register Commands
		registerNotificationCommands(notificationsCenter, notificationsToasts);
	}

	private async restoreWorkbench(
		editorService: IEditorService,
		editorGroupService: IEditorGroupsService,
		viewletService: IViewletService,
		panelService: IPanelService,
		logService: ILogService,
		lifecycleService: ILifecycleService
	): Promise<void> {
		const restorePromises: Promise<void>[] = [];

		// Restore editors
		restorePromises.push((async () => {
			mark('willRestoreEditors');

			// first ensure the editor part is restored
			await editorGroupService.whenRestored;

			// then see for editors to open as instructed
			let editors: IResourceEditor[];
			if (Array.isArray(this.state.editor.editorsToOpen)) {
				editors = this.state.editor.editorsToOpen;
			} else {
				editors = await this.state.editor.editorsToOpen;
			}

			if (editors.length) {
				await editorService.openEditors(editors);
			}

			mark('didRestoreEditors');
		})());

		// Restore Sidebar
		if (this.state.sideBar.viewletToRestore) {
			restorePromises.push((async () => {
				mark('willRestoreViewlet');

				const viewlet = await viewletService.openViewlet(this.state.sideBar.viewletToRestore);
				if (!viewlet) {
					await viewletService.openViewlet(viewletService.getDefaultViewletId()); // fallback to default viewlet as needed
				}

				mark('didRestoreViewlet');
			})());
		}

		// Restore Panel
		if (this.state.panel.panelToRestore) {
			mark('willRestorePanel');
			panelService.openPanel(this.state.panel.panelToRestore);
			mark('didRestorePanel');
		}

		// Restore Zen Mode
		if (this.state.zenMode.restore) {
			this.toggleZenMode(false, true);
		}

		// Restore Editor Center Mode
		if (this.state.editor.restoreCentered) {
			this.centerEditorLayout(true);
		}

		// Emit a warning after 10s if restore does not complete
		const restoreTimeoutHandle = setTimeout(() => logService.warn('Workbench did not finish loading in 10 seconds, that might be a problem that should be reported.'), 10000);

		try {
			await Promise.all(restorePromises);

			clearTimeout(restoreTimeoutHandle);
		} catch (error) {
			onUnexpectedError(error);
		} finally {

			// Set lifecycle phase to `Restored`
			lifecycleService.phase = LifecyclePhase.Restored;

			// Set lifecycle phase to `Eventually` after a short delay and when idle (min 2.5sec, max 5sec)
			setTimeout(() => {
				this._register(runWhenIdle(() => lifecycleService.phase = LifecyclePhase.Eventually, 2500));
			}, 2500);

			// Telemetry: startup metrics
			mark('didStartWorkbench');
		}
	}
}
