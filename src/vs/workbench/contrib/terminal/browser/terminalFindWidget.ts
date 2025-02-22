/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SimpleFindWidget } from 'vs/workbench/contrib/codeEditor/browser/find/simpleFindWidget';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { ITerminalService, KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_INPUT_FOCUSED, KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_FOCUSED } from 'vs/workbench/contrib/terminal/common/terminal';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';

export class TerminalFindWidget extends SimpleFindWidget {
	protected _findInputFocused: IContextKey<boolean>;
	protected _findWidgetFocused: IContextKey<boolean>;

	constructor(
		findState: FindReplaceState,
		@IContextViewService _contextViewService: IContextViewService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(_contextViewService, _contextKeyService, findState, true, true);
		this._register(findState.onFindReplaceStateChange(() => {
			this.show();
		}));
		this._findInputFocused = KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_INPUT_FOCUSED.bindTo(this._contextKeyService);
		this._findWidgetFocused = KEYBINDING_CONTEXT_TERMINAL_FIND_WIDGET_FOCUSED.bindTo(this._contextKeyService);
	}

	public find(previous: boolean) {
		const instance = this._terminalService.getActiveInstance();
		if (instance !== null) {
			if (previous) {
				instance.findPrevious(this.inputValue, { regex: this._getRegexValue(), wholeWord: this._getWholeWordValue(), caseSensitive: this._getCaseSensitiveValue() });
			} else {
				instance.findNext(this.inputValue, { regex: this._getRegexValue(), wholeWord: this._getWholeWordValue(), caseSensitive: this._getCaseSensitiveValue() });
			}
		}
	}

	public hide() {
		super.hide();
		const instance = this._terminalService.getActiveInstance();
		if (instance) {
			instance.focus();
		}
	}

	protected onInputChanged() {
		// Ignore input changes for now
		const instance = this._terminalService.getActiveInstance();
		if (instance !== null) {
			return instance.findPrevious(this.inputValue, { regex: this._getRegexValue(), wholeWord: this._getWholeWordValue(), caseSensitive: this._getCaseSensitiveValue(), incremental: true });
		}
		return false;
	}

	protected onFocusTrackerFocus() {
		const instance = this._terminalService.getActiveInstance();
		if (instance) {
			instance.notifyFindWidgetFocusChanged(true);
		}
		this._findWidgetFocused.set(true);
	}

	protected onFocusTrackerBlur() {
		const instance = this._terminalService.getActiveInstance();
		if (instance) {
			instance.notifyFindWidgetFocusChanged(false);
		}
		this._findWidgetFocused.reset();
	}

	protected onFindInputFocusTrackerFocus() {
		this._findInputFocused.set(true);
	}

	protected onFindInputFocusTrackerBlur() {
		this._findInputFocused.reset();
	}

	public findFirst() {
		const instance = this._terminalService.getActiveInstance();
		if (instance) {
			if (instance.hasSelection()) {
				instance.clearSelection();
			}
			instance.findPrevious(this.inputValue, { regex: this._getRegexValue(), wholeWord: this._getWholeWordValue(), caseSensitive: this._getCaseSensitiveValue() });
		}
	}
}
