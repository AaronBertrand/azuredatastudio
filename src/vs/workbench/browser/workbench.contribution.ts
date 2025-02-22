/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import * as nls from 'vs/nls';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { isMacintosh, isWindows, isLinux, isWeb } from 'vs/base/common/platform';

// Configuration
(function registerConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	// Workbench
	registry.registerConfiguration({
		'id': 'workbench',
		'order': 7,
		'title': nls.localize('workbenchConfigurationTitle', "Workbench"),
		'type': 'object',
		'properties': {
			'workbench.editor.showTabs': {
				'type': 'boolean',
				'description': nls.localize('showEditorTabs', "Controls whether opened editors should show in tabs or not."),
				'default': true
			},
			'workbench.editor.highlightModifiedTabs': {
				'type': 'boolean',
				'description': nls.localize('highlightModifiedTabs', "Controls whether a top border is drawn on modified (dirty) editor tabs or not."),
				'default': false
			},
			'workbench.editor.labelFormat': {
				'type': 'string',
				'enum': ['default', 'short', 'medium', 'long'],
				'enumDescriptions': [
					nls.localize('workbench.editor.labelFormat.default', "Show the name of the file. When tabs are enabled and two files have the same name in one group the distinguishing sections of each file's path are added. When tabs are disabled, the path relative to the workspace folder is shown if the editor is active."),
					nls.localize('workbench.editor.labelFormat.short', "Show the name of the file followed by its directory name."),
					nls.localize('workbench.editor.labelFormat.medium', "Show the name of the file followed by its path relative to the workspace folder."),
					nls.localize('workbench.editor.labelFormat.long', "Show the name of the file followed by its absolute path.")
				],
				'default': 'default',
				'description': nls.localize({
					comment: ['This is the description for a setting. Values surrounded by parenthesis are not to be translated.'],
					key: 'tabDescription'
				}, "Controls the format of the label for an editor."),
			},
			'workbench.editor.tabCloseButton': {
				'type': 'string',
				'enum': ['left', 'right', 'off'],
				'default': 'right',
				'description': nls.localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'editorTabCloseButton' }, "Controls the position of the editor's tabs close buttons, or disables them when set to 'off'.")
			},
			'workbench.editor.tabSizing': {
				'type': 'string',
				'enum': ['fit', 'shrink'],
				'default': 'fit',
				'enumDescriptions': [
					nls.localize('workbench.editor.tabSizing.fit', "Always keep tabs large enough to show the full editor label."),
					nls.localize('workbench.editor.tabSizing.shrink', "Allow tabs to get smaller when the available space is not enough to show all tabs at once.")
				],
				'description': nls.localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'tabSizing' }, "Controls the sizing of editor tabs.")
			},
			'workbench.editor.focusRecentEditorAfterClose': {
				'type': 'boolean',
				'description': nls.localize('focusRecentEditorAfterClose', "Controls whether tabs are closed in most recently used order or from left to right."),
				'default': true
			},
			'workbench.editor.showIcons': {
				'type': 'boolean',
				'description': nls.localize('showIcons', "Controls whether opened editors should show with an icon or not. This requires an icon theme to be enabled as well."),
				'default': true
			},
			'workbench.editor.enablePreview': {
				'type': 'boolean',
				'description': nls.localize('enablePreview', "Controls whether opened editors show as preview. Preview editors are reused until they are pinned (e.g. via double click or editing) and show up with an italic font style."),
				'default': true
			},
			'workbench.editor.enablePreviewFromQuickOpen': {
				'type': 'boolean',
				'description': nls.localize('enablePreviewFromQuickOpen', "Controls whether opened editors from Quick Open show as preview. Preview editors are reused until they are pinned (e.g. via double click or editing)."),
				'default': true
			},
			'workbench.editor.closeOnFileDelete': {
				'type': 'boolean',
				'description': nls.localize('closeOnFileDelete', "Controls whether editors showing a file that was opened during the session should close automatically when getting deleted or renamed by some other process. Disabling this will keep the editor open  on such an event. Note that deleting from within the application will always close the editor and that dirty files will never close to preserve your data."),
				'default': false
			},
			'workbench.editor.openPositioning': {
				'type': 'string',
				'enum': ['left', 'right', 'first', 'last'],
				'default': 'right',
				'markdownDescription': nls.localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'editorOpenPositioning' }, "Controls where editors open. Select `left` or `right` to open editors to the left or right of the currently active one. Select `first` or `last` to open editors independently from the currently active one.")
			},
			'workbench.editor.openSideBySideDirection': {
				'type': 'string',
				'enum': ['right', 'down'],
				'default': 'right',
				'markdownDescription': nls.localize('sideBySideDirection', "Controls the default direction of editors that are opened side by side (e.g. from the explorer). By default, editors will open on the right hand side of the currently active one. If changed to `down`, the editors will open below the currently active one.")
			},
			'workbench.editor.closeEmptyGroups': {
				'type': 'boolean',
				'description': nls.localize('closeEmptyGroups', "Controls the behavior of empty editor groups when the last tab in the group is closed. When enabled, empty groups will automatically close. When disabled, empty groups will remain part of the grid."),
				'default': true
			},
			'workbench.editor.revealIfOpen': {
				'type': 'boolean',
				'description': nls.localize('revealIfOpen', "Controls whether an editor is revealed in any of the visible groups if opened. If disabled, an editor will prefer to open in the currently active editor group. If enabled, an already opened editor will be revealed instead of opened again in the currently active editor group. Note that there are some cases where this setting is ignored, e.g. when forcing an editor to open in a specific group or to the side of the currently active group."),
				'default': false
			},
			'workbench.editor.mouseBackForwardToNavigate': {
				'type': 'boolean',
				'description': nls.localize('mouseBackForwardToNavigate', "Navigate between open files using mouse buttons four and five if provided."),
				'default': true,
				'included': !isMacintosh
			},
			'workbench.editor.restoreViewState': {
				'type': 'boolean',
				'description': nls.localize('restoreViewState', "Restores the last view state (e.g. scroll position) when re-opening files after they have been closed."),
				'default': true,
			},
			'workbench.editor.centeredLayoutAutoResize': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('centeredLayoutAutoResize', "Controls if the centered layout should automatically resize to maximum width when more than one group is open. Once only one group is open it will resize back to the original centered width.")
			},
			'workbench.commandPalette.history': {
				'type': 'number',
				'description': nls.localize('commandHistory', "Controls the number of recently used commands to keep in history for the command palette. Set to 0 to disable command history."),
				'default': 50
			},
			'workbench.commandPalette.preserveInput': {
				'type': 'boolean',
				'description': nls.localize('preserveInput', "Controls whether the last typed input to the command palette should be restored when opening it the next time."),
				'default': false
			},
			'workbench.quickOpen.closeOnFocusLost': {
				'type': 'boolean',
				'description': nls.localize('closeOnFocusLost', "Controls whether Quick Open should close automatically once it loses focus."),
				'default': true
			},
			'workbench.quickOpen.preserveInput': {
				'type': 'boolean',
				'description': nls.localize('workbench.quickOpen.preserveInput', "Controls whether the last typed input to Quick Open should be restored when opening it the next time."),
				'default': false
			},
			'workbench.settings.openDefaultSettings': {
				'type': 'boolean',
				'description': nls.localize('openDefaultSettings', "Controls whether opening settings also opens an editor showing all default settings."),
				'default': false
			},
			'workbench.settings.useSplitJSON': {
				'type': 'boolean',
				'markdownDescription': nls.localize('useSplitJSON', "Controls whether to use the split JSON editor when editing settings as JSON."),
				'default': false
			},
			'workbench.settings.openDefaultKeybindings': {
				'type': 'boolean',
				'description': nls.localize('openDefaultKeybindings', "Controls whether opening keybinding settings also opens an editor showing all default keybindings."),
				'default': false
			},
			'workbench.sideBar.location': {
				'type': 'string',
				'enum': ['left', 'right'],
				'default': 'left',
				'description': nls.localize('sideBarLocation', "Controls the location of the sidebar. It can either show on the left or right of the workbench.")
			},
			'workbench.panel.defaultLocation': {
				'type': 'string',
				'enum': ['bottom', 'right'],
				'default': 'bottom',
				'description': nls.localize('panelDefaultLocation', "Controls the default location of the panel (terminal, debug console, output, problems). It can either show at the bottom or on the right of the workbench.")
			},
			'workbench.statusBar.visible': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('statusBarVisibility', "Controls the visibility of the status bar at the bottom of the workbench.")
			},
			'workbench.activityBar.visible': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('activityBarVisibility', "Controls the visibility of the activity bar in the workbench.")
			},
			'workbench.view.alwaysShowHeaderActions': {
				'type': 'boolean',
				'default': false,
				'description': nls.localize('viewVisibility', "Controls the visibility of view header actions. View header actions may either be always visible, or only visible when that view is focused or hovered over.")
			},
			'workbench.fontAliasing': {
				'type': 'string',
				'enum': ['default', 'antialiased', 'none', 'auto'],
				'default': 'default',
				'description':
					nls.localize('fontAliasing', "Controls font aliasing method in the workbench."),
				'enumDescriptions': [
					nls.localize('workbench.fontAliasing.default', "Sub-pixel font smoothing. On most non-retina displays this will give the sharpest text."),
					nls.localize('workbench.fontAliasing.antialiased', "Smooth the font on the level of the pixel, as opposed to the subpixel. Can make the font appear lighter overall."),
					nls.localize('workbench.fontAliasing.none', "Disables font smoothing. Text will show with jagged sharp edges."),
					nls.localize('workbench.fontAliasing.auto', "Applies `default` or `antialiased` automatically based on the DPI of displays.")
				],
				'included': isMacintosh
			},
			'workbench.settings.enableNaturalLanguageSearch': {
				'type': 'boolean',
				'description': nls.localize('enableNaturalLanguageSettingsSearch', "Controls whether to enable the natural language search mode for settings. The natural language search is provided by a Microsoft online service."),
				'default': true,
				'scope': ConfigurationScope.WINDOW,
				'tags': ['usesOnlineServices']
			},
			'workbench.settings.settingsSearchTocBehavior': {
				'type': 'string',
				'enum': ['hide', 'filter'],
				'enumDescriptions': [
					nls.localize('settingsSearchTocBehavior.hide', "Hide the Table of Contents while searching."),
					nls.localize('settingsSearchTocBehavior.filter', "Filter the Table of Contents to just categories that have matching settings. Clicking a category will filter the results to that category."),
				],
				'description': nls.localize('settingsSearchTocBehavior', "Controls the behavior of the settings editor Table of Contents while searching."),
				'default': 'filter',
				'scope': ConfigurationScope.WINDOW
			},
			'workbench.settings.editor': {
				'type': 'string',
				'enum': ['ui', 'json'],
				'enumDescriptions': [
					nls.localize('settings.editor.ui', "Use the settings UI editor."),
					nls.localize('settings.editor.json', "Use the JSON file editor."),
				],
				'description': nls.localize('settings.editor.desc', "Determines which settings editor to use by default."),
				'default': 'ui',
				'scope': ConfigurationScope.WINDOW
			},
			'workbench.enableExperiments': {
				'type': 'boolean',
				'description': nls.localize('workbench.enableExperiments', "Fetches experiments to run from a Microsoft online service."),
				'default': true,
				'tags': ['usesOnlineServices']
			},
			'workbench.useExperimentalGridLayout': {
				'type': 'boolean',
				'description': nls.localize('workbench.useExperimentalGridLayout', "Enables the grid layout for the workbench. This setting may enable additional layout options for workbench components."),
				'default': true,
				'scope': ConfigurationScope.APPLICATION
			}
		}
	});

	// Window

	let windowTitleDescription = nls.localize('windowTitle', "Controls the window title based on the active editor. Variables are substituted based on the context:");
	windowTitleDescription += '\n- ' + [
		nls.localize('activeEditorShort', "`\${activeEditorShort}`: the file name (e.g. myFile.txt)."),
		nls.localize('activeEditorMedium', "`\${activeEditorMedium}`: the path of the file relative to the workspace folder (e.g. myFolder/myFileFolder/myFile.txt)."),
		nls.localize('activeEditorLong', "`\${activeEditorLong}`: the full path of the file (e.g. /Users/Development/myFolder/myFileFolder/myFile.txt)."),
		nls.localize('activeFolderShort', "`\${activeFolderShort}`: the name of the folder the file is contained in (e.g. myFileFolder)."),
		nls.localize('activeFolderMedium', "`\${activeFolderMedium}`: the path of the folder the file is contained in, relative to the workspace folder (e.g. myFolder/myFileFolder)."),
		nls.localize('activeFolderLong', "`\${activeFolderLong}`: the full path of the folder the file is contained in (e.g. /Users/Development/myFolder/myFileFolder)."),
		nls.localize('folderName', "`\${folderName}`: name of the workspace folder the file is contained in (e.g. myFolder)."),
		nls.localize('folderPath', "`\${folderPath}`: file path of the workspace folder the file is contained in (e.g. /Users/Development/myFolder)."),
		nls.localize('rootName', "`\${rootName}`: name of the workspace (e.g. myFolder or myWorkspace)."),
		nls.localize('rootPath', "`\${rootPath}`: file path of the workspace (e.g. /Users/Development/myWorkspace)."),
		nls.localize('appName', "`\${appName}`: e.g. VS Code."),
		nls.localize('dirty', "`\${dirty}`: a dirty indicator if the active editor is dirty."),
		nls.localize('separator', "`\${separator}`: a conditional separator (\" - \") that only shows when surrounded by variables with values or static text.")
	].join('\n- '); // intentionally concatenated to not produce a string that is too long for translations

	registry.registerConfiguration({
		'id': 'window',
		'order': 8,
		'title': nls.localize('windowConfigurationTitle', "Window"),
		'type': 'object',
		'properties': {
			'window.title': {
				'type': 'string',
				'default': isMacintosh ? '${activeEditorShort}${separator}${rootName}' : '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}',
				'markdownDescription': windowTitleDescription
			},
			'window.menuBarVisibility': {
				'type': 'string',
				'enum': ['default', 'visible', 'toggle', 'hidden'],
				'enumDescriptions': [
					nls.localize('window.menuBarVisibility.default', "Menu is only hidden in full screen mode."),
					nls.localize('window.menuBarVisibility.visible', "Menu is always visible even in full screen mode."),
					nls.localize('window.menuBarVisibility.toggle', "Menu is hidden but can be displayed via Alt key."),
					nls.localize('window.menuBarVisibility.hidden', "Menu is always hidden.")
				],
				'default': 'default',
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('menuBarVisibility', "Control the visibility of the menu bar. A setting of 'toggle' means that the menu bar is hidden and a single press of the Alt key will show it. By default, the menu bar will be visible, unless the window is full screen."),
				'included': isWindows || isLinux || isWeb
			},
			'window.enableMenuBarMnemonics': {
				'type': 'boolean',
				'default': !isMacintosh,
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('enableMenuBarMnemonics', "Controls whether the main menus can be opened via Alt-key shortcuts. Disabling mnemonics allows to bind these Alt-key shortcuts to editor commands instead."),
				'included': isWindows || isLinux || isWeb
			},
			'window.customMenuBarAltFocus': {
				'type': 'boolean',
				'default': !isMacintosh,
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': nls.localize('customMenuBarAltFocus', "Controls whether the menu bar will be focused by pressing the Alt-key. This setting has no effect on toggling the menu bar with the Alt-key."),
				'included': isWindows || isLinux || isWeb
			},
			'window.openFoldersInNewWindow': {
				'type': 'string',
				'enum': ['on', 'off', 'default'],
				'enumDescriptions': [
					nls.localize('window.openFoldersInNewWindow.on', "Folders will open in a new window."),
					nls.localize('window.openFoldersInNewWindow.off', "Folders will replace the last active window."),
					nls.localize('window.openFoldersInNewWindow.default', "Folders will open in a new window unless a folder is picked from within the application (e.g. via the File menu).")
				],
				'default': 'default',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': nls.localize('openFoldersInNewWindow', "Controls whether folders should open in a new window or replace the last active window.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option).")
			}
		}
	});

	// Zen Mode
	registry.registerConfiguration({
		'id': 'zenMode',
		'order': 9,
		'title': nls.localize('zenModeConfigurationTitle', "Zen Mode"),
		'type': 'object',
		'properties': {
			'zenMode.fullScreen': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('zenMode.fullScreen', "Controls whether turning on Zen Mode also puts the workbench into full screen mode.")
			},
			'zenMode.centerLayout': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('zenMode.centerLayout', "Controls whether turning on Zen Mode also centers the layout.")
			},
			'zenMode.hideTabs': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('zenMode.hideTabs', "Controls whether turning on Zen Mode also hides workbench tabs.")
			},
			'zenMode.hideStatusBar': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('zenMode.hideStatusBar', "Controls whether turning on Zen Mode also hides the status bar at the bottom of the workbench.")
			},
			'zenMode.hideActivityBar': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('zenMode.hideActivityBar', "Controls whether turning on Zen Mode also hides the activity bar at the left of the workbench.")
			},
			'zenMode.hideLineNumbers': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('zenMode.hideLineNumbers', "Controls whether turning on Zen Mode also hides the editor line numbers.")
			},
			'zenMode.restore': {
				'type': 'boolean',
				'default': false,
				'description': nls.localize('zenMode.restore', "Controls whether a window should restore to zen mode if it was exited in zen mode.")
			}
		}
	});
})();
