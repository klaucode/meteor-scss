const path = Plugin.path;
const fs = Plugin.fs;

export function getRealImportPathFromIncludes(includePaths, importPath, getRealImportPathFn) {
  let possibleFilePath;
  let foundFile;
  for (let includePath of includePaths) {
    possibleFilePath = path.join(includePath, importPath);
    foundFile = getRealImportPathFn(possibleFilePath);
    if (foundFile) {
      return foundFile;
    }
  }
  return null;
}

/**
 * Build a path from current process working directory (i.e. meteor project
 * root) and specified file name, try to get the file and parse its content.
 * @param configFileName
 * @returns {{}}
 * @private
 */
export function getConfig(configFileName) {
  const appDir = process.env.PWD || process.cwd();
  const customConfigFilename = path.join(appDir, configFileName);
  let userConfig = {};

  if (fileExists(customConfigFilename)) {
    userConfig = fs.readFileSync(customConfigFilename, {
      encoding: "utf8",
    });
    userConfig = JSON.parse(userConfig);
  } else {
    // console.warn('Could not find configuration file at ' + customConfigFilename);
  }
  return userConfig;
}

export function decodeFilePath(filePath) {
  const match = filePath.match(/{(.*)}\/(.*)$/);
  if (!match) {
    throw new Error(`Failed to decode sass path: ${filePath}`);
  }

  if (match[1] === "") {
    // app
    return match[2];
  }

  return `packages/${match[1]}/${match[2]}`;
}

export function fileExists(file) {
  if (fs.statSync) {
    try {
      fs.statSync(file);
    } catch (e) {
      return false;
    }
    return true;
  }
  if (fs.existsSync) {
    return fs.existsSync(file);
  }
}

export function convertToStandardPath(osPath) {
  if (process.platform === "win32") {
    // return toPosixPath(osPath, partialPath);
    // p = osPath;
    // Sometimes, you can have a path like \Users\IEUser on windows, and this
    // actually means you want C:\Users\IEUser
    if (osPath[0] === "\\") {
      osPath = process.env.SystemDrive + osPath;
    }

    osPath = osPath.replace(/\\/g, "/");
    if (osPath[1] === ":") {
      // transform "C:/bla/bla" to "/c/bla/bla"
      osPath = `/${osPath[0]}${osPath.slice(2)}`;
    }

    return osPath;
  }
  return osPath;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), "g"), replace);
}
