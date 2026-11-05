import { BiometricAuthBase } from './base.js';
import type { AuthenticateOptions, BiometricAuthPlugin, CheckBiometryResult } from './definitions.js';
import { BiometryType } from './definitions.js';
export declare class BiometricAuthNative extends BiometricAuthBase {
    constructor(capProxy: BiometricAuthPlugin);
    checkBiometry(): Promise<CheckBiometryResult>;
    internalAuthenticate(_options?: AuthenticateOptions): Promise<void>;
    setBiometryType(_type: BiometryType | string | Array<BiometryType | string> | undefined): Promise<void>;
    setBiometryIsEnrolled(_enrolled: boolean): Promise<void>;
    setDeviceIsSecure(_isSecure: boolean): Promise<void>;
}
