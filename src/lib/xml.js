export function decodeXml(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let encoding = 'utf-8';
  let hasSignature = false;
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0 && bytes[3] === 0)) {
    encoding = 'utf-16le';
    hasSignature = true;
  } else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0)) {
    encoding = 'utf-16be';
    hasSignature = true;
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    hasSignature = true;
  }
  if (!hasSignature) {
    const header = Array.from(bytes.subarray(0, 1024), (byte) => String.fromCharCode(byte)).join('');
    const declaration = header.match(/^\s*<\?xml[^?]*encoding\s*=\s*["']([^"']+)["']/i);
    if (declaration) encoding = declaration[1].toLowerCase();
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Could not decode this XML file (' + encoding + '). Check that the file is not damaged.');
  }
}

export function parseXml(xml) {
  // Metadata is read as text; uploaded XML is never inserted into the page as HTML.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML document types and custom entities are not supported.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (!document.documentElement || document.getElementsByTagNameNS('*', 'parsererror').length) {
    throw new Error('The XML inside this file is damaged or incomplete.');
  }
  return document;
}

export function children(element, localName) {
  return Array.from(element?.children || []).filter((child) => child.localName === localName);
}

export function child(element, localName) {
  return children(element, localName)[0] || null;
}

export function textOf(element) {
  return (element?.textContent || '').replace(/\s+/g, ' ').trim();
}
