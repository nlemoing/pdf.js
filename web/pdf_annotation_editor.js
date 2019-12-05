const ENTER_KEY = 13;
const ESCAPE_KEY = 27;

class PDFAnnotationEditor {
    constructor({ annotationButton, }, eventBus) {
        this.toggleButton = annotationButton;
        this.eventBus = eventBus;
        this.active = false;
        this.editor = null;
        this.input = null;
        this.coordinates = null;
        this.page = null;
        this.toggleButton.addEventListener('click', () => {
            this.toggle();
        });
        eventBus.on('pageclick', this.handlePageClick.bind(this));
    }
    on() {
        this.active = true;
        this.toggleButton.classList.add('toggled');
        document.addEventListener('keyup', this.handleKeyPress.bind(this));
    }
    off() {
        this.active = false;
        this.toggleButton.classList.remove('toggled');
        document.removeEventListener('keyup', this.handleKeyPress);
    }
    toggle() {
        if (this.active) {
            this.off();
        } else {
            this.on();
        }
    }
    handleKeyPress({ keyCode, }) {
        if (keyCode === ENTER_KEY && this.editor) {
            this.escapeEditing(true);
        } else if (keyCode === ESCAPE_KEY && this.editor) {
            this.escapeEditing(false);
        } else if (keyCode === ESCAPE_KEY) {
            this.off();
        }
    }
    handlePageClick(e) {
        if (!this.active) {
            return;
        }
        if (this.editor) {
            this.escapeEditing(false);
            return;
        }
        this.addEditBox(e);
    }
    addEditBox({ x, y, offsetX, offsetY, page, }) {
        if (this.editor) {
            this.editor.remove();
        }
        this.coordinates = { x: offsetX, y: offsetY, };
        this.page = page;
        this.editor = document.createElement('div');
        this.editor.classList.add('addAnnotation');
        this.editor.setAttribute('style', `top: ${y}px; left: ${x}px;`);
        // Stop propagation so that clicks on editor don't escape editor
        this.editor.addEventListener('click', (evt) => {
            evt.stopPropagation();
        });
        document.body.appendChild(this.editor);
        this.input = document.createElement('textarea');
        this.editor.appendChild(this.input);
        this.input.focus();
    }
    escapeEditing(submit) {
        if (!this.editor) {
            return;
        }
        const text = this.input.value;
        if (submit) {
            this.eventBus.dispatch('createannotation',
                text, this.page, this.coordinates);
        }
        this.editor.remove();
        this.editor = null;
        this.input = null;
        this.coordinates = null;
        this.page = null;
    }
}

export {
    PDFAnnotationEditor,
};
