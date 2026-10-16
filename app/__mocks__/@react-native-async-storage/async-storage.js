// Mock automatico di AsyncStorage per Jest: quello ufficiale del pacchetto
// (in memoria). Il modulo nativo non esiste in ambiente di test.

module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
