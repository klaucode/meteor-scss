import sass from "sass";
import { convertToStandardPath, decodeFilePath, getConfig } from "./helpers";

const path = Plugin.path;

const compileSass = sass.compileAsync;
const compileSassString = sass.compileStringAsync;
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
const nodeModulesDir = `${rootDir}node_modules`;

// Stylesheets that are imported from JS are lazy modules: their CSS travels as a
// string inside the JS bundle and never reaches standard-minifier-css. So do the
// whitespace/comment stripping here, and keep source maps out of the production
// bundle entirely (they carry a full copy of every scss source).
const isProduction = process.env.NODE_ENV === "production";

// dart-sass' modern API (compileAsync/compileStringAsync) silently ignores the
// legacy `importer` callback and `includePaths` option, so everything the old
// resolver used to do has to be expressed through `loadPaths` and the modern
// Importer API instead. `loadPaths` is what makes bare npm specifiers such as
// `@import "@coreui/coreui/scss/functions"` resolve.
const loadPaths = [nodeModulesDir, rootDir, ...includePaths];

// Build plugins have no `url` module, so percent-encoding is done by hand
// (encodeURI leaves ? and # alone, and both are plain path characters here).
const encodePath = (p) => encodeURI(p).replace(/[?#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const toFileUrl = (absolutePath) => new URL(`file://${encodePath(absolutePath)}`);

// Meteor build paths ("{}/app/file.scss" for the app, "{author:pkg}/file.scss"
// for a package) are not necessarily readable from disk, so they are served out
// of `allFiles` under a custom scheme. Note that `{author:pkg}/...` cannot be
// written in an @import: dart-sass parses the import target as a URL and rejects
// it ("Scheme not starting with alphabetic character"). Write it as
// `@import "meteor:author:pkg/file"` instead.
const toMeteorUrl = (importPath) => new URL(`meteor:///${encodePath(importPath)}`);
const fromMeteorUrl = (url) => decodeURIComponent(url.pathname).replace(/^\//, "");
const parseMeteorUrl = (url) =>
  url.startsWith("meteor:///")
    ? fromMeteorUrl(new URL(url))
    : `{${url.slice("meteor:".length).replace("/", "}/")}`;

const syntaxOf = (importPath) => {
  if (importPath.endsWith(".sass")) return "indented";
  if (importPath.endsWith(".css")) return "css";
  return "scss";
};

// SASS turns one import statement into a whole range of candidate files; mirror
// that for the files we resolve ourselves (explicit extension, extension
// guessing, and _partials).
const candidateImportPaths = (importPath) => {
  const dir = path.dirname(importPath);
  const base = path.basename(importPath);
  const bases = base.startsWith("_") ? [base] : [base, `_${base}`];
  const candidates = [];

  for (const b of bases) {
    if (b.match(/\.s?(a|c)ss$/)) {
      candidates.push(path.join(dir, b));
    } else {
      for (const extension of ["scss", "sass", "css"]) {
        candidates.push(path.join(dir, `${b}.${extension}`));
      }
    }
  }

  return candidates;
};

// Turn a source map source URL into something a browser can label the file with.
const toDisplayPath = (sourceUrl) => {
  if (sourceUrl.startsWith("meteor:")) {
    return decodeFilePath(fromMeteorUrl(new URL(sourceUrl)));
  }
  if (sourceUrl.startsWith("file:")) {
    const filePath = convertToStandardPath(decodeURIComponent(new URL(sourceUrl).pathname));
    return filePath.startsWith(rootDir) ? filePath.slice(rootDir.length) : filePath;
  }
  return sourceUrl;
};

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

    // Serves Meteor build paths out of `allFiles`, so scss shipped inside a
    // Meteor package can be imported across packages.
    const meteorImporter = {
      canonicalize(url) {
        if (!url.startsWith("meteor:")) {
          return null;
        }
        const found = candidateImportPaths(parseMeteorUrl(url)).find((candidate) => allFiles.has(candidate));
        return found ? toMeteorUrl(found) : null;
      },

      load(canonicalUrl) {
        const importPath = fromMeteorUrl(canonicalUrl);
        const file = allFiles.get(importPath);
        if (!file) {
          return null;
        }
        if (!referencedImportPaths.includes(importPath)) {
          referencedImportPaths.push(importPath);
        }
        return {
          contents: file.getContentsAsString(),
          syntax: syntaxOf(importPath),
          sourceMapUrl: canonicalUrl,
        };
      },
    };

    // "~pkg/file" (webpack style) and "{}/app/file" (app-absolute) both point at
    // real files on disk, so sass can load them itself.
    const diskImporter = {
      findFileUrl(url) {
        // dart-sass percent-encodes the braces before handing the url over.
        const importPath = url.startsWith("%7B") ? decodeURIComponent(url) : url;

        if (importPath.startsWith("~")) {
          return toFileUrl(path.join(nodeModulesDir, importPath.slice(1)));
        }
        if (importPath.startsWith("{}/")) {
          return toFileUrl(path.join(rootDir, importPath.slice(3)));
        }
        return null;
      },
    };

    const options = {
      loadPaths,
      importers: [meteorImporter, diskImporter],
      style: isProduction ? "compressed" : "expanded",
      sourceMap: !isProduction,
      // Embed the sources: the browser cannot fetch them back from these paths.
      sourceMapIncludeSources: !isProduction,
    };

    const absoluteImportPath = this.getAbsoluteImportPath(inputFile);
    const isAppFile = absoluteImportPath.startsWith("{}/");

    let output;
    try {
      output = isAppFile
        ? await compileSass(path.join(rootDir, absoluteImportPath.slice(3)), options)
        : // A file inside a Meteor package: compile its contents directly, since
          // the isopack path is not a path sass could read.
          await compileSassString(inputFile.getContentsAsString(), {
            ...options,
            url: toMeteorUrl(absoluteImportPath),
            importer: meteorImporter,
            syntax: syntaxOf(absoluteImportPath),
          });
    } catch (e) {
      inputFile.error({
        message: `Scss compiler error: ${e}\n`,
        sourcePath: inputFile.getDisplayPath(),
      });
      return null;
    }

    // Everything meteorImporter served has already been recorded; add the files
    // sass loaded from disk on its own. Without this `referencedImportPaths`
    // stays empty and edits to imported partials never invalidate the cache.
    (output.loadedUrls || []).forEach((loadedUrl) => {
      if (!String(loadedUrl).startsWith("file:")) {
        return;
      }
      const filePath = convertToStandardPath(decodeURIComponent(loadedUrl.pathname));
      if (!filePath.startsWith(rootDir)) {
        return;
      }
      const importPath = `{}/${filePath.slice(rootDir.length)}`;
      if (importPath !== absoluteImportPath && allFiles.has(importPath) && !referencedImportPaths.includes(importPath)) {
        referencedImportPaths.push(importPath);
      }
    });

    // The modern API returns the map on `sourceMap` as a plain object (the old
    // `output.map` was always undefined here, so stylesheets used to ship
    // without any source map at all).
    const sourceMap = output.sourceMap
      ? { ...output.sourceMap, sources: output.sourceMap.sources.map(toDisplayPath) }
      : null;

    const compileResult = { css: output.css.toString(), sourceMap };
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
