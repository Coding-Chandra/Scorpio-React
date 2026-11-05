import { App } from '@capacitor/app';
import { CapacitorException, WebPlugin } from '@capacitor/core';
import { BiometryError, isBiometryErrorType } from './definitions.js';
export class BiometricAuthBase extends WebPlugin {
    async authenticate(options) {
        try {
            await this.internalAuthenticate(options);
        }
        catch (error) {
            // error will be an instance of CapacitorException on native platforms,
            // an instance of BiometryError on the web.
            throw error instanceof CapacitorException &&
                isBiometryErrorType(error.code)
                ? new BiometryError(error.message, error.code)
                : error;
        }
    }
    async addResumeListener(listener) {
        return App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                ;
                (async () => {
                    try {
                        const info = await this.checkBiometry();
                        listener(info);
                    }
                    catch (error) {
                        console.error(error);
                    }
                })();
            }
        });
    }
}
