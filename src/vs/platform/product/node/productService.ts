/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductService } from 'vs/platform/product/common/product';
import product from 'vs/platform/product/node/product';
import pkg from 'vs/platform/product/node/package';
import { ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';

export class ProductService implements IProductService {

	_serviceBrand!: ServiceIdentifier<IProductService>;

	get version(): string { return pkg.version; }

	get vscodeVersion(): string { return '1.35.0'; } // {{SQL CARBON EDIT}} add vscodeversion

	get recommendedExtensionsByScenario(): { [area: string]: Array<string> } { return product.recommendedExtensionsByScenario; }// {{SQL CARBON EDIT}} add getter

	get commit(): string | undefined { return product.commit; }

	get nameLong(): string { return product.nameLong; }

	get urlProtocol(): string { return product.urlProtocol; }

	get extensionAllowedProposedApi(): readonly string[] { return product.extensionAllowedProposedApi; }

	get uiExtensions(): readonly string[] | undefined { return product.uiExtensions; }

	get enableTelemetry(): boolean { return product.enableTelemetry; }

	get sendASmile(): { reportIssueUrl: string, requestFeatureUrl: string } { return product.sendASmile; }

	get extensionsGallery() { return product.extensionsGallery; }

	get settingsSearchBuildId(): number | undefined { return product.settingsSearchBuildId; }

	get settingsSearchUrl(): string | undefined { return product.settingsSearchUrl; }

	get experimentsUrl(): string | undefined { return product.experimentsUrl; }

	get extensionKeywords(): { [extension: string]: readonly string[]; } | undefined { return product.extensionKeywords; }

	get extensionAllowedBadgeProviders(): readonly string[] | undefined { return product.extensionAllowedBadgeProviders; }
}
