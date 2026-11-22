export function logoExtension(bytes) {
  const startsWith = (signature, offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  if (startsWith([137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (startsWith([255, 216, 255])) return "jpg";
  if (startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8)) return "webp";
  return "";
}
