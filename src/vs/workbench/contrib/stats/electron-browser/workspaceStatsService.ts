/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import { IFileService, IResolveFileResult, IFileStat } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, WorkbenchState, IWorkspace } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWindowService, IWindowConfiguration } from 'vs/platform/windows/common/windows';
import { INotificationService, IPromptChoice } from 'vs/platform/notification/common/notification';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITextFileService, ITextFileContent } from 'vs/workbench/services/textfile/common/textfiles';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { localize } from 'vs/nls';
import Severity from 'vs/base/common/severity';
import { joinPath } from 'vs/base/common/resources';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export type Tags = { [index: string]: boolean | number | string | undefined };

const DISABLE_WORKSPACE_PROMPT_KEY = 'workspaces.dontPromptToOpen';

const ModulesToLookFor = [
	// Packages that suggest a node server
	'express',
	'sails',
	'koa',
	'hapi',
	'socket.io',
	'restify',
	// JS frameworks
	'react',
	'react-native',
	'rnpm-plugin-windows',
	'@angular/core',
	'@ionic',
	'vue',
	'tns-core-modules',
	// Other interesting packages
	'aws-sdk',
	'aws-amplify',
	'azure',
	'azure-storage',
	'firebase',
	'@google-cloud/common',
	'heroku-cli',
	//Office and Sharepoint packages
	'@microsoft/office-js',
	'@microsoft/office-js-helpers',
	'@types/office-js',
	'@types/office-runtime',
	'office-ui-fabric-react',
	'@uifabric/icons',
	'@uifabric/merge-styles',
	'@uifabric/styling',
	'@uifabric/experiments',
	'@uifabric/utilities',
	'@microsoft/rush',
	'lerna',
	'just-task',
	'beachball'
];
const PyModulesToLookFor = [
	'azure',
	'azure-storage-common',
	'azure-storage-blob',
	'azure-storage-file',
	'azure-storage-queue',
	'azure-shell',
	'azure-cosmos',
	'azure-devtools',
	'azure-elasticluster',
	'azure-eventgrid',
	'azure-functions',
	'azure-graphrbac',
	'azure-keyvault',
	'azure-loganalytics',
	'azure-monitor',
	'azure-servicebus',
	'azure-servicefabric',
	'azure-storage',
	'azure-translator',
	'azure-iothub-device-client',
	'adal',
	'pydocumentdb',
	'botbuilder-core',
	'botbuilder-schema',
	'botframework-connector'
];

export const IWorkspaceStatsService = createDecorator<IWorkspaceStatsService>('workspaceStatsService');

export interface IWorkspaceStatsService {
	_serviceBrand: any;
	getTags(): Promise<Tags>;

	/**
	 * Returns an id for the workspace, different from the id returned by the context service. A hash based
	 * on the folder uri or workspace configuration, not time-based, and undefined for empty workspaces.
	 */
	getTelemetryWorkspaceId(workspace: IWorkspace, state: WorkbenchState): string | undefined;
}


export class WorkspaceStatsService implements IWorkspaceStatsService {
	_serviceBrand: any;
	private _tags: Tags;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IWindowService private readonly windowService: IWindowService,
		@INotificationService private readonly notificationService: INotificationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IStorageService private readonly storageService: IStorageService,
		@ITextFileService private readonly textFileService: ITextFileService
	) { }

	public async getTags(): Promise<Tags> {
		if (!this._tags) {
			this._tags = await this.resolveWorkspaceTags(this.environmentService.configuration, rootFiles => this.handleWorkspaceFiles(rootFiles));
		}

		return this._tags;
	}

	public getTelemetryWorkspaceId(workspace: IWorkspace, state: WorkbenchState): string | undefined {
		function createHash(uri: URI): string {
			return crypto.createHash('sha1').update(uri.scheme === Schemas.file ? uri.fsPath : uri.toString()).digest('hex');
		}

		let workspaceId: string | undefined;
		switch (state) {
			case WorkbenchState.EMPTY:
				workspaceId = undefined;
				break;
			case WorkbenchState.FOLDER:
				workspaceId = createHash(workspace.folders[0].uri);
				break;
			case WorkbenchState.WORKSPACE:
				if (workspace.configuration) {
					workspaceId = createHash(workspace.configuration);
				}
		}

		return workspaceId;
	}

	/* __GDPR__FRAGMENT__
		"WorkspaceTags" : {
			"workbench.filesToOpenOrCreate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workbench.filesToDiff" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.id" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"workspace.roots" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.empty" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.grunt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gulp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.jake" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.tsconfig" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.jsconfig" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.config.xml" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.vsc.extension" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.asp<NUMBER>" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.sln" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.unity" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.express" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.sails" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.koa" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.hapi" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.socket.io" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.restify" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.rnpm-plugin-windows" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@angular/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vue" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.aws-sdk" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.aws-amplify-sdk" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.azure-storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@google-cloud/common" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.firebase" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.heroku-cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/office-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/office-js-helpers" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/office-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/office-runtime" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.office-ui-fabric-react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/icons" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/merge-styles" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/styling" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/experiments" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/utilities" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/rush" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.lerna" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.just-task" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.beachball" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.bower" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.yeoman.code.ext" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.cordova.high" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.cordova.low" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.xamarin.android" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.xamarin.ios" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.android.cpp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.reactNative" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.ionic" : { "classification" : "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": "true" },
			"workspace.nativeScript" : { "classification" : "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": "true" },
			"workspace.java.pom" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.requirements" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.requirements.star" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.Pipfile" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.conda" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.any-azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-storage-common" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-storage-blob" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-storage-file" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-storage-queue" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-mgmt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-shell" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pulumi-azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-cosmos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-devtools" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-elasticluster" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-eventgrid" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-functions" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-graphrbac" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-keyvault" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-loganalytics" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-monitor" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-servicebus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-servicefabric" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-translator" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-iothub-device-client" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-ml" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-cognitiveservices" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.adal" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pydocumentdb" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botbuilder-core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botbuilder-schema" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botframework-connector" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
		}
	*/
	private resolveWorkspaceTags(configuration: IWindowConfiguration, participant?: (rootFiles: string[]) => void): Promise<Tags> {
		const tags: Tags = Object.create(null);

		const state = this.contextService.getWorkbenchState();
		const workspace = this.contextService.getWorkspace();

		tags['workspace.id'] = this.getTelemetryWorkspaceId(workspace, state);

		const { filesToOpenOrCreate, filesToDiff } = configuration;
		tags['workbench.filesToOpenOrCreate'] = filesToOpenOrCreate && filesToOpenOrCreate.length || 0;
		tags['workbench.filesToDiff'] = filesToDiff && filesToDiff.length || 0;

		const isEmpty = state === WorkbenchState.EMPTY;
		tags['workspace.roots'] = isEmpty ? 0 : workspace.folders.length;
		tags['workspace.empty'] = isEmpty;

		const folders = !isEmpty ? workspace.folders.map(folder => folder.uri) : this.environmentService.appQuality !== 'stable' && this.findFolders(configuration);
		if (!folders || !folders.length || !this.fileService) {
			return Promise.resolve(tags);
		}

		return this.fileService.resolveAll(folders.map(resource => ({ resource }))).then((files: IResolveFileResult[]) => {
			const names = (<IFileStat[]>[]).concat(...files.map(result => result.success ? (result.stat!.children || []) : [])).map(c => c.name);
			const nameSet = names.reduce((s, n) => s.add(n.toLowerCase()), new Set());

			if (participant) {
				participant(names);
			}

			tags['workspace.grunt'] = nameSet.has('gruntfile.js');
			tags['workspace.gulp'] = nameSet.has('gulpfile.js');
			tags['workspace.jake'] = nameSet.has('jakefile.js');

			tags['workspace.tsconfig'] = nameSet.has('tsconfig.json');
			tags['workspace.jsconfig'] = nameSet.has('jsconfig.json');
			tags['workspace.config.xml'] = nameSet.has('config.xml');
			tags['workspace.vsc.extension'] = nameSet.has('vsc-extension-quickstart.md');

			tags['workspace.ASP5'] = nameSet.has('project.json') && this.searchArray(names, /^.+\.cs$/i);
			tags['workspace.sln'] = this.searchArray(names, /^.+\.sln$|^.+\.csproj$/i);
			tags['workspace.unity'] = nameSet.has('assets') && nameSet.has('library') && nameSet.has('projectsettings');
			tags['workspace.npm'] = nameSet.has('package.json') || nameSet.has('node_modules');
			tags['workspace.bower'] = nameSet.has('bower.json') || nameSet.has('bower_components');

			tags['workspace.java.pom'] = nameSet.has('pom.xml');

			tags['workspace.yeoman.code.ext'] = nameSet.has('vsc-extension-quickstart.md');

			tags['workspace.py.requirements'] = nameSet.has('requirements.txt');
			tags['workspace.py.requirements.star'] = this.searchArray(names, /^(.*)requirements(.*)\.txt$/i);
			tags['workspace.py.Pipfile'] = nameSet.has('pipfile');
			tags['workspace.py.conda'] = this.searchArray(names, /^environment(\.yml$|\.yaml$)/i);

			const mainActivity = nameSet.has('mainactivity.cs') || nameSet.has('mainactivity.fs');
			const appDelegate = nameSet.has('appdelegate.cs') || nameSet.has('appdelegate.fs');
			const androidManifest = nameSet.has('androidmanifest.xml');

			const platforms = nameSet.has('platforms');
			const plugins = nameSet.has('plugins');
			const www = nameSet.has('www');
			const properties = nameSet.has('properties');
			const resources = nameSet.has('resources');
			const jni = nameSet.has('jni');

			if (tags['workspace.config.xml'] &&
				!tags['workspace.language.cs'] && !tags['workspace.language.vb'] && !tags['workspace.language.aspx']) {
				if (platforms && plugins && www) {
					tags['workspace.cordova.high'] = true;
				} else {
					tags['workspace.cordova.low'] = true;
				}
			}

			if (tags['workspace.config.xml'] &&
				!tags['workspace.language.cs'] && !tags['workspace.language.vb'] && !tags['workspace.language.aspx']) {

				if (nameSet.has('ionic.config.json')) {
					tags['workspace.ionic'] = true;
				}
			}

			if (mainActivity && properties && resources) {
				tags['workspace.xamarin.android'] = true;
			}

			if (appDelegate && resources) {
				tags['workspace.xamarin.ios'] = true;
			}

			if (androidManifest && jni) {
				tags['workspace.android.cpp'] = true;
			}

			function getFilePromises(filename: string, fileService: IFileService, textFileService: ITextFileService, contentHandler: (content: ITextFileContent) => void): Promise<void>[] {
				return !nameSet.has(filename) ? [] : (folders as URI[]).map(workspaceUri => {
					const uri = workspaceUri.with({ path: `${workspaceUri.path !== '/' ? workspaceUri.path : ''}/${filename}` });
					return fileService.exists(uri).then(exists => {
						if (!exists) {
							return undefined;
						}

						return textFileService.read(uri, { acceptTextOnly: true }).then(contentHandler);
					}, err => {
						// Ignore missing file
					});
				});
			}

			function addPythonTags(packageName: string): void {
				if (PyModulesToLookFor.indexOf(packageName) > -1) {
					tags['workspace.py.' + packageName] = true;
				}
				// cognitive services has a lot of tiny packages. e.g. 'azure-cognitiveservices-search-autosuggest'
				if (packageName.indexOf('azure-cognitiveservices') > -1) {
					tags['workspace.py.azure-cognitiveservices'] = true;
				}
				if (packageName.indexOf('azure-mgmt') > -1) {
					tags['workspace.py.azure-mgmt'] = true;
				}
				if (packageName.indexOf('azure-ml') > -1) {
					tags['workspace.py.azure-ml'] = true;
				}
				if (!tags['workspace.py.any-azure']) {
					tags['workspace.py.any-azure'] = /azure/i.test(packageName);
				}
			}

			const requirementsTxtPromises = getFilePromises('requirements.txt', this.fileService, this.textFileService, content => {
				const dependencies: string[] = content.value.split(/\r\n|\r|\n/);
				for (let dependency of dependencies) {
					// Dependencies in requirements.txt can have 3 formats: `foo==3.1, foo>=3.1, foo`
					const format1 = dependency.split('==');
					const format2 = dependency.split('>=');
					const packageName = (format1.length === 2 ? format1[0] : format2[0]).trim();
					addPythonTags(packageName);
				}
			});

			const pipfilePromises = getFilePromises('pipfile', this.fileService, this.textFileService, content => {
				let dependencies: string[] = content.value.split(/\r\n|\r|\n/);

				// We're only interested in the '[packages]' section of the Pipfile
				dependencies = dependencies.slice(dependencies.indexOf('[packages]') + 1);

				for (let dependency of dependencies) {
					if (dependency.trim().indexOf('[') > -1) {
						break;
					}
					// All dependencies in Pipfiles follow the format: `<package> = <version, or git repo, or something else>`
					if (dependency.indexOf('=') === -1) {
						continue;
					}
					const packageName = dependency.split('=')[0].trim();
					addPythonTags(packageName);
				}

			});

			const packageJsonPromises = getFilePromises('package.json', this.fileService, this.textFileService, content => {
				try {
					const packageJsonContents = JSON.parse(content.value);
					let dependencies = packageJsonContents['dependencies'];
					let devDependencies = packageJsonContents['devDependencies'];
					for (let module of ModulesToLookFor) {
						if ('react-native' === module) {
							if ((dependencies && dependencies[module]) || (devDependencies && devDependencies[module])) {
								tags['workspace.reactNative'] = true;
							}
						} else if ('tns-core-modules' === module) {
							if ((dependencies && dependencies[module]) || (devDependencies && devDependencies[module])) {
								tags['workspace.nativescript'] = true;
							}
						} else {
							if ((dependencies && dependencies[module]) || (devDependencies && devDependencies[module])) {
								tags['workspace.npm.' + module] = true;
							}
						}
					}

				}
				catch (e) {
					// Ignore errors when resolving file or parsing file contents
				}
			});
			return Promise.all([...packageJsonPromises, ...requirementsTxtPromises, ...pipfilePromises]).then(() => tags);
		});
	}

	private handleWorkspaceFiles(rootFiles: string[]): void {
		const state = this.contextService.getWorkbenchState();
		const workspace = this.contextService.getWorkspace();

		// Handle top-level workspace files for local single folder workspace
		if (state === WorkbenchState.FOLDER) {
			const workspaceFiles = rootFiles.filter(hasWorkspaceFileExtension);
			if (workspaceFiles.length > 0) {
				this.doHandleWorkspaceFiles(workspace.folders[0].uri, workspaceFiles);
			}
		}
	}

	private doHandleWorkspaceFiles(folder: URI, workspaces: string[]): void {
		if (this.storageService.getBoolean(DISABLE_WORKSPACE_PROMPT_KEY, StorageScope.WORKSPACE)) {
			return; // prompt disabled by user
		}

		const doNotShowAgain: IPromptChoice = {
			label: localize('never again', "Don't Show Again"),
			isSecondary: true,
			run: () => this.storageService.store(DISABLE_WORKSPACE_PROMPT_KEY, true, StorageScope.WORKSPACE)
		};

		// Prompt to open one workspace
		if (workspaces.length === 1) {
			const workspaceFile = workspaces[0];

			this.notificationService.prompt(Severity.Info, localize('workspaceFound', "This folder contains a workspace file '{0}'. Do you want to open it? [Learn more]({1}) about workspace files.", workspaceFile, 'https://go.microsoft.com/fwlink/?linkid=2025315'), [{
				label: localize('openWorkspace', "Open Workspace"),
				run: () => this.windowService.openWindow([{ workspaceUri: joinPath(folder, workspaceFile) }])
			}, doNotShowAgain]);
		}

		// Prompt to select a workspace from many
		else if (workspaces.length > 1) {
			this.notificationService.prompt(Severity.Info, localize('workspacesFound', "This folder contains multiple workspace files. Do you want to open one? [Learn more]({0}) about workspace files.", 'https://go.microsoft.com/fwlink/?linkid=2025315'), [{
				label: localize('selectWorkspace', "Select Workspace"),
				run: () => {
					this.quickInputService.pick(
						workspaces.map(workspace => ({ label: workspace } as IQuickPickItem)),
						{ placeHolder: localize('selectToOpen', "Select a workspace to open") }).then(pick => {
							if (pick) {
								this.windowService.openWindow([{ workspaceUri: joinPath(folder, pick.label) }]);
							}
						});
				}
			}, doNotShowAgain]);
		}
	}

	private findFolders(configuration: IWindowConfiguration): URI[] | undefined {
		const folder = this.findFolder(configuration);
		return folder && [folder];
	}

	private findFolder({ filesToOpenOrCreate, filesToDiff }: IWindowConfiguration): URI | undefined {
		if (filesToOpenOrCreate && filesToOpenOrCreate.length) {
			return this.parentURI(filesToOpenOrCreate[0].fileUri);
		} else if (filesToDiff && filesToDiff.length) {
			return this.parentURI(filesToDiff[0].fileUri);
		}
		return undefined;
	}

	private parentURI(uri: URI | undefined): URI | undefined {
		if (!uri) {
			return undefined;
		}
		const path = uri.path;
		const i = path.lastIndexOf('/');
		return i !== -1 ? uri.with({ path: path.substr(0, i) }) : undefined;
	}

	private searchArray(arr: string[], regEx: RegExp): boolean | undefined {
		return arr.some(v => v.search(regEx) > -1) || undefined;
	}
}

registerSingleton(IWorkspaceStatsService, WorkspaceStatsService, true);
