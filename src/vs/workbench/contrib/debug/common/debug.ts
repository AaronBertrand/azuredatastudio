/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI as uri } from 'vs/base/common/uri';
import severity from 'vs/base/common/severity';
import { Event } from 'vs/base/common/event';
import { IJSONSchemaSnippet } from 'vs/base/common/jsonSchema';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel as EditorIModel } from 'vs/editor/common/model';
import { IEditor, ITextEditor } from 'vs/workbench/common/editor';
import { Position } from 'vs/editor/common/core/position';
import { CompletionItem } from 'vs/editor/common/modes';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { Range, IRange } from 'vs/editor/common/core/range';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IViewContainersRegistry, ViewContainer, Extensions as ViewContainerExtensions } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { TaskIdentifier } from 'vs/workbench/contrib/tasks/common/tasks';
import { TelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';

export const VIEWLET_ID = 'workbench.view.debug';
export const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(VIEWLET_ID);

export const VARIABLES_VIEW_ID = 'workbench.debug.variablesView';
export const WATCH_VIEW_ID = 'workbench.debug.watchExpressionsView';
export const CALLSTACK_VIEW_ID = 'workbench.debug.callStackView';
export const LOADED_SCRIPTS_VIEW_ID = 'workbench.debug.loadedScriptsView';
export const BREAKPOINTS_VIEW_ID = 'workbench.debug.breakPointsView';
export const REPL_ID = 'workbench.panel.repl';
export const DEBUG_SERVICE_ID = 'debugService';
export const CONTEXT_DEBUG_TYPE = new RawContextKey<string>('debugType', undefined);
export const CONTEXT_DEBUG_CONFIGURATION_TYPE = new RawContextKey<string>('debugConfigurationType', undefined);
export const CONTEXT_DEBUG_STATE = new RawContextKey<string>('debugState', 'inactive');
export const CONTEXT_IN_DEBUG_MODE = new RawContextKey<boolean>('inDebugMode', false);
export const CONTEXT_IN_DEBUG_REPL = new RawContextKey<boolean>('inDebugRepl', false);
export const CONTEXT_BREAKPOINT_WIDGET_VISIBLE = new RawContextKey<boolean>('breakpointWidgetVisible', false);
export const CONTEXT_IN_BREAKPOINT_WIDGET = new RawContextKey<boolean>('inBreakpointWidget', false);
export const CONTEXT_BREAKPOINTS_FOCUSED = new RawContextKey<boolean>('breakpointsFocused', true);
export const CONTEXT_WATCH_EXPRESSIONS_FOCUSED = new RawContextKey<boolean>('watchExpressionsFocused', true);
export const CONTEXT_VARIABLES_FOCUSED = new RawContextKey<boolean>('variablesFocused', true);
export const CONTEXT_EXPRESSION_SELECTED = new RawContextKey<boolean>('expressionSelected', false);
export const CONTEXT_BREAKPOINT_SELECTED = new RawContextKey<boolean>('breakpointSelected', false);
export const CONTEXT_CALLSTACK_ITEM_TYPE = new RawContextKey<string>('callStackItemType', undefined);
export const CONTEXT_LOADED_SCRIPTS_SUPPORTED = new RawContextKey<boolean>('loadedScriptsSupported', false);
export const CONTEXT_LOADED_SCRIPTS_ITEM_TYPE = new RawContextKey<string>('loadedScriptsItemType', undefined);
export const CONTEXT_FOCUSED_SESSION_IS_ATTACH = new RawContextKey<boolean>('focusedSessionIsAttach', false);
export const CONTEXT_STEP_BACK_SUPPORTED = new RawContextKey<boolean>('stepBackSupported', false);
export const CONTEXT_RESTART_FRAME_SUPPORTED = new RawContextKey<boolean>('restartFrameSupported', false);
export const CONTEXT_JUMP_TO_CURSOR_SUPPORTED = new RawContextKey<boolean>('jumpToCursorSupported', false);

export const EDITOR_CONTRIBUTION_ID = 'editor.contrib.debug';
export const DEBUG_SCHEME = 'debug';
export const INTERNAL_CONSOLE_OPTIONS_SCHEMA = {
	enum: ['neverOpen', 'openOnSessionStart', 'openOnFirstSessionStart'],
	default: 'openOnFirstSessionStart',
	description: nls.localize('internalConsoleOptions', "Controls when the internal debug console should open.")
};

// raw

export interface IRawModelUpdate {
	sessionId: string;
	threads: DebugProtocol.Thread[];
	stoppedDetails?: IRawStoppedDetails;
}

export interface IRawStoppedDetails {
	reason?: string;
	description?: string;
	threadId?: number;
	text?: string;
	totalFrames?: number;
	allThreadsStopped?: boolean;
	framesErrorMessage?: string;
}

// model

export interface ITreeElement {
	getId(): string;
}

export interface IReplElement extends ITreeElement {
	toString(): string;
	readonly sourceData?: IReplElementSource;
}

export interface IReplElementSource {
	readonly source: Source;
	readonly lineNumber: number;
	readonly column: number;
}

export interface IExpressionContainer extends ITreeElement {
	readonly hasChildren: boolean;
	getChildren(): Promise<IExpression[]>;
}

export interface IExpression extends IReplElement, IExpressionContainer {
	name: string;
	readonly value: string;
	valueChanged?: boolean;
	readonly type?: string;
}

export interface IDebugger {
	createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter>;
	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined>;
	getCustomTelemetryService(): Promise<TelemetryService | undefined>;
}

export const enum State {
	Inactive,
	Initializing,
	Stopped,
	Running
}

export function getStateLabel(state: State): string {
	switch (state) {
		case State.Initializing: return 'initializing';
		case State.Stopped: return 'stopped';
		case State.Running: return 'running';
		default: return 'inactive';
	}
}

export interface AdapterEndEvent {
	error?: Error;
	sessionLengthInSeconds: number;
	emittedStopped: boolean;
}

export interface LoadedSourceEvent {
	reason: 'new' | 'changed' | 'removed';
	source: Source;
}

export interface IDebugSession extends ITreeElement {

	readonly configuration: IConfig;
	readonly unresolvedConfiguration: IConfig | undefined;
	readonly state: State;
	readonly root: IWorkspaceFolder;
	readonly parentSession: IDebugSession | undefined;
	readonly subId: string | undefined;

	setSubId(subId: string | undefined): void;

	getLabel(): string;

	getSourceForUri(modelUri: uri): Source | undefined;
	getSource(raw?: DebugProtocol.Source): Source;

	setConfiguration(configuration: { resolved: IConfig, unresolved: IConfig | undefined }): void;
	rawUpdate(data: IRawModelUpdate): void;

	getThread(threadId: number): IThread | undefined;
	getAllThreads(): IThread[];
	clearThreads(removeThreads: boolean, reference?: number): void;

	getReplElements(): IReplElement[];

	removeReplExpressions(): void;
	addReplExpression(stackFrame: IStackFrame | undefined, name: string): Promise<void>;
	appendToRepl(data: string | IExpression, severity: severity, source?: IReplElementSource): void;
	logToRepl(sev: severity, args: any[], frame?: { uri: uri, line: number, column: number }): void;

	// session events
	readonly onDidEndAdapter: Event<AdapterEndEvent>;
	readonly onDidChangeState: Event<void>;
	readonly onDidChangeReplElements: Event<void>;

	// DA capabilities
	readonly capabilities: DebugProtocol.Capabilities;

	// DAP events

	readonly onDidLoadedSource: Event<LoadedSourceEvent>;
	readonly onDidCustomEvent: Event<DebugProtocol.Event>;

	// Disconnects and clears state. Session can be initialized again for a new connection.
	shutdown(): void;

	// DAP request

	initialize(dbgr: IDebugger): Promise<void>;
	launchOrAttach(config: IConfig): Promise<void>;
	restart(): Promise<void>;
	terminate(restart?: boolean /* false */): Promise<void>;
	disconnect(restart?: boolean /* false */): Promise<void>;

	sendBreakpoints(modelUri: uri, bpts: IBreakpoint[], sourceModified: boolean): Promise<void>;
	sendFunctionBreakpoints(fbps: IFunctionBreakpoint[]): Promise<void>;
	sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void>;

	stackTrace(threadId: number, startFrame: number, levels: number): Promise<DebugProtocol.StackTraceResponse>;
	exceptionInfo(threadId: number): Promise<IExceptionInfo | undefined>;
	scopes(frameId: number): Promise<DebugProtocol.ScopesResponse>;
	variables(variablesReference: number, filter: 'indexed' | 'named' | undefined, start: number | undefined, count: number | undefined): Promise<DebugProtocol.VariablesResponse>;
	evaluate(expression: string, frameId?: number, context?: string): Promise<DebugProtocol.EvaluateResponse>;
	customRequest(request: string, args: any): Promise<DebugProtocol.Response>;

	restartFrame(frameId: number, threadId: number): Promise<void>;
	next(threadId: number): Promise<void>;
	stepIn(threadId: number): Promise<void>;
	stepOut(threadId: number): Promise<void>;
	stepBack(threadId: number): Promise<void>;
	continue(threadId: number): Promise<void>;
	reverseContinue(threadId: number): Promise<void>;
	pause(threadId: number): Promise<void>;
	terminateThreads(threadIds: number[]): Promise<void>;

	completions(frameId: number | undefined, text: string, position: Position, overwriteBefore: number): Promise<CompletionItem[]>;
	setVariable(variablesReference: number | undefined, name: string, value: string): Promise<DebugProtocol.SetVariableResponse>;
	loadSource(resource: uri): Promise<DebugProtocol.SourceResponse>;
	getLoadedSources(): Promise<Source[]>;

	gotoTargets(source: DebugProtocol.Source, line: number, column?: number): Promise<DebugProtocol.GotoTargetsResponse>;
	goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse>;
}

export interface IThread extends ITreeElement {

	/**
	 * Process the thread belongs to
	 */
	readonly session: IDebugSession;

	/**
	 * Id of the thread generated by the debug adapter backend.
	 */
	readonly threadId: number;

	/**
	 * Name of the thread.
	 */
	readonly name: string;

	/**
	 * Information about the current thread stop event. Undefined if thread is not stopped.
	 */
	readonly stoppedDetails: IRawStoppedDetails | undefined;

	/**
	 * Information about the exception if an 'exception' stopped event raised and DA supports the 'exceptionInfo' request, otherwise undefined.
	 */
	readonly exceptionInfo: Promise<IExceptionInfo | undefined>;

	readonly stateLabel: string;

	/**
	 * Gets the callstack if it has already been received from the debug
	 * adapter.
	 */
	getCallStack(): ReadonlyArray<IStackFrame>;

	/**
	 * Invalidates the callstack cache
	 */
	clearCallStack(): void;

	/**
	 * Indicates whether this thread is stopped. The callstack for stopped
	 * threads can be retrieved from the debug adapter.
	 */
	readonly stopped: boolean;

	next(): Promise<any>;
	stepIn(): Promise<any>;
	stepOut(): Promise<any>;
	stepBack(): Promise<any>;
	continue(): Promise<any>;
	pause(): Promise<any>;
	terminate(): Promise<any>;
	reverseContinue(): Promise<any>;
}

export interface IScope extends IExpressionContainer {
	readonly name: string;
	readonly expensive: boolean;
	readonly range?: IRange;
}

export interface IStackFrame extends ITreeElement {
	readonly thread: IThread;
	readonly name: string;
	readonly presentationHint: string | undefined;
	readonly frameId: number;
	readonly range: IRange;
	readonly source: Source;
	getScopes(): Promise<IScope[]>;
	getMostSpecificScopes(range: IRange): Promise<ReadonlyArray<IScope>>;
	getSpecificSourceName(): string;
	forgetScopes(): void;
	restart(): Promise<any>;
	toString(): string;
	openInEditor(editorService: IEditorService, preserveFocus?: boolean, sideBySide?: boolean): Promise<ITextEditor | null>;
}

export interface IEnablement extends ITreeElement {
	readonly enabled: boolean;
}

export interface IBreakpointData {
	readonly id?: string;
	readonly lineNumber: number;
	readonly column?: number;
	readonly enabled?: boolean;
	readonly condition?: string;
	readonly logMessage?: string;
	readonly hitCondition?: string;
}

export interface IBreakpointUpdateData {
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	readonly lineNumber?: number;
	readonly column?: number;
}

export interface IBaseBreakpoint extends IEnablement {
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	readonly verified: boolean;
	readonly idFromAdapter: number | undefined;
}

export interface IBreakpoint extends IBaseBreakpoint {
	readonly uri: uri;
	readonly lineNumber: number;
	readonly endLineNumber?: number;
	readonly column?: number;
	readonly endColumn?: number;
	readonly message?: string;
	readonly adapterData: any;
	readonly sessionAgnosticData: { lineNumber: number, column: number | undefined };
}

export interface IFunctionBreakpoint extends IBaseBreakpoint {
	readonly name: string;
}

export interface IExceptionBreakpoint extends IEnablement {
	readonly filter: string;
	readonly label: string;
}

export interface IExceptionInfo {
	readonly id?: string;
	readonly description?: string;
	readonly breakMode: string | null;
	readonly details?: DebugProtocol.ExceptionDetails;
}

// model interfaces

export interface IViewModel extends ITreeElement {
	/**
	 * Returns the focused debug session or undefined if no session is stopped.
	 */
	readonly focusedSession: IDebugSession | undefined;

	/**
	 * Returns the focused thread or undefined if no thread is stopped.
	 */
	readonly focusedThread: IThread | undefined;

	/**
	 * Returns the focused stack frame or undefined if there are no stack frames.
	 */
	readonly focusedStackFrame: IStackFrame | undefined;

	getSelectedExpression(): IExpression | undefined;
	getSelectedFunctionBreakpoint(): IFunctionBreakpoint | undefined;
	setSelectedExpression(expression: IExpression | undefined): void;
	setSelectedFunctionBreakpoint(functionBreakpoint: IFunctionBreakpoint | undefined): void;

	isMultiSessionView(): boolean;

	onDidFocusSession: Event<IDebugSession | undefined>;
	onDidFocusStackFrame: Event<{ stackFrame: IStackFrame | undefined, explicit: boolean }>;
	onDidSelectExpression: Event<IExpression | undefined>;
}

export interface IEvaluate {
	evaluate(session: IDebugSession, stackFrame: IStackFrame, context: string): Promise<void>;
}

export interface IDebugModel extends ITreeElement {
	getSession(sessionId: string | undefined, includeInactive?: boolean): IDebugSession | undefined;
	getSessions(includeInactive?: boolean): IDebugSession[];
	getBreakpoints(filter?: { uri?: uri, lineNumber?: number, column?: number, enabledOnly?: boolean }): ReadonlyArray<IBreakpoint>;
	areBreakpointsActivated(): boolean;
	getFunctionBreakpoints(): ReadonlyArray<IFunctionBreakpoint>;
	getExceptionBreakpoints(): ReadonlyArray<IExceptionBreakpoint>;
	getWatchExpressions(): ReadonlyArray<IExpression & IEvaluate>;

	onDidChangeBreakpoints: Event<IBreakpointsChangeEvent | undefined>;
	onDidChangeCallStack: Event<void>;
	onDidChangeWatchExpressions: Event<IExpression | undefined>;
}

/**
 * An event describing a change to the set of [breakpoints](#debug.Breakpoint).
 */
export interface IBreakpointsChangeEvent {
	added?: Array<IBreakpoint | IFunctionBreakpoint>;
	removed?: Array<IBreakpoint | IFunctionBreakpoint>;
	changed?: Array<IBreakpoint | IFunctionBreakpoint>;
	sessionOnly?: boolean;
}

// Debug configuration interfaces

export interface IDebugConfiguration {
	allowBreakpointsEverywhere: boolean;
	openDebug: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart' | 'openOnDebugBreak';
	openExplorerOnEnd: boolean;
	inlineValues: boolean;
	toolBarLocation: 'floating' | 'docked' | 'hidden';
	showInStatusBar: 'never' | 'always' | 'onFirstSessionStart';
	internalConsoleOptions: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart';
	extensionHostDebugAdapter: boolean;
	enableAllHovers: boolean;
	showSubSessionsInToolBar: boolean;
	console: {
		fontSize: number;
		fontFamily: string;
		lineHeight: number;
		wordWrap: boolean;
	};
	focusWindowOnBreak: boolean;
}

export interface IGlobalConfig {
	version: string;
	compounds: ICompound[];
	configurations: IConfig[];
}

export interface IEnvConfig {
	internalConsoleOptions?: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart';
	preLaunchTask?: string | TaskIdentifier;
	postDebugTask?: string | TaskIdentifier;
	debugServer?: number;
	noDebug?: boolean;
}

export interface IConfig extends IEnvConfig {

	// fundamental attributes
	type: string;
	request: string;
	name: string;

	// platform specifics
	windows?: IEnvConfig;
	osx?: IEnvConfig;
	linux?: IEnvConfig;

	// internals
	__sessionId?: string;
	__restart?: any;
	__autoAttach?: boolean;
	port?: number; // TODO
}

export interface ICompound {
	name: string;
	configurations: (string | { name: string, folder: string })[];
}

export interface IDebugAdapter extends IDisposable {
	readonly onError: Event<Error>;
	readonly onExit: Event<number | null>;
	onRequest(callback: (request: DebugProtocol.Request) => void): void;
	onEvent(callback: (event: DebugProtocol.Event) => void): void;
	startSession(): Promise<void>;
	sendMessage(message: DebugProtocol.ProtocolMessage): void;
	sendResponse(response: DebugProtocol.Response): void;
	sendRequest(command: string, args: any, clb: (result: DebugProtocol.Response) => void, timeout?: number): void;
	stopSession(): Promise<void>;
}

export interface IDebugAdapterFactory extends ITerminalLauncher {
	createDebugAdapter(session: IDebugSession): IDebugAdapter;
	substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
}

export interface IDebugAdapterExecutableOptions {
	cwd?: string;
	env?: { [key: string]: string };
}

export interface IDebugAdapterExecutable {
	readonly type: 'executable';
	readonly command: string;
	readonly args: string[];
	readonly options?: IDebugAdapterExecutableOptions;
}

export interface IDebugAdapterServer {
	readonly type: 'server';
	readonly port: number;
	readonly host?: string;
}

export interface IDebugAdapterImplementation {
	readonly type: 'implementation';
	readonly implementation: any;
}

export type IAdapterDescriptor = IDebugAdapterExecutable | IDebugAdapterServer | IDebugAdapterImplementation;

export interface IPlatformSpecificAdapterContribution {
	program?: string;
	args?: string[];
	runtime?: string;
	runtimeArgs?: string[];
}

export interface IDebuggerContribution extends IPlatformSpecificAdapterContribution {
	type: string;
	label?: string;
	// debug adapter executable
	adapterExecutableCommand?: string;
	win?: IPlatformSpecificAdapterContribution;
	winx86?: IPlatformSpecificAdapterContribution;
	windows?: IPlatformSpecificAdapterContribution;
	osx?: IPlatformSpecificAdapterContribution;
	linux?: IPlatformSpecificAdapterContribution;

	// internal
	aiKey?: string;

	// supported languages
	languages?: string[];
	enableBreakpointsFor?: { languageIds: string[] };

	// debug configuration support
	configurationAttributes?: any;
	initialConfigurations?: any[];
	configurationSnippets?: IJSONSchemaSnippet[];
	variables?: { [key: string]: string };
}

export interface IDebugConfigurationProvider {
	readonly type: string;
	resolveDebugConfiguration?(folderUri: uri | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	provideDebugConfigurations?(folderUri: uri | undefined, token: CancellationToken): Promise<IConfig[]>;
	debugAdapterExecutable?(folderUri: uri | undefined): Promise<IAdapterDescriptor>;		// TODO@AW legacy
}

export interface IDebugAdapterDescriptorFactory {
	readonly type: string;
	createDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor>;
}

export interface IDebugAdapterTrackerFactory {
	readonly type: string;
}

export interface ITerminalLauncher {
	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined>;
}

export interface IConfigurationManager {
	/**
	 * Returns true if breakpoints can be set for a given editor model. Depends on mode.
	 */
	canSetBreakpointsIn(model: EditorIModel): boolean;

	/**
	 * Returns an object containing the selected launch configuration and the selected configuration name. Both these fields can be null (no folder workspace).
	 */
	readonly selectedConfiguration: {
		launch: ILaunch | undefined;
		name: string | undefined;
	};

	selectConfiguration(launch: ILaunch | undefined, name?: string, debugStarted?: boolean): void;

	getLaunches(): ReadonlyArray<ILaunch>;

	getLaunch(workspaceUri: uri | undefined): ILaunch | undefined;

	/**
	 * Allows to register on change of selected debug configuration.
	 */
	onDidSelectConfiguration: Event<void>;

	activateDebuggers(activationEvent: string, debugType?: string): Promise<void>;

	hasDebugConfigurationProvider(debugType: string): boolean;

	registerDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): IDisposable;
	unregisterDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): void;

	registerDebugAdapterDescriptorFactory(debugAdapterDescriptorFactory: IDebugAdapterDescriptorFactory): IDisposable;
	unregisterDebugAdapterDescriptorFactory(debugAdapterDescriptorFactory: IDebugAdapterDescriptorFactory): void;

	resolveConfigurationByProviders(folderUri: uri | undefined, type: string | undefined, debugConfiguration: any, token: CancellationToken): Promise<any>;
	getDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor | undefined>;

	registerDebugAdapterFactory(debugTypes: string[], debugAdapterFactory: IDebugAdapterFactory): IDisposable;
	createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined;

	substituteVariables(debugType: string, folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
	runInTerminal(debugType: string, args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined>;
}

export interface ILaunch {

	/**
	 * Resource pointing to the launch.json this object is wrapping.
	 */
	readonly uri: uri;

	/**
	 * Name of the launch.
	 */
	readonly name: string;

	/**
	 * Workspace of the launch. Can be undefined.
	 */
	readonly workspace: IWorkspaceFolder | undefined;

	/**
	 * Should this launch be shown in the debug dropdown.
	 */
	readonly hidden: boolean;

	/**
	 * Returns a configuration with the specified name.
	 * Returns undefined if there is no configuration with the specified name.
	 */
	getConfiguration(name: string): IConfig | undefined;

	/**
	 * Returns a compound with the specified name.
	 * Returns undefined if there is no compound with the specified name.
	 */
	getCompound(name: string): ICompound | undefined;

	/**
	 * Returns the names of all configurations and compounds.
	 * Ignores configurations which are invalid.
	 */
	getConfigurationNames(includeCompounds?: boolean): string[];

	/**
	 * Opens the launch.json file. Creates if it does not exist.
	 */
	openConfigFile(sideBySide: boolean, preserveFocus: boolean, type?: string, token?: CancellationToken): Promise<{ editor: IEditor | null, created: boolean }>;
}

// Debug service interfaces

export const IDebugService = createDecorator<IDebugService>(DEBUG_SERVICE_ID);

export interface IDebugService {
	_serviceBrand: any;

	/**
	 * Gets the current debug state.
	 */
	readonly state: State;

	/**
	 * Allows to register on debug state changes.
	 */
	onDidChangeState: Event<State>;

	/**
	 * Allows to register on new session events.
	 */
	onDidNewSession: Event<IDebugSession>;

	/**
	 * Allows to register on sessions about to be created (not yet fully initialised)
	 */
	onWillNewSession: Event<IDebugSession>;

	/**
	 * Allows to register on end session events.
	 */
	onDidEndSession: Event<IDebugSession>;

	/**
	 * Gets the current configuration manager.
	 */
	getConfigurationManager(): IConfigurationManager;

	/**
	 * Sets the focused stack frame and evaluates all expressions against the newly focused stack frame,
	 */
	focusStackFrame(focusedStackFrame: IStackFrame | undefined, thread?: IThread, session?: IDebugSession, explicit?: boolean): void;

	/**
	 * Adds new breakpoints to the model for the file specified with the uri. Notifies debug adapter of breakpoint changes.
	 */
	addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[], context: string): Promise<IBreakpoint[]>;

	/**
	 * Updates the breakpoints.
	 */
	updateBreakpoints(uri: uri, data: Map<string, IBreakpointUpdateData>, sendOnResourceSaved: boolean): Promise<void>;

	/**
	 * Enables or disables all breakpoints. If breakpoint is passed only enables or disables the passed breakpoint.
	 * Notifies debug adapter of breakpoint changes.
	 */
	enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): Promise<void>;

	/**
	 * Sets the global activated property for all breakpoints.
	 * Notifies debug adapter of breakpoint changes.
	 */
	setBreakpointsActivated(activated: boolean): Promise<void>;

	/**
	 * Removes all breakpoints. If id is passed only removes the breakpoint associated with that id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeBreakpoints(id?: string): Promise<any>;

	/**
	 * Adds a new function breakpoint for the given name.
	 */
	addFunctionBreakpoint(name?: string, id?: string): void;

	/**
	 * Renames an already existing function breakpoint.
	 * Notifies debug adapter of breakpoint changes.
	 */
	renameFunctionBreakpoint(id: string, newFunctionName: string): Promise<void>;

	/**
	 * Removes all function breakpoints. If id is passed only removes the function breakpoint with the passed id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeFunctionBreakpoints(id?: string): Promise<void>;

	/**
	 * Sends all breakpoints to the passed session.
	 * If session is not passed, sends all breakpoints to each session.
	 */
	sendAllBreakpoints(session?: IDebugSession): Promise<any>;

	/**
	 * Adds a new watch expression and evaluates it against the debug adapter.
	 */
	addWatchExpression(name?: string): void;

	/**
	 * Renames a watch expression and evaluates it against the debug adapter.
	 */
	renameWatchExpression(id: string, newName: string): void;

	/**
	 * Moves a watch expression to a new possition. Used for reordering watch expressions.
	 */
	moveWatchExpression(id: string, position: number): void;

	/**
	 * Removes all watch expressions. If id is passed only removes the watch expression with the passed id.
	 */
	removeWatchExpressions(id?: string): void;

	/**
	 * Starts debugging. If the configOrName is not passed uses the selected configuration in the debug dropdown.
	 * Also saves all files, manages if compounds are present in the configuration
	 * and resolveds configurations via DebugConfigurationProviders.
	 *
	 * Returns true if the start debugging was successfull. For compound launches, all configurations have to start successfuly for it to return success.
	 * On errors the startDebugging will throw an error, however some error and cancelations are handled and in that case will simply return false.
	 */
	startDebugging(launch: ILaunch | undefined, configOrName?: IConfig | string, noDebug?: boolean, parentSession?: IDebugSession): Promise<boolean>;

	/**
	 * Restarts a session or creates a new one if there is no active session.
	 */
	restartSession(session: IDebugSession, restartData?: any): Promise<any>;

	/**
	 * Stops the session. If the session does not exist then stops all sessions.
	 */
	stopSession(session: IDebugSession | undefined): Promise<any>;

	/**
	 * Makes unavailable all sources with the passed uri. Source will appear as grayed out in callstack view.
	 */
	sourceIsNotAvailable(uri: uri): void;

	/**
	 * Gets the current debug model.
	 */
	getModel(): IDebugModel;

	/**
	 * Gets the current view model.
	 */
	getViewModel(): IViewModel;
}

// Editor interfaces
export const enum BreakpointWidgetContext {
	CONDITION = 0,
	HIT_COUNT = 1,
	LOG_MESSAGE = 2
}

export interface IDebugEditorContribution extends IEditorContribution {
	showHover(range: Range, focus: boolean): Promise<void>;
	showBreakpointWidget(lineNumber: number, column: number | undefined, context?: BreakpointWidgetContext): void;
	closeBreakpointWidget(): void;
	addLaunchConfiguration(): Promise<any>;
}

// temporary debug helper service

export const DEBUG_HELPER_SERVICE_ID = 'debugHelperService';
export const IDebugHelperService = createDecorator<IDebugHelperService>(DEBUG_HELPER_SERVICE_ID);

export interface IDebugHelperService {
	_serviceBrand: any;

	createTelemetryService(configurationService: IConfigurationService, args: string[]): TelemetryService | undefined;
}
