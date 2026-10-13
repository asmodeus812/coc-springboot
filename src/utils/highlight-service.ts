'use strict'
import deepEqual from 'deep-equal'
import {
    CodeLens,
    CodeLensProvider,
    Disposable,
    DocumentSelector,
    Emitter,
    Event,
    ProviderResult,
    TextDocument,
    Uri,
    VersionedTextDocumentIdentifier,
    events,
    languages,
    workspace,
} from 'coc.nvim'

const HIGHLIGHT_NAMESPACE = 'springboot-highlight'
const HIGHLIGHT_GROUP = 'CocSpringBootHighlight'

export interface HighlightParams {
    doc: VersionedTextDocumentIdentifier
    codeLenses: CodeLens[]
}

function normalizeUri(uri: string): string {
    return Uri.parse(uri).toString()
}

/**
 * Highlights the ranges the language server reports through `sts/highlight`, these are the places
 * in the source code for which live information from a running boot application is available
 */
export class HighlightService implements Disposable {

    private highlights: Map<string, HighlightParams> = new Map()
    private disposables: Disposable[] = []

    constructor() {
        workspace.nvim.command(`highlight default link ${HIGHLIGHT_GROUP} DiffAdd`, true)
        this.disposables.push(events.on('BufEnter', (bufnr: number) => {
            const document = workspace.getDocument(bufnr)
            if (document) {
                this.refresh(document.uri)
            }
        }))
    }

    public handle(params: HighlightParams): void {
        const uri = normalizeUri(params.doc.uri)
        this.highlights.set(uri, params)
        this.refresh(uri)
    }

    private refresh(uri: string): void {
        const document = workspace.getDocument(uri)
        const params = this.highlights.get(normalizeUri(uri))
        if (document && document.attached) {
            const ranges = params && params.doc.version === document.version ? (params.codeLenses || []).map(cl => cl.range) : []
            document.buffer.clearNamespace(HIGHLIGHT_NAMESPACE)
            if (ranges.length > 0) {
                document.buffer.highlightRanges(HIGHLIGHT_NAMESPACE, HIGHLIGHT_GROUP, ranges)
            }
        }
    }

    public dispose(): void {
        for (const document of workspace.documents) {
            document.buffer.clearNamespace(HIGHLIGHT_NAMESPACE)
        }
        this.disposables.forEach(d => d.dispose())
        this.highlights.clear()
    }
}

/**
 * Exposes the commands attached to the highlighted ranges as code lenses, these usually contain the
 * live information summary, e.g. the wired beans or the evaluated conditions in the running app
 */
export class HighlightCodeLensProvider implements CodeLensProvider {

    private highlights: Map<string, HighlightParams> = new Map()
    private _onDidChangeCodeLenses = new Emitter<void>()

    public isEnabled: () => boolean = () => true

    public refresh(): void {
        this._onDidChangeCodeLenses.fire()
    }

    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeCodeLenses.event
    }

    public handle(params: HighlightParams): void {
        const uri = normalizeUri(params.doc.uri)
        if (!deepEqual(this.highlights.get(uri), params)) {
            this.highlights.set(uri, params)
            this._onDidChangeCodeLenses.fire()
        }
    }

    public provideCodeLenses(document: TextDocument): ProviderResult<CodeLens[]> {
        const params = this.highlights.get(normalizeUri(document.uri))
        if (this.isEnabled() && params && params.doc.version === document.version) {
            return (params.codeLenses || []).filter(cl => cl.command).map(cl => ({ range: cl.range, command: cl.command }))
        }
        return []
    }
}

/**
 * Registers the code lens provider for highlights, lenses are only provided while the corresponding setting is enabled
 */
export function registerHighlightCodeLens(selector: DocumentSelector, provider: HighlightCodeLensProvider, settingKey: string): Disposable {
    provider.isEnabled = () => workspace.getConfiguration().get<boolean>(settingKey, true)
    const registration = languages.registerCodeLensProvider(selector, provider)
    const listener = workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(settingKey)) {
            provider.refresh()
        }
    })
    return Disposable.create(() => {
        listener.dispose()
        registration.dispose()
    })
}
