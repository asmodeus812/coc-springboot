'use strict'
import * as path from 'node:path'
import {
    nvim,
    services,
    commands,
    extensions,
    window,
    workspace,
    ConfigurationTarget,
    Disposable,
    ExtensionContext,
} from 'coc.nvim'

import * as commons from './utils'
import { ApiManager } from "./apiManager"
import { ExtensionAPI } from "./api"
import { registerJavaDataService, registerClasspathService } from "./utils"
import { startPropertiesConversionSupport } from "./convert-props-yaml"
import * as liveHoverUi from "./live-hover-connect-ui"
import * as setLogLevelUi from "./set-log-levels-ui"
import { buildCommandsMiddleware, registerBuildCommands } from "./build-commands"
import { configFileSelector, isRegistrationHookSupported, languageIdMiddleware, registerLegacyFiletypes } from "./language-ids"
import { logToSpringBootOutput } from "./utils/logging"
import { registerHelp } from "./help"

const JAVA_LANGUAGE_ID = "java"
const XML_LANGUAGE_ID = "xml"

const STOP_ASKING = "Stop Asking"

export function activate(context: ExtensionContext): Promise<ExtensionAPI> {
    registerHelp(context).catch(error => logToSpringBootOutput(`Unable to register the help page: ${error}`))

    const specificVmArgs = [
        "-Dspring.config.location=classpath:/application.properties",
        "-Djdk.util.zip.disableZip64ExtraFieldValidation=true"
    ]

    const aiPreferencesConfig = workspace.getConfiguration("boot-java.ai")
    const mcpServerEnabled = aiPreferencesConfig.get<boolean>("mcp-server-enabled")
    const mcpServerPort = aiPreferencesConfig.get<number>("mcp-server-port", 50627)

    if (mcpServerEnabled === true && mcpServerPort >= 0 && mcpServerPort <= 65535) {
        specificVmArgs.push("-Dserver.port=" + mcpServerPort)
    } else {
        // the embedded mcp server is a web application, do not start it when it is not requested
        specificVmArgs.push("-Dspring.main.web-application-type=NONE")
    }

    let options: commons.ActivatorOptions = {
        extensionId: 'springboot',
        CONNECT_TO_LS: false,
        jvmHeap: '1024m',
        preferJdk: true,
        DEBUG: false,
        vmArgs: specificVmArgs,
        checkjvm: (_, jvm: commons.JVM) => {
            let version = jvm.getMajorVersion()
            if (version < 21) {
                throw new Error(`Spring Tools Language Server requires Java 21 or higher to be launched. Current Java version is ${version}`)
            }

            const missingModules = jvm.getMissingJdkModules()
            if (missingModules.length > 0) {
                void window.showWarningMessage(
                    `The Java runtime used by Spring Tools (${jvm.getJavaHome()}) does not provide the ${missingModules.join(' and ')} module${missingModules.length > 1 ? 's' : ''}. `
                    + 'A full JDK is required to attach to locally running Spring Boot apps, hence live process information (live hovers and live metrics) is unavailable. All other features work as usual.',
                    STOP_ASKING).then(selection => {
                        if (selection === STOP_ASKING) {
                            options.workspaceOptions.update('checkJVM', false, ConfigurationTarget.Global).then(undefined, error => logToSpringBootOutput(`Unable to stop asking about the JVM: ${error}`))
                        }
                    })
            }
        },
        workspaceOptions: workspace.getConfiguration("spring-boot.ls"),
        clientOptions: {
            markdown: {
                isTrusted: true
            },
            disabledFeatures: [
                // TODO: coc does not handle multiple symbol providing clients
                "documentHighlight",
                "documentSymbol"
            ],
            documentSelector: [
                ...configFileSelector,
                {
                    language: XML_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: JAVA_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: JAVA_LANGUAGE_ID,
                    scheme: 'jdt'
                },
            ],
            synchronize: {
                configurationSection: ['boot-java', 'spring-boot', 'http']
            },
            middleware: { ...buildCommandsMiddleware, ...languageIdMiddleware },
            initializationOptions: () => ({
                workspaceFolders: workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.toString()) : null,
                // Do not enable JDT classpath listeners at the startup - classpath service would enable it later if needed based on the Java extension mode
                // Classpath service registration requires commands to be registered and Boot LS needs to register classpath
                // listeners when client has callbacks for STS4 extension java related messages registered via JDT classpath and Data Service registration
                enableJdtClasspath: false
            })
        },
        highlightCodeLensSettingKey: 'boot-java.highlight-codelens.on'
    }

    let legacyFiletypes: Disposable | undefined

    return commons.activate(options, context).then(client => {
        // one start for whoever asks first: jdtls (vscode-spring-boot.ls.start) or the start once jdtls imported the projects
        let starting: Promise<void> | undefined
        const start = (): Promise<void> => {
            starting = starting ?? client.start().then(started, error => {
                starting = undefined
                void window.showErrorMessage(`Unable to start the Spring Boot language server: ${error}`)
            })
            return starting
        }
        const started = (): void => {
            console.log(`Starting spring-boot server`)
            void window.showInformationMessage('Spring Boot language server started')

            services.registerLanguageClient(client)
            registerClasspathService(client, context)
            registerJavaDataService(client)

            // Force classpath listener to be enabled. Boot LS can only be launched iff classpath is available and there Spring-Boot on the classpath somewhere.
            commands.executeCommand('sts.vscode-spring-boot.enableClasspathListening', true)
                .catch(error => logToSpringBootOutput(`Unable to enable the classpath listening: ${error}`))

            // the server registers completion for the spring language ids right after the start, older coc versions do not
            // route these registrations through the middleware, fallback to forcing the spring language ids as filetypes
            setTimeout(() => {
                if (!isRegistrationHookSupported() && !legacyFiletypes) {
                    logToSpringBootOutput('Dynamic registration middleware not supported by coc, forcing spring filetypes on configuration files')
                    legacyFiletypes = registerLegacyFiletypes()
                    context.subscriptions.push(legacyFiletypes)
                }
            }, 10000)
        }
        // @Note that the name of this command is hard coded in the spring boot extensions and is expected to be exactly - vscode-spring-boot.ls.start
        context.subscriptions.push(commands.registerCommand('vscode-spring-boot.ls.start', start))
        // jdtls sends the start only once, after an event of its own that can pass before its spring plugin listens for
        // it: start the server ourselves once jdtls has imported the projects and one of them has spring boot, and again
        // when coc-java imports projects or updates a classpath later
        // one check at a time: an import sends several events in a row
        let checking: boolean = false
        const startIfBoot = (projects?: string[]): void => {
            if (client.needsStart() && !checking) {
                checking = true
                startWhenJavaReady(start, projects)
                    .catch(error => logToSpringBootOutput(`Start after the java import failed: ${error}`))
                    .finally(() => { checking = false })
            }
        }
        startIfBoot()
        watchProjects(startIfBoot, context)
        context.subscriptions.push(commands.registerCommand('vscode-spring-boot.ls.stop', () => client.stop().then(() => {
            starting = undefined
            void window.showInformationMessage('Spring Boot language server stopped')
        }, error => {
            void window.showErrorMessage(`Unable to stop the Spring Boot language server: ${error}`)
        })))

        commons.registerCommands(context)
        registerJarContentLoader(context)
        registerBuildCommands(client, context)
        liveHoverUi.activate(client, context)
        setLogLevelUi.activate(client, context)
        startPropertiesConversionSupport(context)
        registerMiscCommands(context)

        return new ApiManager(client).api
    })
}

/**
 * Load the content of `spring-boot-ls:file:/...jar!/...` links (jar entries) through the language server,
 * the coc content providers only handle `scheme:/...` buffer names, hence the dedicated autocmd
 */
function registerJarContentLoader(context: ExtensionContext) {
    context.subscriptions.push(workspace.registerAutocmd({
        event: "BufReadCmd",
        pattern: "spring-boot-ls:*/*",
        arglist: ["expand('<afile>')", "+expand('<abuf>')"],
        request: true,
        callback: async (uri: string, bufnr: number) => {
            try {
                const content = await commands.executeCommand<string>('sts/jar/fetch-content', uri)
                const buffer = nvim.createBuffer(bufnr)
                await buffer.setLines((content || '').split(/\r?\n/), { start: 0, end: -1, strictIndexing: false })
                await buffer.setOption('buftype', 'nofile')
                await buffer.setOption('modifiable', false)
                await nvim.command('filetype detect')
            } catch (error) {
                void window.showErrorMessage(`Unable to load ${uri}: ${error}`)
            }
        }
    }))
}

function registerMiscCommands(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('springboot.spring.modulith.metadata.refresh', async () => {
            let modulithProjects: any
            let serverMissing = false
            try {
                modulithProjects = await commands.executeCommand('sts/modulith/projects')
            } catch (error) {
                serverMissing = true
            }
            const projectNames: any[] = Object.keys(modulithProjects || {})
            if (serverMissing) {
                void window.showWarningMessage('The Spring Boot language server is not running (or still starting)')
            } else if (projectNames.length === 0) {
                void window.showErrorMessage('No Spring Modulith projects found')
            } else {
                const projectName = projectNames.length === 1 ? projectNames[0] : await window.showQuickPick(
                    projectNames,
                    { placeholder: "Select the target project." },
                )
                if (projectName) {
                    try {
                        await commands.executeCommand('sts/modulith/metadata/refresh', modulithProjects[projectName])
                        void window.showInformationMessage(`Refreshed the Spring Modulith metadata of ${projectName}`)
                    } catch (error) {
                        void window.showErrorMessage(`Unable to refresh the Spring Modulith metadata: ${error}`)
                    }
                }
            }
        }),

        commands.registerCommand('springboot.properties.reload', async () => {
            try {
                const reloadOutput = await commands.executeCommand("sts/common-properties/reload")
                if (reloadOutput) {
                    void window.showInformationMessage('Reloading common properties metadata')
                } else {
                    void window.showWarningMessage('The Spring Boot language server did not reload the common properties metadata')
                }
            } catch (error) {
                void window.showErrorMessage(`Unable to reload the common properties metadata: ${error}`)
            }
        }),
    )
}

/**
 * Watches the java projects for `changed`, a failure to watch them is logged
 */
function watchProjects(changed: (projects: string[]) => void, context: ExtensionContext): void {
    watchJavaProjects(changed, context)
        .catch(error => logToSpringBootOutput(`Unable to watch the java projects: ${error}`))
}

/**
 * Calls `changed` with the projects coc-java imports or updates the classpath of, read from its API once it is active.
 */
async function watchJavaProjects(changed: (projects: string[]) => void, context: ExtensionContext): Promise<void> {
    const api = await javaExports<JavaEvents>()
    if (api?.onDidProjectsImport) {
        context.subscriptions.push(api.onDidProjectsImport(projects => changed(projects.map(uri => uri.toString()))))
    }
    if (api?.onDidClasspathUpdate) {
        context.subscriptions.push(api.onDidClasspathUpdate(project => changed([project.toString()])))
    }
}

/** The exports of coc-java, activating it first when needed, undefined when coc-java is not installed. */
async function javaExports<T>(): Promise<T | undefined> {
    const java = extensions.getExtensionById<T>('coc-java')
    let api: T | undefined = undefined
    if (java?.isActive) {
        api = java.exports
    } else if (java) {
        api = await java.activate()
    }
    return api
}

/** The events of coc-java's API about the projects of the workspace, each with the root uri of the projects. */
interface JavaEvents {
    onDidProjectsImport?: (listener: (projects: { toString(): string }[]) => void) => Disposable
    onDidClasspathUpdate?: (listener: (project: { toString(): string }) => void) => Disposable
}

/**
 * Waits until coc-java's jdtls has imported the projects (its `serverReady`), then starts the Spring Boot server when a
 * project has a spring-boot jar on its classpath, the condition jdtls's spring plugin starts it on.
 */
async function startWhenJavaReady(start: () => Promise<void>, projects?: string[]): Promise<void> {
    const api = await javaExports<{ serverReady?: () => Promise<boolean> }>()
    const ready: boolean = api?.serverReady ? await api.serverReady() : false
    if (ready && await hasBootProject(projects)) {
        logToSpringBootOutput('Starting the Spring Boot server after the java import')
        await start()
    }
}

/**
 * Whether one of `projects` (the root uris, all projects of the workspace when not given) has spring boot on its classpath.
 */
async function hasBootProject(projects?: string[]): Promise<boolean> {
    const run = (command: string, ...args: any[]): Promise<any> => commands.executeCommand('java.execute.workspaceCommand', command, ...args)
    const uris: string[] = projects ?? (await run('java.project.getAll').catch(() => []) ?? [])
    let found: boolean = false
    for (const uri of uris) {
        if (!found) {
            const result = await run('java.project.getClasspaths', uri, JSON.stringify({ scope: 'runtime' })).catch(() => undefined)
            found = ((result?.classpaths ?? []) as string[]).some(entry => path.basename(entry).startsWith('spring-boot'))
        }
    }
    return found
}
