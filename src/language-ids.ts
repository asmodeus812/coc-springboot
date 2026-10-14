import { Disposable, DocumentFilter, DocumentSelector, LinesTextDocument, Middleware, nvim, workspace } from 'coc.nvim'

const PROPERTIES_LANGUAGE_ID = "spring-boot-properties"
const YAML_LANGUAGE_ID = "spring-boot-properties-yaml"
const FACTORIES_LANGUAGE_ID = "spring-factories"
const JPA_QUERY_PROPERTIES_LANGUAGE_ID = "jpa-query-properties"

interface LanguageIdMapping {
    languageId: string
    syntax: string
    patterns: string[]
}

// set once coc routed a dynamic capability registration through the middleware below
let registrationHookUsed = false

export function isRegistrationHookSupported(): boolean {
    return registrationHookUsed
}

/**
 * The spring boot configuration files keep their native filetypes (yaml, jproperties, etc.) so that other language
 * servers (e.g. coc-yaml) keep working on them, only the language server of this extension is told about the spring
 * specific language ids, see https://github.com/neoclide/coc.nvim/issues/5112. The coc `languageIdMap` client option
 * only supports exact file names, while profile specific files (e.g. application-dev.yml) require glob patterns.
 */
const LANGUAGE_ID_MAPPINGS: LanguageIdMapping[] = [
    {
        languageId: YAML_LANGUAGE_ID,
        syntax: "yaml",
        patterns: ["**/application*.yml", "**/application*.yaml", "**/bootstrap*.yml", "**/bootstrap*.yaml"]
    },
    {
        languageId: PROPERTIES_LANGUAGE_ID,
        syntax: "jproperties",
        patterns: ["**/application*.properties", "**/bootstrap*.properties"]
    },
    {
        languageId: FACTORIES_LANGUAGE_ID,
        syntax: "jproperties",
        patterns: ["**/*.factories"]
    },
    {
        languageId: JPA_QUERY_PROPERTIES_LANGUAGE_ID,
        syntax: "jproperties",
        patterns: ["**/jpa-named-queries.properties"]
    },
]

function toFilters(mapping: LanguageIdMapping): DocumentFilter[] {
    return mapping.patterns.map(pattern => ({ scheme: 'file', pattern }))
}

/**
 * Selects the spring boot configuration files by their file name only, regardless of the native filetype
 */
export const configFileSelector: DocumentSelector = LANGUAGE_ID_MAPPINGS.flatMap(toFilters)

function findMapping(document: LinesTextDocument): LanguageIdMapping | undefined {
    return LANGUAGE_ID_MAPPINGS.find(m => workspace.match(toFilters(m), document) > 0)
}

function expandSelector(selector: any): any {
    if (!Array.isArray(selector)) {
        return selector
    }
    return selector.flatMap(filter => {
        const language = typeof filter === 'string' ? filter : filter?.language
        const mapping = LANGUAGE_ID_MAPPINGS.find(m => m.languageId === language)
        return mapping ? [filter, ...toFilters(mapping)] : [filter]
    })
}

/**
 * Sends the spring specific language id in the didOpen notification of the matching configuration files, and
 * widens the document selectors of the capabilities the server registers dynamically for the spring language ids
 * (e.g. completion) to the file name patterns, since the buffers keep their native filetypes
 */
export const languageIdMiddleware = {
    // available since coc LSP 3.18 support (2025-04), see registerLegacyFiletypes for older versions
    handleRegisterCapability: (params, next) => {
        registrationHookUsed = true
        return next({
            registrations: params.registrations.map(registration => {
                const options = registration.registerOptions as any
                return options?.documentSelector
                    ? { ...registration, registerOptions: { ...options, documentSelector: expandSelector(options.documentSelector) } }
                    : registration
            })
        })
    },
    didOpen: (document, next) => {
        const languageId = findMapping(document)?.languageId
        if (languageId && languageId !== document.languageId) {
            return next(new Proxy(document, {
                get: (target, property) => {
                    const value = property === 'languageId' ? languageId : Reflect.get(target, property, target)
                    return typeof value === 'function' ? value.bind(target) : value
                }
            }))
        }
        return next(document)
    }
} as Middleware

/**
 * Fallback for coc versions which do not route dynamic capability registrations through the middleware, the
 * capabilities the server registers for the spring language ids (e.g. completion) would never match the native
 * filetypes, hence the spring language ids are forced as buffer filetypes, which breaks other servers on these files
 */
export function registerLegacyFiletypes(): Disposable {
    const disposables: Disposable[] = []
    for (const mapping of LANGUAGE_ID_MAPPINGS) {
        disposables.push(workspace.registerAutocmd({
            event: ["BufRead", "BufNewFile"],
            callback: async () => {
                await nvim.command(`setlocal filetype=${mapping.languageId} syntax=${mapping.syntax}`)
            },
            pattern: mapping.patterns.map(p => p.replace(/^\*\*\//, '')).join(",")
        }))
    }
    for (const document of workspace.documents) {
        const mapping = findMapping(document.textDocument)
        if (mapping && document.filetype !== mapping.languageId) {
            nvim.call('setbufvar', [document.bufnr, '&filetype', mapping.languageId], true)
            nvim.call('setbufvar', [document.bufnr, '&syntax', mapping.syntax], true)
        }
    }
    return Disposable.create(() => disposables.forEach(d => d.dispose()))
}
