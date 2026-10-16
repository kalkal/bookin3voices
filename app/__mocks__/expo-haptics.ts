// Mock automatico di expo-haptics per Jest (modulo nativo assente nei test).

export const impactAsync = jest.fn(async () => {});
export const notificationAsync = jest.fn(async () => {});
export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' } as const;
export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;
