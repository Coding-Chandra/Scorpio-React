// noinspection JSUnusedGlobalSymbols
/**
 * The type of biometry supported by the device.
 */
export var BiometryType;
(function (BiometryType) {
    BiometryType[BiometryType["none"] = 0] = "none";
    /**
     * iOS Touch ID
     */
    BiometryType[BiometryType["touchId"] = 1] = "touchId";
    /**
     * iOS Face ID
     */
    BiometryType[BiometryType["faceId"] = 2] = "faceId";
    /**
     * Android fingerprint authentication
     */
    BiometryType[BiometryType["fingerprintAuthentication"] = 3] = "fingerprintAuthentication";
    /**
     * Android face authentication
     */
    BiometryType[BiometryType["faceAuthentication"] = 4] = "faceAuthentication";
    /**
     * Android iris authentication
     */
    BiometryType[BiometryType["irisAuthentication"] = 5] = "irisAuthentication";
})(BiometryType || (BiometryType = {}));
export var AndroidBiometryStrength;
(function (AndroidBiometryStrength) {
    /**
     * `authenticate()` will present any available biometry.
     */
    AndroidBiometryStrength[AndroidBiometryStrength["weak"] = 0] = "weak";
    /**
     * `authenticate()` will only present strong biometry.
     */
    AndroidBiometryStrength[AndroidBiometryStrength["strong"] = 1] = "strong";
})(AndroidBiometryStrength || (AndroidBiometryStrength = {}));
/**
 * If the `authenticate()` method throws an exception, the `BiometryError`
 * instance contains a `.code` property which will contain one of these strings,
 * indicating what the error was.
 *
 * See https://developer.apple.com/documentation/localauthentication/laerror
 * for a description of each error code.
 */
export var BiometryErrorType;
(function (BiometryErrorType) {
    BiometryErrorType["none"] = "";
    BiometryErrorType["appCancel"] = "appCancel";
    BiometryErrorType["authenticationFailed"] = "authenticationFailed";
    BiometryErrorType["invalidContext"] = "invalidContext";
    BiometryErrorType["notInteractive"] = "notInteractive";
    BiometryErrorType["passcodeNotSet"] = "passcodeNotSet";
    BiometryErrorType["systemCancel"] = "systemCancel";
    BiometryErrorType["userCancel"] = "userCancel";
    BiometryErrorType["userFallback"] = "userFallback";
    BiometryErrorType["biometryLockout"] = "biometryLockout";
    BiometryErrorType["biometryNotAvailable"] = "biometryNotAvailable";
    BiometryErrorType["biometryNotEnrolled"] = "biometryNotEnrolled";
    BiometryErrorType["noDeviceCredential"] = "noDeviceCredential";
})(BiometryErrorType || (BiometryErrorType = {}));
export function isBiometryErrorType(value) {
    return (typeof value === 'string' &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        Object.values(BiometryErrorType).includes(value));
}
/**
 * `authenticate()` throws instances of this class.
 */
export class BiometryError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'BiometryError';
        // Set the prototype explicitly to ensure instanceof works correctly.
        // This is recommended for custom error classes in TypeScript.
        Object.setPrototypeOf(this, BiometryError.prototype);
    }
}
