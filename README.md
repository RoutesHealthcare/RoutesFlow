# RoutesFlow

A browser-based diagram editor. Drawings are stored as `.flow` text and can be imported from and exported to Mermaid, PlantUML, Graphviz DOT, draw.io and Visio (`.vsdx`).

## Using it

Open `dist/flow-editor.html` in a browser. It is a single self-contained file, so it works straight from disk.
A short guided tour opens on the first visit; the Tour button replays it.

Visio drawings come in through **Import** (choosing a `.vsdx` with Open, or dropping one on the page, opens the
Import dialog). Shapes keep their places and sizes, Visio's dynamic connectors keep their right-angled routes, and
the first page can go on a new page, replace this page or sit beside what is there. Icon shapes (SQL Server, screens,
code and similar Visio stencils) keep their artwork: the picture is stored once per distinct icon as an
`icon name "data:image/svg+xml;base64,..."` line under the `flow 1` header, and shapes use it with `[icon=name]`. The
shape keeps its nearest editor type, so text exports still work. Other Visio-only formatting is not kept. A connection's route (straight or right-angled) can be changed in the properties panel;
in the text it is `route=elbow`, with any imported bend points as `via="x,y x,y"` in mm.

Right-angled lines are edited as in Visio: select one and drag the square handle on any segment sideways; the end
handles re-attach either end. Moving a group of shapes moves the routes between them too; moving or resizing one
end keeps the bends and slides the one next to that end so the line stays square. A line without bends is routed
automatically, around other shapes. Lines are drawn beneath shapes.

Text sizes come across from Visio (`size=8` in the text, in points) and can be set for any selection in the
properties panel. Text is measured as drawn, so words are only split when a single word is wider than its shape.

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
  js/tutorial.js         the guided tour
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

## Testing

End-to-end tests use Playwright and run every spec twice: against the modules in `src/` (served by
`build.mjs --serve`) and against the single-file `dist/flow-editor.html` opened from disk. JSZip is served from
`node_modules` instead of the CDN, so the tests work offline.

```shell
npm install
npx playwright install chromium   # first time only
npm test                          # builds, then runs tests/e2e
npm run test:ui                   # Playwright's interactive runner
```

`tests/e2e/fixtures.js` holds a small page object (`FlowApp`) that drives the editor through its UI only:
find shapes by their text, click, drag, read the selection title. Specs fail on any uncaught page error.
`tests/fixtures/visio-flowchart.vsdx` is a real Visio flowchart with every label replaced by a placeholder and the
author details removed.
