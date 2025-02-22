/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductService, IProductConfiguration } from 'vs/platform/product/common/product';
import { ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';

export class ProductService implements IProductService {

	_serviceBrand!: ServiceIdentifier<IProductService>;

	private readonly productConfiguration: IProductConfiguration | null;

	constructor() {
		const element = document.getElementById('vscode-remote-product-configuration');
		this.productConfiguration = element ? JSON.parse(element.getAttribute('data-settings')!) : null;
	}

	get version(): string { return this.productConfiguration && this.productConfiguration.version ? this.productConfiguration.version : '1.38.0-unknown'; }

	get vscodeVersion(): string { return '1.35.0'; } // {{SQL CARBON EDIT}} add vscodeversion

	get recommendedExtensionsByScenario(): { [area: string]: Array<string> } { return this.productConfiguration.recommendedExtensionsByScenario; }// {{SQL CARBON EDIT}} add getter

	get commit(): string | undefined { return this.productConfiguration ? this.productConfiguration.commit : undefined; }

	get nameLong(): string { return this.productConfiguration ? this.productConfiguration.nameLong : 'Unknown'; }

	get urlProtocol(): string { return ''; }

	get extensionAllowedProposedApi(): readonly string[] { return this.productConfiguration ? this.productConfiguration.extensionAllowedProposedApi : []; }

	get uiExtensions(): readonly string[] | undefined { return this.productConfiguration ? this.productConfiguration.uiExtensions : undefined; }

	get enableTelemetry(): boolean { return false; }

	get sendASmile(): { reportIssueUrl: string, requestFeatureUrl: string } | undefined { return this.productConfiguration ? this.productConfiguration.sendASmile : undefined; }

	get extensionsGallery() { return this.productConfiguration ? this.productConfiguration.extensionsGallery : undefined; }

	get settingsSearchBuildId(): number | undefined { return this.productConfiguration ? this.productConfiguration.settingsSearchBuildId : undefined; }

	get settingsSearchUrl(): string | undefined { return this.productConfiguration ? this.productConfiguration.settingsSearchUrl : undefined; }

	get experimentsUrl(): string | undefined { return this.productConfiguration ? this.productConfiguration.experimentsUrl : undefined; }

	get extensionKeywords(): { [extension: string]: readonly string[]; } | undefined { return this.productConfiguration ? this.productConfiguration.extensionKeywords : undefined; }

	get extensionAllowedBadgeProviders(): readonly string[] | undefined { return this.productConfiguration ? this.productConfiguration.extensionAllowedBadgeProviders : undefined; }

	get aiConfig() { return this.productConfiguration ? this.productConfiguration.aiConfig : undefined; }
}
