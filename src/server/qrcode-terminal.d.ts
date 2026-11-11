// ponytail: qrcode-terminal ships no types; this covers the one call we make.
declare module 'qrcode-terminal' {
  const qrcode: { generate(text: string, opts: { small?: boolean }, cb: (qr: string) => void): void };
  export default qrcode;
}
