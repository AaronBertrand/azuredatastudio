/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UriComponents } from 'vs/base/common/uri';
import { ProcessItem } from 'vs/base/common/processes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IMainProcessInfo } from 'vs/platform/launch/common/launchService';
import { IWorkspace } from 'vs/platform/workspace/common/workspace';
import { IStringDictionary } from 'vs/base/common/collections';

export interface IMachineInfo {
	os: string;
	cpus?: string;
	memory: string;
	vmHint: string;
}

export interface IDiagnosticInfo {
	machineInfo: IMachineInfo;
	workspaceMetadata?: IStringDictionary<WorkspaceStats>;
	processes?: ProcessItem;
}
export interface SystemInfo extends IMachineInfo {
	processArgs: string;
	gpuStatus: any;
	screenReader: string;
	remoteData: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[];
	load?: string;
}

export interface IRemoteDiagnosticInfo extends IDiagnosticInfo {
	hostName: string;
}

export interface IRemoteDiagnosticError {
	hostName: string;
	errorMessage: string;
}

export interface IDiagnosticInfoOptions {
	includeProcesses?: boolean;
	folders?: UriComponents[];
	includeExtensions?: boolean;
}

export interface WorkspaceStatItem {
	name: string;
	count: number;
}

export interface WorkspaceStats {
	fileTypes: WorkspaceStatItem[];
	configFiles: WorkspaceStatItem[];
	fileCount: number;
	maxFilesReached: boolean;
	launchConfigFiles: WorkspaceStatItem[];
}

export interface PerformanceInfo {
	processInfo?: string;
	workspaceInfo?: string;
}

export interface IWorkspaceInformation extends IWorkspace {
	telemetryId: string | undefined;
}

export const ID = 'diagnosticsService';
export const IDiagnosticsService = createDecorator<IDiagnosticsService>(ID);

export interface IDiagnosticsService {
	_serviceBrand: any;

	getPerformanceInfo(mainProcessInfo: IMainProcessInfo, remoteInfo: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<PerformanceInfo>;
	getSystemInfo(mainProcessInfo: IMainProcessInfo, remoteInfo: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<SystemInfo>;
	getDiagnostics(mainProcessInfo: IMainProcessInfo, remoteInfo: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<string>;
	reportWorkspaceStats(workspace: IWorkspaceInformation): Promise<void>;
}

export function isRemoteDiagnosticError(x: any): x is IRemoteDiagnosticError {
	return !!x.hostName && !!x.errorMessage;
}
