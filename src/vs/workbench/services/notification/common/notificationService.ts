/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { INotificationService, INotification, INotificationHandle, Severity, NotificationMessage, INotificationActions, IPromptChoice, IPromptOptions, IStatusMessageOptions, NoOpNotification } from 'vs/platform/notification/common/notification';
import { INotificationsModel, NotificationsModel, ChoiceAction } from 'vs/workbench/common/notifications';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';
import { IAction, Action } from 'vs/base/common/actions';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';

export class NotificationService extends Disposable implements INotificationService {

	_serviceBrand!: ServiceIdentifier<INotificationService>;

	private _model: INotificationsModel = this._register(new NotificationsModel());

	get model(): INotificationsModel {
		return this._model;
	}

	constructor(@IStorageService private readonly storageService: IStorageService) {
		super();
	}

	info(message: NotificationMessage | NotificationMessage[]): void {
		if (Array.isArray(message)) {
			message.forEach(m => this.info(m));

			return;
		}

		this.model.addNotification({ severity: Severity.Info, message });
	}

	warn(message: NotificationMessage | NotificationMessage[]): void {
		if (Array.isArray(message)) {
			message.forEach(m => this.warn(m));

			return;
		}

		this.model.addNotification({ severity: Severity.Warning, message });
	}

	error(message: NotificationMessage | NotificationMessage[]): void {
		if (Array.isArray(message)) {
			message.forEach(m => this.error(m));

			return;
		}

		this.model.addNotification({ severity: Severity.Error, message });
	}

	notify(notification: INotification): INotificationHandle {
		const toDispose = new DisposableStore();

		// Handle neverShowAgain option accordingly
		let handle: INotificationHandle;
		if (notification.neverShowAgain) {

			// If the user already picked to not show the notification
			// again, we return with a no-op notification here
			const id = notification.neverShowAgain.id;
			if (this.storageService.getBoolean(id, StorageScope.GLOBAL)) {
				return new NoOpNotification();
			}

			const neverShowAgainAction = toDispose.add(new Action(
				'workbench.notification.neverShowAgain',
				nls.localize('neverShowAgain', "Don't Show Again"),
				undefined, true, () => {

					// Close notification
					handle.close();

					// Remember choice
					this.storageService.store(id, true, StorageScope.GLOBAL);

					return Promise.resolve();
				}));

			// Insert as primary or secondary action
			const actions = notification.actions || { primary: [], secondary: [] };
			if (!notification.neverShowAgain.isSecondary) {
				actions.primary = [neverShowAgainAction, ...(actions.primary || [])]; // action comes first
			} else {
				actions.secondary = [...(actions.secondary || []), neverShowAgainAction]; // actions comes last
			}

			notification.actions = actions;
		}

		// Show notification
		handle = this.model.addNotification(notification);

		// Cleanup when notification gets disposed
		Event.once(handle.onDidClose)(() => toDispose.dispose());

		return handle;
	}

	prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		const toDispose = new DisposableStore();

		// Handle neverShowAgain option accordingly
		if (options && options.neverShowAgain) {

			// If the user already picked to not show the notification
			// again, we return with a no-op notification here
			const id = options.neverShowAgain.id;
			if (this.storageService.getBoolean(id, StorageScope.GLOBAL)) {
				return new NoOpNotification();
			}

			const neverShowAgainChoice = {
				label: nls.localize('neverShowAgain', "Don't Show Again"),
				run: () => this.storageService.store(id, true, StorageScope.GLOBAL),
				isSecondary: options.neverShowAgain.isSecondary
			};

			// Insert as primary or secondary action
			if (!options.neverShowAgain.isSecondary) {
				choices = [neverShowAgainChoice, ...choices]; // action comes first
			} else {
				choices = [...choices, neverShowAgainChoice]; // actions comes last
			}
		}

		let choiceClicked = false;
		let handle: INotificationHandle;

		// Convert choices into primary/secondary actions
		const primaryActions: IAction[] = [];
		const secondaryActions: IAction[] = [];
		choices.forEach((choice, index) => {
			const action = new ChoiceAction(`workbench.dialog.choice.${index}`, choice);
			if (!choice.isSecondary) {
				primaryActions.push(action);
			} else {
				secondaryActions.push(action);
			}

			// React to action being clicked
			toDispose.add(action.onDidRun(() => {
				choiceClicked = true;

				// Close notification unless we are told to keep open
				if (!choice.keepOpen) {
					handle.close();
				}
			}));

			toDispose.add(action);
		});

		// Show notification with actions
		const actions: INotificationActions = { primary: primaryActions, secondary: secondaryActions };
		handle = this.notify({ severity, message, actions, sticky: options && options.sticky, silent: options && options.silent });

		Event.once(handle.onDidClose)(() => {

			// Cleanup when notification gets disposed
			toDispose.dispose();

			// Indicate cancellation to the outside if no action was executed
			if (options && typeof options.onCancel === 'function' && !choiceClicked) {
				options.onCancel();
			}
		});

		return handle;
	}

	status(message: NotificationMessage, options?: IStatusMessageOptions): IDisposable {
		return this.model.showStatusMessage(message, options);
	}
}

registerSingleton(INotificationService, NotificationService, true);
