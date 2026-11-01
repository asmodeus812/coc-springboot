'use strict'
import * as path from 'path'
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
                throw Error(`Spring Tools Language Server requires Java 21 or higher to be launched. Current Java version is ${version}`)
            }

            const missingModules = jvm.getMissingJdkModules()
            if (missingModules.length > 0) {
                window.showWarningMessage(
                    `The Java runtime used by Spring Tools (${jvm.getJavaHome()}) does not provide the ${missingModules.join(' and ')} module${missingModules.length > 1 ? 's' : ''}. `
                    + 'A full JDK is required to attach to locally running Spring Boot apps, hence live process information (live hovers and live metrics) is unavailable. All other features work as usual.',
                    STOP_ASKING).then(selection => {
                        if (selection === STOP_ASKING) {
                            options.workspaceOptions.update('checkJVM', false, ConfigurationTarget.Global)
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
                window.showErrorMessage(`Unable to start the Spring Boot language server: ${error}`)
            })
            return starting
        }
        const started = (): void => {
            console.log(`Starting spring-boot server`)
            window.showInformationMessage('Spring Boot language server started')

            services.registerLanguageClient(client)
            registerClasspathService(client, context)
            registerJavaDataService(client)

            // Force classpath listener to be enabled. Boot LS can only be launched iff classpath is available and there Spring-Boot on the classpath somewhere.
            commands.executeCommand('sts.vscode-spring-boot.enableClasspathListening', true)

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
        // it: start the server ourselves once jdtls has imported the projects and one of them has spring boot
        startWhenJavaReady(start).catch(error => logToSpringBootOutput(`Start after the java import failed: ${error}`))
        context.subscriptions.push(commands.registerCommand('vscode-spring-boot.ls.stop', () => client.stop().then(() => {
            starting = undefined
            window.showInformationMessage('Spring Boot language server stopped')
        }, error => {
            window.showErrorMessage(`Unable to stop the Spring Boot language server: ${error}`)
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
                window.showErrorMessage(`Unable to load ${uri}: ${error}`)
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
                window.showWarningMessage('The Spring Boot language server is not running (or still starting)')
            } else if (projectNames.length === 0) {
                window.showErrorMessage('No Spring Modulith projects found')
            } else {
                const projectName = projectNames.length === 1 ? projectNames[0] : await window.showQuickPick(
                    projectNames,
                    { placeholder: "Select the target project." },
                )
                if (projectName) {
                    try {
                        await commands.executeCommand('sts/modulith/metadata/refresh', modulithProjects[projectName])
                        window.showInformationMessage(`Refreshed the Spring Modulith metadata of ${projectName}`)
                    } catch (error) {
                        window.showErrorMessage(`Unable to refresh the Spring Modulith metadata: ${error}`)
                    }
                }
            }
        }),

        commands.registerCommand('springboot.properties.reload', async () => {
            try {
                const reloadOutput = await commands.executeCommand("sts/common-properties/reload")
                if (reloadOutput) {
                    window.showInformationMessage('Reloading common properties metadata')
                } else {
                    window.showWarningMessage('The Spring Boot language server did not reload the common properties metadata')
                }
            } catch (error) {
                window.showErrorMessage(`Unable to reload the common properties metadata: ${error}`)
            }
        }),
    )
}

/**
 * Waits until coc-java's jdtls has imported the projects (its `serverReady`), then starts the Spring Boot server when a
 * project has a spring-boot jar on its classpath, the condition jdtls's spring plugin starts it on.
 */
async function startWhenJavaReady(start: () => Promise<void>): Promise<void> {
    const java = extensions.getExtensionById<{ serverReady?: () => Promise<boolean> }>('coc-java')
    const api = java ? (java.isActive ? java.exports : await java.activate()) : undefined
    const ready: boolean = api?.serverReady ? await api.serverReady() : false
    if (ready && await hasBootProject()) {
        logToSpringBootOutput('Starting the Spring Boot server after the java import')
        await start()
    }
}

async function hasBootProject(): Promise<boolean> {
    const run = (command: string, ...args: any[]): Promise<any> => commands.executeCommand('java.execute.workspaceCommand', command, ...args)
    const projects: string[] = (await run('java.project.getAll').catch(() => [])) ?? []
    let found: boolean = false
    for (const uri of projects) {
        if (!found) {
            const result = await run('java.project.getClasspaths', uri, JSON.stringify({ scope: 'runtime' })).catch(() => undefined)
            found = ((result?.classpaths ?? []) as string[]).some(entry => path.basename(entry).startsWith('spring-boot'))
        }
    }
    return found
}
