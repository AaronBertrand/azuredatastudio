/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import * as dom from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Emitter, Event } from 'vs/base/common/event';
import { Keybinding, ResolvedKeybinding, SimpleKeybinding, createKeybinding } from 'vs/base/common/keyCodes';
import { IDisposable, IReference, ImmortalReference, toDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { OS, isLinux, isMacintosh } from 'vs/base/common/platform';
import Severity from 'vs/base/common/severity';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor, IDiffEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IBulkEditOptions, IBulkEditResult, IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { isDiffEditorConfigurationKey, isEditorConfigurationKey } from 'vs/editor/common/config/commonEditorConfig';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { IPosition, Position as Pos } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ITextModel, ITextSnapshot } from 'vs/editor/common/model';
import { TextEdit, WorkspaceEdit, isResourceTextEdit } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IResolvedTextEditorModel, ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import { ITextResourceConfigurationService, ITextResourcePropertiesService } from 'vs/editor/common/services/resourceConfiguration';
import { CommandsRegistry, ICommand, ICommandEvent, ICommandHandler, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationChangeEvent, IConfigurationData, IConfigurationOverrides, IConfigurationService, IConfigurationModel } from 'vs/platform/configuration/common/configuration';
import { Configuration, ConfigurationModel, DefaultConfigurationModel } from 'vs/platform/configuration/common/configurationModels';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IConfirmation, IConfirmationResult, IDialogOptions, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { AbstractKeybindingService } from 'vs/platform/keybinding/common/abstractKeybindingService';
import { IKeybindingEvent, IKeyboardEvent, KeybindingSource } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingResolver } from 'vs/platform/keybinding/common/keybindingResolver';
import { IKeybindingItem, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { USLayoutResolvedKeybinding } from 'vs/platform/keybinding/common/usLayoutResolvedKeybinding';
import { ILabelService, ResourceLabelFormatter } from 'vs/platform/label/common/label';
import { INotification, INotificationHandle, INotificationService, IPromptChoice, IPromptOptions, NoOpNotification, IStatusMessageOptions } from 'vs/platform/notification/common/notification';
import { IProgressRunner, IEditorProgressService } from 'vs/platform/progress/common/progress';
import { ITelemetryInfo, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFolder, IWorkspaceFoldersChangeEvent, WorkbenchState, WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ILayoutService, IDimension } from 'vs/platform/layout/browser/layoutService';
import { SimpleServicesNLS } from 'vs/editor/common/standaloneStrings';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';

export class SimpleModel implements IResolvedTextEditorModel {

	private readonly model: ITextModel;
	private readonly _onDispose: Emitter<void>;

	constructor(model: ITextModel) {
		this.model = model;
		this._onDispose = new Emitter<void>();
	}

	public get onDispose(): Event<void> {
		return this._onDispose.event;
	}

	public load(): Promise<SimpleModel> {
		return Promise.resolve(this);
	}

	public get textEditorModel(): ITextModel {
		return this.model;
	}

	public createSnapshot(): ITextSnapshot {
		return this.model.createSnapshot();
	}

	public isReadonly(): boolean {
		return false;
	}

	public dispose(): void {
		this._onDispose.fire();
	}
}

export interface IOpenEditorDelegate {
	(url: string): boolean;
}

function withTypedEditor<T>(widget: editorCommon.IEditor, codeEditorCallback: (editor: ICodeEditor) => T, diffEditorCallback: (editor: IDiffEditor) => T): T {
	if (isCodeEditor(widget)) {
		// Single Editor
		return codeEditorCallback(<ICodeEditor>widget);
	} else {
		// Diff Editor
		return diffEditorCallback(<IDiffEditor>widget);
	}
}

export class SimpleEditorModelResolverService implements ITextModelService {
	public _serviceBrand: any;

	private editor?: editorCommon.IEditor;

	public setEditor(editor: editorCommon.IEditor): void {
		this.editor = editor;
	}

	public createModelReference(resource: URI): Promise<IReference<IResolvedTextEditorModel>> {
		let model: ITextModel | null = null;
		if (this.editor) {
			model = withTypedEditor(this.editor,
				(editor) => this.findModel(editor, resource),
				(diffEditor) => this.findModel(diffEditor.getOriginalEditor(), resource) || this.findModel(diffEditor.getModifiedEditor(), resource)
			);
		}

		if (!model) {
			return Promise.reject(new Error(`Model not found`));
		}

		return Promise.resolve(new ImmortalReference(new SimpleModel(model)));
	}

	public registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable {
		return {
			dispose: function () { /* no op */ }
		};
	}

	public hasTextModelContentProvider(scheme: string): boolean {
		return false;
	}

	private findModel(editor: ICodeEditor, resource: URI): ITextModel | null {
		let model = editor.getModel();
		if (model && model.uri.toString() !== resource.toString()) {
			return null;
		}

		return model;
	}
}

export class SimpleEditorProgressService implements IEditorProgressService {
	_serviceBrand: any;

	private static NULL_PROGRESS_RUNNER: IProgressRunner = {
		done: () => { },
		total: () => { },
		worked: () => { }
	};

	show(infinite: true, delay?: number): IProgressRunner;
	show(total: number, delay?: number): IProgressRunner;
	show(): IProgressRunner {
		return SimpleEditorProgressService.NULL_PROGRESS_RUNNER;
	}

	showWhile(promise: Promise<any>, delay?: number): Promise<void> {
		return Promise.resolve(undefined);
	}
}

export class SimpleDialogService implements IDialogService {

	public _serviceBrand: any;

	public confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		return this.doConfirm(confirmation).then(confirmed => {
			return {
				confirmed,
				checkboxChecked: false // unsupported
			} as IConfirmationResult;
		});
	}

	private doConfirm(confirmation: IConfirmation): Promise<boolean> {
		let messageText = confirmation.message;
		if (confirmation.detail) {
			messageText = messageText + '\n\n' + confirmation.detail;
		}

		return Promise.resolve(window.confirm(messageText));
	}

	public show(severity: Severity, message: string, buttons: string[], options?: IDialogOptions): Promise<number> {
		return Promise.resolve(0);
	}
}

export class SimpleNotificationService implements INotificationService {

	public _serviceBrand: any;

	private static readonly NO_OP: INotificationHandle = new NoOpNotification();

	public info(message: string): INotificationHandle {
		return this.notify({ severity: Severity.Info, message });
	}

	public warn(message: string): INotificationHandle {
		return this.notify({ severity: Severity.Warning, message });
	}

	public error(error: string | Error): INotificationHandle {
		return this.notify({ severity: Severity.Error, message: error });
	}

	public notify(notification: INotification): INotificationHandle {
		switch (notification.severity) {
			case Severity.Error:
				console.error(notification.message);
				break;
			case Severity.Warning:
				console.warn(notification.message);
				break;
			default:
				console.log(notification.message);
				break;
		}

		return SimpleNotificationService.NO_OP;
	}

	public prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		return SimpleNotificationService.NO_OP;
	}

	public status(message: string | Error, options?: IStatusMessageOptions): IDisposable {
		return Disposable.None;
	}
}

export class StandaloneCommandService implements ICommandService {
	_serviceBrand: any;

	private readonly _instantiationService: IInstantiationService;
	private readonly _dynamicCommands: { [id: string]: ICommand; };

	private readonly _onWillExecuteCommand = new Emitter<ICommandEvent>();
	private readonly _onDidExecuteCommand = new Emitter<ICommandEvent>();
	public readonly onWillExecuteCommand: Event<ICommandEvent> = this._onWillExecuteCommand.event;
	public readonly onDidExecuteCommand: Event<ICommandEvent> = this._onDidExecuteCommand.event;

	constructor(instantiationService: IInstantiationService) {
		this._instantiationService = instantiationService;
		this._dynamicCommands = Object.create(null);
	}

	public addCommand(command: ICommand): IDisposable {
		const { id } = command;
		this._dynamicCommands[id] = command;
		return toDisposable(() => {
			delete this._dynamicCommands[id];
		});
	}

	public executeCommand<T>(id: string, ...args: any[]): Promise<T> {
		const command = (CommandsRegistry.getCommand(id) || this._dynamicCommands[id]);
		if (!command) {
			return Promise.reject(new Error(`command '${id}' not found`));
		}

		try {
			this._onWillExecuteCommand.fire({ commandId: id, args });
			const result = this._instantiationService.invokeFunction.apply(this._instantiationService, [command.handler, ...args]) as T;

			this._onDidExecuteCommand.fire({ commandId: id, args });
			return Promise.resolve(result);
		} catch (err) {
			return Promise.reject(err);
		}
	}
}

export class StandaloneKeybindingService extends AbstractKeybindingService {
	private _cachedResolver: KeybindingResolver | null;
	private readonly _dynamicKeybindings: IKeybindingItem[];

	constructor(
		contextKeyService: IContextKeyService,
		commandService: ICommandService,
		telemetryService: ITelemetryService,
		notificationService: INotificationService,
		domNode: HTMLElement
	) {
		super(contextKeyService, commandService, telemetryService, notificationService);

		this._cachedResolver = null;
		this._dynamicKeybindings = [];

		this._register(dom.addDisposableListener(domNode, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			let keyEvent = new StandardKeyboardEvent(e);
			let shouldPreventDefault = this._dispatch(keyEvent, keyEvent.target);
			if (shouldPreventDefault) {
				keyEvent.preventDefault();
			}
		}));
	}

	public addDynamicKeybinding(commandId: string, _keybinding: number, handler: ICommandHandler, when: ContextKeyExpr | undefined): IDisposable {
		const keybinding = createKeybinding(_keybinding, OS);
		if (!keybinding) {
			throw new Error(`Invalid keybinding`);
		}

		const toDispose = new DisposableStore();

		this._dynamicKeybindings.push({
			keybinding: keybinding,
			command: commandId,
			when: when,
			weight1: 1000,
			weight2: 0
		});

		toDispose.add(toDisposable(() => {
			for (let i = 0; i < this._dynamicKeybindings.length; i++) {
				let kb = this._dynamicKeybindings[i];
				if (kb.command === commandId) {
					this._dynamicKeybindings.splice(i, 1);
					this.updateResolver({ source: KeybindingSource.Default });
					return;
				}
			}
		}));

		let commandService = this._commandService;
		if (commandService instanceof StandaloneCommandService) {
			toDispose.add(commandService.addCommand({
				id: commandId,
				handler: handler
			}));
		} else {
			throw new Error('Unknown command service!');
		}
		this.updateResolver({ source: KeybindingSource.Default });

		return toDispose;
	}

	private updateResolver(event: IKeybindingEvent): void {
		this._cachedResolver = null;
		this._onDidUpdateKeybindings.fire(event);
	}

	protected _getResolver(): KeybindingResolver {
		if (!this._cachedResolver) {
			const defaults = this._toNormalizedKeybindingItems(KeybindingsRegistry.getDefaultKeybindings(), true);
			const overrides = this._toNormalizedKeybindingItems(this._dynamicKeybindings, false);
			this._cachedResolver = new KeybindingResolver(defaults, overrides);
		}
		return this._cachedResolver;
	}

	protected _documentHasFocus(): boolean {
		return document.hasFocus();
	}

	private _toNormalizedKeybindingItems(items: IKeybindingItem[], isDefault: boolean): ResolvedKeybindingItem[] {
		let result: ResolvedKeybindingItem[] = [], resultLen = 0;
		for (const item of items) {
			const when = item.when || undefined;
			const keybinding = item.keybinding;

			if (!keybinding) {
				// This might be a removal keybinding item in user settings => accept it
				result[resultLen++] = new ResolvedKeybindingItem(undefined, item.command, item.commandArgs, when, isDefault);
			} else {
				const resolvedKeybindings = this.resolveKeybinding(keybinding);
				for (const resolvedKeybinding of resolvedKeybindings) {
					result[resultLen++] = new ResolvedKeybindingItem(resolvedKeybinding, item.command, item.commandArgs, when, isDefault);
				}
			}
		}

		return result;
	}

	public resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[] {
		return [new USLayoutResolvedKeybinding(keybinding, OS)];
	}

	public resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding {
		let keybinding = new SimpleKeybinding(
			keyboardEvent.ctrlKey,
			keyboardEvent.shiftKey,
			keyboardEvent.altKey,
			keyboardEvent.metaKey,
			keyboardEvent.keyCode
		).toChord();
		return new USLayoutResolvedKeybinding(keybinding, OS);
	}

	public resolveUserBinding(userBinding: string): ResolvedKeybinding[] {
		return [];
	}

	public _dumpDebugInfo(): string {
		return '';
	}

	public _dumpDebugInfoJSON(): string {
		return '';
	}
}

function isConfigurationOverrides(thing: any): thing is IConfigurationOverrides {
	return thing
		&& typeof thing === 'object'
		&& (!thing.overrideIdentifier || typeof thing.overrideIdentifier === 'string')
		&& (!thing.resource || thing.resource instanceof URI);
}

export class SimpleConfigurationService implements IConfigurationService {

	_serviceBrand: any;

	private _onDidChangeConfiguration = new Emitter<IConfigurationChangeEvent>();
	public readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent> = this._onDidChangeConfiguration.event;

	private readonly _configuration: Configuration;

	constructor() {
		this._configuration = new Configuration(new DefaultConfigurationModel(), new ConfigurationModel());
	}

	private configuration(): Configuration {
		return this._configuration;
	}

	getValue<T>(): T;
	getValue<T>(section: string): T;
	getValue<T>(overrides: IConfigurationOverrides): T;
	getValue<T>(section: string, overrides: IConfigurationOverrides): T;
	getValue(arg1?: any, arg2?: any): any {
		const section = typeof arg1 === 'string' ? arg1 : undefined;
		const overrides = isConfigurationOverrides(arg1) ? arg1 : isConfigurationOverrides(arg2) ? arg2 : {};
		return this.configuration().getValue(section, overrides, undefined);
	}

	public updateValue(key: string, value: any, arg3?: any, arg4?: any): Promise<void> {
		this.configuration().updateValue(key, value);
		return Promise.resolve();
	}

	public inspect<C>(key: string, options: IConfigurationOverrides = {}): {
		default: C,
		user: C,
		workspace?: C,
		workspaceFolder?: C
		value: C,
	} {
		return this.configuration().inspect<C>(key, options, undefined);
	}

	public keys() {
		return this.configuration().keys(undefined);
	}

	public reloadConfiguration(): Promise<void> {
		return Promise.resolve(undefined);
	}

	public getConfigurationData(): IConfigurationData | null {
		const emptyModel: IConfigurationModel = {
			contents: {},
			keys: [],
			overrides: []
		};
		return {
			defaults: emptyModel,
			user: emptyModel,
			workspace: emptyModel,
			folders: []
		};
	}
}

export class SimpleResourceConfigurationService implements ITextResourceConfigurationService {

	_serviceBrand: any;

	private readonly _onDidChangeConfiguration = new Emitter<IConfigurationChangeEvent>();
	public readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	constructor(private readonly configurationService: SimpleConfigurationService) {
		this.configurationService.onDidChangeConfiguration((e) => {
			this._onDidChangeConfiguration.fire(e);
		});
	}

	getValue<T>(resource: URI, section?: string): T;
	getValue<T>(resource: URI, position?: IPosition, section?: string): T;
	getValue<T>(resource: any, arg2?: any, arg3?: any) {
		const position: IPosition | null = Pos.isIPosition(arg2) ? arg2 : null;
		const section: string | undefined = position ? (typeof arg3 === 'string' ? arg3 : undefined) : (typeof arg2 === 'string' ? arg2 : undefined);
		if (typeof section === 'undefined') {
			return this.configurationService.getValue<T>();
		}
		return this.configurationService.getValue<T>(section);
	}
}

export class SimpleResourcePropertiesService implements ITextResourcePropertiesService {

	_serviceBrand: any;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
	}

	getEOL(resource: URI): string {
		const filesConfiguration = this.configurationService.getValue<{ eol: string }>('files');
		if (filesConfiguration && filesConfiguration.eol) {
			if (filesConfiguration.eol !== 'auto') {
				return filesConfiguration.eol;
			}
		}
		return (isLinux || isMacintosh) ? '\n' : '\r\n';
	}
}

export class StandaloneTelemetryService implements ITelemetryService {
	_serviceBrand: void = undefined;

	public isOptedIn = false;

	public setEnabled(value: boolean): void {
	}

	public publicLog(eventName: string, data?: any): Promise<void> {
		return Promise.resolve(undefined);
	}

	publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLog(eventName, data as any);
	}

	public getTelemetryInfo(): Promise<ITelemetryInfo> {
		throw new Error(`Not available`);
	}
}

export class SimpleWorkspaceContextService implements IWorkspaceContextService {

	public _serviceBrand: any;

	private static SCHEME = 'inmemory';

	private readonly _onDidChangeWorkspaceName = new Emitter<void>();
	public readonly onDidChangeWorkspaceName: Event<void> = this._onDidChangeWorkspaceName.event;

	private readonly _onDidChangeWorkspaceFolders = new Emitter<IWorkspaceFoldersChangeEvent>();
	public readonly onDidChangeWorkspaceFolders: Event<IWorkspaceFoldersChangeEvent> = this._onDidChangeWorkspaceFolders.event;

	private readonly _onDidChangeWorkbenchState = new Emitter<WorkbenchState>();
	public readonly onDidChangeWorkbenchState: Event<WorkbenchState> = this._onDidChangeWorkbenchState.event;

	private readonly workspace: IWorkspace;

	constructor() {
		const resource = URI.from({ scheme: SimpleWorkspaceContextService.SCHEME, authority: 'model', path: '/' });
		this.workspace = { id: '4064f6ec-cb38-4ad0-af64-ee6467e63c82', folders: [new WorkspaceFolder({ uri: resource, name: '', index: 0 })] };
	}

	getCompleteWorkspace(): Promise<IWorkspace> {
		return Promise.resolve(this.getWorkspace());
	}

	public getWorkspace(): IWorkspace {
		return this.workspace;
	}

	public getWorkbenchState(): WorkbenchState {
		if (this.workspace) {
			if (this.workspace.configuration) {
				return WorkbenchState.WORKSPACE;
			}
			return WorkbenchState.FOLDER;
		}
		return WorkbenchState.EMPTY;
	}

	public getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
		return resource && resource.scheme === SimpleWorkspaceContextService.SCHEME ? this.workspace.folders[0] : null;
	}

	public isInsideWorkspace(resource: URI): boolean {
		return resource && resource.scheme === SimpleWorkspaceContextService.SCHEME;
	}

	public isCurrentWorkspace(workspaceIdentifier: ISingleFolderWorkspaceIdentifier | IWorkspaceIdentifier): boolean {
		return true;
	}
}

export function applyConfigurationValues(configurationService: IConfigurationService, source: any, isDiffEditor: boolean): void {
	if (!source) {
		return;
	}
	if (!(configurationService instanceof SimpleConfigurationService)) {
		return;
	}
	Object.keys(source).forEach((key) => {
		if (isEditorConfigurationKey(key)) {
			configurationService.updateValue(`editor.${key}`, source[key]);
		}
		if (isDiffEditor && isDiffEditorConfigurationKey(key)) {
			configurationService.updateValue(`diffEditor.${key}`, source[key]);
		}
	});
}

export class SimpleBulkEditService implements IBulkEditService {
	_serviceBrand: any;

	constructor(private readonly _modelService: IModelService) {
		//
	}

	apply(workspaceEdit: WorkspaceEdit, options?: IBulkEditOptions): Promise<IBulkEditResult> {

		let edits = new Map<ITextModel, TextEdit[]>();

		if (workspaceEdit.edits) {
			for (let edit of workspaceEdit.edits) {
				if (!isResourceTextEdit(edit)) {
					return Promise.reject(new Error('bad edit - only text edits are supported'));
				}
				let model = this._modelService.getModel(edit.resource);
				if (!model) {
					return Promise.reject(new Error('bad edit - model not found'));
				}
				let array = edits.get(model);
				if (!array) {
					array = [];
				}
				edits.set(model, array.concat(edit.edits));
			}
		}

		let totalEdits = 0;
		let totalFiles = 0;
		edits.forEach((edits, model) => {
			model.applyEdits(edits.map(edit => EditOperation.replaceMove(Range.lift(edit.range), edit.text)));
			totalFiles += 1;
			totalEdits += edits.length;
		});

		return Promise.resolve({
			selection: undefined,
			ariaSummary: strings.format(SimpleServicesNLS.bulkEditServiceSummary, totalEdits, totalFiles)
		});
	}
}

export class SimpleUriLabelService implements ILabelService {
	_serviceBrand: any;

	private readonly _onDidRegisterFormatter = new Emitter<void>();
	public readonly onDidChangeFormatters: Event<void> = this._onDidRegisterFormatter.event;

	public getUriLabel(resource: URI, options?: { relative?: boolean, forceNoTildify?: boolean }): string {
		if (resource.scheme === 'file') {
			return resource.fsPath;
		}
		return resource.path;
	}

	public getWorkspaceLabel(workspace: IWorkspaceIdentifier | URI | IWorkspace, options?: { verbose: boolean; }): string {
		return '';
	}

	public getSeparator(scheme: string, authority?: string): '/' | '\\' {
		return '/';
	}

	public registerFormatter(formatter: ResourceLabelFormatter): IDisposable {
		throw new Error('Not implemented');
	}

	public getHostLabel(): string {
		return '';
	}
}

export class SimpleLayoutService implements ILayoutService {
	_serviceBrand: any;

	public onLayout = Event.None;

	private _dimension?: IDimension;
	get dimension(): IDimension {
		if (!this._dimension) {
			this._dimension = dom.getClientArea(window.document.body);
		}

		return this._dimension;
	}

	get container(): HTMLElement {
		return this._container;
	}

	constructor(private _container: HTMLElement) { }
}
