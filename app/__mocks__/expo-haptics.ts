// Automatic expo-haptics mock for Jest (native module absent in tests).

export const impactAsync = jest.fn(async () => {});
export const notificationAsync = jest.fn(async () => {});
export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' } as const;
export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;
