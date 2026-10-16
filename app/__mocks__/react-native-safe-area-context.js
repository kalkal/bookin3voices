// Mock automatico di react-native-safe-area-context per Jest: quello ufficiale
// del pacchetto (SafeAreaProvider sintetico con inset a zero — senza, il
// provider nativo non renderizza i figli in ambiente di test).

module.exports = require('react-native-safe-area-context/jest/mock').default;
