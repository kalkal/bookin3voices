// Automatic expo-network mock for Jest: network present. Tests that want to
// simulate offline override it with their own jest.mock().

export const useNetworkState = jest.fn(() => ({ isConnected: true }));
