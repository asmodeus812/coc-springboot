import * as deepEqual from 'deep-equal';
import {
    CancellationToken,
    CodeLens,
    CodeLensProvider,
    Event,
    Emitter,
    ProviderResult,
    TextDocument,
    Uri
} from "coc.nvim";
// import {HighlightParams, toVSRange} from './highlight-service';
// import * as Lsp from 'vscode-languageclient';

export class HighlightCodeLensProvider implements CodeLensProvider {

    private _onDidChangeCodeLenses = new Emitter<void>();

    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeCodeLenses.event;
    }

    static toVSCodeLens(cl: Lsp.CodeLens): CodeLens {
        const codeLens: CodeLens = {
            range: toVSRange(cl.range),
            command: cl.command
        };
        return codeLens;
    }

    provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]> {
        const activeUri = document.uri.toString();
        const activeVersion = document.version;
        const highlightParams = this.highlights.get(activeUri);
        if (highlightParams && highlightParams.doc.version === activeVersion) {
            const codeLenses = highlightParams.codeLenses || [];
            return codeLenses.filter(cl => cl.command)
        }
        return [];
    };

}
