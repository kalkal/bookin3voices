// Automatic expo-keep-awake mock for Jest (native module absent in tests).

export const activateKeepAwakeAsync = jest.fn(async () => {});
export const deactivateKeepAwake = jest.fn(async () => {});
