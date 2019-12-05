import { PDFDataWriter } from "./pdf_data_writer";
import { Dict, Ref, Name } from "../core/primitives";


function annotateDocument(pdfManager, { page, coords, contents, }) {
    
    pdfManager.requestLoadedStream();
    return pdfManager.onLoadedStream().then(function(stream) {
        const pdfData = stream.bytes;
        const pdfDocument = pdfManager.pdfDocument;

        const trailer = pdfDocument.xref.trailer;
        const startXRef = pdfDocument.startXRef;

        // Create reference for new annotation object and update the size
        const size = trailer.get('Size');
        const newAnnotationRef = new Ref(size, 0);
        trailer.set('Size', size + 1);

        // Add annotation properties
        const newAnnotationDict = new Dict();
        newAnnotationDict.set('Type', new Name('Annot'));
        newAnnotationDict.set('Subtype', new Name('Text'));
        newAnnotationDict.set('Contents', contents);

        return pdfDocument.getPage(page).then((pdfPage) => {
            const pageRef = pdfPage.ref;

            // x and y coords are a percentage of the page's width and height
            // this converts them to user space units
            const width = pdfPage.view[2];
            const height = pdfPage.view[3];
            const x = parseInt(coords.x * width);
            const y = parseInt(coords.y * height);
            newAnnotationDict.set('Rect', [x, y, x + 12, y + 10]);

            const annotations = pdfPage.annotations;
            annotations.push(newAnnotationRef);

            const pageDict = pdfPage.pageDict;
            const newPageDict = new Dict();
            for (var k of pageDict.getKeys()) {
                if (k !== 'Annots') {
                    newPageDict.set(k, pageDict.getRaw(k));
                }
            }
            newPageDict.set('Annots', annotations);

            return new PDFDataWriter(pdfData)
                .setTrailer(trailer)
                .setStartXRef(startXRef)
                .startObj(newAnnotationRef)
                .appendDict(newAnnotationDict)
                .endObj()
                .startObj(pageRef)
                .appendDict(newPageDict)
                .endObj()
                .appendTrailer()
                .toUint8Array();
        });
    });
}

export {
    annotateDocument
};