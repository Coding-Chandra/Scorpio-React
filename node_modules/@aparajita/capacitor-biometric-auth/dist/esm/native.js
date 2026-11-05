import { BiometricAuthBase } from './base.js';
import { BiometryErrorType, BiometryType } from './definitions.js';
/* eslint-disable @typescript-eslint/require-await */
// oxlint-disable eslint/class-methods-use-this -- Protected methods don't use `this` but need to be overridden
export class BiometricAuthNative extends BiometricAuthBase {
    constructor(capProxy) {
        super();
        /*
          In order to call native methods and maintain the ability to
          call pure Javascript methods as well, we have to bind the native methods
          to the proxy.
    
          capProxy is a proxy of an instance of this class, so it is safe
          to cast it to this class.
        */
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const proxy = capProxy;
        /* eslint-disable @typescript-eslint/unbound-method */
        this.checkBiometry = proxy.checkBiometry;
        this.internalAuthenticate = proxy.internalAuthenticate;
        /* eslint-enable @typescript-eslint/unbound-method */
    }
    // @native
    async checkBiometry() {
        // Never used, but we have to satisfy the compiler.
        return {
            isAvailable: false,
            strongBiometryIsAvailable: false,
            biometryType: BiometryType.none,
            biometryTypes: [],
            deviceIsSecure: false,
            reason: '',
            code: BiometryErrorType.none,
            strongReason: '',
            strongCode: BiometryErrorType.none,
        };
    }
    // @native
    // On native platforms, this will present the native authentication UI.
    async internalAuthenticate(_options) {
        // This method is implemented natively
    }
    // Web only, used for simulating biometric authentication.
    async setBiometryType(_type) {
        console.warn('setBiometryType() is web only');
    }
    // Web only, used for simulating biometry enrollment.
    async setBiometryIsEnrolled(_enrolled) {
        console.warn('setBiometryEnrolled() is web only');
    }
    // Web only, used for simulating device security.
    async setDeviceIsSecure(_isSecure) {
        console.warn('setDeviceIsSecure() is web only');
    }
}
/* eslint-enable @typescript-eslint/require-await */
