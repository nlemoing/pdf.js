import { Dict, Name, Ref } from './primitives';
import { PDFDataWriter } from './pdf_data_writer';

/**
 * Coordinates object for annotations.
 *
 * @typedef {Object} AnnotationCoordinates
 * @property {Number} [x] - The x position
 * @property {Number} [y] - The y position
 */


/**
 * Annotation parameters object.
 *
 * @typedef {Object} AnnotationProperties
 * @property {Integer} [page] - The index of the page to annotate
 * @property {AnnotationCoordinates} [coords] - Position of annotation
 * @property {String} [contents] - Contents of the annotation
 * @property {String} [author] - Author of the annotation
 */

/**
 * Returns a Dict object that represents the annotation to be written
 * This is where annotation properties are set, and where new annotation
 * types could be added
 * Refer to the PDF 1.7 spec, section 12.5 (Annotations) for more information
 * about the Dict properties that are being specified
 * @param {AnnotationProperties} annotation: object containing annotation properties 
 * @param {Page} pdfPage: page object to annotate 
 */

function annotationDict(annotation, pdfPage) {

    const { coords, contents, author, } = annotation;

    // Base annotation properties
    const newAnnotationDict = new Dict();
    newAnnotationDict.set('Type', new Name('Annot'));

    // x and y coords are a percentage of the page's width and height
    // this converts them to user space units
    const width = pdfPage.view[2];
    const height = pdfPage.view[3];
    const x = parseInt(coords.x * width);
    const y = parseInt(coords.y * height);
    // TODO: better default dimensions
    newAnnotationDict.set('Rect', [x, y, x + 12, y + 10]);

    // Text-specific properties
    newAnnotationDict.set('Subtype', new Name('Text'));
    newAnnotationDict.set('Contents', contents);
    if (author !== undefined) {
        newAnnotationDict.set('T', author);
    }

    return newAnnotationDict;
}

/**
 * 
 * @param {PDFDocument} pdfDocument PDF Document to annotate
 * @param {AnnotationProperties} annotation annotation properties
 * @param {Int} byteLength length of PDF, used for calculating offsets
 * @returns {Uint8Array} bytearray with file updates to be appended at the end 
 */
function writeAnnotation(pdfDocument, annotation, byteLength = 0) {

    const page = annotation.page;

    const trailer = pdfDocument.xref.trailer;
    const startXRef = pdfDocument.startXRef;

    // Create reference for new annotation object and update the size
    const size = trailer.get('Size');
    const newAnnotationRef = new Ref(size, 0);
    trailer.set('Size', size + 1);

    return pdfDocument.getPage(page).then((pdfPage) => {
        const pageRef = pdfPage.ref;

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

        const newAnnotationDict = annotationDict(annotation, pdfPage);

        return new PDFDataWriter(null, byteLength)
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
}

export {
    writeAnnotation,
};