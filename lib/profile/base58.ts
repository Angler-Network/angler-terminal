const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet) for Solana signatures, without pulling the Solana SDK into the browser bundle. */
export function base58(bytes: Uint8Array) {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros += "1";
  }
  return zeros + digits.reverse().map((digit) => ALPHABET[digit]).join("");
}
