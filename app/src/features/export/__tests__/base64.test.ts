import { base64ToUint8Array } from '../base64';

function toBase64(bytes: number[]): string {
  // riferimento indipendente: Buffer esiste nei test (ambiente Node)
  return Buffer.from(bytes).toString('base64');
}

describe('base64ToUint8Array', () => {
  it('decodifica stringhe con e senza padding', () => {
    expect([...base64ToUint8Array('ZmludG8=')]).toEqual([...'finto'].map((c) => c.charCodeAt(0)));
    expect([...base64ToUint8Array('YQ==')]).toEqual([97]);
    expect([...base64ToUint8Array('YWI=')]).toEqual([97, 98]);
    expect([...base64ToUint8Array('YWJj')]).toEqual([97, 98, 99]);
    expect([...base64ToUint8Array('')]).toEqual([]);
  });

  it('fa il giro completo su byte binari arbitrari', () => {
    const bytes = Array.from({ length: 300 }, (_, i) => (i * 7 + 13) % 256);
    expect([...base64ToUint8Array(toBase64(bytes))]).toEqual(bytes);
  });

  it('rifiuta input non base64', () => {
    expect(() => base64ToUint8Array('non base64!!!')).toThrow('base64 non valido');
  });
});
