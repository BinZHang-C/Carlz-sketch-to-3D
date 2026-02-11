/**
 * @typedef {{data: string, mimeType: string}} InlineImageData
 */

/**
 * Prefer a manually entered key; otherwise use env key.
 * @param {string} manualApiKey
 * @param {string | undefined} envApiKey
 * @returns {string}
 */
export const resolveApiKey = (manualApiKey, envApiKey) => {
  const manual = manualApiKey.trim();
  if (manual) {
    return manual;
  }

  return (envApiKey ?? '').trim();
};

/**
 * Parse a base64 data URL into inline image data payload.
 * @param {string} dataUrl
 * @param {string} [fallbackMimeType='image/png']
 * @returns {InlineImageData}
 */
export const extractInlineImageData = (dataUrl, fallbackMimeType = 'image/png') => {
  const [header, data = ''] = dataUrl.split(',', 2);
  const mimeMatch = /^data:([^;]+);base64$/i.exec(header ?? '');

  return {
    data,
    mimeType: mimeMatch?.[1] || fallbackMimeType,
  };
};
