/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService, LogLevel } from 'vs/platform/log/common/log';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { SQLiteStorageDatabase, ISQLiteStorageDatabaseLoggingOptions } from 'vs/base/parts/storage/node/storage';
import { Storage, IStorage, InMemoryStorageDatabase } from 'vs/base/parts/storage/common/storage';
import { join } from 'vs/base/common/path';

export const IStorageMainService = createDecorator<IStorageMainService>('storageMainService');

export interface IStorageMainService {

	_serviceBrand: ServiceIdentifier<any>;

	/**
	 * Emitted whenever data is updated or deleted.
	 */
	readonly onDidChangeStorage: Event<IStorageChangeEvent>;

	/**
	 * Emitted when the storage is about to persist. This is the right time
	 * to persist data to ensure it is stored before the application shuts
	 * down.
	 *
	 * Note: this event may be fired many times, not only on shutdown to prevent
	 * loss of state in situations where the shutdown is not sufficient to
	 * persist the data properly.
	 */
	readonly onWillSaveState: Event<void>;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided defaultValue if the element is null or undefined.
	 */
	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided defaultValue if the element is null or undefined. The element
	 * will be converted to a boolean.
	 */
	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided defaultValue if the element is null or undefined. The element
	 * will be converted to a number using parseInt with a base of 10.
	 */
	getNumber(key: string, fallbackValue: number): number;
	getNumber(key: string, fallbackValue?: number): number | undefined;

	/**
	 * Store a string value under the given key to storage. The value will
	 * be converted to a string.
	 */
	store(key: string, value: string | boolean | number | undefined | null): void;

	/**
	 * Delete an element stored under the provided key from storage.
	 */
	remove(key: string): void;
}

export interface IStorageChangeEvent {
	key: string;
}

export class StorageMainService extends Disposable implements IStorageMainService {

	_serviceBrand!: ServiceIdentifier<any>;

	private static STORAGE_NAME = 'state.vscdb';

	private readonly _onDidChangeStorage: Emitter<IStorageChangeEvent> = this._register(new Emitter<IStorageChangeEvent>());
	readonly onDidChangeStorage: Event<IStorageChangeEvent> = this._onDidChangeStorage.event;

	private readonly _onWillSaveState: Emitter<void> = this._register(new Emitter<void>());
	readonly onWillSaveState: Event<void> = this._onWillSaveState.event;

	get items(): Map<string, string> { return this.storage.items; }

	private storage: IStorage;

	private initializePromise: Promise<void>;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super();

		// Until the storage has been initialized, it can only be in memory
		this.storage = new Storage(new InMemoryStorageDatabase());
	}

	private get storagePath(): string {
		if (!!this.environmentService.extensionTestsLocationURI) {
			return SQLiteStorageDatabase.IN_MEMORY_PATH; // no storage during extension tests!
		}

		return join(this.environmentService.globalStorageHome, StorageMainService.STORAGE_NAME);
	}

	private createLogginOptions(): ISQLiteStorageDatabaseLoggingOptions {
		return {
			logTrace: (this.logService.getLevel() === LogLevel.Trace) ? msg => this.logService.trace(msg) : undefined,
			logError: error => this.logService.error(error)
		};
	}

	initialize(): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.doInitialize();
		}

		return this.initializePromise;
	}

	private doInitialize(): Promise<void> {
		this.storage.dispose();
		this.storage = new Storage(new SQLiteStorageDatabase(this.storagePath, {
			logging: this.createLogginOptions()
		}));

		this._register(this.storage.onDidChangeStorage(key => this._onDidChangeStorage.fire({ key })));

		return this.storage.init();
	}

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		return this.storage.get(key, fallbackValue);
	}

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
		return this.storage.getBoolean(key, fallbackValue);
	}

	getNumber(key: string, fallbackValue: number): number;
	getNumber(key: string, fallbackValue?: number): number | undefined;
	getNumber(key: string, fallbackValue?: number): number | undefined {
		return this.storage.getNumber(key, fallbackValue);
	}

	store(key: string, value: string | boolean | number | undefined | null): Promise<void> {
		return this.storage.set(key, value);
	}

	remove(key: string): Promise<void> {
		return this.storage.delete(key);
	}

	close(): Promise<void> {

		// Signal as event so that clients can still store data
		this._onWillSaveState.fire();

		// Do it
		return this.storage.close();
	}
}
