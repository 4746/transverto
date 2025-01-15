const isObject = (val: unknown): boolean => val && typeof val === "object" && !Array.isArray(val);
const isString = (val: unknown): boolean => {
  return typeof val === "string"
};

/**
 * Sorts an object, including nested objects and arrays, by keys.
 *
 * @param {unknown} value - The value to be sorted.
 * @returns {unknown} - The sorted value.
 */
const sortObjByKey = (value: NonNullable<object>): NonNullable<object> => {
  return typeof value === "object"
    ? Array.isArray(value)
      ? value.map((element) => sortObjByKey(element))
      : Object.keys(value)
        .sort()
        .reduce((o, key) => {
          const v = value[key];
          o[key] = sortObjByKey(v);
          return o;
        }, {})
    : value;
}

/**
 * Set the value of a nested property in an object.
 *
 * @param {object} obj - The object in which to set the nested property.
 * @param {string} keyLabel - The label representing the nested property.
 * @param {string} value - The value to set for the nested property.
 * @returns {void}
 */
const setNestedValue = (obj: NonNullable<object>, keyLabel: string, value: string | string[]): void => {
  let i;
  const keyLabelPath = keyLabel.split('.');
  for (i = 0; i < keyLabelPath.length - 1; i++) {
    if (!obj[keyLabelPath[i]]) {
      obj[keyLabelPath[i]] = {};
    }

    obj = obj[keyLabelPath[i]];
  }

  obj[keyLabelPath[i]] = value;
}

/**
 * Replaces the value of a nested property in an object.
 *
 * @param {object} obj - The object to modify.
 * @param {string} path - The path to the property, separated by dots.
 * @param {string} translation - The new value to set.
 * @returns {object} - A new object with the modified value.
 * @throws {TypeError} - If the specified property is not a string.
 */
const replacePropertyPath = (obj: NonNullable<object>, path: string, translation: string): NonNullable<object> => {
  const _obj: NonNullable<object> = JSON.parse(JSON.stringify(obj));
  const keys = path.split('.');

  keys.reduce((acc, key, index) => {
    if (index === keys.length - 1) {
      if (typeof acc[key] === "string") {
        acc[key] = translation;
      } else {
        throw new TypeError(`Label [${path}] is not string.`);
      }
    }

    return acc[key];
  }, _obj);

  return _obj;
}

/**
 * Retrieves a nested value from an object based on a given path.
 *
 * @param {object} obj - The object to retrieve the value from.
 * @param {string} path - The dot-separated path to the desired value.
 * @returns {*} - The value found at the specified path, or undefined if not found.
 */
const getNestedValue = (obj: NonNullable<object>, path: string): unknown => {
  let i: number;
  const kePath = path.split('.');
  for (i = 0; i < kePath.length - 1; i++) {
    if (!obj[kePath[i]]) {
      obj[kePath[i]] = {};
    }

    obj = obj[kePath[i]];
  }

  return obj[kePath[i]];
}

/**
 * Flattens a nested object into a single-level object with dot-separated keys.
 *
 * @param data - The object to be flattened.
 * @param parent - Optional parent key used for recursively building flattened keys.
 * @returns The flattened object with dot-separated keys.
 * @example {
 *  'april': 'April',
 *  'date.month.april': 'April',
 *  'date.month.august': 'August',
 *    ...,
 * }
 */
const flattenObject = (data: NonNullable<object>, parent?: string): Record<string, string> => {
  return Object.entries(data).reduce((acc, [key, val]) => {
    if (key.includes(".")) {
      console.warn(`*** !WARNING! key "${key}" includes dots. This is unsupported!`);
      key = key.replaceAll('.', '_');
    }

    const newKey = parent ? `${parent}.${key}` : key;
    if (typeof val === 'string' || Array.isArray(val)) {
      acc[newKey] = val;
    } else {
      acc = {...acc, ...flattenObject(val, newKey)};
    }

    return acc;
  }, {});
}

/**
 * Deletes a property from an object based on the given path.
 * This function mutates the original object, removing the specified property.
 *
 * @param {NonNullable<object>} obj - The object from which the property needs to be deleted.
 * @param {string} path - The path of the property to be deleted, using dot notation.
 *                        For example, "prop1.prop2" would delete 'prop2' from 'prop1'.
 * @returns {NonNullable<object>} - The mutated object with the property deleted.
 */
const deletePropertyPath = (obj: NonNullable<object>, path: string): NonNullable<object> => {
  const _obj = JSON.parse(JSON.stringify(obj));
  const keys = path.split('.');

  keys.reduce((acc, key, index) => {
    if (index === keys.length - 1) {
      delete acc[key];
      return true;
    }

    return acc[key];
  }, _obj);

  return _obj;
}

/**
 * Merges multiple objects deeply into a single object.
 *
 * @param {...NonNullable<object>} sources - The objects to merge.
 * @returns {NonNullable<object>} - The merged object.
 */
const mergeDeep = (...sources: NonNullable<object>[]): NonNullable<object> => {
  const target = {};
  if (sources.length === 0) {
    return target;
  }

  while (sources.length > 0) {
    const source = sources.shift();
    if (isObject(source)) {
      for (const key in source) {
        if (isObject(source[key])) {
          target[key] = mergeDeep(target[key], source[key]);
        } else {
          Object.assign(target, {[key]: source[key]});
        }
      }
    }
  }

  return target;
}

/**
 * Removes specified characters from the beginning and end of a given string.
 *
 * @param {string} str - The input string to trim.
 * @param {string} chars - A string containing characters to be trimmed from both ends of the input string.
 * @returns {string} - The resulting string after removing the specified characters from the start and end.
 */
export const trimChars = (str: string, chars: string): string => {
  const pattern = new RegExp(`^[${chars}]+|[${chars}]+$`, 'g');
  return str.replace(pattern, '');
}

export const UTIL = {
  deletePropertyPath,
  flattenObject,
  getNestedValue,
  isObject,
  isString,
  mergeDeep,
  replacePropertyPath,
  setNestedValue,
  sortObjByKey,
  trimChars,
}
