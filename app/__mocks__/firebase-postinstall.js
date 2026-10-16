// Stub per @firebase/util/dist/postinstall.mjs: jest-expo non trasforma i
// .mjs e il modulo serve solo a leggere i default iniettati dal postinstall
// di npm (che in test non esistono).
module.exports = { getDefaultsFromPostinstall: () => undefined };
