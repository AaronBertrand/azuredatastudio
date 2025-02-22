/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, RunOnceScheduler, createCancelablePromise, disposableTimeout } from 'vs/base/common/async';
import { onUnexpectedError, onUnexpectedExternalError } from 'vs/base/common/errors';
import { toDisposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { StableEditorScrollState } from 'vs/editor/browser/core/editorState';
import * as editorBrowser from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IModelDecorationsChangeAccessor } from 'vs/editor/common/model';
import { CodeLensProviderRegistry, CodeLens } from 'vs/editor/common/modes';
import { CodeLensModel, getCodeLensData, CodeLensItem } from 'vs/editor/contrib/codelens/codelens';
import { CodeLensWidget, CodeLensHelper } from 'vs/editor/contrib/codelens/codelensWidget';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ICodeLensCache } from 'vs/editor/contrib/codelens/codeLensCache';

export class CodeLensContribution implements editorCommon.IEditorContribution {

	private static readonly ID: string = 'css.editor.codeLens';

	private _isEnabled: boolean;

	private readonly _globalToDispose = new DisposableStore();
	private readonly _localToDispose = new DisposableStore();
	private _lenses: CodeLensWidget[] = [];
	private _currentFindCodeLensSymbolsPromise: CancelablePromise<CodeLensModel> | undefined;
	private _oldCodeLensModels = new DisposableStore();
	private _currentCodeLensModel: CodeLensModel | undefined;
	private _modelChangeCounter: number = 0;
	private _currentResolveCodeLensSymbolsPromise: CancelablePromise<any> | undefined;
	private _detectVisibleLenses!: RunOnceScheduler;

	constructor(
		private readonly _editor: editorBrowser.ICodeEditor,
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ICodeLensCache private readonly _codeLensCache: ICodeLensCache
	) {
		this._isEnabled = this._editor.getConfiguration().contribInfo.codeLens;

		this._globalToDispose.add(this._editor.onDidChangeModel(() => this._onModelChange()));
		this._globalToDispose.add(this._editor.onDidChangeModelLanguage(() => this._onModelChange()));
		this._globalToDispose.add(this._editor.onDidChangeConfiguration(() => {
			const prevIsEnabled = this._isEnabled;
			this._isEnabled = this._editor.getConfiguration().contribInfo.codeLens;
			if (prevIsEnabled !== this._isEnabled) {
				this._onModelChange();
			}
		}));
		this._globalToDispose.add(CodeLensProviderRegistry.onDidChange(this._onModelChange, this));
		this._onModelChange();
	}

	dispose(): void {
		this._localDispose();
		this._globalToDispose.dispose();
		this._oldCodeLensModels.dispose();
		dispose(this._currentCodeLensModel);
	}

	private _localDispose(): void {
		if (this._currentFindCodeLensSymbolsPromise) {
			this._currentFindCodeLensSymbolsPromise.cancel();
			this._currentFindCodeLensSymbolsPromise = undefined;
			this._modelChangeCounter++;
		}
		if (this._currentResolveCodeLensSymbolsPromise) {
			this._currentResolveCodeLensSymbolsPromise.cancel();
			this._currentResolveCodeLensSymbolsPromise = undefined;
		}
		this._localToDispose.clear();
		this._oldCodeLensModels.clear();
		dispose(this._currentCodeLensModel);
	}

	getId(): string {
		return CodeLensContribution.ID;
	}

	private _onModelChange(): void {

		this._localDispose();

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		if (!this._isEnabled) {
			return;
		}

		const cachedLenses = this._codeLensCache.get(model);
		if (cachedLenses) {
			this._renderCodeLensSymbols(cachedLenses);
		}

		if (!CodeLensProviderRegistry.has(model)) {
			// no provider -> return but check with
			// cached lenses. they expire after 30 seconds
			if (cachedLenses) {
				this._localToDispose.add(disposableTimeout(() => {
					const cachedLensesNow = this._codeLensCache.get(model);
					if (cachedLenses === cachedLensesNow) {
						this._codeLensCache.delete(model);
						this._onModelChange();
					}
				}, 30 * 1000));
			}
			return;
		}

		for (const provider of CodeLensProviderRegistry.all(model)) {
			if (typeof provider.onDidChange === 'function') {
				let registration = provider.onDidChange(() => scheduler.schedule());
				this._localToDispose.add(registration);
			}
		}

		this._detectVisibleLenses = new RunOnceScheduler(() => {
			this._onViewportChanged();
		}, 250);

		const scheduler = new RunOnceScheduler(() => {
			const counterValue = ++this._modelChangeCounter;
			if (this._currentFindCodeLensSymbolsPromise) {
				this._currentFindCodeLensSymbolsPromise.cancel();
			}

			this._currentFindCodeLensSymbolsPromise = createCancelablePromise(token => getCodeLensData(model, token));

			this._currentFindCodeLensSymbolsPromise.then(result => {
				if (counterValue === this._modelChangeCounter) { // only the last one wins
					if (this._currentCodeLensModel) {
						this._oldCodeLensModels.add(this._currentCodeLensModel);
					}
					this._currentCodeLensModel = result;

					// cache model to reduce flicker
					this._codeLensCache.put(model, result);

					// render lenses
					this._renderCodeLensSymbols(result);
					this._detectVisibleLenses.schedule();
				}
			}, onUnexpectedError);
		}, 250);
		this._localToDispose.add(scheduler);
		this._localToDispose.add(this._detectVisibleLenses);
		this._localToDispose.add(this._editor.onDidChangeModelContent(() => {
			this._editor.changeDecorations(decorationsAccessor => {
				this._editor.changeViewZones(viewZonesAccessor => {
					let toDispose: CodeLensWidget[] = [];
					let lastLensLineNumber: number = -1;

					this._lenses.forEach((lens) => {
						if (!lens.isValid() || lastLensLineNumber === lens.getLineNumber()) {
							// invalid -> lens collapsed, attach range doesn't exist anymore
							// line_number -> lenses should never be on the same line
							toDispose.push(lens);

						} else {
							lens.update(viewZonesAccessor);
							lastLensLineNumber = lens.getLineNumber();
						}
					});

					let helper = new CodeLensHelper();
					toDispose.forEach((l) => {
						l.dispose(helper, viewZonesAccessor);
						this._lenses.splice(this._lenses.indexOf(l), 1);
					});
					helper.commit(decorationsAccessor);
				});
			});

			// Compute new `visible` code lenses
			this._detectVisibleLenses.schedule();
			// Ask for all references again
			scheduler.schedule();
		}));
		this._localToDispose.add(this._editor.onDidScrollChange(e => {
			if (e.scrollTopChanged && this._lenses.length > 0) {
				this._detectVisibleLenses.schedule();
			}
		}));
		this._localToDispose.add(this._editor.onDidLayoutChange(() => {
			this._detectVisibleLenses.schedule();
		}));
		this._localToDispose.add(toDisposable(() => {
			if (this._editor.getModel()) {
				const scrollState = StableEditorScrollState.capture(this._editor);
				this._editor.changeDecorations(decorationsAccessor => {
					this._editor.changeViewZones(viewZonesAccessor => {
						this._disposeAllLenses(decorationsAccessor, viewZonesAccessor);
					});
				});
				scrollState.restore(this._editor);
			} else {
				// No accessors available
				this._disposeAllLenses(undefined, undefined);
			}
		}));
		this._localToDispose.add(this._editor.onDidChangeConfiguration(e => {
			if (e.fontInfo) {
				for (const lens of this._lenses) {
					lens.updateHeight();
				}
			}
		}));
		this._localToDispose.add(this._editor.onMouseUp(e => {
			if (e.target.type === editorBrowser.MouseTargetType.CONTENT_WIDGET && e.target.element && e.target.element.tagName === 'A') {
				for (const lens of this._lenses) {
					let command = lens.getCommand(e.target.element as HTMLLinkElement);
					if (command) {
						this._commandService.executeCommand(command.id, ...(command.arguments || [])).catch(err => this._notificationService.error(err));
						break;
					}
				}
			}
		}));
		scheduler.schedule();
	}

	private _disposeAllLenses(decChangeAccessor: IModelDecorationsChangeAccessor | undefined, viewZoneChangeAccessor: editorBrowser.IViewZoneChangeAccessor | undefined): void {
		let helper = new CodeLensHelper();
		this._lenses.forEach((lens) => lens.dispose(helper, viewZoneChangeAccessor));
		if (decChangeAccessor) {
			helper.commit(decChangeAccessor);
		}
		this._lenses = [];
	}

	private _renderCodeLensSymbols(symbols: CodeLensModel): void {
		if (!this._editor.hasModel()) {
			return;
		}

		let maxLineNumber = this._editor.getModel().getLineCount();
		let groups: CodeLensItem[][] = [];
		let lastGroup: CodeLensItem[] | undefined;

		for (let symbol of symbols.lenses) {
			let line = symbol.symbol.range.startLineNumber;
			if (line < 1 || line > maxLineNumber) {
				// invalid code lens
				continue;
			} else if (lastGroup && lastGroup[lastGroup.length - 1].symbol.range.startLineNumber === line) {
				// on same line as previous
				lastGroup.push(symbol);
			} else {
				// on later line as previous
				lastGroup = [symbol];
				groups.push(lastGroup);
			}
		}

		const scrollState = StableEditorScrollState.capture(this._editor);

		this._editor.changeDecorations(decorationsAccessor => {
			this._editor.changeViewZones(viewZoneAccessor => {

				const helper = new CodeLensHelper();
				let codeLensIndex = 0;
				let groupsIndex = 0;

				while (groupsIndex < groups.length && codeLensIndex < this._lenses.length) {

					let symbolsLineNumber = groups[groupsIndex][0].symbol.range.startLineNumber;
					let codeLensLineNumber = this._lenses[codeLensIndex].getLineNumber();

					if (codeLensLineNumber < symbolsLineNumber) {
						this._lenses[codeLensIndex].dispose(helper, viewZoneAccessor);
						this._lenses.splice(codeLensIndex, 1);
					} else if (codeLensLineNumber === symbolsLineNumber) {
						this._lenses[codeLensIndex].updateCodeLensSymbols(groups[groupsIndex], helper);
						groupsIndex++;
						codeLensIndex++;
					} else {
						this._lenses.splice(codeLensIndex, 0, new CodeLensWidget(groups[groupsIndex], this._editor, helper, viewZoneAccessor, () => this._detectVisibleLenses.schedule()));
						codeLensIndex++;
						groupsIndex++;
					}
				}

				// Delete extra code lenses
				while (codeLensIndex < this._lenses.length) {
					this._lenses[codeLensIndex].dispose(helper, viewZoneAccessor);
					this._lenses.splice(codeLensIndex, 1);
				}

				// Create extra symbols
				while (groupsIndex < groups.length) {
					this._lenses.push(new CodeLensWidget(groups[groupsIndex], this._editor, helper, viewZoneAccessor, () => this._detectVisibleLenses.schedule()));
					groupsIndex++;
				}

				helper.commit(decorationsAccessor);
			});
		});

		scrollState.restore(this._editor);
	}

	private _onViewportChanged(): void {
		if (this._currentResolveCodeLensSymbolsPromise) {
			this._currentResolveCodeLensSymbolsPromise.cancel();
			this._currentResolveCodeLensSymbolsPromise = undefined;
		}

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		const toResolve: CodeLensItem[][] = [];
		const lenses: CodeLensWidget[] = [];
		this._lenses.forEach((lens) => {
			const request = lens.computeIfNecessary(model);
			if (request) {
				toResolve.push(request);
				lenses.push(lens);
			}
		});

		if (toResolve.length === 0) {
			return;
		}

		this._currentResolveCodeLensSymbolsPromise = createCancelablePromise(token => {

			const promises = toResolve.map((request, i) => {

				const resolvedSymbols = new Array<CodeLens | undefined | null>(request.length);
				const promises = request.map((request, i) => {
					if (!request.symbol.command && typeof request.provider.resolveCodeLens === 'function') {
						return Promise.resolve(request.provider.resolveCodeLens(model, request.symbol, token)).then(symbol => {
							resolvedSymbols[i] = symbol;
						}, onUnexpectedExternalError);
					} else {
						resolvedSymbols[i] = request.symbol;
						return Promise.resolve(undefined);
					}
				});

				return Promise.all(promises).then(() => {
					if (!token.isCancellationRequested) {
						lenses[i].updateCommands(resolvedSymbols);
					}
				});
			});

			return Promise.all(promises);
		});

		this._currentResolveCodeLensSymbolsPromise.then(() => {
			this._oldCodeLensModels.clear(); // dispose old models once we have updated the UI with the current model
			this._currentResolveCodeLensSymbolsPromise = undefined;
		}, err => {
			onUnexpectedError(err); // can also be cancellation!
			this._currentResolveCodeLensSymbolsPromise = undefined;
		});
	}
}

registerEditorContribution(CodeLensContribution);
