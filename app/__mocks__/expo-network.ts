// Mock automatico di expo-network per Jest: rete presente. I test che vogliono
// simulare l'offline sovrascrivono con un jest.mock() proprio.

export const useNetworkState = jest.fn(() => ({ isConnected: true }));
