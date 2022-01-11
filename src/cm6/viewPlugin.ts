import { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import OzanImagePlugin from 'src/main';
import { StatefulDecorationSet } from 'src/cm6/decorations';

// --> View Plugin
export const getViewPlugin = (params: { plugin: OzanImagePlugin }): Extension => {
    const { plugin } = params;

    const imageViewPlugin = ViewPlugin.fromClass(
        class {
            decoManager: StatefulDecorationSet;

            constructor(view: EditorView) {
                this.decoManager = new StatefulDecorationSet(view);
                const state = view.state;
                this.decoManager.debouncedUpdate({ view, state, newDoc: state.doc, plugin });
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    const state = update.view.state;
                    this.decoManager.debouncedUpdate({ view: update.view, plugin, newDoc: state.doc });
                }
            }

            destroy() {}
        }
    );

    return imageViewPlugin;
};
