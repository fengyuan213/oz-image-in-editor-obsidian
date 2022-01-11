import OzanImagePlugin from 'src/main';
import { editorViewField, normalizePath, TFile } from 'obsidian';
import { Text } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/rangeset';
import { Decoration, EditorView } from '@codemirror/view';
import { createPNGFromExcalidrawFile } from 'src/util/excalidrawHandler';
import * as TransclusionHandler from 'src/util/transclusionHandler';
import * as ObsidianHelpers from 'src/util/obsidianHelper';
import { ImageDecoration, PDFDecoration, CustomHTMLDecoration, TransclusionDecoration } from 'src/cm6/widget';
import { detectLink, transclusionTypes } from 'src/cm6/linkDetector';

export const getDecorationsForLines = async (params: { lineNrs: number[]; view: EditorView; newDoc: Text; plugin: OzanImagePlugin }) => {
    const { newDoc, view, lineNrs, plugin } = params;

    let rangeBuilder = new RangeSetBuilder<Decoration>();

    // --> Get Source File
    const mdView = view.state.field(editorViewField);
    const sourceFile: TFile = mdView.file;

    // --> Loop Through Lines Found
    if (lineNrs.length > 0) {
        for (const lineNr of lineNrs) {
            const line = newDoc.line(lineNr);
            let newDeco: Decoration = null;

            // --> Look at Link Result
            const linkResult = detectLink({ lineText: line.text, plugin: plugin, sourceFile: sourceFile });

            // --> External Link Render
            if (linkResult && linkResult.type === 'external-image' && plugin.settings.renderImages) {
                newDeco = ImageDecoration({ url: linkResult.linkText, altText: linkResult.altText, filePath: linkResult.linkText });
            }

            // --> Vault Image Render
            else if (linkResult && linkResult.type === 'vault-image' && plugin.settings.renderImages) {
                let imagePath = ObsidianHelpers.getPathOfImage(plugin.app.vault, linkResult.file);
                newDeco = ImageDecoration({ url: imagePath, altText: linkResult.altText, filePath: linkResult.file.path });
            }

            // --> Excalidraw Drawing
            else if (linkResult && linkResult.type === 'excalidraw' && plugin.settings.renderExcalidraw) {
                let excalidrawImage = await createPNGFromExcalidrawFile(linkResult.file);
                newDeco = ImageDecoration({ url: URL.createObjectURL(excalidrawImage), altText: linkResult.altText, filePath: linkResult.file.path });
            }

            // --> External PDF Link Render
            else if (linkResult && linkResult.type === 'pdf-link' && plugin.settings.renderPDF) {
                newDeco = PDFDecoration({ url: linkResult.linkText + linkResult.blockRef, filePath: linkResult.linkText + linkResult.blockRef });
            }

            // --> Internal PDF File
            else if (linkResult && linkResult.type === 'pdf-file' && plugin.settings.renderPDF) {
                const buffer = await plugin.app.vault.adapter.readBinary(normalizePath(linkResult.file.path));
                const arr = new Uint8Array(buffer);
                const blob = new Blob([arr], { type: 'application/pdf' });
                newDeco = PDFDecoration({ url: URL.createObjectURL(blob) + linkResult.blockRef, filePath: linkResult.file.path });
            }

            // --> Transclusion Render
            else if (linkResult && transclusionTypes.contains(linkResult.type) && plugin.settings.renderTransclusion) {
                let cache = plugin.app.metadataCache.getCache(linkResult.file.path);
                let cachedReadOfTarget = await plugin.app.vault.cachedRead(linkResult.file);

                // Block Id Transclusion
                if (linkResult.type === 'blockid-transclusion') {
                    const blockId = linkResult.blockRef;
                    cache = plugin.app.metadataCache.getCache(linkResult.file.path);
                    if (cache.blocks && cache.blocks[blockId]) {
                        const block = cache.blocks[blockId];
                        if (block) {
                            let htmlDivElement = TransclusionHandler.renderBlockCache(block, cachedReadOfTarget);
                            TransclusionHandler.clearHTML(htmlDivElement, plugin);
                            newDeco = TransclusionDecoration({
                                htmlDivElement,
                                type: linkResult.type,
                                filePath: linkResult.file.path,
                                blockRef: linkResult.blockRef,
                            });
                        }
                    }
                }

                // Header Transclusion
                else if (linkResult.type === 'header-transclusion') {
                    const blockHeading = cache.headings?.find(
                        (h: any) => ObsidianHelpers.clearSpecialCharacters(h.heading) === ObsidianHelpers.clearSpecialCharacters(linkResult.blockRef)
                    );
                    if (blockHeading) {
                        // --> Start Num
                        let startNum = blockHeading.position.start.offset;
                        // --> End Num
                        const blockHeadingIndex = cache.headings.indexOf(blockHeading);
                        let endNum = cachedReadOfTarget.length;
                        for (let h of cache.headings.slice(blockHeadingIndex + 1)) {
                            if (h.level <= blockHeading.level) {
                                endNum = h.position.start.offset;
                                break;
                            }
                        }
                        // --> Get HTML Render and add as Widget
                        let htmlDivElement = TransclusionHandler.renderHeader(startNum, endNum, cachedReadOfTarget);
                        TransclusionHandler.clearHTML(htmlDivElement, plugin);
                        newDeco = TransclusionDecoration({
                            htmlDivElement,
                            type: linkResult.type,
                            filePath: linkResult.file.path,
                            blockRef: linkResult.blockRef,
                        });
                    }
                }

                // File Transclusion
                else if (linkResult.type === 'file-transclusion') {
                    if (cachedReadOfTarget !== '') {
                        let htmlDivElement = document.createElement('div');
                        htmlDivElement.innerHTML = TransclusionHandler.convertMdToHtml(cachedReadOfTarget);
                        TransclusionHandler.clearHTML(htmlDivElement, plugin);
                        newDeco = TransclusionDecoration({
                            htmlDivElement,
                            type: linkResult.type,
                            filePath: linkResult.file.path,
                            blockRef: linkResult.blockRef,
                        });
                    }
                }
            }

            // --> Iframe Render
            else if (linkResult && linkResult.type === 'iframe' && plugin.settings.renderIframe) {
                newDeco = CustomHTMLDecoration({ htmlText: linkResult.match });
            }

            if (newDeco !== null) rangeBuilder.add(line.to, line.to, newDeco);
        }
    }

    return rangeBuilder.finish();
};