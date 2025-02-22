/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function entrypoint (name) {
	return [{ name: name, include: [], exclude: ['vs/css', 'vs/nls'] }];
}

exports.base = [{
	name: 'vs/base/common/worker/simpleWorker',
	include: ['vs/editor/common/services/editorSimpleWorker'],
	prepend: ['vs/loader.js'],
	append: ['vs/base/worker/workerMain'],
	dest: 'vs/base/worker/workerMain.js'
}];

exports.serviceWorker = [{
	name: 'vs/workbench/contrib/resources/browser/resourceServiceWorker',
	// include: ['vs/editor/common/services/editorSimpleWorker'],
	prepend: ['vs/loader.js'],
	append: ['vs/workbench/contrib/resources/browser/resourceServiceWorkerMain'],
	dest: 'vs/workbench/contrib/resources/browser/resourceServiceWorkerMain.js'
}];

exports.workbench = require('./vs/workbench/buildfile').collectModules(['vs/workbench/workbench.desktop.main']);
exports.workbenchWeb = entrypoint('vs/workbench/workbench.web.api');

exports.keyboardMaps = [
	entrypoint('vs/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.linux'),
	entrypoint('vs/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.darwin'),
	entrypoint('vs/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.win')
];

exports.code = require('./vs/code/buildfile').collectModules();

exports.entrypoint = entrypoint;
