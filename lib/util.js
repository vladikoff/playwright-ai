/**
 * Extracts name from a $$...$$ string.
 * @param {*} inputString
 * @returns
 */
function extractName(inputString) {
  const regex2 = /\$\$(.*?)\$\$/;
  const match2 = inputString.match(regex2);
  return match2 ? match2[1].trim() : null;
}

/**
 * Extracts code from a ```...``` string.
 * @param {*} inputString
 * @returns
 */
function extractCode(inputString) {
  const regex = /(?:```[a-zA-Z]*)([\s\S]*?)(?:```)/;
  const match = inputString.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Converts a string to snake case.
 * @param {*} string
 * @returns
 */
const snakeCase = (string) => {
  if (!string) {
    return null;
  }
  return string
    .replace(/\W+/g, " ")
    .split(/ |\B(?=[A-Z])/)
    .map((word) => word.toLowerCase())
    .join("_");
};

/**
 * Gets a fallback component name from a test string.
 * @param {*} input
 * @returns
 */
function fallbackComponentName(input) {
  if (!input) {
    return null;
  }
  const pattern = /test\('(.*)',/;
  const match = input.match(pattern);
  return match ? match[1].trim() : null;
}

export { snakeCase, extractName, extractCode, fallbackComponentName };
