// Mock automatico di expo-keep-awake per Jest (modulo nativo assente nei test).

export const activateKeepAwakeAsync = jest.fn(async () => {});
export const deactivateKeepAwake = jest.fn(async () => {});
