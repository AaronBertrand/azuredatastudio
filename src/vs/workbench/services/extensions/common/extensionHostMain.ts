/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from 'vs/base/common/async';
import * as errors from 'vs/base/common/errors';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI, setUriThrowOnMissingScheme } from 'vs/base/common/uri';
import { IURITransformer } from 'vs/base/common/uriIpc';
import { IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import { IInitData, MainContext, MainThreadConsoleShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostLogService } from 'vs/workbench/api/common/extHostLogService';
import { RPCProtocol } from 'vs/workbench/services/extensions/common/rpcProtocol';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { getSingletonServiceDescriptors } from 'vs/platform/instantiation/common/extensions';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostRpcService, ExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { IURITransformerService, URITransformerService } from 'vs/workbench/api/common/extHostUriTransformerService';
import { IExtHostExtensionService, IHostUtils } from 'vs/workbench/api/common/extHostExtensionService';

// we don't (yet) throw when extensions parse
// uris that have no scheme
setUriThrowOnMissingScheme(false);

export interface IExitFn {
	(code?: number): any;
}

export interface IConsolePatchFn {
	(mainThreadConsole: MainThreadConsoleShape): any;
}

export interface ILogServiceFn {
	(initData: IInitData): ILogService;
}

export class ExtensionHostMain {

	private _isTerminating: boolean;
	private readonly _hostUtils: IHostUtils;
	private readonly _extensionService: IExtHostExtensionService;
	private readonly _disposables = new DisposableStore();

	constructor(
		protocol: IMessagePassingProtocol,
		initData: IInitData,
		hostUtils: IHostUtils,
		consolePatchFn: IConsolePatchFn,
		logServiceFn: ILogServiceFn,
		uriTransformer: IURITransformer | null
	) {
		this._isTerminating = false;
		this._hostUtils = hostUtils;
		const rpcProtocol = new RPCProtocol(protocol, null, uriTransformer);

		// ensure URIs are transformed and revived
		initData = ExtensionHostMain._transform(initData, rpcProtocol);

		// allow to patch console
		consolePatchFn(rpcProtocol.getProxy(MainContext.MainThreadConsole));

		// services
		const extHostLogService = new ExtHostLogService(logServiceFn(initData), initData.logsLocation.fsPath);
		this._disposables.add(extHostLogService);

		// bootstrap services
		const services = new ServiceCollection(...getSingletonServiceDescriptors());
		services.set(IExtHostInitDataService, { _serviceBrand: undefined, ...initData });
		services.set(IExtHostRpcService, new ExtHostRpcService(rpcProtocol));
		services.set(ILogService, extHostLogService);
		services.set(IURITransformerService, new URITransformerService(uriTransformer));
		services.set(IHostUtils, hostUtils);

		const instaService: IInstantiationService = new InstantiationService(services, true);

		extHostLogService.info('extension host started');
		extHostLogService.trace('initData', initData);

		// todo@joh -> not soo nice...
		this._extensionService = instaService.invokeFunction(accessor => accessor.get(IExtHostExtensionService));
		this._extensionService.initialize();

		// error forwarding and stack trace scanning
		Error.stackTraceLimit = 100; // increase number of stack frames (from 10, https://github.com/v8/v8/wiki/Stack-Trace-API)
		const extensionErrors = new WeakMap<Error, IExtensionDescription>();
		this._extensionService.getExtensionPathIndex().then(map => {
			(<any>Error).prepareStackTrace = (error: Error, stackTrace: errors.V8CallSite[]) => {
				let stackTraceMessage = '';
				let extension: IExtensionDescription | undefined;
				let fileName: string;
				for (const call of stackTrace) {
					stackTraceMessage += `\n\tat ${call.toString()}`;
					fileName = call.getFileName();
					if (!extension && fileName) {
						extension = map.findSubstr(fileName);
					}

				}
				extensionErrors.set(error, extension);
				return `${error.name || 'Error'}: ${error.message || ''}${stackTraceMessage}`;
			};
		});

		const mainThreadExtensions = rpcProtocol.getProxy(MainContext.MainThreadExtensionService);
		const mainThreadErrors = rpcProtocol.getProxy(MainContext.MainThreadErrors);
		errors.setUnexpectedErrorHandler(err => {
			const data = errors.transformErrorForSerialization(err);
			const extension = extensionErrors.get(err);
			if (extension) {
				mainThreadExtensions.$onExtensionRuntimeError(extension.identifier, data);
			} else {
				mainThreadErrors.$onUnexpectedError(data);
			}
		});
	}

	terminate(): void {
		if (this._isTerminating) {
			// we are already shutting down...
			return;
		}
		this._isTerminating = true;

		this._disposables.dispose();

		errors.setUnexpectedErrorHandler((err) => {
			// TODO: write to log once we have one
		});

		const extensionsDeactivated = this._extensionService.deactivateAll();

		// Give extensions 1 second to wrap up any async dispose, then exit in at most 4 seconds
		setTimeout(() => {
			Promise.race([timeout(4000), extensionsDeactivated]).finally(() => this._hostUtils.exit());
		}, 1000);
	}

	private static _transform(initData: IInitData, rpcProtocol: RPCProtocol): IInitData {
		initData.extensions.forEach((ext) => (<any>ext).extensionLocation = URI.revive(rpcProtocol.transformIncomingURIs(ext.extensionLocation)));
		initData.environment.appRoot = URI.revive(rpcProtocol.transformIncomingURIs(initData.environment.appRoot));
		initData.environment.appSettingsHome = URI.revive(rpcProtocol.transformIncomingURIs(initData.environment.appSettingsHome));
		const extDevLocs = initData.environment.extensionDevelopmentLocationURI;
		if (extDevLocs) {
			initData.environment.extensionDevelopmentLocationURI = extDevLocs.map(url => URI.revive(rpcProtocol.transformIncomingURIs(url)));
		}
		initData.environment.extensionTestsLocationURI = URI.revive(rpcProtocol.transformIncomingURIs(initData.environment.extensionTestsLocationURI));
		initData.environment.globalStorageHome = URI.revive(rpcProtocol.transformIncomingURIs(initData.environment.globalStorageHome));
		initData.environment.userHome = URI.revive(rpcProtocol.transformIncomingURIs(initData.environment.userHome));
		initData.logsLocation = URI.revive(rpcProtocol.transformIncomingURIs(initData.logsLocation));
		initData.workspace = rpcProtocol.transformIncomingURIs(initData.workspace);
		return initData;
	}
}
