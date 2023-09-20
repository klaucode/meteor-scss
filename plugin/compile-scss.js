import sass from "sass";
import {
  replaceAll,
  getRealImportPathFromIncludes,
  convertToStandardPath,
  decodeFilePath,
  fileExists,
  getConfig,
} from "./helpers";

const path = Plugin.path;
const fs = Plugin.fs;

const compileSass = sass.compileAsync;
const { includePaths: incPaths } = getConfig("scss-config.json");
const includePaths = Array.isArray(incPaths) ? incPaths : [];

Plugin.registerCompiler(
  {
    extensions: ["scss", "sass"],
    archMatching: "web",
  },
  () => new SassCompiler()
);

const rootDir = convertToStandardPath(`${process.env.PWD || process.cwd()}/`);

// CompileResult is {css, sourceMap}.
class SassCompiler extends MultiFileCachingCompiler {
  constructor() {
    super({
      compilerName: "sass",
      defaultCacheSize: 1024 * 1024 * 10,
    });
  }

  getCacheKey(inputFile) {
    return inputFile.getSourceHash();
  }

  compileResultSize(compileResult) {
    return compileResult.css.length + this.sourceMapSize(compileResult.sourceMap);
  }

  // The heuristic is that a file is an import (ie, is not itself processed as a
  // root) if it matches _*.sass, _*.scss
  // This can be overridden in either direction via an explicit
  // `isImport` file option in api.addFiles.
  isRoot(inputFile) {
    const fileOptions = inputFile.getFileOptions();

    if (fileOptions.hasOwnProperty("isImport")) {
      return !fileOptions.isImport;
    }

    const pathInPackage = inputFile.getPathInPackage();
    return !this.hasUnderscore(pathInPackage);
  }

  hasUnderscore(file) {
    return path.basename(file).startsWith("_");
  }

  compileOneFileLater(inputFile, getResult) {
    inputFile.addStylesheet(
      {
        path: inputFile.getPathInPackage(),
      },
      async () => {
        const result = await getResult();
        return (
          result && {
            data: result.css,
            sourceMap: result.sourceMap,
          }
        );
      }
    );
  }

  async compileOneFile(inputFile, allFiles) {
    const referencedImportPaths = [];

    let totalImportPath = [];
    let sourceMapPaths = [`.${inputFile.getDisplayPath()}`];

    const addUnderscore = (file) => {
      if (!this.hasUnderscore(file)) {
        file = path.join(path.dirname(file), `_${path.basename(file)}`);
      }
      return file;
    };

    const getRealImportPath = (importPath) => {
      const isAbsolute = importPath.startsWith("/");

      // SASS has a whole range of possible import files from one import statement, try each of them
      const possibleFiles = [];

      // If the referenced file has no extension, try possible extensions, starting with extension of the parent file.
      let possibleExtensions = ["scss", "sass", "css"];

      if (!importPath.match(/\.s?(a|c)ss$/)) {
        possibleExtensions = [
          inputFile.getExtension(),
          ...possibleExtensions.filter((e) => e !== inputFile.getExtension()),
        ];
        for (const extension of possibleExtensions) {
          possibleFiles.push(`${importPath}.${extension}`);
        }
      } else {
        possibleFiles.push(importPath);
      }

      // Try files prefixed with underscore
      for (const possibleFile of possibleFiles) {
        if (!this.hasUnderscore(possibleFile)) {
          possibleFiles.push(addUnderscore(possibleFile));
        }
      }

      // Try if one of the possible files exists
      for (const possibleFile of possibleFiles) {
        // If absolute paths or if relative path exists in allFiles
        if ((isAbsolute && fileExists(possibleFile)) || (!isAbsolute && allFiles.has(possibleFile))) {
          return { absolute: isAbsolute, path: possibleFile };
        }
        let foundFile;
        // Remove everything before node_modules or ../
        let searchFile = possibleFile.includes("node_modules")
          ? possibleFile.substring(possibleFile.indexOf("node_modules") + 1)
          : replaceAll(possibleFile, "../", "");
        // ...and find searchFile in allFiles
        allFiles.forEach((f, i) => {
          if (i && i.endsWith(searchFile)) {
            foundFile = i;
          }
        });
        // If found, great...
        if (foundFile) {
          return { absolute: isAbsolute, path: foundFile };
        }
      }
      // Ooh no, file not found...
      return null;
    };

    const fixTilde = function (thePath) {
      let newPath = thePath;
      // replace ~ with {}/....
      if (newPath.startsWith("~")) {
        newPath = newPath.replace("~", "{}/node_modules/");
      }

      // add {}/ if starts with node_modules
      if (!newPath.startsWith("{")) {
        if (newPath.startsWith("node_modules")) {
          newPath = `{}/${newPath}`;
        }
        if (newPath.startsWith("/node_modules")) {
          newPath = `{}${newPath}`;
        }
      }
      return newPath;
    };

    // Handle import statements found by the sass compiler, used to handle cross-package imports
    const importer = function (url, prev, done) {
      prev = convertToStandardPath(prev);
      prev = fixTilde(prev);
      if (!totalImportPath.length) {
        totalImportPath.push(prev);
      }

      if (prev !== undefined) {
        // iterate backwards over totalImportPath and remove paths that don't equal the prev url
        for (let i = totalImportPath.length - 1; i >= 0; i--) {
          // check if importPath contains prev, if it doesn't, remove it. Up until we find a path that does contain it
          if (totalImportPath[i] === prev) {
            break;
          } else {
            // remove last item (which has to be item i because we are iterating backwards)
            totalImportPath.splice(i, 1);
          }
        }
      }
      let importPath = convertToStandardPath(url);
      importPath = fixTilde(importPath);
      for (let i = totalImportPath.length - 1; i >= 0; i--) {
        if (importPath.startsWith("/") || importPath.startsWith("{")) {
          break;
        }
        // 'path' is the Node.js path module
        importPath = path.join(path.dirname(totalImportPath[`${i}`]), importPath);
      }

      let accPosition = importPath.indexOf("{");
      if (accPosition > -1) {
        importPath = importPath.substr(accPosition, importPath.length);
      }

      // TODO: This fix works.. BUT if you edit the scss/css file it doesn't recompile! Probably because of the absolute path problem
      if (importPath.startsWith("{")) {
        // replace {}/node_modules/ for rootDir + "node_modules/"
        importPath = importPath.replace(/^(\{\}\/node_modules\/)/, `${rootDir}node_modules/`);
        // importPath = importPath.replace('{}/node_modules/', rootDir + "node_modules/");
        if (importPath.endsWith(".css")) {
          // .css files aren't in allFiles. Replace {}/ for absolute path.
          importPath = importPath.replace(/^(\{\}\/)/, rootDir);
        }
      }

      try {
        let parsed = getRealImportPath(importPath);
        if (!parsed) {
          parsed = getRealImportPathFromIncludes(includePaths, url, getRealImportPath);
        }
        if (!parsed) {
          // Nothing found...
          throw new Error(`File to import: ${url} not found in file: ${totalImportPath[totalImportPath.length - 2]}`);
        }
        totalImportPath.push(parsed.path);

        if (parsed.absolute) {
          sourceMapPaths.push(parsed.path);
          done({ contents: fs.readFileSync(parsed.path, "utf8"), file: parsed.path });
        } else {
          referencedImportPaths.push(parsed.path);
          sourceMapPaths.push(decodeFilePath(parsed.path));
          done({ contents: allFiles.get(parsed.path).getContentsAsString(), file: parsed.path });
        }
      } catch (e) {
        return done(e);
      }
    };

    // Start compile sass (async)
    const options = {
      sourceMap: true,
      sourceMapContents: true,
      sourceMapEmbed: false,
      sourceComments: false,
      omitSourceMapUrl: true,
      sourceMapRoot: ".",
      indentedSyntax: inputFile.getExtension() === "sass",
      outFile: `.${inputFile.getBasename()}`,
      importer,
      includePaths: [],
      precision: 10,
    };

    const ffile = this.getAbsoluteImportPath(inputFile).replace("{}/", "");
    // options.file = ffile;

    // options.data = inputFile.getContentsAsBuffer().toString('utf8');

    // If the file is empty, options.data is an empty string
    // In that case options.file will be used by node-sass,
    // which it can not read since it will contain a meteor package or app reference '{}'
    // This is one workaround, another one would be to not set options.file, in which case the importer 'prev' will be 'stdin'
    // However, this would result in problems if a file named stdín.scss would exist.
    // Not the most elegant of solutions, but it works.
    // if (!options.data.trim()) {
    //  options.data = '$fakevariable_ae7bslvbp2yqlfba : blue;';
    // }

    let output;
    try {
      output = await compileSass(ffile, options);
    } catch (e) {
      inputFile.error({
        message: `Scss compiler error: ${e.formatted}\n`,
        sourcePath: inputFile.getDisplayPath(),
      });
      return null;
    }
    // End compile sass

    // Start fix sourcemap references
    if (output.map) {
      const map = JSON.parse(output.map.toString());
      map.sources = sourceMapPaths;
      output.map = map;
    }
    // End fix sourcemap references

    const compileResult = { css: output.css.toString(), sourceMap: output.map };
    return { compileResult, referencedImportPaths };
  }

  addCompileResult(inputFile, compileResult) {
    inputFile.addStylesheet({
      data: compileResult.css,
      path: `${inputFile.getPathInPackage()}.css`,
      sourceMap: compileResult.sourceMap,
    });
  }
}
