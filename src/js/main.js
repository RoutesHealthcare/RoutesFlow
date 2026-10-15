/* Entry point. Each module only declares things when it is imported; init() wires it to the page.
   The init() calls run in the same order as the original single script, which some of them rely on
   (for example, selection state must exist before the pointer handlers and the first render). */
import {init as initShapes} from './shapes.js';
import {init as initSelection} from './selection.js';
import {init as initTextEditor} from './text-editor.js';
import {init as initPointer} from './pointer.js';
import {init as initPalette} from './palette.js';
import {init as initProperties} from './properties.js';
import {init as initFormatsExport} from './formats/export.js';
import {init as initFormatsImport} from './formats/import.js';
import {init as initDialogs} from './dialogs.js';
import {init as initFlowModel} from './flow/model.js';
import {init as initFlowLanguage} from './flow/language.js';
import {init as initConnectionProps} from './connection-props.js';
import {init as initTextPane, TP, setPane} from './text-pane.js';
import {init as initToolbar} from './toolbar.js';
import {toast} from './core.js';
import {newDoc} from './document.js';

for(const init of [initShapes, initSelection, initTextEditor, initPointer, initPalette, initProperties, initFormatsExport, initFormatsImport, initDialogs, initFlowModel, initFlowLanguage, initConnectionProps, initTextPane, initToolbar]) init();

newDoc(); setPane(TP.open,TP.pinned);
if(!window.JSZip) toast('The zip library did not load, so Visio files cannot be opened or exported. Check the internet connection and reload.',8000);
