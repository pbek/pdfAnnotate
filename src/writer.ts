import { Util } from './util'
import { Annotation, ReferencePointer, PDFDocumentParser, Page } from './parser'
import { XRef } from './document-history'

/**
 * Creats the byte array that must be attached to the end of the document
 * */
export class Writer {

    public static N: number = 110
    public static F: number = 102

    public static SPACE: number = 32
    public static CR: number = 13
    public static LF: number = 10
    public static R: number = 82
    public static OBJ: number[] = [111, 98, 106]
    public static ENDOBJ: number[] = [101, 110, 100, 111, 98, 106]
    public static ARRAY_START: number = 91
    public static ARRAY_END: number = 93
    public static DICT_START: number[] = [60, 60]
    public static DICT_END: number[] = [62, 62]
    public static TYPE_ANNOT: number[] = [47, 84, 121, 112, 101, Writer.SPACE, 47, 65, 110, 110, 111, 116]
    public static RECT: number[] = [47, 82, 101, 99, 116]
    public static SUBTYPE: number[] = [47, 83, 117, 98, 116, 121, 112, 101]
    public static UPDATE_DATE: number[] = [47, 77] // = '/M'
    public static AUTHOR: number[] = [47, 84] // = '/T'
    public static CONTENTS: number[] = [47, 67, 111, 110, 116, 101, 110, 116, 115] // = '/Contents'
    public static BRACKET_START: number = 40
    public static BRACKET_END: number = 41
    public static FLAG: number[] = [47, 70] // = '/F'
    public static ID: number[] = [47, 78, 77] // = '/NM'
    public static COLOR: number[] = [47, 67] // = '/C'
    public static OPACITY: number[] = [47, 67, 65] // = '/CA'
    public static BORDER: number[] = [47, 66, 111, 114, 100, 101, 114] // = '/Border'
    public static PAGE_REFERENCE: number[] = [47, 80] // = '/P'
    public static DEFAULT_APPEARANCE: number[] = [47, 68, 65] // = '/DA'

    public static TRAILER: number[] = [116, 114, 97, 105, 108, 101, 114] // = 'trailer'
    public static SIZE: number[] = [47, 83, 105, 122, 101] // = '/Size'
    public static ROOT: number[] = [47, 82, 111, 111, 116] // = '/Root'
    public static PREV: number[] = [47, 80, 114, 101, 118] // ='/Prev'
    public static STARTXREF: number[] = [115, 116, 97, 114, 116, 120, 114, 101, 102] // = 'startxref'
    public static EOF: number[] = [37, 37, 69, 79, 70] // = '%%EOF'

    public static XREF: number[] = [120, 114, 101, 102] // = 'xref'

    public static QUADPOINTS: number[] = [47, 81, 117, 97, 100, 80, 111, 105, 110, 116, 115] // = '/QuadPoints'
    public static VERTICES: number[] = [47, 86, 101, 114, 116, 105, 99, 101, 115] // = '/Vertices'
    public static NAME: number[] = [47, 78, 97, 109, 101] // = '/Name'
    public static DRAFT: number[] = [47, 68, 114, 97, 102, 116] // = '/Draft'

    public static SY: number[] = [47, 83, 121] // = '/Sy'
    public static P: number = 80

    /**
     * Holds the crossite reference table
     * */
    private xrefs: XRef[] = []

    /**
     * data : The data representing the original PDF document
     * aannotations : The annotations to add to the document
     * */
    constructor(private data: Int8Array, private annotations: Annotation[], private parser: PDFDocumentParser) {
        this.data = new Int8Array(data)
    }

    /**
     * Sorts the annotations pagewise.
     *
     * This is necessary since the annotation arrays of the sites must be extended
     * and it makes sense to do this update in one step.
     * */
    sortPageWise(annotations: Annotation[]): { [item: number]: Annotation[] } {
        let pageAnnots: { [item: number]: Annotation[] } = {}

        for (let annot of annotations) {
            if (!pageAnnots[annot.page])
                pageAnnots[annot.page] = []

            pageAnnots[annot.page].push(annot)
        }

        return pageAnnots
    }

    /**
     * Writes a reference pointer
     *
     * <obj_id> <generation> R
     *
     * The 'R' and the preceding space is only written in case 'referenced' is true
     * */
    writeReferencePointer(ref: ReferencePointer, referenced: boolean = false): number[] {
        let ret: number[] = Util.convertNumberToCharArray(ref.obj)

        ret.push(Writer.SPACE)

        ret = ret.concat(Util.convertNumberToCharArray(ref.generation))

        if (referenced) {
            ret.push(Writer.SPACE)

            ret.push(Writer.R)
        }

        return ret
    }

    /**
     * It returns the object extended with the /Annot entry.
     *
     * ptr : Pointer to the page object
     * annot_array_reference : The reference to the annotation array
     * */
    adaptPageObject(page: Page, annot_array_reference: ReferencePointer): number[] {
        if (!page.object_id)
            throw Error("Page without object id")

        let ret: number[] = []
        let lookupTable = this.parser.documentHistory.createObjectLookupTable()

        let page_ptr: XRef = lookupTable[page.object_id.obj]

        let ptr_objend = Util.locateSequence(Util.ENDOBJ, this.data, page_ptr.pointer, true)

        let object_data = this.data.slice(page_ptr.pointer, ptr_objend + Util.ENDOBJ.length)

        let ptr_dict_end = Util.locateSequence(Util.DICT_END, object_data, 0, true)

        ret = Array.from(object_data.slice(0, ptr_dict_end))

        ret = ret.concat(Util.ANNOTS)
        ret.push(Util.SPACE)
        ret = ret.concat(this.writeReferencePointer(annot_array_reference, true))
        ret.push(Util.SPACE)
        ret = ret.concat(Array.from(object_data.slice(ptr_dict_end, object_data.length)))
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        return ret
    }

    /**
     * Takes the annotations of >>one<< page and derives the annotations array from it.
     * Thereby it also considers the potentially existing annotation array.
     * */
    writeAnnotArray(annots: Annotation[]): { ptr: ReferencePointer, data: number[], pageReference: ReferencePointer, pageData: number[] } {
        let page = annots[0].pageReference

        if (!page)
            throw Error("Missing page reference")

        if (!page.object_id)
            throw Error("Page without object id")

        let references: ReferencePointer[] = page.annots

        references = references.concat(annots.map((x) => {
            if (!x.object_id)
                throw Error("Annotation with object_id null")

            return x.object_id
        }))

        let refArray_id = page.annotsPointer

        let page_data: number[] = []
        if (!refArray_id) {
            refArray_id = this.parser.getFreeObjectId()
            page_data = this.adaptPageObject(page, refArray_id)
        }

        let ret: number[] = this.writeReferencePointer(refArray_id)
        ret.push(Writer.SPACE)
        ret = ret.concat(Writer.OBJ)
        ret.push(Writer.SPACE)
        ret.push(Writer.ARRAY_START)


        for (let an of references) {
            ret = ret.concat(this.writeReferencePointer(an, true))
            ret.push(Writer.SPACE)
        }

        ret.push(Writer.ARRAY_END)
        ret.push(Writer.SPACE)

        ret = ret.concat(Writer.ENDOBJ)
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        return { ptr: refArray_id, data: ret, pageReference: page.object_id, pageData: page_data }
    }

    /**
     * Converts a subtype to its byte representation
     * */
    convertSubtype(st: string): number[] {
        switch (st) {
            case 'Text':
            case '/Text':
                return [47, 84, 101, 120, 116] // = '/Text'
            case 'Highlight':
            case '/Highlight':
                return [47, 72, 105, 103, 104, 108, 105, 103, 104, 116] // = '/Highlight'
            case 'Underline':
            case '/Underline':
                return [47, 85, 110, 100, 101, 114, 108, 105, 110, 101] // = '/Underline'
            case 'Squiggly':
            case '/Squiggly':
                return [47, 83, 113, 117, 105, 103, 103, 108, 121] // = '/Squiggly'
            case 'StrikeOut':
            case '/StrikeOut':
                return [47, 83, 116, 114, 105, 107, 101, 79, 117, 116] // = '/StrikeOut'
            case 'Square':
            case '/Square':
                return [47, 83, 113, 117, 97, 114, 101] // = '/Square'
            case 'Circle':
            case '/Circle':
                return [47, 67, 105, 114, 99, 108, 101] // = '/Circle'
            case 'FreeText':
            case '/FreeText':
                return [47, 70, 114, 101, 101, 84, 101, 120, 116] // = '/FreeText'
            case 'Polygon':
            case '/Polygon':
                return [47, 80, 111, 108, 121, 103, 111, 110] // = '/Polygon'
            case 'PolyLine':
            case '/PolyLine':
                return [47, 80, 111, 108, 121, 76, 105, 110, 101] // '/PolyLine
            case 'Stamp':
            case '/Stamp':
                return [47, 83, 116, 97, 109, 112] // = '/Stamp'
            case 'Caret':
            case '/Caret':
                return [47, 67, 97, 114, 101, 116] // = '/Caret'
        }

        return []
    }

    /**
     * Writes a javascript number array to a PDF number array
     * */
    writeNumberArray(array: number[]): number[] {
        let ret: number[] = [Writer.ARRAY_START]

        for (let i of array) {
            ret = ret.concat(Util.convertNumberToCharArray(i))
            ret.push(Writer.SPACE)
        }

        ret.push(Writer.ARRAY_END)

        return ret
    }

    /**
     * Writes an annotation object
     * */
    writeAnnotationObject(annot: Annotation): { ptr: ReferencePointer, data: number[] } {
        if (!annot.author || "" === annot.author)
            throw Error("No author provided")

        if (!annot.contents || "" === annot.contents)
            throw Error("No content provided")

        if (!annot.object_id)
            throw Error("No object_id")

        let ret: number[] = this.writeReferencePointer(annot.object_id)
        ret.push(Writer.SPACE)
        ret = ret.concat(Writer.OBJ)
        ret.push(Writer.SPACE)
        ret = ret.concat(Writer.DICT_START)
        ret = ret.concat(Writer.TYPE_ANNOT)
        ret.push(Writer.SPACE)

        if (annot.rect && annot.rect.length > 0) {
            ret = ret.concat(Writer.RECT)
            ret.push(Writer.SPACE)
            ret = ret.concat(this.writeNumberArray(annot.rect))
            ret.push(Writer.SPACE)
        }

        ret = ret.concat(Writer.SUBTYPE)
        ret.push(Writer.SPACE)
        ret = ret.concat(this.convertSubtype(annot.type))
        ret.push(Writer.SPACE)

        ret = ret.concat(Writer.UPDATE_DATE)
        ret.push(Writer.SPACE)
        ret = ret.concat(Util.convertStringToAscii(annot.updateDate))
        ret.push(Writer.SPACE)

        ret = ret.concat(Writer.AUTHOR)
        ret.push(Writer.SPACE)
        ret.push(Writer.BRACKET_START)
        ret = ret.concat(Util.convertStringToAscii(annot.author))
        ret.push(Writer.BRACKET_END)
        ret.push(Writer.SPACE)

        if (annot.contents) {
            ret = ret.concat(Writer.CONTENTS)
            ret.push(Writer.SPACE)
            ret.push(Writer.BRACKET_START)
            ret = ret.concat(Util.convertStringToAscii(annot.contents))
            ret.push(Writer.BRACKET_END)
            ret.push(Writer.SPACE)
        }

        ret = ret.concat(Writer.ID)
        ret.push(Writer.SPACE)
        ret = ret.concat(Util.convertStringToAscii(annot.id))
        ret.push(Writer.SPACE)

        if (annot.annotation_flag) {
            ret = ret.concat(Writer.FLAG)
            ret.push(Writer.SPACE)
            ret = ret.concat(Util.convertNumberToCharArray(annot.annotation_flag))
            ret.push(Writer.SPACE)
        }

        if (annot.color) {
            if (annot.color.r > 1) annot.color.r /= 255
            if (annot.color.g > 1) annot.color.g /= 255
            if (annot.color.b > 1) annot.color.b /= 255

            ret.push(Writer.SPACE)
            ret = ret.concat(Writer.COLOR)
            ret.push(Writer.SPACE)
            ret = ret.concat(this.writeNumberArray([annot.color.r, annot.color.g, annot.color.b]))
            ret.push(Writer.SPACE)
        }


        let opacity = annot.opacity
        if (opacity) {
            ret = ret.concat(Writer.OPACITY)
            ret.push(Writer.SPACE)
            ret = ret.concat(Util.convertNumberToCharArray(opacity))
            ret.push(Writer.SPACE)
        }

        if (annot.border) {
            ret.push(Writer.SPACE)
            ret = ret.concat(Writer.BORDER)
            ret.push(Writer.SPACE)
            ret = ret.concat(this.writeNumberArray([annot.border.horizontal_corner_radius, annot.border.vertical_corner_radius, annot.border.border_width]))
            ret.push(Writer.SPACE)
        }

        if (annot.defaultAppearance) {
            ret.push(Writer.SPACE)
            ret = ret.concat(Writer.DEFAULT_APPEARANCE)
            ret.push(Writer.SPACE)
            ret.push(Writer.BRACKET_START)
            ret = ret.concat(Util.convertStringToAscii(annot.defaultAppearance))
            ret.push(Writer.BRACKET_END)
            ret.push(Writer.SPACE)
        }

        if (!annot.pageReference)
            throw Error("No page reference")

        if (annot.pageReference.object_id) {
            ret.push(Writer.SPACE)
            ret = ret.concat(Writer.PAGE_REFERENCE)
            ret.push(Writer.SPACE)
            ret = ret.concat(this.writeReferencePointer(annot.pageReference.object_id, true))
            ret.push(Writer.SPACE)
        }

        if (annot.quadPoints) {
            ret = ret.concat(Writer.QUADPOINTS)
            ret.push(Writer.SPACE)
            ret = ret.concat(this.writeNumberArray(annot.quadPoints))
            ret.push(Writer.SPACE)
        }

        if (annot.vertices) {
            ret = ret.concat(Writer.VERTICES)
            ret.push(Writer.SPACE)
            ret = ret.concat(this.writeNumberArray(annot.vertices))
            ret.push(Writer.SPACE)
        }

        if (annot.stampType) {
            ret = ret.concat(Writer.NAME)
            ret.push(Writer.SPACE)
            ret = ret.concat(Writer.DRAFT)
            ret.push(Writer.SPACE)
        }

        if (annot.caretSymbol) {
            ret = ret.concat(Writer.SY)
            ret.push(Writer.SPACE)
            ret.push(Writer.P)
            ret.push(Writer.SPACE)
        }

        ret = ret.concat(Writer.DICT_END)
        ret.push(Writer.SPACE)
        ret = ret.concat(Writer.ENDOBJ)
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        return { ptr: annot.object_id, data: ret }
    }

    /**
     * Takes all the cross site reference table entries and extracts the consecutive sequences
     * */
    computeXrefSequences(): XRef[][] {
        let seqs: XRef[][] = []

        let ordered_xrefs = this.xrefs.sort((a, b) => {
            if (a.id < b.id)
                return -1
            if (a.id > b.id)
                return 1
            return 0
        })

        let seq: XRef[] = [ordered_xrefs[0]]
        let last_id = ordered_xrefs[0].id
        seqs.push(seq)
        for (let i = 1; i < ordered_xrefs.length; ++i) {
            if (ordered_xrefs[i].id === last_id + 1) {
                seq.push(ordered_xrefs[i])
            } else {
                seq = [ordered_xrefs[i]]
                seqs.push(seq)
            }
            last_id = ordered_xrefs[i].id
        }

        return seqs
    }

    /**
     * Adds preceding zeros (0) in front of the 'value' to match the length
     * */
    pad(length: number, value: string | number): number[] {
        value = String(value)

        let ret: number[] = []

        for (let i = 0; i < length - value.length; ++i) {
            ret.push(48)
        }

        ret = ret.concat(Util.convertNumberToCharArray(value))

        return ret
    }

    /**
     * Writes the crossite reference table
     * */
    writeCrossSiteReferenceTable(): number[] {
        let ret: number[] = Writer.XREF
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        // write free object head
        let head = this.parser.documentHistory.getRecentUpdate().refs[0]
        this.xrefs.push(head)

        let ordered_sequences = this.computeXrefSequences()

        for (let sequence of ordered_sequences) {
            head = sequence[0]
            ret = ret.concat(Util.convertNumberToCharArray(head.id))
            ret.push(Writer.SPACE)
            ret = ret.concat(Util.convertNumberToCharArray(sequence.length))
            ret.push(Writer.CR)
            ret.push(Writer.LF)

            for (let i = 0; i < sequence.length; ++i) {
                let _ret: number[] = []
                _ret = _ret.concat(this.pad(10, sequence[i].pointer))
                _ret.push(Writer.SPACE)
                _ret = _ret.concat(this.pad(5, sequence[i].generation))
                _ret.push(Writer.SPACE)

                if (sequence[i].free)
                    _ret.push(Writer.F)

                if (sequence[i].update)
                    _ret.push(Writer.N)

                _ret.push(Writer.CR)
                _ret.push(Writer.LF)

                if (_ret.length < 20)
                    throw Error("XRef entry < 20 bytes")

                ret = ret.concat(_ret)
            }
        }

        return ret
    }

    /**
     * Writes the trailer
     * */
    writeTrailer(posXref: number): number[] {
        let ret: number[] = Writer.TRAILER
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        ret = ret.concat(Writer.DICT_START)
        ret = ret.concat(Writer.SIZE)
        ret.push(Writer.SPACE)
        ret = ret.concat(Util.convertNumberToCharArray(this.parser.documentHistory.trailerSize))
        ret.push(Writer.SPACE)

        let trailer = this.parser.documentHistory.getRecentUpdate().trailer
        ret = ret.concat(Writer.ROOT)
        ret.push(Writer.SPACE)
        ret = ret.concat(this.writeReferencePointer(trailer.root, true))
        ret.push(Writer.SPACE)

        ret = ret.concat(Writer.PREV)
        ret.push(Writer.SPACE)
        ret = ret.concat(Util.convertNumberToCharArray(this.parser.documentHistory.getRecentUpdate().start_pointer))
        ret = ret.concat(Writer.DICT_END)
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        ret = ret.concat(Writer.STARTXREF)
        ret.push(Writer.CR)
        ret.push(Writer.LF)

        ret = ret.concat(Util.convertNumberToCharArray(posXref))
        ret.push(Writer.CR)
        ret.push(Writer.LF)
        ret = ret.concat(Writer.EOF)

        return ret
    }

    /**
     * Writes the annations at the end of the PDF byte representation and returns
     * the byte array
     * */
    write(): Int8Array {
        let pageWiseSorted = this.sortPageWise(this.annotations)

        let ptr: number = this.data.length

        let new_data: number[] = []

        for (let key in pageWiseSorted) {
            let pageAnnots = pageWiseSorted[key]

            let annot_array = this.writeAnnotArray(pageAnnots)
            this.xrefs.push({
                id: annot_array.ptr.obj,
                pointer: ptr,
                generation: annot_array.ptr.generation,
                free: false,
                update: true
            })

            new_data = new_data.concat(annot_array.data)
            ptr += annot_array.data.length

            // add adapted page object if it exists
            if (annot_array.pageData.length > 0) {
                this.xrefs.push({
                    id: annot_array.pageReference.obj,
                    pointer: ptr,
                    generation: annot_array.pageReference.generation,
                    free: false,
                    update: true
                })
                new_data = new_data.concat(annot_array.pageData)
                ptr += annot_array.pageData.length
            }

            for (let annot of pageAnnots) {
                let annot_obj = this.writeAnnotationObject(annot)
                this.xrefs.push({
                    id: annot_obj.ptr.obj,
                    pointer: ptr,
                    generation: annot_obj.ptr.generation,
                    free: false,
                    update: true
                })

                new_data = new_data.concat(annot_obj.data)
                ptr += annot_obj.data.length
            }
        }

        let crtable = this.writeCrossSiteReferenceTable()
        new_data = new_data.concat(crtable)

        let trailer = this.writeTrailer(ptr)
        new_data = new_data.concat(trailer)

        let new_data_array = new Int8Array(new_data)

        let ret_array = new Int8Array(this.data.length + new_data_array.length)
        ret_array.set(this.data)
        ret_array.set(new_data, this.data.length)

        return ret_array
    }
}
