/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createValidAbsoluteUrl, shadow, unreachable, warn
} from '../shared/util';
import { Dict, Name, Ref } from './primitives';
import { ChunkedStreamManager } from './chunked_stream';
import { MissingDataException } from './core_utils';
import { PDFDataWriter } from './pdf_data_writer';
import { PDFDocument } from './document';
import { Stream } from './stream';

class BasePdfManager {
  constructor() {
    if (this.constructor === BasePdfManager) {
      unreachable('Cannot initialize BasePdfManager.');
    }
  }

  get docId() {
    return this._docId;
  }

  get password() {
    return this._password;
  }

  get docBaseUrl() {
    let docBaseUrl = null;
    if (this._docBaseUrl) {
      const absoluteUrl = createValidAbsoluteUrl(this._docBaseUrl);
      if (absoluteUrl) {
        docBaseUrl = absoluteUrl.href;
      } else {
        warn(`Invalid absolute docBaseUrl: "${this._docBaseUrl}".`);
      }
    }
    return shadow(this, 'docBaseUrl', docBaseUrl);
  }

  onLoadedStream() {
    unreachable('Abstract method `onLoadedStream` called');
  }

  ensureDoc(prop, args) {
    return this.ensure(this.pdfDocument, prop, args);
  }

  ensureXRef(prop, args) {
    return this.ensure(this.pdfDocument.xref, prop, args);
  }

  ensureCatalog(prop, args) {
    return this.ensure(this.pdfDocument.catalog, prop, args);
  }

  getPage(pageIndex) {
    return this.pdfDocument.getPage(pageIndex);
  }

  fontFallback(id, handler) {
    return this.pdfDocument.fontFallback(id, handler);
  }

  cleanup() {
    return this.pdfDocument.cleanup();
  }

  async ensure(obj, prop, args) {
    unreachable('Abstract method `ensure` called');
  }

  requestRange(begin, end) {
    unreachable('Abstract method `requestRange` called');
  }

  requestLoadedStream() {
    unreachable('Abstract method `requestLoadedStream` called');
  }

  sendProgressiveData(chunk) {
    unreachable('Abstract method `sendProgressiveData` called');
  }

  updatePassword(password) {
    this._password = password;
  }

  terminate(reason) {
    unreachable('Abstract method `terminate` called');
  }

  annotateDocument({ page, coords, contents, }) {

    const pdfDocument = this.pdfDocument;
    this.requestLoadedStream();
    return this.onLoadedStream().then(function(stream) {
        const pdfData = stream.bytes;

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

            return new PDFDataWriter(null, pdfData.byteLength)
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
}

class LocalPdfManager extends BasePdfManager {
  constructor(docId, data, password, evaluatorOptions, docBaseUrl) {
    super();

    this._docId = docId;
    this._password = password;
    this._docBaseUrl = docBaseUrl;
    this.evaluatorOptions = evaluatorOptions;

    const stream = new Stream(data);
    this.pdfDocument = new PDFDocument(this, stream);
    this._loadedStreamPromise = Promise.resolve(stream);
  }

  async ensure(obj, prop, args) {
    const value = obj[prop];
    if (typeof value === 'function') {
      return value.apply(obj, args);
    }
    return value;
  }

  requestRange(begin, end) {
    return Promise.resolve();
  }

  requestLoadedStream() {}

  onLoadedStream() {
    return this._loadedStreamPromise;
  }

  terminate(reason) {}
}

class NetworkPdfManager extends BasePdfManager {
  constructor(docId, pdfNetworkStream, args, evaluatorOptions, docBaseUrl) {
    super();

    this._docId = docId;
    this._password = args.password;
    this._docBaseUrl = docBaseUrl;
    this.msgHandler = args.msgHandler;
    this.evaluatorOptions = evaluatorOptions;

    this.streamManager = new ChunkedStreamManager(pdfNetworkStream, {
      msgHandler: args.msgHandler,
      length: args.length,
      disableAutoFetch: args.disableAutoFetch,
      rangeChunkSize: args.rangeChunkSize,
    });
    this.pdfDocument = new PDFDocument(this, this.streamManager.getStream());
  }

  async ensure(obj, prop, args) {
    try {
      const value = obj[prop];
      if (typeof value === 'function') {
        return value.apply(obj, args);
      }
      return value;
    } catch (ex) {
      if (!(ex instanceof MissingDataException)) {
        throw ex;
      }
      await this.requestRange(ex.begin, ex.end);
      return this.ensure(obj, prop, args);
    }
  }

  requestRange(begin, end) {
    return this.streamManager.requestRange(begin, end);
  }

  requestLoadedStream() {
    this.streamManager.requestAllChunks();
  }

  sendProgressiveData(chunk) {
    this.streamManager.onReceiveData({ chunk, });
  }

  onLoadedStream() {
    return this.streamManager.onLoadedStream();
  }

  terminate(reason) {
    this.streamManager.abort(reason);
  }
}

class UpdatePdfManager extends BasePdfManager {
  constructor(oldPdfManager, updatedData) {
    super();

    this._docId = oldPdfManager.docId;
    this._password = oldPdfManager._password;
    this._docBaseUrl = oldPdfManager._docBaseUrl;
    this.evaluatorOptions = oldPdfManager.evaluatorOptions;

    this.pdfDocument = oldPdfManager.pdfDocument;
    oldPdfManager.requestLoadedStream();
    this._loadedStreamPromise = oldPdfManager.onLoadedStream()
      .then((oldStream) => {
        const data = new Uint8Array(oldStream.bytes.byteLength +
                                    updatedData.byteLength);
        data.set(oldStream.bytes);
        data.set(updatedData, oldStream.bytes.length);
        const stream = new Stream(data);
        this.pdfDocument.update(this, stream);
        return stream;
      });
  }

  async ensure(obj, prop, args) {
    const value = obj[prop];
    if (typeof value === 'function') {
      return value.apply(obj, args);
    }
    return value;
  }

  requestRange(begin, end) {
    return Promise.resolve();
  }

  requestLoadedStream() {}

  onLoadedStream() {
    return this._loadedStreamPromise;
  }

  terminate(reason) {}
}

export {
  LocalPdfManager,
  NetworkPdfManager,
  UpdatePdfManager,
};
