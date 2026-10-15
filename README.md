# RoutesFlow

A browser-based diagram editor. Drawings are stored as `.flow` text and can be imported from and exported to Mermaid, PlantUML, Graphviz DOT, draw.io and Visio (`.vsdx`).

## Using it

Open `dist/flow-editor.html` in a browser. It is a single self-contained file, so it works straight from disk.

## Developing

The source is split into an HTML page, a stylesheet and ES modules:

```
src/
  index.html             page markup
  css/flow-editor.css    styles
  js/main.js             entry point: runs each module's init() in order, then opens a blank drawing
  js/core.js             shared state (S), constants and small DOM/XML helpers
  js/visio-package.js    reading Visio packages; shape -> master -> style inheritance
  js/geometry.js         ShapeSheet geometry and transforms
  js/render.js           drawing shapes to SVG, selection overlay, zoom and pan
  js/connectors.js       connector routing and glue
  js/shapes.js           shape library and editing operations; database tables
  js/selection.js        multi-selection, delete, move, duplicate
  js/pointer.js          hit testing, hover, marquee, drag, resize, connect
  js/text-editor.js      in-place text editing
  js/palette.js          shape palette and drag-to-add
  js/properties.js       properties panel
  js/connection-props.js connection settings in the properties panel
  js/formats/export.js   graph model and exporters (Mermaid, PlantUML, DOT, draw.io)
  js/formats/import.js   importers for the same formats
  js/layout.js           automatic layered layout for imports without positions
  js/dialogs.js          import and export dialogs
  js/flow/model.js       connection types and the user-defined cells the model is stored in
  js/flow/language.js    the .flow language parser and writer
  js/flow/sync.js        text to canvas and canvas to text
  js/document.js         document state, undo/redo and rebuild
  js/visio-io.js         Visio import/export, opening and saving files
  js/text-pane.js        the text pane
  js/toolbar.js          toolbar buttons and keyboard shortcuts
```

Modules only declare things when imported. Anything that touches the page (event listeners, DOM lookups) is in the module's `init()`, and `main.js` calls those in a fixed order.

Browsers do not load ES modules from `file://`, so serve `src/` while developing:

```shell
npm install
npm run serve      # http://localhost:8000
```

After changing anything in `src/`, rebuild the single-file copy and commit it with the source:

```shell
npm run build      # writes dist/flow-editor.html
```
