import type { PluginListenerHandle } from '@capacitor/core';
import { WebPlugin } from '@capacitor/core';
import type { AuthenticateOptions, BiometricAuthPlugin, BiometryType, CheckBiometryResult, ResumeListener } from './definitions.js';
export declare abstract class BiometricAuthBase extends WebPlugin implements BiometricAuthPlugin {
    abstract setBiometryType(type: BiometryType | string | Array<BiometryType | string> | undefined): Promise<void>;
    abstract checkBiometry(): Promise<CheckBiometryResult>;
    abstract setBiometryIsEnrolled(enrolled: boolean): Promise<void>;
    abstract setDeviceIsSecure(isSecure: boolean): Promise<void>;
    authenticate(options?: AuthenticateOptions): Promise<void>;
    protected abstract internalAuthenticate(options?: AuthenticateOptions): Promise<void>;
    addResumeListener(listener: ResumeListener): Promise<PluginListenerHandle>;
}
