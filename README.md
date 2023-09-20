# Sass for Meteor
This is a Sass build plugin for Meteor. It compiles Sass files with sass.
**Fork from nodeseven:scss to add support for dart-sass.**

## Installation

Install using Meteor's package management system:

```bash
> meteor add klaucode:scss
```

If you want to use it for your package, add it in your package control file's
`onUse` block:

```javascript
Package.onUse(function (api) {
  ...
  api.use('klaucode:scss');
  ...
});
```

## Compatibility
<table>
<thead>
<tr><th>Meteor Version</th><th>Recommended klaucode:scss version</th></tr>
</thead>
<tbody>
<tr><td>2.13</td><td>5.0.0</td></tr>
</tbody>
</table>

Fore previous meteor versions, you can use `fourseven:scss` package.

## Usage
Without any additional configuration after installation, this package automatically finds all `.scss` and `.sass` files in your project, compiles them with [node-sass](https://github.com/sass/node-sass), and includes the resulting CSS in the application bundle that Meteor sends to the client. The files can be anywhere in your project.

### File types

There are two different types of files recognized by this package:

- Sass sources (all `*.scss` and `*.sass` files that are not imports)
- Sass imports/partials, which are:
  * files that are prefixed with an underscore `_`
  * marked as `isImport: true` in the package's `package.js` file:
    `api.addFiles('x.scss', 'client', {isImport: true})`
  * Starting from Meteor 1.3, all files in a directory named `imports/`

The source files are compiled automatically (eagerly loaded). The imports are not loaded by
themselves; you need to import them from one of the source files to use them.

The imports are intended to keep shared mixins and variables for your project,
or to allow your package to provide several components which your package's
users can opt into one by one.

Each compiled source file produces a separate CSS file.  (The
`standard-minifiers` package merges them into one file afterwards.)

### Importing

You can use the regular `@import` syntax to import any Sass files: sources or
imports.

Besides the usual way of importing files based on the relative path in the same
package (or app), you can also import files from other packages or apps with the
following syntax.

Importing styles from a different package:

```scss
@import "{my-package:pretty-buttons}/buttons/_styles.scss";

.my-button {
  // use the styles imported from a package
  @extend .pretty-button;
}
```

Importing styles from the target app:

```scss
@import "{}/client/styles/imports/colors.scss";

.my-nav {
  // use a color from the app style pallete
  background-color: @primary-branding-color;
}
```

This can also conveniently be used to import styles from npm modules for example:
```scss
@import "{}/node_modules/module-name/stylesheet";
```

Note that **Meteor 1.7** introduced a change so that files in `node_modules` aren't automatically compiled any more.
This requires you to add a symlink inside the `imports` directory to the pacakge in order for compilation to work.
E.g.

```
meteor npm install the-package
cd imports
ln -s ../node_modules/the-package .
```

See the [meteor changelog](https://github.com/meteor/meteor/blob/devel/History.md) for more information.

#### Global include path

Sometimes a 3rd party module uses import paths that assume that the compiler is
configured with specific `includePaths` option (e.g. Ionic, Bootstrap, etc.):
```scss
@import "ionicons-icons"; // This file is actually placed in another npm module!
```

Create a configuration file named "`scss-config.json`" at the root of your Meteor
project to specify include paths that the compiler should use as an extra
possibility to resolve import paths:
```json
{
  "includePaths": [
    "{}/node_modules/ionicons/dist/scss/"
  ]
}
```


### Sourcemaps
These are on by default.

### Autoprefixer
As of Meteor 1.2 autoprefixer should preferably be installed as a separate plugin. You can do so by running:

```
meteor remove standard-minifiers
meteor add seba:minifiers-autoprefixer@0.0.2
```

In a Meteor 1.3+ project, do the same by running:
```
meteor remove standard-minifier-css
meteor add seba:minifiers-autoprefixer
```

## Dart Sass
Please note that this project uses [Dart-Sass](https://www.npmjs.com/package/sass).
