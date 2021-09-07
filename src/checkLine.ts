import { normalizePath, TFile } from 'obsidian';
import OzanImagePlugin from './main';
import pollUntil from 'pollUntil';
import * as PDFHandler from 'src/util/pdfHandler';
import * as ExcalidrawHandler from 'src/util/excalidrawHandler';
import * as ObsidianHelper from 'src/util/obsidianHelper';
import * as WidgetHandler from 'src/util/widgetHandler';
import * as LinkHandler from 'src/util/linkHandler';
import * as ImageHandler from 'src/util/imageHandler';
import * as IframeHandler from 'src/util/iframeHandler';
import * as TransclusionHandler from 'src/util/transclusionHandler';
import Prism from 'prismjs';
import 'prismjs/plugins/line-numbers/prism-line-numbers.min';
import 'prismjs/components/prism-python.min';
import 'prismjs/components/prism-typescript.min';
import 'prismjs/components/prism-jsx.min';
import 'prismjs/components/prism-tsx.min';
import 'prismjs/components/prism-bash.min';
import 'prismjs/components/prism-visual-basic.min';

// Check Single Line
export const checkLine: any = async (cm: CodeMirror.Editor, lineNumber: number, targetFile: TFile, plugin: OzanImagePlugin, changedFilePath?: string) => {
	// Get the Line edited
	const line = cm.lineInfo(lineNumber);
	if (line === null) return;

	// Check if the line is an internet link
	const linkInLine = LinkHandler.getLinkInline(line.text);
	const imgInLine = ImageHandler.getImageInLine(line.text);

	// Clear the widget if link was removed
	var lineImageWidget = WidgetHandler.getWidgets(line, 'oz-image-widget');
	if (lineImageWidget && !(imgInLine.result || linkInLine.result)) lineImageWidget[0]?.clear();

	// --> Source Path for finding best File Match for Links
	var sourcePath = '';
	if (targetFile != null) {
		sourcePath = targetFile.path;
	} else {
		let activeNoteFile = ObsidianHelper.getActiveNoteFile(plugin.app.workspace);
		sourcePath = activeNoteFile ? activeNoteFile.path : '';
	}

	/* ------------------ TRANSCLUSION RENDER  ------------------ */

	if (plugin.settings && plugin.settings.renderTransclusion) {
		let lineIsTransclusion = TransclusionHandler.lineIsTransclusion(line.text);
		// Clear if there is a widget but reference is removed
		var lineTransclusionWidget = WidgetHandler.getWidgets(line, 'oz-transclusion-widget');
		if (lineTransclusionWidget && !lineIsTransclusion) {
			lineTransclusionWidget[0]?.clear();
		}

		if (lineIsTransclusion) {
			// Get the referenced file and return if doesn't exist
			let file = TransclusionHandler.getFile(line.text, plugin.app, sourcePath);
			if (!file) return;

			// If a file changed, do not render the line again
			if (changedFilePath !== undefined) return;

			// Get the file and text cache
			let cache = plugin.app.metadataCache.getCache(file.path);
			let cachedReadOfTarget = await plugin.app.vault.cachedRead(file);
			WidgetHandler.clearLineWidgets(line);

			// --> Handle #^ Block Id
			if (TransclusionHandler.lineIsWithBlockId(line.text)) {
				const blockId = TransclusionHandler.getBlockId(line.text);
				// --> Wait for Block Id Creation by Obsidian
				await pollUntil(() => cache.blocks && cache.blocks[blockId], [cache.blocks], 3000, 100).then((result) => {
					if (!result) return;
					const block = cache.blocks[blockId];
					if (block) {
						let htmlElement = TransclusionHandler.renderBlockCache(block, cachedReadOfTarget);
						TransclusionHandler.clearHTML(htmlElement, plugin);
						cm.addLineWidget(lineNumber, htmlElement, {
							className: 'oz-transclusion-widget',
							showIfHidden: false,
						});
						Prism.highlightAll();
					}
				});
			}

			// --> Render # Header Block
			if (TransclusionHandler.lineIsWithHeading(line.text)) {
				const header = TransclusionHandler.getHeader(line.text);
				const blockHeading = cache.headings?.find(
					(h) => ObsidianHelper.clearSpecialCharacters(h.heading) === ObsidianHelper.clearSpecialCharacters(header)
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
					let htmlElement = TransclusionHandler.renderHeader(startNum, endNum, cachedReadOfTarget);
					TransclusionHandler.clearHTML(htmlElement, plugin);
					cm.addLineWidget(lineNumber, htmlElement, {
						className: 'oz-transclusion-widget',
						showIfHidden: false,
					});
					Prism.highlightAll();
				}
			}

			return;
		}
	}

	/* ------------------ IFRAME RENDER  ------------------ */

	if (plugin.settings && plugin.settings.renderIframe) {
		// Check if the line is a Iframe
		const iframeInLine = IframeHandler.getIframeInLine(line.text);

		// If Regex Matches
		if (iframeInLine.result) {
			// Clear the Line Widgets
			WidgetHandler.clearLineWidgets(line);

			// Create Iframe Node
			var iframeNode = IframeHandler.createIframeNode(iframeInLine.result);

			// Add Widget in Line
			cm.addLineWidget(lineNumber, iframeNode, { className: 'oz-image-widget', showIfHidden: false });

			// End Rendering of the line
			return;
		}
	}

	/* ------------------ PDF RENDER  ------------------ */

	if (plugin.settings && plugin.settings.renderPDF) {
		// Check if the line is a  PDF
		const pdfInLine = PDFHandler.getPdfInLine(line.text);

		// If PDF Regex Matches
		if (pdfInLine.result) {
			// Clear the Line Widgets
			WidgetHandler.clearLineWidgets(line);

			// Get Source Path
			if (targetFile != null) sourcePath = targetFile.path;

			// Get PDF File
			var pdfName = PDFHandler.getPdfName(pdfInLine.linkType, pdfInLine.result);

			// Create URL for Link and Local PDF
			var pdfPath = '';

			if (LinkHandler.pathIsALink(pdfName)) {
				pdfPath = pdfName;
			} else {
				// Get the PDF File Object
				var pdfFile = plugin.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(pdfName), sourcePath);
				// Create Object URL
				var buffer = await plugin.app.vault.adapter.readBinary(normalizePath(pdfFile.path));
				var arr = new Uint8Array(buffer);
				var blob = new Blob([arr], { type: 'application/pdf' });
				pdfPath = URL.createObjectURL(blob);
				// Add Page Number
				var pdfPageNr = PDFHandler.getPdfPageNumber(pdfInLine.result);
				if (pdfPageNr) pdfPath = pdfPath + pdfPageNr;
			}

			// Create the Widget
			var pdfWidget = document.createElement('embed');
			pdfWidget.src = pdfPath;
			pdfWidget.type = 'application/pdf';
			pdfWidget.width = '100%';
			pdfWidget.height = '800px';

			// Add Widget in Line
			cm.addLineWidget(lineNumber, pdfWidget, { className: 'oz-image-widget', showIfHidden: false });

			// End Rendering of the line
			return;
		}
	}

	/* ------------------ EXCALIDRAW & IMAGE RENDER ------------------ */

	// If any of regex matches, it will add image widget
	if (linkInLine.result || imgInLine.result) {
		// Get the file name and alt text depending on format
		var filename = '';
		var alt = '';

		if (linkInLine.result) {
			// linkType 3 and 4
			filename = ImageHandler.getImageFileNameAndAltText(linkInLine.linkType, linkInLine.result).fileName;
			alt = ImageHandler.getImageFileNameAndAltText(linkInLine.linkType, linkInLine.result).altText;
		} else if (imgInLine.result) {
			filename = ImageHandler.getImageFileNameAndAltText(imgInLine.linkType, imgInLine.result).fileName;
			alt = ImageHandler.getImageFileNameAndAltText(imgInLine.linkType, imgInLine.result).altText;
		}

		// Create Image
		const img = document.createElement('img');

		var image = null;

		// Prepare the src for the Image
		if (linkInLine.result) {
			// Local File URL Correction (Outside of Vault)
			if (filename.startsWith('file:///')) filename = filename.replace('file:///', 'app://local/');
			img.src = decodeURI(filename);
		} else {
			// Get Image File
			var imageFile = plugin.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(filename), sourcePath);
			if (!imageFile) return;

			// Additional Check for Changed Files - helps updating only for changed image
			if (changedFilePath && imageFile && changedFilePath !== imageFile.path) return;

			/* ------------------ EXCALIDRAW RENDER ------------------ */

			if (['md', 'excalidraw'].contains(imageFile.extension)) {
				// md, excalidraw file check to be rendered
				if (ExcalidrawHandler.excalidrawPluginIsLoaded && ExcalidrawHandler.isAnExcalidrawFile(imageFile)) {
					// Do not render drawing if option turned off
					if (!plugin.settings.renderExcalidraw) return;

					// The file is an excalidraw drawing
					if (plugin.imagePromiseList.contains(imageFile.path)) return;
					plugin.addToImagePromiseList(imageFile.path);

					var image = await ExcalidrawHandler.createPNGFromExcalidrawFile(imageFile);

					// Check if Object or Alt Changed
					if (line.handle.widgets) {
						var currentImageNode = line.handle.widgets[0].node;
						var blobLink = currentImageNode.currentSrc;
						var existingBlop = await ImageHandler.getBlobObject(blobLink);
						if (existingBlop.size === image.size && currentImageNode.alt === alt) {
							// Drawing hasn't changed
							plugin.removeFromImagePromiseList(imageFile.path);
							return;
						}
					}

					// Generate New Link for new Drawing
					img.src = URL.createObjectURL(image);
					plugin.removeFromImagePromiseList(imageFile.path);
				} else {
					return;
				}
			}

			/* ------------------ ALL IMAGE RENDERS ------------------ */

			if (['jpeg', 'jpg', 'png', 'gif', 'svg', 'bmp'].contains(imageFile.extension)) {
				img.src = ObsidianHelper.getPathOfImage(plugin.app.vault, imageFile);
				img.setAttr('data-path', imageFile.path);
			}
		}

		// Clear the image widgets if exists
		WidgetHandler.clearLineWidgets(line);

		// Image Properties
		var altSizer = ImageHandler.altWidthHeight(alt);
		if (altSizer) {
			img.width = altSizer.width;
			if (altSizer.height) img.height = altSizer.height;
		}

		img.alt = alt;

		// Add Image widget under the Image Markdown
		cm.addLineWidget(lineNumber, img, { className: 'oz-image-widget', showIfHidden: false });
	}
};

// Check All Lines Function
export const checkLines: any = (cm: CodeMirror.Editor, from: number, to: number, plugin: OzanImagePlugin, changedFilePath?: string) => {
	// Last Used Line Number in Code Mirror
	var file = ObsidianHelper.getFileCmBelongsTo(cm, plugin.app.workspace);
	for (let i = from; i <= to; i++) {
		checkLine(cm, i, file, plugin, changedFilePath);
	}
};
