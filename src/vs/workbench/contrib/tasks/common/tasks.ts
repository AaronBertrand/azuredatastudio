/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as Types from 'vs/base/common/types';
import { IJSONSchemaMap } from 'vs/base/common/jsonSchema';
import * as Objects from 'vs/base/common/objects';
import { UriComponents } from 'vs/base/common/uri';

import { ProblemMatcher } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { TaskDefinitionRegistry } from 'vs/workbench/contrib/tasks/common/taskDefinitionRegistry';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';

export const TASK_RUNNING_STATE = new RawContextKey<boolean>('taskRunning', false);

export enum ShellQuoting {
	/**
	 * Use character escaping.
	 */
	Escape = 1,

	/**
	 * Use strong quoting
	 */
	Strong = 2,

	/**
	 * Use weak quoting.
	 */
	Weak = 3,
}

export const CUSTOMIZED_TASK_TYPE = '$customized';

export namespace ShellQuoting {
	export function from(this: void, value: string): ShellQuoting {
		if (!value) {
			return ShellQuoting.Strong;
		}
		switch (value.toLowerCase()) {
			case 'escape':
				return ShellQuoting.Escape;
			case 'strong':
				return ShellQuoting.Strong;
			case 'weak':
				return ShellQuoting.Weak;
			default:
				return ShellQuoting.Strong;
		}
	}
}

export interface ShellQuotingOptions {
	/**
	 * The character used to do character escaping.
	 */
	escape?: string | {
		escapeChar: string;
		charsToEscape: string;
	};

	/**
	 * The character used for string quoting.
	 */
	strong?: string;

	/**
	 * The character used for weak quoting.
	 */
	weak?: string;
}

export interface ShellConfiguration {
	/**
	 * The shell executable.
	 */
	executable?: string;

	/**
	 * The arguments to be passed to the shell executable.
	 */
	args?: string[];

	/**
	 * Which kind of quotes the shell supports.
	 */
	quoting?: ShellQuotingOptions;
}

export interface CommandOptions {

	/**
	 * The shell to use if the task is a shell command.
	 */
	shell?: ShellConfiguration;

	/**
	 * The current working directory of the executed program or shell.
	 * If omitted VSCode's current workspace root is used.
	 */
	cwd?: string;

	/**
	 * The environment of the executed program or shell. If omitted
	 * the parent process' environment is used.
	 */
	env?: { [key: string]: string; };
}

export namespace CommandOptions {
	export const defaults: CommandOptions = { cwd: '${workspaceFolder}' };
}

export enum RevealKind {
	/**
	 * Always brings the terminal to front if the task is executed.
	 */
	Always = 1,

	/**
	 * Only brings the terminal to front if a problem is detected executing the task
	 * e.g. the task couldn't be started,
	 * the task ended with an exit code other than zero,
	 * or the problem matcher found an error.
	 */
	Silent = 2,

	/**
	 * The terminal never comes to front when the task is executed.
	 */
	Never = 3
}

export namespace RevealKind {
	export function fromString(this: void, value: string): RevealKind {
		switch (value.toLowerCase()) {
			case 'always':
				return RevealKind.Always;
			case 'silent':
				return RevealKind.Silent;
			case 'never':
				return RevealKind.Never;
			default:
				return RevealKind.Always;
		}
	}
}

export enum RevealProblemKind {
	/**
	 * Never reveals the problems panel when this task is executed.
	 */
	Never = 1,


	/**
	 * Only reveals the problems panel if a problem is found.
	 */
	OnProblem = 2,

	/**
	 * Never reveals the problems panel when this task is executed.
	 */
	Always = 3
}

export namespace RevealProblemKind {
	export function fromString(this: void, value: string): RevealProblemKind {
		switch (value.toLowerCase()) {
			case 'always':
				return RevealProblemKind.Always;
			case 'never':
				return RevealProblemKind.Never;
			case 'onproblem':
				return RevealProblemKind.OnProblem;
			default:
				return RevealProblemKind.OnProblem;
		}
	}
}

export enum PanelKind {

	/**
	 * Shares a panel with other tasks. This is the default.
	 */
	Shared = 1,

	/**
	 * Uses a dedicated panel for this tasks. The panel is not
	 * shared with other tasks.
	 */
	Dedicated = 2,

	/**
	 * Creates a new panel whenever this task is executed.
	 */
	New = 3
}

export namespace PanelKind {
	export function fromString(value: string): PanelKind {
		switch (value.toLowerCase()) {
			case 'shared':
				return PanelKind.Shared;
			case 'dedicated':
				return PanelKind.Dedicated;
			case 'new':
				return PanelKind.New;
			default:
				return PanelKind.Shared;
		}
	}
}

export interface PresentationOptions {
	/**
	 * Controls whether the task output is reveal in the user interface.
	 * Defaults to `RevealKind.Always`.
	 */
	reveal: RevealKind;

	/**
	 * Controls whether the problems pane is revealed when running this task or not.
	 * Defaults to `RevealProblemKind.Never`.
	 */
	revealProblems: RevealProblemKind;

	/**
	 * Controls whether the command associated with the task is echoed
	 * in the user interface.
	 */
	echo: boolean;

	/**
	 * Controls whether the panel showing the task output is taking focus.
	 */
	focus: boolean;

	/**
	 * Controls if the task panel is used for this task only (dedicated),
	 * shared between tasks (shared) or if a new panel is created on
	 * every task execution (new). Defaults to `TaskInstanceKind.Shared`
	 */
	panel: PanelKind;

	/**
	 * Controls whether to show the "Terminal will be reused by tasks, press any key to close it" message.
	 */
	showReuseMessage: boolean;

	/**
	 * Controls whether to clear the terminal before executing the task.
	 */
	clear: boolean;

	/**
	 * Controls whether the task is executed in a specific terminal group using split panes.
	 */
	group?: string;
}

export namespace PresentationOptions {
	export const defaults: PresentationOptions = {
		echo: true, reveal: RevealKind.Always, revealProblems: RevealProblemKind.Never, focus: false, panel: PanelKind.Shared, showReuseMessage: true, clear: false
	};
}

export enum RuntimeType {
	Shell = 1,
	Process = 2,
	CustomExecution2 = 3
}

export namespace RuntimeType {
	export function fromString(value: string): RuntimeType {
		switch (value.toLowerCase()) {
			case 'shell':
				return RuntimeType.Shell;
			case 'process':
				return RuntimeType.Process;
			case 'customExecution2':
				return RuntimeType.CustomExecution2;
			default:
				return RuntimeType.Process;
		}
	}
}

export interface QuotedString {
	value: string;
	quoting: ShellQuoting;
}

export type CommandString = string | QuotedString;

export namespace CommandString {
	export function value(value: CommandString): string {
		if (Types.isString(value)) {
			return value;
		} else {
			return value.value;
		}
	}
}

export interface CommandConfiguration {

	/**
	 * The task type
	 */
	runtime?: RuntimeType;

	/**
	 * The command to execute
	 */
	name?: CommandString;

	/**
	 * Additional command options.
	 */
	options?: CommandOptions;

	/**
	 * Command arguments.
	 */
	args?: CommandString[];

	/**
	 * The task selector if needed.
	 */
	taskSelector?: string;

	/**
	 * Whether to suppress the task name when merging global args
	 *
	 */
	suppressTaskName?: boolean;

	/**
	 * Describes how the task is presented in the UI.
	 */
	presentation?: PresentationOptions;
}

export namespace TaskGroup {
	export const Clean: 'clean' = 'clean';

	export const Build: 'build' = 'build';

	export const Rebuild: 'rebuild' = 'rebuild';

	export const Test: 'test' = 'test';

	export function is(value: string): value is string {
		return value === Clean || value === Build || value === Rebuild || value === Test;
	}
}

export type TaskGroup = 'clean' | 'build' | 'rebuild' | 'test';


export const enum TaskScope {
	Global = 1,
	Workspace = 2,
	Folder = 3
}

export namespace TaskSourceKind {
	export const Workspace: 'workspace' = 'workspace';
	export const Extension: 'extension' = 'extension';
	export const InMemory: 'inMemory' = 'inMemory';
}

export interface TaskSourceConfigElement {
	workspaceFolder: IWorkspaceFolder;
	file: string;
	index: number;
	element: any;
}

interface BaseTaskSource {
	readonly kind: string;
	readonly label: string;
}

export interface WorkspaceTaskSource extends BaseTaskSource {
	readonly kind: 'workspace';
	readonly config: TaskSourceConfigElement;
	readonly customizes?: KeyedTaskIdentifier;
}

export interface ExtensionTaskSource extends BaseTaskSource {
	readonly kind: 'extension';
	readonly extension?: string;
	readonly scope: TaskScope;
	readonly workspaceFolder: IWorkspaceFolder | undefined;
}

export interface ExtensionTaskSourceTransfer {
	__workspaceFolder: UriComponents;
	__definition: { type: string;[name: string]: any };
}

export interface InMemoryTaskSource extends BaseTaskSource {
	readonly kind: 'inMemory';
}

export type TaskSource = WorkspaceTaskSource | ExtensionTaskSource | InMemoryTaskSource;

export interface TaskIdentifier {
	type: string;
	[name: string]: any;
}

export interface KeyedTaskIdentifier extends TaskIdentifier {
	_key: string;
}

export interface TaskDependency {
	workspaceFolder: IWorkspaceFolder;
	task: string | KeyedTaskIdentifier | undefined;
}

export const enum GroupType {
	default = 'default',
	user = 'user'
}

export const enum DependsOrder {
	parallel = 'parallel',
	sequence = 'sequence'
}

export interface ConfigurationProperties {

	/**
	 * The task's name
	 */
	name?: string;

	/**
	 * The task's name
	 */
	identifier?: string;

	/**
	 * the task's group;
	 */
	group?: string;

	/**
	 * The group type
	 */
	groupType?: GroupType;

	/**
	 * The presentation options
	 */
	presentation?: PresentationOptions;

	/**
	 * The command options;
	 */
	options?: CommandOptions;

	/**
	 * Whether the task is a background task or not.
	 */
	isBackground?: boolean;

	/**
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * The other tasks this task depends on.
	 */
	dependsOn?: TaskDependency[];

	/**
	 * The order the dependsOn tasks should be executed in.
	 */
	dependsOrder?: DependsOrder;

	/**
	 * The problem watchers to use for this task
	 */
	problemMatchers?: Array<string | ProblemMatcher>;
}

export enum RunOnOptions {
	default = 1,
	folderOpen = 2
}

export interface RunOptions {
	reevaluateOnRerun?: boolean;
	runOn?: RunOnOptions;
}

export namespace RunOptions {
	export const defaults: RunOptions = { reevaluateOnRerun: true, runOn: RunOnOptions.default };
}

export abstract class CommonTask {

	/**
	 * The task's internal id
	 */
	_id: string;

	/**
	 * The cached label.
	 */
	_label: string;

	type?: string;

	runOptions: RunOptions;

	configurationProperties: ConfigurationProperties;

	_source: BaseTaskSource;

	private _taskLoadMessages: string[] | undefined;

	protected constructor(id: string, label: string | undefined, type: string | undefined, runOptions: RunOptions,
		configurationProperties: ConfigurationProperties, source: BaseTaskSource) {
		this._id = id;
		if (label) {
			this._label = label;
		}
		if (type) {
			this.type = type;
		}
		this.runOptions = runOptions;
		this.configurationProperties = configurationProperties;
		this._source = source;
	}

	public getDefinition(useSource?: boolean): KeyedTaskIdentifier | undefined {
		return undefined;
	}

	public getMapKey(): string {
		return this._id;
	}

	public getRecentlyUsedKey(): string | undefined {
		return undefined;
	}

	public clone(): Task {
		return this.fromObject(Objects.assign({}, <any>this));
	}

	protected abstract fromObject(object: any): Task;

	public getWorkspaceFolder(): IWorkspaceFolder | undefined {
		return undefined;
	}

	public getTelemetryKind(): string {
		return 'unknown';
	}

	public matches(key: string | KeyedTaskIdentifier | undefined, compareId: boolean = false): boolean {
		if (key === undefined) {
			return false;
		}
		if (Types.isString(key)) {
			return key === this._label || key === this.configurationProperties.identifier || (compareId && key === this._id);
		}
		let identifier = this.getDefinition(true);
		return identifier !== undefined && identifier._key === key._key;
	}

	public getQualifiedLabel(): string {
		let workspaceFolder = this.getWorkspaceFolder();
		if (workspaceFolder) {
			return `${this._label} (${workspaceFolder.name})`;
		} else {
			return this._label;
		}
	}

	public getTaskExecution(): TaskExecution {
		let result: TaskExecution = {
			id: this._id,
			task: <any>this
		};
		return result;
	}

	public addTaskLoadMessages(messages: string[] | undefined) {
		if (this._taskLoadMessages === undefined) {
			this._taskLoadMessages = [];
		}
		if (messages) {
			this._taskLoadMessages = this._taskLoadMessages.concat(messages);
		}
	}

	get taskLoadMessages(): string[] | undefined {
		return this._taskLoadMessages;
	}
}

export class CustomTask extends CommonTask {

	type: '$customized'; // CUSTOMIZED_TASK_TYPE

	/**
	 * Indicated the source of the task (e.g. tasks.json or extension)
	 */
	_source: WorkspaceTaskSource;

	hasDefinedMatchers: boolean;

	/**
	 * The command configuration
	 */
	command: CommandConfiguration;

	public constructor(id: string, source: WorkspaceTaskSource, label: string, type: string, command: CommandConfiguration | undefined,
		hasDefinedMatchers: boolean, runOptions: RunOptions, configurationProperties: ConfigurationProperties) {
		super(id, label, undefined, runOptions, configurationProperties, source);
		this._source = source;
		this.hasDefinedMatchers = hasDefinedMatchers;
		if (command) {
			this.command = command;
		}
	}

	public customizes(): KeyedTaskIdentifier | undefined {
		if (this._source && this._source.customizes) {
			return this._source.customizes;
		}
		return undefined;
	}

	public getDefinition(useSource: boolean = false): KeyedTaskIdentifier {
		if (useSource && this._source.customizes !== undefined) {
			return this._source.customizes;
		} else {
			let type: string;
			const commandRuntime = this.command ? this.command.runtime : undefined;
			switch (commandRuntime) {
				case RuntimeType.Shell:
					type = 'shell';
					break;

				case RuntimeType.Process:
					type = 'process';
					break;

				case RuntimeType.CustomExecution2:
					type = 'customExecution2';
					break;

				case undefined:
					type = '$composite';
					break;

				default:
					throw new Error('Unexpected task runtime');
			}

			let result: KeyedTaskIdentifier = {
				type,
				_key: this._id,
				id: this._id
			};
			return result;
		}
	}

	public static is(value: any): value is CustomTask {
		return value instanceof CustomTask;
	}

	public getMapKey(): string {
		let workspaceFolder = this._source.config.workspaceFolder;
		return workspaceFolder ? `${workspaceFolder.uri.toString()}|${this._id}` : this._id;
	}

	public getRecentlyUsedKey(): string | undefined {
		interface CustomKey {
			type: string;
			folder: string;
			id: string;
		}
		let workspaceFolder = this._source.config.workspaceFolder;
		if (!workspaceFolder) {
			return undefined;
		}
		let key: CustomKey = { type: CUSTOMIZED_TASK_TYPE, folder: workspaceFolder.uri.toString(), id: this.configurationProperties.identifier! };
		return JSON.stringify(key);
	}

	public getWorkspaceFolder(): IWorkspaceFolder {
		return this._source.config.workspaceFolder;
	}

	public getTelemetryKind(): string {
		if (this._source.customizes) {
			return 'workspace>extension';
		} else {
			return 'workspace';
		}
	}

	protected fromObject(object: CustomTask): CustomTask {
		return new CustomTask(object._id, object._source, object._label, object.type, object.command, object.hasDefinedMatchers, object.runOptions, object.configurationProperties);
	}
}

export class ConfiguringTask extends CommonTask {

	/**
	 * Indicated the source of the task (e.g. tasks.json or extension)
	 */
	_source: WorkspaceTaskSource;

	configures: KeyedTaskIdentifier;

	public constructor(id: string, source: WorkspaceTaskSource, label: string | undefined, type: string | undefined,
		configures: KeyedTaskIdentifier, runOptions: RunOptions, configurationProperties: ConfigurationProperties) {
		super(id, label, type, runOptions, configurationProperties, source);
		this._source = source;
		this.configures = configures;
	}

	public static is(value: any): value is ConfiguringTask {
		return value instanceof ConfiguringTask;
	}

	protected fromObject(object: any): Task {
		return object;
	}

	public getDefinition(): KeyedTaskIdentifier {
		return this.configures;
	}
}

export class ContributedTask extends CommonTask {

	/**
	 * Indicated the source of the task (e.g. tasks.json or extension)
	 */
	_source: ExtensionTaskSource;

	defines: KeyedTaskIdentifier;

	hasDefinedMatchers: boolean;

	/**
	 * The command configuration
	 */
	command: CommandConfiguration;

	public constructor(id: string, source: ExtensionTaskSource, label: string, type: string | undefined, defines: KeyedTaskIdentifier,
		command: CommandConfiguration, hasDefinedMatchers: boolean, runOptions: RunOptions,
		configurationProperties: ConfigurationProperties) {
		super(id, label, type, runOptions, configurationProperties, source);
		this.defines = defines;
		this.hasDefinedMatchers = hasDefinedMatchers;
		this.command = command;
	}

	public getDefinition(): KeyedTaskIdentifier {
		return this.defines;
	}

	public static is(value: any): value is ContributedTask {
		return value instanceof ContributedTask;
	}

	public getMapKey(): string {
		let workspaceFolder = this._source.workspaceFolder;
		return workspaceFolder
			? `${this._source.scope.toString()}|${workspaceFolder.uri.toString()}|${this._id}`
			: `${this._source.scope.toString()}|${this._id}`;
	}

	public getRecentlyUsedKey(): string | undefined {
		interface ContributedKey {
			type: string;
			scope: number;
			folder?: string;
			id: string;
		}

		let key: ContributedKey = { type: 'contributed', scope: this._source.scope, id: this._id };
		if (this._source.scope === TaskScope.Folder && this._source.workspaceFolder) {
			key.folder = this._source.workspaceFolder.uri.toString();
		}
		return JSON.stringify(key);
	}

	public getWorkspaceFolder(): IWorkspaceFolder | undefined {
		return this._source.workspaceFolder;
	}

	public getTelemetryKind(): string {
		return 'extension';
	}

	protected fromObject(object: ContributedTask): ContributedTask {
		return new ContributedTask(object._id, object._source, object._label, object.type, object.defines, object.command, object.hasDefinedMatchers, object.runOptions, object.configurationProperties);
	}
}

export class InMemoryTask extends CommonTask {
	/**
	 * Indicated the source of the task (e.g. tasks.json or extension)
	 */
	_source: InMemoryTaskSource;

	type: 'inMemory';

	public constructor(id: string, source: InMemoryTaskSource, label: string, type: string,
		runOptions: RunOptions, configurationProperties: ConfigurationProperties) {
		super(id, label, type, runOptions, configurationProperties, source);
		this._source = source;
	}

	public static is(value: any): value is InMemoryTask {
		return value instanceof InMemoryTask;
	}

	public getTelemetryKind(): string {
		return 'composite';
	}

	protected fromObject(object: InMemoryTask): InMemoryTask {
		return new InMemoryTask(object._id, object._source, object._label, object.type, object.runOptions, object.configurationProperties);
	}
}

export type Task = CustomTask | ContributedTask | InMemoryTask;

export interface TaskExecution {
	id: string;
	task: Task;
}

export enum ExecutionEngine {
	Process = 1,
	Terminal = 2
}

export namespace ExecutionEngine {
	export const _default: ExecutionEngine = ExecutionEngine.Terminal;
}

export const enum JsonSchemaVersion {
	V0_1_0 = 1,
	V2_0_0 = 2
}

export interface TaskSet {
	tasks: Task[];
	extension?: IExtensionDescription;
}

export interface TaskDefinition {
	extensionId: string;
	taskType: string;
	required: string[];
	properties: IJSONSchemaMap;
}

export class TaskSorter {

	private _order: Map<string, number> = new Map();

	constructor(workspaceFolders: IWorkspaceFolder[]) {
		for (let i = 0; i < workspaceFolders.length; i++) {
			this._order.set(workspaceFolders[i].uri.toString(), i);
		}
	}

	public compare(a: Task, b: Task): number {
		let aw = a.getWorkspaceFolder();
		let bw = b.getWorkspaceFolder();
		if (aw && bw) {
			let ai = this._order.get(aw.uri.toString());
			ai = ai === undefined ? 0 : ai + 1;
			let bi = this._order.get(bw.uri.toString());
			bi = bi === undefined ? 0 : bi + 1;
			if (ai === bi) {
				return a._label.localeCompare(b._label);
			} else {
				return ai - bi;
			}
		} else if (!aw && bw) {
			return -1;
		} else if (aw && !bw) {
			return +1;
		} else {
			return 0;
		}
	}
}

export const enum TaskEventKind {
	DependsOnStarted = 'dependsOnStarted',
	Start = 'start',
	ProcessStarted = 'processStarted',
	Active = 'active',
	Inactive = 'inactive',
	Changed = 'changed',
	Terminated = 'terminated',
	ProcessEnded = 'processEnded',
	End = 'end'
}


export const enum TaskRunType {
	SingleRun = 'singleRun',
	Background = 'background'
}

export interface TaskEvent {
	kind: TaskEventKind;
	taskId?: string;
	taskName?: string;
	runType?: TaskRunType;
	group?: string;
	processId?: number;
	exitCode?: number;
	terminalId?: number;
	__task?: Task;
}

export const enum TaskRunSource {
	System,
	User,
	FolderOpen,
	ConfigurationChange
}

export namespace TaskEvent {
	export function create(kind: TaskEventKind.ProcessStarted | TaskEventKind.ProcessEnded, task: Task, processIdOrExitCode?: number): TaskEvent;
	export function create(kind: TaskEventKind.Start, task: Task, terminalId?: number): TaskEvent;
	export function create(kind: TaskEventKind.DependsOnStarted | TaskEventKind.Start | TaskEventKind.Active | TaskEventKind.Inactive | TaskEventKind.Terminated | TaskEventKind.End, task: Task): TaskEvent;
	export function create(kind: TaskEventKind.Changed): TaskEvent;
	export function create(kind: TaskEventKind, task?: Task, processIdOrExitCodeOrTerminalId?: number): TaskEvent {
		if (task) {
			let result: TaskEvent = {
				kind: kind,
				taskId: task._id,
				taskName: task.configurationProperties.name,
				runType: task.configurationProperties.isBackground ? TaskRunType.Background : TaskRunType.SingleRun,
				group: task.configurationProperties.group,
				processId: undefined as number | undefined,
				exitCode: undefined as number | undefined,
				terminalId: undefined as number | undefined,
				__task: task,
			};
			if (kind === TaskEventKind.Start) {
				result.terminalId = processIdOrExitCodeOrTerminalId;
			} else if (kind === TaskEventKind.ProcessStarted) {
				result.processId = processIdOrExitCodeOrTerminalId;
			} else if (kind === TaskEventKind.ProcessEnded) {
				result.exitCode = processIdOrExitCodeOrTerminalId;
			}
			return Object.freeze(result);
		} else {
			return Object.freeze({ kind: TaskEventKind.Changed });
		}
	}
}

export namespace KeyedTaskIdentifier {
	function sortedStringify(literal: any): string {
		const keys = Object.keys(literal).sort();
		let result: string = '';
		for (let position in keys) {
			let stringified = literal[keys[position]];
			if (stringified instanceof Object) {
				stringified = sortedStringify(stringified);
			} else if (typeof stringified === 'string') {
				stringified = stringified.replace(/,/g, ',,');
			}
			result += keys[position] + ',' + stringified + ',';
		}
		return result;
	}
	export function create(value: TaskIdentifier): KeyedTaskIdentifier {
		const resultKey = sortedStringify(value);
		let result = { _key: resultKey, type: value.taskType };
		Objects.assign(result, value);
		return result;
	}
}

export namespace TaskDefinition {
	export function createTaskIdentifier(external: TaskIdentifier, reporter: { error(message: string): void; }): KeyedTaskIdentifier | undefined {
		let definition = TaskDefinitionRegistry.get(external.type);
		if (definition === undefined) {
			// We have no task definition so we can't sanitize the literal. Take it as is
			let copy = Objects.deepClone(external);
			delete copy._key;
			return KeyedTaskIdentifier.create(copy);
		}

		let literal: { type: string;[name: string]: any } = Object.create(null);
		literal.type = definition.taskType;
		let required: Set<string> = new Set();
		definition.required.forEach(element => required.add(element));

		let properties = definition.properties;
		for (let property of Object.keys(properties)) {
			let value = external[property];
			if (value !== undefined && value !== null) {
				literal[property] = value;
			} else if (required.has(property)) {
				let schema = properties[property];
				if (schema.default !== undefined) {
					literal[property] = Objects.deepClone(schema.default);
				} else {
					switch (schema.type) {
						case 'boolean':
							literal[property] = false;
							break;
						case 'number':
						case 'integer':
							literal[property] = 0;
							break;
						case 'string':
							literal[property] = '';
							break;
						default:
							reporter.error(nls.localize(
								'TaskDefinition.missingRequiredProperty',
								'Error: the task identifier \'{0}\' is missing the required property \'{1}\'. The task identifier will be ignored.', JSON.stringify(external, undefined, 0), property
							));
							return undefined;
					}
				}
			}
		}
		return KeyedTaskIdentifier.create(literal);
	}
}
